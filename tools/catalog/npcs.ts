import { NPC_FIELDS, NPC_TEMPLATE_CATEGORIES, NPC_PROVIDER_REASONS } from '../../shared/record-catalog/src/npcs.ts';
import { join, resolve } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { readExport, summarizeUnsupported } from './exports.ts';
import type { ExportRow } from './exports.ts';
import { decodeFormKey } from '../../shared/record-catalog/src/codecs.ts';
import { contentSignature, recordSignature } from '../../shared/record-catalog/src/integrity.ts';
import type { CatalogRecord, DomainData, PluginFingerprint, UnsupportedLink } from '../../shared/record-catalog/src/types.ts';
import type { JsonObject, JsonValue } from '../../shared/contracts/src/messages.ts';
import type { RecordType, StableFormKey } from '../../shared/contracts/src/identity.ts';

const families = { NPC_: 'Npc', CLAS: 'Class' } as const;
// Names and bit positions: libespm/include/libespm/NPC_.h TemplateFlags.
const templateFlags = ['Traits', 'Stats', 'Factions', 'SpellList', 'AIData', 'AIPackages',
  'ModelAnimation', 'BaseData', 'Inventory', 'Script', 'DefPackList', 'AttackData', 'Keywords'] as const;
const skills = ['OneHanded', 'TwoHanded', 'Archery', 'Block', 'Smithing', 'HeavyArmor', 'LightArmor',
  'Pickpocket', 'Lockpicking', 'Sneak', 'Alchemy', 'Speech', 'Alteration', 'Conjuration', 'Destruction',
  'Illusion', 'Restoration', 'Enchanting'] as const;
const compare = (a: string, b: string) => a.localeCompare(b, 'en');
const addressPattern = /^[\da-f]{6}:[^:]+\.(esm|esp|esl)$/i;

