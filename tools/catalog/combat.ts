import { join } from 'node:path';
import { readExport, summarizeUnsupported } from './exports.ts';
import type { ExportRow } from './exports.ts';
import { decodeFormKey, encodeFormKey } from '../../shared/record-catalog/src/codecs.ts';
import { contentSignature, recordSignature } from '../../shared/record-catalog/src/integrity.ts';
import type { CatalogRecord, DomainData, PluginFingerprint, UnsupportedLink } from '../../shared/record-catalog/src/types.ts';
import type { JsonObject, JsonValue } from '../../shared/contracts/src/messages.ts';
import type { RecordType, StableFormKey } from '../../shared/contracts/src/identity.ts';

const families = { WEAP: 'Weapon', ARMO: 'Armor', AMMO: 'Ammunition', RACE: 'Race', KYWD: 'Keyword' } as const;
const numeric: Readonly<Record<string, readonly string[]>> = {
  Weapon: ['BasicStats.Damage', 'Data.Speed', 'Data.Reach', 'Data.RangeMin', 'Data.RangeMax', 'Data.Stagger',
    'Critical.Damage', 'Critical.PercentMult'],
  Armor: ['ArmorRating'], Ammunition: ['Damage'],
  Race: ['UnarmedDamage', 'UnarmedReach', 'AimAngleTolerance', 'AngularTolerance']
};
const scalar: Readonly<Record<string, readonly string[]>> = {
  Weapon: ['Data.AnimationType', 'Data.Skill', 'Data.Flags', 'Critical.Flags'],
  Armor: ['BodyTemplate.ArmorType', 'BodyTemplate.FirstPersonFlags', 'BodyTemplate.Flags'],
  Ammunition: ['Flags'], Race: ['Flags', 'EquipmentFlags', 'Size']
};
const references: Readonly<Record<string, readonly string[]>> = {
  Weapon: ['ObjectEffect', 'Template', 'Critical.Effect', 'EquipmentType'],
  Armor: ['ObjectEffect', 'TemplateArmor', 'Race', 'EquipmentType'],
  Ammunition: ['Projectile'], Race: ['AttackRace', 'UnarmedEquipSlot']
};
const compare = (a: string, b: string) => a.localeCompare(b, 'en');
const addressPattern = /^[\da-f]{6}:[^:]+\.(esm|esp|esl)$/i;

/** All physical winners, including nonplayable equipment. No name filters.
 * Leaves remain local; inheritance and effect semantics remain uncertified. */
