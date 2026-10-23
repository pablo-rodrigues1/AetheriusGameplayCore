#!/usr/bin/env node
// DS-0b: Markdown report from a development combat-probe JSONL file
// (GAMEPLAY_CORE_DEV_COMBAT_PROBE_FILE). Read only. Usage:
//   node runtime/tools/combat-probe-report.mjs <probe.jsonl> [--out <report.md>]
// Correlations are SUSPICIONS, never proof: the client reports value changes
// with a cadence of up to 2000 ms over an unreliable channel
// (aetherius-client sendInputsService.ts), and ring buffers may overflow.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const POWER_WINDOW_MS = 1500;
export const HEALTH_WINDOW_MS = 3000;
/** Animation events taken as "strong attack" evidence. attackPower* is the
 * vanilla family; the others are names combat mods are known to emit. Every
 * distinct name is listed in the report so this list can be checked. */
export const POWER_EVENT = /^attackPower|power_?attack|bfco_?power|^attackStart_.*Power/i;

export function parseLines(text) {
  const rows = [], invalid = [];
  text.split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return;
    try { rows.push(JSON.parse(line)); } catch { invalid.push(index + 1); }
  });
  return { rows, invalid };
}

const fmt = value => typeof value === 'number' ? (Number.isInteger(value) ? String(value) : value.toFixed(4)) : value === null || value === undefined ? '—' : String(value);
const hex = value => typeof value === 'number' ? `0x${value.toString(16).toUpperCase()}` : '—';
const table = (head, rows) => rows.length
  ? [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map(r => `| ${r.map(c => String(c).replaceAll('|', '\\|')).join(' | ')} |`)].join('\n')
  : '_nenhum_';