/** NPC/CLAS winners. Generation resolves static categories only; no spawn selection. */
export async function buildNpcsDomain(exportsDir: string, fingerprints: readonly PluginFingerprint[], report?: UnsupportedLink[]): Promise<DomainData> {
  const files = await Promise.all(Object.keys(families).map(name => readExport(join(exportsDir, name + '.jsonl'))));
  const epoch = files[0]!.manifest.epoch;
  if (files.some(file => file.manifest.epoch !== epoch)) throw new TypeError('NPC/CLAS exports have different epochs');
  const plugins = new Map<string, PluginFingerprint>();
  for (const p of fingerprints) {
    if (plugins.has(p.filename.toLowerCase())) throw new TypeError('Duplicate plugin metadata: ' + p.filename);
    if (!Number.isSafeInteger(p.size) || p.size < 12 || p.crc32 !== (p.crc32 | 0) || typeof p.isLight !== 'boolean') {
      throw new TypeError('Invalid plugin metadata: ' + p.filename);
    }
    plugins.set(p.filename.toLowerCase(), { filename: p.filename, size: p.size, crc32: p.crc32, isLight: p.isLight });
  }
  const dependencies = new Map<string, PluginFingerprint>();
  const depend = (name: string): PluginFingerprint => {
    const p = plugins.get(name.toLowerCase());
    if (!p) throw new TypeError('Required plugin metadata absent: ' + name);
    dependencies.set(p.filename.toLowerCase(), p); return p;
  };
  const key = (text: string): StableFormKey => {
    if (!addressPattern.test(text)) throw new TypeError('Invalid exported FormKey: ' + text);
    const p = depend(text.slice(text.indexOf(':') + 1));
    return decodeFormKey(text, 'housecarl', p.isLight ? 'LIGHT' : 'FULL');
  };
  // Lookup is always by FormID, never export position or editor/name.
  const indexes = new Map<string, Map<string, ExportRow>>();
  for (const [i, [sig, type]] of Object.entries(families).entries()) {
    const index = new Map<string, ExportRow>();
    for (const row of files[i]!.rows) {
      if (row.type !== type) throw new TypeError('Unexpected ' + sig + ' export type: ' + row.type);
      if (!addressPattern.test(row.formid)) throw new TypeError('Invalid exported FormKey: ' + row.formid);
      const stable = row.formid.toLowerCase();
      if (index.has(stable)) throw new TypeError('Duplicate record: ' + stable);
      if (new Set(row.fields.map(f => f.path)).size !== row.fields.length) throw new TypeError('Duplicate field: ' + stable);
      index.set(stable, row);
    }
    indexes.set(sig, index);
  }
  const unsupported: UnsupportedLink[] = [];
  const records = new Map<StableFormKey, CatalogRecord>();
  const roots: StableFormKey[] = [];
  const issue = (stableFormKey: StableFormKey, reason: string) => unsupported.push({ status: 'UNSUPPORTED', stableFormKey, reason });
  function put(row: ExportRow, recordType: RecordType): StableFormKey {
    const stableFormKey = key(row.formid), defining = depend(row.formid.slice(row.formid.indexOf(':') + 1));
    depend(row.winner);
    const exported = new Map(row.fields.map(f => [f.path, f]));
    const fields: Record<string, JsonValue> = {};
    const exportNotes: Record<string, JsonValue> = {};
    const missing = (path: string) => {
      const note = exported.get(path)?.note ?? 'field not exported';
      exportNotes[path] = note;
      issue(stableFormKey, path + ': ' + note); return null;
    };
    function leaf(path: string, kind: 'number' | 'signed' | 'string' | 'reference' | 'boolean'): JsonValue {
      const f = exported.get(path);
      if (kind === 'reference' && f?.value === undefined && f?.note === '(null link)') return null;
      if (f?.value === undefined) return missing(path);
      const raw = f.value;
      if (kind === 'reference') return key(raw);
      if (kind === 'boolean') {
        if (raw === 'True' || raw === 'False') return raw === 'True';
      } else if (kind === 'number' || kind === 'signed') {
        if (raw.trim() !== '' && Number.isFinite(Number(raw)) && (kind === 'signed' || Number(raw) >= 0)) return Number(raw);
      } else return /^\d+$/.test(raw) ? Number(raw) : raw;
      issue(stableFormKey, path + ': invalid ' + kind + ' value ' + JSON.stringify(raw));
      exportNotes[path] = 'invalid exported value: ' + raw; return null;
    }
    fields.IsDeleted = leaf('IsDeleted', 'boolean');
    if (fields.IsDeleted === true) issue(stableFormKey, 'Deleted winner; cannot be used for physical calculation');
    function readNpc(): JsonObject {
      // This section is local winner data. Template providers are resolved separately below.
      for (const p of ['Class', 'Race', 'Template', 'DefaultOutfit', 'SleepingOutfit', 'WornArmor', 'AttackRace']) {
        fields[p] = leaf(p, 'reference');
      }
      for (const p of ['Configuration.Flags', 'Configuration.TemplateFlags']) fields[p] = leaf(p, 'string');
      for (const p of ['HealthOffset', 'MagickaOffset', 'StaminaOffset', 'CalcMinLevel', 'CalcMaxLevel']) {
        fields['Configuration.' + p] = leaf('Configuration.' + p, 'signed');
      }
      const mode = exported.get('Configuration.Level')?.note;
      let level: JsonObject | null = null;
      if (mode === '[NpcLevel]') {
        fields['Configuration.Level.Level'] = leaf('Configuration.Level.Level', 'number');
        level = { kind: 'FIXED', value: fields['Configuration.Level.Level']! };
      } else if (mode === '[PcLevelMult]') {
        fields['Configuration.Level.LevelMult'] = leaf('Configuration.Level.LevelMult', 'number');
        level = { kind: 'PC_LEVEL_MULT', multiplier: fields['Configuration.Level.LevelMult']!,
          min: fields['Configuration.CalcMinLevel']!, max: fields['Configuration.CalcMaxLevel']! };
      } else missing('Configuration.Level');
      const flagText = fields['Configuration.Flags'];
      const knownFlags = ['Female', 'Essential', 'IsCharGenFacePreset', 'Respawn', 'AutoCalcStats', 'Unique',
        'DoesntAffectStealthMeter', 'UseTemplate', 'Protected', 'Summonable', 'DoesNotBleed', 'BleedoutOverride',
        'OppositeGenderAnims', 'SimpleActor', 'LoopedScript', 'LoopedAudio', 'IsGhost', 'Invulnerable'];
      const namedFlags = typeof flagText === 'string' ? flagText.split(',').map(s => s.trim()) : null;
      const autoCalcStats = namedFlags && namedFlags.every(flag => knownFlags.includes(flag))
        ? namedFlags.includes('AutoCalcStats') : flagText === 0 ? false : null;
      if (autoCalcStats === null) issue(stableFormKey, 'Configuration.Flags: AutoCalcStats flag cannot be decoded');
      const flagValue = fields['Configuration.TemplateFlags'];
      let flags: string[] | null = null;
      if (typeof flagValue === 'number' && Number.isInteger(flagValue) && flagValue >= 0 && flagValue < 2 ** templateFlags.length) {
        flags = templateFlags.filter((_, i) => (flagValue & 2 ** i) !== 0);
      } else if (typeof flagValue === 'string') {
        const names = flagValue.split(',').map(s => s.trim());
        if (names.every(n => templateFlags.some(flag => flag === n)) && new Set(names).size === names.length) flags = names;
      }
      if (flags === null) issue(stableFormKey, 'Configuration.TemplateFlags: unknown flags; template providers unavailable');
      for (const group of ['SkillValues', 'SkillOffsets']) {
        const path = 'PlayerSkills.' + group;
        const members = row.fields.filter(f => f.path.startsWith(path + '['));
        const count = /^\[dict: (\d+) pair\(s\)\]$/.exec(exported.get(path)?.note ?? '');
        for (const skill of skills) fields[path + '[' + skill + ']'] = leaf(path + '[' + skill + ']', 'number');
        if (!count || Number(count[1]) !== skills.length || members.length !== skills.length) missing(path);
      }
      for (const p of ['Health', 'Magicka', 'Stamina', 'GearedUpWeapons']) {
        fields['PlayerSkills.' + p] = leaf('PlayerSkills.' + p, 'number');
      }
      // An absent list remains unknown, not an invented empty set. Marker [list: 0] is known empty.
      function list(path: string, read: (i: number) => JsonValue): JsonValue[] | null {
        const count = /^\[list: (\d+) item\(s\)\]$/.exec(exported.get(path)?.note ?? '');
        if (!count) { missing(path); return null; }
        const members = row.fields.filter(f => new RegExp('^' + path + '\\[\\d+\\]$').test(f.path));
        if (members.length !== Number(count[1])) { missing(path); return null; }
        return Array.from({ length: Number(count[1]) }, (_, i) => read(i));
      }
      const perks = list('Perks', i => {
        const p = 'Perks[' + i + ']';
        const perk = leaf(p + '.Perk', 'reference'), rank = leaf(p + '.Rank', 'number');
        fields[p + '.Perk'] = perk; fields[p + '.Rank'] = rank;
        return { perk, rank };
      });
      const spells = list('ActorEffect', i => {
        const p = 'ActorEffect[' + i + ']'; return fields[p] = leaf(p, 'reference');
      });
      const items = list('Items', i => {
        const p = 'Items[' + i + '].Item';
        // At depth 3 the item is an explicit note_ref on the ContainerItem marker.
        const reference = exported.get(p + '.Item')?.value ?? exported.get(p)?.note_ref;
        const item = reference ? key(reference) : missing(p + '.Item');
        fields[p + '.Item'] = item;
        fields[p + '.Count'] = leaf(p + '.Count', 'signed');
        return { item, count: fields[p + '.Count']!, referenceOnly: true };
      });
      if (autoCalcStats === true) issue(stableFormKey,
        'AutoCalcStats: DNAM is exported data, not certified effective skills/stats; effective auto-calculation semantics not certified');
      return { level, autoCalcStats, templateFlags: flags, perks, spells, items };
    }
    const data: JsonObject = recordType === 'NPC_'
      ? { npc: readNpc(), fields, exportNotes }
      : readClass();
    function readClass(): JsonObject {
      function weights(path: string, names: readonly string[]): JsonValue[] {
        const count = /^\[dict: (\d+) pair\(s\)\]$/.exec(exported.get(path)?.note ?? '');
        if (!count || Number(count[1]) !== names.length || row.fields.filter(f => f.path.startsWith(path + '[')).length !== names.length) missing(path);
        return names.map(name => leaf(path + '[' + name + ']', 'number'));
      }
      return { isDeleted: fields.IsDeleted!, skillWeights: weights('SkillWeights', skills),
        statWeights: weights('StatWeights', ['Health', 'Magicka', 'Stamina']),
        bleedoutDefault: leaf('BleedoutDefault', 'number'), voicePoints: leaf('VoicePoints', 'number'),
        unknown: leaf('Unknown', 'signed'), unknown2: leaf('Unknown2', 'number'),
        unavailable: Object.keys(exportNotes).sort(compare) };
    }
    const record: Omit<CatalogRecord, 'signature'> = { stableFormKey, recordType, definingPlugin: defining.filename,
      pluginKind: defining.isLight ? 'LIGHT' : 'FULL', winnerPlugin: row.winner, data };
    records.set(stableFormKey, { ...record, signature: recordSignature(record, defining) }); return stableFormKey;
  }
  for (const sig of ['NPC_', 'CLAS'] as const) {
    for (const row of indexes.get(sig)!.values()) roots.push(put(row, sig));
  }
  // Same category-provider stopping rule as the host EvaluateTemplate.h: no TPLT or
  // flag clear => this winner. Never select a leveled NPC; a non-NPC target is unsupported.
  for (const record of records.values()) if (record.recordType === 'NPC_') {
    const providers: Record<string, JsonValue> = {};
    for (const flag of templateFlags) {
      const chain: StableFormKey[] = [], seen = new Set<StableFormKey>();
      let current: CatalogRecord | undefined = record;
      let reason: string | undefined;
      let provider: StableFormKey | null = null;
      while (current) {
        if (seen.has(current.stableFormKey)) { reason = 'cycle in NPC template chain'; break; }
        seen.add(current.stableFormKey); chain.push(current.stableFormKey);
        if ((current.data.fields as JsonObject).IsDeleted === true) { reason = 'deleted NPC template winner'; break; }
        const local = current.data.fields as JsonObject;
        const npc = current.data.npc as JsonObject;
        if (local.Template === null && !Object.hasOwn(current.data.exportNotes as object, 'Template')) { provider = current.stableFormKey; break; }
        if (!Array.isArray(npc.templateFlags)) { reason = 'template flags unavailable'; break; }
        if (!npc.templateFlags.includes(flag)) { provider = current.stableFormKey; break; }
        if (typeof local.Template !== 'string') { reason = 'template link unavailable'; break; }
        const next = records.get(local.Template as StableFormKey);
        if (!next || next.recordType !== 'NPC_') { reason = 'template absent from NPC_ export or LVLN requires an observed chain; no spawn selection'; break; }
        current = next;
      }
      providers[flag] = reason ? { status: 'UNSUPPORTED', reason, chain } : { status: 'SUPPORTED', provider, chain };
      if (reason) issue(record.stableFormKey, 'Template.' + flag + ': ' + reason);
    }
    const updated = { ...record, data: { ...record.data, npc: { ...(record.data.npc as JsonObject), templateProviders: providers } } };
    const defining = depend(record.definingPlugin);
    records.set(record.stableFormKey, { ...updated, signature: recordSignature(updated, defining) });
  }
  // Compact only after resolving providers against local winners. No duplicate path/value leaves.
  for (const record of records.values()) if (record.recordType === 'NPC_') {
    const fields = record.data.fields as JsonObject, npc = record.data.npc as JsonObject;
    const providers = npc.templateProviders as JsonObject;
    const groups = new Map<string, JsonValue[]>();
    for (const [i, category] of NPC_TEMPLATE_CATEGORIES.entries()) {
      const p = providers[category] as JsonObject;
      const reason = p.status === 'SUPPORTED' ? null : NPC_PROVIDER_REASONS.indexOf(p.reason as typeof NPC_PROVIDER_REASONS[number]);
      if (reason === -1) throw new TypeError('Unknown template provider reason');
      const tuple: JsonValue[] = [0, p.provider ?? null, p.chain!, reason];
      const id = JSON.stringify(tuple);
      const group = groups.get(id) ?? tuple;
      group[0] = Number(group[0]) + 2 ** i; groups.set(id, group);
    }
    const data: JsonObject = { layout: 1, fields: NPC_FIELDS.map(path => fields[path]!),
      level: npc.level!, autoCalcStats: npc.autoCalcStats!, templateFlags: Array.isArray(npc.templateFlags) ? npc.templateFlags.reduce<number>((mask, flag) => mask + 2 ** templateFlags.indexOf(flag as typeof templateFlags[number]), 0) : null,
      perks: Array.isArray(npc.perks) ? npc.perks.map(p => [(p as JsonObject).perk!, (p as JsonObject).rank!]) : null,
      spells: npc.spells!, items: Array.isArray(npc.items) ? npc.items.map(p => [(p as JsonObject).item!, (p as JsonObject).count!]) : null,
      providers: [...groups.values()], unavailable: Object.keys(record.data.exportNotes as object)
        .filter(path => !/^Items\[\d+\]\.Item\.Count$/.test(path)).sort(compare) };
    const updated = { ...record, data };
    records.set(record.stableFormKey, { ...updated, signature: recordSignature(updated, depend(record.definingPlugin)) });
    if (typeof fields.Class === 'string' && !records.has(fields.Class as StableFormKey)) issue(record.stableFormKey, 'Class: CLAS absent from exports');
  }
  if (report) for (const entry of unsupported) report.push(entry);
  const payload = { schemaVersion: 1 as const, domain: 'npcs' as const, exportEpoch: epoch,
    dependencies: [...dependencies.values()].sort((a, b) => compare(a.filename.toLowerCase(), b.filename.toLowerCase())),
    roots: roots.sort(compare), records: [...records.values()].sort((a, b) => compare(a.stableFormKey, b.stableFormKey)),
    unsupported: summarizeUnsupported(unsupported) };
  return { ...payload, signature: contentSignature(payload) };
}