export async function buildCombatDomain(exportsDir: string, fingerprints: readonly PluginFingerprint[], report?: UnsupportedLink[]): Promise<DomainData> {
  const files = await Promise.all(Object.keys(families).map(name => readExport(join(exportsDir, name + '.jsonl'))));
  const epoch = files[0]!.manifest.epoch;
  if (files.some(file => file.manifest.epoch !== epoch)) throw new TypeError('Combat exports have different epochs');
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
  const reached = new Set<StableFormKey>();
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
    function leaf(path: string, kind: 'number' | 'string' | 'reference' | 'boolean'): JsonValue {
      const f = exported.get(path);
      if (kind === 'reference' && f?.value === undefined && f?.note === '(null link)') return null;
      if (f?.value === undefined) return missing(path);
      const raw = f.value;
      if (kind === 'reference') return key(raw);
      if (kind === 'boolean') {
        if (raw === 'True' || raw === 'False') return raw === 'True';
      } else if (kind === 'number') {
        if (raw.trim() !== '' && Number.isFinite(Number(raw)) && Number(raw) >= 0) return Number(raw);
      } else return /^\d+$/.test(raw) ? Number(raw) : raw;
      issue(stableFormKey, path + ': invalid ' + kind + ' value ' + JSON.stringify(raw));
      exportNotes[path] = 'invalid exported value: ' + raw; return null;
    }
    fields.IsDeleted = leaf('IsDeleted', 'boolean');
    if (fields.IsDeleted === true) issue(stableFormKey, 'Deleted winner; cannot be used for physical calculation');
    if (recordType !== 'KYWD') {
      fields.MajorFlags = leaf('MajorFlags', 'string');
      for (const p of numeric[row.type] ?? []) fields[p] = leaf(p, 'number');
      for (const p of scalar[row.type] ?? []) fields[p] = leaf(p, 'string');
      for (const p of references[row.type] ?? []) fields[p] = leaf(p, 'reference');
      for (const p of ['Template', 'TemplateArmor', 'AttackRace']) if (typeof fields[p] === 'string') {
        issue(stableFormKey, p + ': inheritance semantics not certified; local fields are not an inherited calculation');
      }
      if (typeof fields.ObjectEffect === 'string') issue(stableFormKey, 'ObjectEffect: reference only; ENCH effects not exported/certified');
      if (typeof fields['Critical.Effect'] === 'string') issue(stableFormKey, 'Critical.Effect: reference only; SPEL semantics not certified');
    }
    let keywords: JsonValue = null;
    if (recordType !== 'KYWD') {
      const members = row.fields.filter(f => /^Keywords\[\d+\]$/.test(f.path));
      const count = /^\[list: (\d+) item\(s\)\]$/.exec(exported.get('Keywords')?.note ?? '');
      if (count && Number(count[1]) === members.length && members.every((_, i) => exported.has('Keywords[' + i + ']'))) {
        keywords = Array.from({ length: members.length }, (_, i) => { const k = leaf('Keywords[' + i + ']', 'reference'); if (typeof k === 'string') reached.add(k as StableFormKey); return k; });
      } else {
        // Keep the known members as evidence without claiming a complete keyword set.
        for (const f of members) { fields[f.path] = leaf(f.path, 'reference'); if (typeof fields[f.path] === 'string') reached.add(fields[f.path] as StableFormKey); }
        missing('Keywords');
      }
    }
    if (recordType === 'RACE') {
      const attacks = row.fields.filter(f => /^Attacks\[\d+\]\.AttackEvent$/.test(f.path));
      for (const f of attacks) fields[f.path] = leaf(f.path, 'string');
      // At depth 3 AttackData is only a struct marker, never its multipliers/flags.
      for (const f of row.fields.filter(f => /^Attacks\[\d+\]\.AttackData$/.test(f.path))) {
        exportNotes[f.path] = f.note ?? 'attack data leaves not selected';
        issue(stableFormKey, f.path + ': attack data leaves not exported by this domain; no attack multiplier/flags inferred');
      }
      if (!exported.has('Attacks') || exported.get('Attacks')?.note === '(absent)') missing('Attacks');
    }

    const data: JsonObject = { editorId: row.editorid, fields, exportNotes, ...(recordType !== 'KYWD' ? { keywords } : {}) };
    const record: Omit<CatalogRecord, 'signature'> = { stableFormKey, recordType, definingPlugin: defining.filename,
      pluginKind: defining.isLight ? 'LIGHT' : 'FULL', winnerPlugin: row.winner, data };
    records.set(stableFormKey, { ...record, signature: recordSignature(record, defining) }); return stableFormKey;
  }
  for (const sig of ['WEAP', 'ARMO', 'AMMO', 'RACE'] as const) {
    for (const row of indexes.get(sig)!.values()) roots.push(put(row, sig));
  }
  for (const stable of [...reached].sort(compare)) {
    const defining = depend(stable.split('|')[0]!);
    const address = encodeFormKey(stable, 'housecarl', defining.isLight ? 'LIGHT' : 'FULL');
    const row = indexes.get('KYWD')!.get(address.toLowerCase());
    if (row) put(row, 'KYWD'); else issue(stable, 'Reached KYWD absent from exports');
  }
  if (report) for (const entry of unsupported) report.push(entry);
  const payload = { schemaVersion: 1 as const, domain: 'combat' as const, exportEpoch: epoch,
    dependencies: [...dependencies.values()].sort((a, b) => compare(a.filename.toLowerCase(), b.filename.toLowerCase())),
    roots: roots.sort(compare), records: [...records.values()].sort((a, b) => compare(a.stableFormKey, b.stableFormKey)),
    unsupported: summarizeUnsupported(unsupported) };
  return { ...payload, signature: contentSignature(payload) };
}