export function analyze(rows) {
  const hits = rows.filter(r => r.kind === 'hit').sort((a, b) => a.timeMs - b.timeMs || a.sequence - b.sequence);
  const animations = rows.filter(r => r.kind === 'animation').sort((a, b) => a.timeMs - b.timeMs || a.sequence - b.sequence);
  const health = rows.filter(r => r.kind === 'health').sort((a, b) => a.timeMs - b.timeMs || a.sequence - b.sequence);
  const rejections = rows.filter(r => r.kind === 'rejection');
  const gaps = rows.filter(r => r.kind === 'gap');
  const resets = rows.filter(r => r.kind === 'reset');
  const counters = rows.filter(r => r.kind === 'counters').at(-1) ?? null;
  const equipment = rows.filter(r => r.kind === 'equipment');
  const writer = rows.filter(r => r.kind === 'writer').at(-1) ?? null;
  const lostByReason = {};
  for (const g of gaps) {
    const n = Number.isFinite(g.lost) ? g.lost : Number(g.to) - Number(g.from) + 1;
    const reason = g.reason ?? 'UNKNOWN';
    lostByReason[reason] = (lostByReason[reason] ?? 0) + (Number.isFinite(n) ? n : 0);
  }

  const families = new Map();
  for (const hit of hits) {
    const f = families.get(hit.family) ?? { hits: 0, power: 0, sneak: 0, bash: 0, blocked: 0, clientBlocked: 0, serverBlocked: 0, sneaking: 0, damage: 0 };
    f.hits++; f.damage += Number(hit.damage) || 0;
    for (const flag of ['power', 'sneak', 'bash', 'blocked', 'clientBlocked']) if (hit[flag]) f[flag]++;
    if (hit.blocked && !hit.clientBlocked) f.serverBlocked++;
    if (hit.aggressorSneaking) f.sneaking++;
    families.set(hit.family, f);
  }

  const power = hits.filter(h => h.power).map(hit => {
    const evidence = animations.filter(a => a.actor === hit.aggressor && POWER_EVENT.test(a.name ?? '')
      && a.timeMs <= hit.timeMs && hit.timeMs - a.timeMs <= POWER_WINDOW_MS).at(-1);
    const embedded = (hit.aggressorAnimations ?? []).find(a => POWER_EVENT.test(a.name ?? '') && a.ageMs >= 0 && a.ageMs <= POWER_WINDOW_MS);
    const found = evidence ? { name: evidence.name, ageMs: hit.timeMs - evidence.timeMs, via: 'animation buffer' }
      : embedded ? { name: embedded.name, ageMs: embedded.ageMs, via: 'hit.aggressorAnimations' } : null;
    return { hit, found, recent: (hit.aggressorAnimations ?? []).map(a => `${a.name}@-${a.ageMs}ms`).join(', ') };
  });

  // Non-finite values (serialized as null) are unavailable, never a drop.
  const finite = h => typeof h.before === 'number' && Number.isFinite(h.before) && typeof h.after === 'number' && Number.isFinite(h.after);
  const unavailableHealth = health.filter(h => !finite(h));
  const drops = health.filter(h => finite(h) && h.after < h.before).map(drop => {
    const prior = hits.filter(h => h.target === drop.actor && h.timeMs <= drop.timeMs && drop.timeMs - h.timeMs <= HEALTH_WINDOW_MS).at(-1);
    return { drop, hit: prior ?? null, distanceMs: prior ? drop.timeMs - prior.timeMs : null };
  });

  const altered = hits.filter(h => typeof h.healthCandidate === 'number' && typeof h.healthAfter === 'number'
    && Math.abs(h.healthCandidate - h.healthAfter) > 1e-4);

  const names = new Map();
  for (const a of animations) names.set(a.name, (names.get(a.name) ?? 0) + 1);
  const hostNames = new Map((counters?.animationNames ?? []).map(n => [n.name, n.count]));
  const allNames = [...new Set([...names.keys(), ...hostNames.keys()])].sort();
  const refusalsByReason = new Map(), refusalsByActor = new Map();
  for (const r of rejections) {
    refusalsByReason.set(r.reason, (refusalsByReason.get(r.reason) ?? 0) + 1);
    for (const actor of new Set([r.aggressor, r.target].filter(id => typeof id === 'number')))
      refusalsByActor.set(actor, (refusalsByActor.get(actor) ?? 0) + 1);
  }
  const events = [...hits, ...rejections].sort((a, b) => a.timeMs - b.timeMs);
  const positions = events.flatMap(event => ['aggressorState', 'targetState'].flatMap(role => {
    const state = event[role];
    return state ? [{ event, role, state, ageMs: state.movementMatches && Number.isFinite(state.lastMovementMs)
      && event.timeMs >= state.lastMovementMs ? event.timeMs - state.lastMovementMs : null }] : [];
  }));
  return { rejections, refusalsByReason, refusalsByActor, events, positions, hits, animations, health, gaps, resets, counters, equipment, writer, lostByReason, unavailableHealth, families, power, drops, altered, names, hostNames, allNames };
}