/** Generates the two independent domains and full diagnostics outside the runtime bundle. */
async function main(): Promise<void> {
  const [exportsDir, manifestPath, outputDir, reportDir] = process.argv.slice(2);
  if (!exportsDir || !manifestPath || !outputDir || !reportDir) throw new TypeError('Usage: npcs.ts <exports-dir> <plugin-manifest.json> <output-dir> <report-dir>');
  const manifest = JSON.parse((await readFile(manifestPath, 'utf8')).replace(/^\uFEFF/, '')) as { plugins: PluginFingerprint[] };
  const { buildCombatDomain } = await import('./combat.ts');
  await mkdir(outputDir, { recursive: true }); await mkdir(reportDir, { recursive: true });
  for (const build of [buildCombatDomain, buildNpcsDomain]) {
    const unsupported: UnsupportedLink[] = [];
    const data = await build(resolve(exportsDir), manifest.plugins, unsupported);
    const { canonicalJson } = await import('../../shared/record-catalog/src/integrity.ts');
    await writeFile(join(outputDir, data.domain + '.json'), canonicalJson(data) + '\n');
    unsupported.sort((a, b) => compare(a.stableFormKey ?? '', b.stableFormKey ?? '') || compare(a.reason, b.reason));
    await writeFile(join(reportDir, data.domain + '-unsupported.json'), canonicalJson({ domain: data.domain, signature: data.signature, unsupported }) + '\n');
    console.log(JSON.stringify({ domain: data.domain, roots: data.roots.length, records: data.records.length,
      unsupportedGroups: data.unsupported.length, unsupportedOccurrences: unsupported.length, signature: data.signature }));
  }
}
if (import.meta.url.startsWith('file:') && process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
