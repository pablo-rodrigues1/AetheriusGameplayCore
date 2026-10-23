// DS-0b: report generated from a JSONL fixture in the recorder's own line format
// (runtime/src/combat-probe.ts) carrying host rows as CombatProbe::Read() emits them.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { analyze, parseLines, render } from '../tools/combat-probe-report.mjs';

const fixture = fileURLToPath(new URL('./fixtures/combat-probe-sample.jsonl', import.meta.url));
const tool = fileURLToPath(new URL('../tools/combat-probe-report.mjs', import.meta.url));

test('analysis: power evidence, 3000 ms health correlation with distances, integrity counters', async () => {
  const parsed = parseLines(await readFile(fixture, 'utf8'));
  assert.equal(parsed.invalid.length, 0);
  const a = analyze(parsed.rows);
  assert.deepEqual([...a.families.keys()].sort(), ['MAGIC', 'MELEE', 'RANGED', 'UNARMED']);
  assert.equal(a.families.get('RANGED').serverBlocked, 1);
  assert.deepEqual(a.power.map(p => p.found?.name ?? null), ['attackPowerStartInPlace', null]);
  assert.equal(a.power[0].found.ageMs, 400);
  // ~600 ms and ~1900 ms after a hit are suspicions; 8000 ms is outside; a rise is not a drop.
  assert.deepEqual(a.drops.map(d => d.distanceMs), [600, 1900, null]);
  assert.deepEqual(a.drops.map(d => d.hit?.sequence ?? null), [1, 2, null]);
  assert.equal(a.altered.length, 1);
  assert.equal(a.gaps.length, 2);
  assert.deepEqual(a.lostByReason, { HOST_RING_OVERWRITTEN: 2, WRITE_FAILURE_RING_OVERWRITTEN: 3 }, 'old gap lines without lost still count');
  assert.equal(a.unavailableHealth.length, 1, 'null health is unavailable, not a drop');
  assert.equal(a.writer.writeFailures, 2);
  assert.equal(a.counters.counters.overwrittenAnimations, 2);
  assert.deepEqual(a.allNames, ['attackPowerStartInPlace', 'attackStart', 'blockStart']);
});

test('markdown labels correlation as suspicion, keeps raw samples, reports enchantment status', async () => {
  const md = render(fixture, parseLines(await readFile(fixture, 'utf8')));
  assert.match(md, /suspeitas, não provas/);
  assert.match(md, /\*\*Suspeita\*\* de dano em dobro .*: 2\. Fora da janela: 1\./);
  assert.match(md, /\| SUSPEITA \| 1 \| 10600 .*\| 600 \|/);
  assert.match(md, /\| SUSPEITA \| 2 \| 21900 .*\| 1900 \|/);
  assert.match(md, /Lacunas .*: 2\./);
  assert.match(md, /HOST_RING_OVERWRITTEN=2, WRITE_FAILURE_RING_OVERWRITTEN=3/);
  assert.match(md, /Gravador: falhas de escrita 2; leituras puladas com escrita pendente 4; escritas simultâneas no máximo 1; último erro EIO injected/);
  assert.match(md, /valor indisponível .*: 1\./);
  assert.match(md, /\| HOST_TRANSITION \| 1 \| 30400 \| profile:108549 \| TRANSITION \|/);
  assert.match(md, /overwrittenAnimations \| 2/);
  assert.match(md, /Detecção do alvo nos golpes: UNAVAILABLE/);
  assert.match(md, /SUPPORTED \(MGEF 0x4605A mag 30 AV 24\)/);
  assert.match(md, /UNSUPPORTED: CREATED_RECORD_NOT_IN_LOAD_ORDER/);
  assert.match(md, /### Vida \(OnChangeValues\)/);
  assert.match(md, /\| 4 \| 45000 \| 0xFF000001 \| 0\.4000 \| 0\.9000 \| 0\.4100 \|/);
});

test('CLI writes the report file; bad usage exits 2', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ds0b-report-'));
  try {
    const out = path.join(dir, 'report.md');
    const ok = spawnSync(process.execPath, [tool, fixture, '--out', out], { encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(await readFile(out, 'utf8'), /# Relatório da sonda de combate/);
    assert.equal(spawnSync(process.execPath, [tool], { encoding: 'utf8' }).status, 2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