export function render(file, parsed) {
  const a = analyze(parsed.rows), out = [];
  const suspect = a.drops.filter(d => d.hit), outside = a.drops.filter(d => !d.hit);
  out.push('# Relatório da sonda de combate (DS-0b, só desenvolvimento)', '');
  out.push(`Arquivo: \`${file}\`. Linhas: ${parsed.rows.length}; inválidas: ${parsed.invalid.length ? parsed.invalid.join(', ') : 0}.`, '');
  out.push('> **Este relatório aponta suspeitas, não provas.** O cliente envia mudanças de vida com cadência de até 2000 ms e por canal unreliable;',
    '> os buffers do host são anéis limitados e podem ter sido sobrescritos (ver integridade). Correlação temporal não estabelece causa.', '');

  out.push('## 1. Integridade dos buffers', '');
  const c = a.counters?.counters;
  out.push(c ? table(['contador', 'valor'], Object.entries(c).map(([k, v]) => [k, fmt(v)])) : '_sem linha de contadores no arquivo_', '');
  out.push(`Lacunas (anel sobrescrito entre leituras): ${a.gaps.length}.`, '');
  if (a.gaps.length) out.push(table(['buffer', 'de', 'até', 'perdidas', 'motivo'],
    a.gaps.map(g => [g.buffer, g.from, g.to, fmt(g.lost ?? (g.to - g.from + 1)), g.reason])), '');
  const losses = Object.entries(a.lostByReason);
  out.push(`Amostras perdidas por motivo: ${losses.length ? losses.map(([k, v]) => `${k}=${v}`).join(', ') : 'nenhuma'}. ` +
    'HOST_RING_OVERWRITTEN: o anel do host encheu entre leituras; WRITE_FAILURE_RING_OVERWRITTEN: perdidas enquanto a escrita falhava; ' +
    'WRITE_BACKPRESSURE_RING_OVERWRITTEN: perdidas enquanto uma escrita lenta estava pendente.', '');
  const w = a.writer;
  out.push(w ? `Gravador: falhas de escrita ${w.writeFailures}; leituras puladas com escrita pendente ${w.pollsSkippedWhileWriting}; ` +
      `escritas simultâneas no máximo ${w.maxInFlightBatches ?? '—'}; último erro ${w.lastError ?? '—'}${w.recovered ? ' (recuperado nesta linha)' : ''}.`
    : 'Gravador: sem linha `writer` no arquivo (formato anterior à DS-0b-fix1).', '');
  if (a.resets.length) out.push(`Reinícios da sonda no host: ${a.resets.length}.`, '');

  out.push('## 2. Golpes por família e flags', '');
  out.push(table(['família', 'golpes', 'power', 'sneak', 'bash', 'blocked (final)', 'blocked pelo cliente', 'blocked inferido pelo servidor', 'agressor agachado', 'dano somado'],
    [...a.families].map(([family, f]) => [family, f.hits, f.power, f.sneak, f.bash, f.blocked, f.clientBlocked, f.serverBlocked, f.sneaking, fmt(f.damage)])), '');
  const detection = [...new Set(a.hits.map(h => h.detection ?? 'AUSENTE'))];
  out.push(`Detecção do alvo nos golpes: ${detection.join(', ') || '—'} (o host não guarda detecção; furtivo não é deduzido de agachamento).`, '');

  out.push(`## 3. Ataque forte: evento de animação do agressor até ${POWER_WINDOW_MS} ms antes`, '');
  const confirmed = a.power.filter(p => p.found).length;
  out.push(`Golpes com power=true: ${a.power.length}; com evento compatível (${POWER_EVENT}): ${confirmed}; sem evento: ${a.power.length - confirmed}.`, '');
  out.push(table(['seq', 'tempo', 'agressor', 'família', 'evento encontrado', 'idade (ms)', 'origem', 'últimos eventos do agressor'],
    a.power.map(p => [p.hit.sequence, p.hit.timeMs, hex(p.hit.aggressor), p.hit.family, p.found?.name ?? 'NENHUM', fmt(p.found?.ageMs), p.found?.via ?? '—', p.recent || '—'])), '');

  out.push(`## 4. Quedas de vida informadas pelo cliente (OnChangeValues) até ${HEALTH_WINDOW_MS} ms depois de um golpe no mesmo ator`, '');
  out.push(`Quedas: ${a.drops.length}. **Suspeita** de dano em dobro (golpe no mesmo ator na janela): ${suspect.length}. Fora da janela: ${outside.length}.`, '');
  out.push(`Amostras de vida com valor indisponível (não finito), fora da correlação: ${a.unavailableHealth.length}.`, '');
  out.push(table(['rótulo', 'seq vida', 'tempo', 'ator', 'antes', 'informado', 'depois', 'golpe seq', 'distância (ms)', 'dano do golpe'],
    a.drops.map(d => [d.hit ? 'SUSPEITA' : 'fora da janela', d.drop.sequence, d.drop.timeMs, hex(d.drop.actor), fmt(d.drop.before), fmt(d.drop.reported),
      fmt(d.drop.after), d.hit?.sequence ?? '—', fmt(d.distanceMs), fmt(d.hit?.damage)])), '');

  out.push('## 5. Vida no golpe: candidato do host x efetivo depois dos ganchos', '');
  out.push(`Golpes em que a vida efetiva difere do percentual calculado (ex.: SkyDeath): ${a.altered.length}.`, '');
  if (a.altered.length) out.push(table(['seq', 'alvo', 'antes', 'candidato', 'efetivo'], a.altered.map(h => [h.sequence, hex(h.target), fmt(h.healthBefore), fmt(h.healthCandidate), fmt(h.healthAfter)])), '');

  out.push('## 6. Nomes de animação distintos', '');
  out.push(table(['nome', 'no arquivo', 'contagem do host'], a.allNames.map(n => [n, a.names.get(n) ?? 0, a.hostNames.get(n) ?? '—'])), '');

  out.push('## 7. Equipamento e encantamentos', '');
  out.push('Origem: HOST_TRANSITION = cada troca aceita pelo host em OnUpdateEquipment (com sequência); STATE_POLL = estado lido a cada 2 s, que também capta mudanças feitas fora desse caminho.', '');
  out.push(table(['origem', 'seq', 'tempo', 'personagem', 'mudança', 'item', 'mão', 'health', 'enchantmentId', 'encantamento', 'poisonId'],
    a.equipment.flatMap(e => e.status === 'UNSUPPORTED'
      ? [[e.source ?? '—', e.sequence ?? '—', e.timeMs, e.characterKey, 'UNSUPPORTED', e.reason, '—', '—', '—', '—', '—']]
      : (e.equipped ?? []).map(i => [e.source ?? '—', e.sequence ?? '—', e.timeMs, e.characterKey ?? hex(e.actorId), e.change ?? '—', i.baseDesc ?? hex(i.baseId), i.hand, fmt(i.health), hex(i.enchantmentId),
        i.enchantment ? (i.enchantment.status === 'SUPPORTED' ? `SUPPORTED (${(i.enchantment.effects ?? []).map(x => `MGEF ${hex(x.mgef)} mag ${fmt(x.magnitude)} AV ${x.actorValue}`).join('; ')})` : `UNSUPPORTED: ${i.enchantment.reason}`) : '—',
        hex(i.poisonId)]))), '');

  out.push('## 8. Recusas por motivo e por ator', '');
  out.push('Sem registros de recusa no formato antigo significa medição indisponível; não significa zero recusas.', '');
  out.push(table(['motivo', 'recusas'], [...a.refusalsByReason]), '',
    table(['ator (agressor ou alvo)', 'recusas'], [...a.refusalsByActor].map(([id, n]) => [hex(id), n])), '');
  out.push(table(['seq', 'tempo', 'motivo', 'agressor', 'alvo', 'fonte', 'distância (unidades)'],
    a.rejections.map(r => [r.sequence, r.timeMs, r.reason, hex(r.aggressor), hex(r.target), r.sourceDesc ?? hex(r.source), fmt(r.distance)])), '');

  out.push('## 9. Posição parada: idade do último movimento aceito', '');
  out.push('A idade mede ausência de movimento aceito, não imobilidade física. Posição diferente da última amostra aceita, timestamp ausente ou relógio invertido = idade indisponível. Troca de hoster não renova esse horário.', '');
  out.push(table(['evento', 'seq', 'papel', 'ator', 'posição no hit', 'célula/worldspace', 'hoster', 'último movimento (ms)', 'idade (ms)', 'última tentativa (ms)', 'aceita', 'posição tentada', 'célula tentada', 'movimentos recusados'],
    a.positions.map(p => [p.event.kind, p.event.sequence, p.role, hex(p.state.actor), (p.state.position ?? []).map(fmt).join(', '),
      p.state.cellOrWorld ?? '—', p.state.hosterDesc ?? hex(p.state.hoster), fmt(p.state.lastMovementMs), fmt(p.ageMs), fmt(p.state.lastMovementAttemptMs), fmt(p.state.lastMovementAccepted),
      (p.state.lastAttemptPosition ?? []).map(fmt).join(', '), p.state.lastAttemptCellDesc ?? hex(p.state.lastAttemptCellOrWorld), fmt(p.state.rejectedMovements)])), '');

  out.push('## 10. Vida máxima por alvo', '');
  out.push('USADO_NO_GOLPE é o denominador da conta do host. CACHED_INPUTS_CURRENT compara os insumos atuais com a última leitura de GetMaximumValues, sem resolver records; calcula a expiração de fraqueza pelo relógio atual. Mudança de insumos, contexto ausente ou excedente dos limites = UNAVAILABLE. LAST_OBSERVED (formato intermediário) não garante máximo atual. resolvedNpcDesc é o terminal da cadeia escolhida pelo host; traits e stats podem vir de outro elo.', '');
  out.push(table(['alvo', 'evento', 'seq', 'máximo usado no golpe', 'máximo atual', 'último máximo observado', 'observado em (ms)', 'estado', 'base', 'NPC terminal', 'cadeia', 'elos omitidos'],
    a.events.map(e => [hex(e.target), e.kind, e.sequence, fmt(e.targetMaximumHealth), fmt(e.targetState?.maximumHealth), fmt(e.targetState?.lastObservedMaximum),
      fmt(e.targetState?.maximumObservedMs), e.targetState?.maximumStatus ?? 'UNAVAILABLE', e.targetState?.baseDesc ?? hex(e.targetState?.base),
      e.targetState?.resolvedNpcDesc ?? '—', (e.targetState?.templateChain ?? []).join(' → '), fmt(e.targetState?.truncatedTemplates)])), '');

  out.push('## 11. Amostras brutas', '');
  out.push('### Golpes', '', table(['seq', 'tempo', 'agressor', 'alvo', 'fonte', 'família', 'flags', 'dano', 'antes', 'candidato', 'depois', 'bloqueio agr/alvo', 'agachado'],
    a.hits.map(h => [h.sequence, h.timeMs, hex(h.aggressor), hex(h.target), h.sourceDesc ?? hex(h.source), h.family,
      ['power', 'sneak', 'bash', 'blocked', 'clientBlocked'].filter(f => h[f]).join(',') || '—', fmt(h.damage), fmt(h.healthBefore), fmt(h.healthCandidate), fmt(h.healthAfter),
      `${h.aggressorBlockActive ? 'A' : '-'}${h.aggressorIsBlocking ? 'B' : '-'}/${h.targetBlockActive ? 'A' : '-'}${h.targetIsBlocking ? 'B' : '-'}`, h.aggressorSneaking ? 'sim' : 'não'])), '');
  out.push('### Vida (OnChangeValues)', '', table(['seq', 'tempo', 'ator', 'antes', 'informado', 'depois'],
    a.health.map(h => [h.sequence, h.timeMs, hex(h.actor), fmt(h.before), fmt(h.reported), fmt(h.after)])), '');
  out.push('### Animações', '', table(['seq', 'tempo', 'ator', 'nome'], a.animations.map(x => [x.sequence, x.timeMs, hex(x.actor), x.name])), '');
  return out.join('\n');
}

async function main(argv) {
  const [file, flag, outFile] = argv;
  if (!file || (flag && flag !== '--out') || (flag && !outFile)) { console.error('usage: combat-probe-report.mjs <probe.jsonl> [--out <report.md>]'); process.exitCode = 2; return; }
  const markdown = render(file, parseLines(await readFile(file, 'utf8')));
  if (outFile) await writeFile(outFile, markdown + '\n', 'utf8'); else process.stdout.write(markdown + '\n');
}
if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)).toLowerCase() === path.resolve(process.argv[1]).toLowerCase()) await main(process.argv.slice(2));
