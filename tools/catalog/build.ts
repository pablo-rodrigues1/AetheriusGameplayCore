import { createReadStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeFormKey, encodeFormKey } from '../../shared/record-catalog/src/codecs.ts';
import { canonicalJson, contentSignature, recordSignature } from '../../shared/record-catalog/src/integrity.ts';
import type { CatalogRecord, DomainData, PluginFingerprint, UnsupportedLink } from '../../shared/record-catalog/src/types.ts';
import type { JsonObject, JsonValue } from '../../shared/contracts/src/messages.ts';
import type { RecordType, StableFormKey } from '../../shared/contracts/src/identity.ts';

interface ExportField { path: string; value?: string; note?: string }
interface ExportRow { formid: string; type: string; editorid: string; winner: string; fields: ExportField[] }
interface ExportManifest { housecarl_artifact: number; row_count: number; epoch: string }
interface ExportFile { manifest: ExportManifest; rows: ExportRow[] }

async function readExport(file: string): Promise<ExportFile> {
  const lines = createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity });
  let manifest: ExportManifest | undefined;
  const rows: ExportRow[] = [];
  const identities = new Set<string>();
  for await (const line of lines) {
    if (!line.trim()) continue;
    const parsed: unknown = JSON.parse(line.replace(/^\uFEFF/, ''));
    if (!manifest) {
      manifest = parsed as ExportManifest;
      if (manifest.housecarl_artifact !== 1 || !Number.isSafeInteger(manifest.row_count) || typeof manifest.epoch !== 'string') {
        throw new TypeError(`Invalid export manifest: ${file}`);
      }
    } else {
      const row = parsed as ExportRow;
      if (typeof row.formid !== 'string' || typeof row.winner !== 'string' || !Array.isArray(row.fields)) throw new TypeError(`Invalid row: ${file}`);
      if (identities.has(row.formid.toLowerCase())) throw new TypeError(`Duplicate record: ${row.formid}`);
      identities.add(row.formid.toLowerCase());
      rows.push(row);
    }
  }
  if (!manifest || rows.length !== manifest.row_count) throw new TypeError(`Export row count mismatch: ${file}`);
  return { manifest, rows };
}
const value = (row: ExportRow, path: string): string | undefined => row.fields.find(f => f.path === path)?.value;
const recordTypes: Readonly<Record<string, RecordType>> = { Activator: 'ACTI', Race: 'RACE', Spell: 'SPEL', MagicEffect: 'MGEF', Perk: 'PERK' };

/** Manifest fingerprints are explicit input; exports alone do not contain TES4 metadata or CRCs. */
export async function buildDomains(exportsDir: string, fingerprints: readonly PluginFingerprint[]): Promise<readonly DomainData[]> {
  const files = await Promise.all(['STONE_ACTIVATORS', 'RACE', 'SPEL', 'MGEF', 'MUNDUS', 'PERK'].map(name => readExport(join(exportsDir, `${name}.jsonl`))));
  const [activators, races, spells, effects, mundus] = files as [ExportFile, ExportFile, ExportFile, ExportFile, ExportFile];
  const epoch = activators.manifest.epoch;
  if (files.some(f => f.manifest.epoch !== epoch)) throw new TypeError('Exports have different epochs');
  const plugins = new Map<string, PluginFingerprint>();
  for (const p of fingerprints) {
    if (plugins.has(p.filename.toLowerCase())) throw new TypeError(`Duplicate plugin metadata: ${p.filename}`);
    if (!Number.isSafeInteger(p.size) || p.size < 12 || p.crc32 !== (p.crc32 | 0) || typeof p.isLight !== 'boolean') throw new TypeError('Invalid plugin metadata');
    plugins.set(p.filename.toLowerCase(), { filename: p.filename, size: p.size, crc32: p.crc32, isLight: p.isLight });
  }
  const plugin = (name: string): PluginFingerprint => {
    const p = plugins.get(name.toLowerCase());
    if (!p) throw new TypeError(`Required plugin metadata absent: ${name}`);
    return p;
  };
  const key = (formid: string): StableFormKey => {
    const name = formid.slice(formid.indexOf(':') + 1);
    return decodeFormKey(formid, 'housecarl', plugin(name).isLight ? 'LIGHT' : 'FULL');
  };
  // Only index the two exported record families this order follows.
  const spellMap = new Map(spells.rows.map(row => [row.formid.toLowerCase(), row]));
  const effectMap = new Map(effects.rows.map(row => [row.formid.toLowerCase(), row]));
  const perkMap = new Map(files[5]!.rows.map(row => [row.formid.toLowerCase(), row]));
  const exportAddress = (stableFormKey: StableFormKey): string => {
    const p = plugin(stableFormKey.split('|')[0]!);
    return encodeFormKey(stableFormKey, 'housecarl', p.isLight ? 'LIGHT' : 'FULL').toLowerCase();
  };

  function domain(name: DomainData['domain'], rootRows: readonly ExportRow[]): DomainData {
    const records = new Map<StableFormKey, CatalogRecord>();
    const dependencies = new Map<string, PluginFingerprint>();
    const unsupported: UnsupportedLink[] = [];
    const roots: StableFormKey[] = [];
    const depend = (filename: string): PluginFingerprint => {
      const p = plugin(filename); dependencies.set(filename.toLowerCase(), p); return p;
    };
    const link = (text: string): StableFormKey => {
      const result = key(text);
      depend(text.slice(text.indexOf(':') + 1));
      return result;
    };
    const normalize = (text: string): JsonValue => /^[\da-fA-F]{6}:[^:]+\.(esm|esp|esl)$/i.test(text) ? link(text) : text;
    const fields = (row: ExportRow, select: RegExp): JsonObject => Object.fromEntries(row.fields
      .filter(f => select.test(f.path) && f.value !== undefined)
      .sort((a, b) => a.path.localeCompare(b.path, 'en'))
      .map(f => [f.path, normalize(f.value!)]));
    function put(row: ExportRow, data: JsonObject): StableFormKey {
      const stableFormKey = link(row.formid);
      const definingPlugin = depend(row.formid.slice(row.formid.indexOf(':') + 1));
      depend(row.winner);
      const recordType = recordTypes[row.type];
      if (!recordType) throw new TypeError(`Unexpected record type ${row.type}`);
      const record: Omit<CatalogRecord, 'signature'> = { stableFormKey, recordType, definingPlugin: definingPlugin.filename,
        pluginKind: definingPlugin.isLight ? 'LIGHT' : 'FULL', winnerPlugin: row.winner, data };
      records.set(stableFormKey, { ...record, signature: recordSignature(record, definingPlugin) });
      return stableFormKey;
    }
    function addPerk(stableFormKey: StableFormKey): void {
      if (records.has(stableFormKey)) return;
      const row = perkMap.get(exportAddress(stableFormKey));
      if (!row) { unsupported.push({ status: 'UNSUPPORTED', stableFormKey, reason: 'PERK absent from exports' }); return; }
      // Keep all exported entry values and the depth-limited condition evidence.
      // Notes describe missing inner fields; they are not invented conditions.
      put(row, { editorId: row.editorid, fields: fields(row, /^(NumRanks$|NextPerk$|Conditions\[|Effects\[|VirtualMachineAdapter\.)/),
        exportNotes: Object.fromEntries(row.fields.filter(f => /^(Effects\[|Conditions|VirtualMachineAdapter)/.test(f.path) && f.note !== undefined)
          .sort((a,b) => a.path.localeCompare(b.path, 'en')).map(f => [f.path, f.note!])) });
    }
    function addEffect(stableFormKey: StableFormKey): void {
      if (records.has(stableFormKey)) return;
      const row = effectMap.get(exportAddress(stableFormKey));
      if (!row) { unsupported.push({ status: 'UNSUPPORTED', stableFormKey, reason: 'MGEF absent from exports' }); return; }
      put(row, { editorId: row.editorid, fields: fields(row, /^(Flags$|Archetype\.|BaseCost$|CastType$|TargetType$|MagicSkill$|ResistValue$|SecondActorValue|PerkToApply$|EquipAbility$|Conditions\[|VirtualMachineAdapter\.)/),
        semantics: 'UNSUPPORTED', reason: 'B2 records definitions only; effect, condition and script semantics are not certified' });
      const perk = value(row, 'PerkToApply');
      if (perk) addPerk(link(perk));
    }
    function addSpell(stableFormKey: StableFormKey): void {
      if (records.has(stableFormKey)) return;
      const row = spellMap.get(exportAddress(stableFormKey));
      if (!row) { unsupported.push({ status: 'UNSUPPORTED', stableFormKey, reason: 'SPEL absent from exports' }); return; }
      const baseEffects = row.fields.filter(f => /^Effects\[\d+\]\.BaseEffect$/.test(f.path)).map(f => link(f.value!));
      put(row, { editorId: row.editorid, spellType: value(row, 'Type') ?? 'UNSUPPORTED', effects: baseEffects,
        fields: fields(row, /^(Type$|CastType$|TargetType$|BaseCost$|ChargeTime$|CastDuration$|Flags$|Effects\[)/) });
      baseEffects.forEach(addEffect);
    }
    for (const row of rootRows) {
      if (name === 'races') {
        const actorEffects = row.fields.filter(f => /^ActorEffect\[\d+\]$/.test(f.path)).map(f => link(f.value!));
        const starting: Record<string, number> = {};
        for (const stat of ['Health', 'Magicka', 'Stamina']) {
          const raw = value(row, `Starting[${stat}]`);
          if (raw === undefined || !Number.isFinite(Number(raw))) throw new TypeError(`Starting ${stat} missing for ${row.formid}`);
          starting[stat] = Number(raw);
        }
        roots.push(put(row, { editorId: row.editorid, starting, actorEffects,
          fields: fields(row, /^(Starting\[|Regen\[|SkillBoost\d\.|BaseCarryWeight$|UnarmedDamage$|Flags$)/) }));
        actorEffects.forEach(addSpell);
      } else {
        const scripts = row.fields.filter(f => /^VirtualMachineAdapter\.Scripts\[\d+\]\.Name$/.test(f.path) && f.value?.toLowerCase() === 'powershrinescript');
        const granted: StableFormKey[] = [];
        const evidence: JsonValue[] = [];
        for (const script of scripts) {
          const prefix = script.path.slice(0, -5);
          const selectors = row.fields.filter(f => f.path.startsWith(`${prefix}.Properties[`) && f.path.endsWith('.Name')
            && /^b[A-Za-z]+$/.test(f.value ?? '') && value(row, f.path.replace(/\.Name$/, '.Data')) === 'True');
          if (selectors.length !== 1) continue;
          const tag = selectors[0]!.value!.slice(1);
          const properties = row.fields.filter(f => f.path.startsWith(`${prefix}.Properties[`) && f.path.endsWith('.Name')
            && new RegExp(`^pdoom${tag}(?:negative)?ability$`, 'i').test(f.value ?? ''));
          for (const prop of properties) {
            const object = value(row, prop.path.replace(/\.Name$/, '.Object'));
            if (!object) continue;
            const spellKey = link(object);
            if (!spellMap.has(exportAddress(spellKey))) continue;
            granted.push(spellKey);
            evidence.push({ selector: selectors[0]!.value!, property: prop.value!, spell: spellKey });
          }
        }
        if (!granted.length) unsupported.push({ status: 'UNSUPPORTED', stableFormKey: key(row.formid), reason: 'Unambiguous powerShrineScript selector/ability linkage absent' });
        const root = put(row, { editorId: row.editorid, spells: [...new Set(granted)].sort(), scriptEvidence: evidence,
          grantStatus: granted.length ? 'SUPPORTED' : 'UNSUPPORTED' });
        roots.push(root);
        granted.forEach(addSpell);
      }
    }
    if (name === 'standing-stones') {
      // A spell present in the domain export but never reached from a selector is not a grant.
      for (const row of mundus.rows.filter(r => r.type === 'Spell')) {
        const spellKey = key(row.formid);
        if (!records.has(spellKey)) {
          addSpell(spellKey);
          unsupported.push({ status: 'UNSUPPORTED', stableFormKey: spellKey,
            reason: 'No activator script property links this spell to a selected stone; perk-mediated grant is not inferred (known Steed sprint case)' });
        }
      }
    }
    const payload = { schemaVersion: 1 as const, domain: name, exportEpoch: epoch,
      dependencies: [...dependencies.values()].sort((a, b) => a.filename.toLowerCase().localeCompare(b.filename.toLowerCase(), 'en')),
      records: [...records.values()].sort((a, b) => a.stableFormKey.localeCompare(b.stableFormKey, 'en')),
      roots: roots.sort(), unsupported: unsupported.sort((a, b) => (a.stableFormKey ?? '').localeCompare(b.stableFormKey ?? '', 'en')) };
    return { ...payload, signature: contentSignature(payload) };
  }
  return [domain('standing-stones', activators.rows), domain('races', races.rows.filter(row => value(row, 'Flags')?.split(/,\s*/).includes('Playable')))];
}

async function main(): Promise<void> {
  const [exportsDir, manifestPath, outputDir] = process.argv.slice(2);
  if (!exportsDir || !manifestPath || !outputDir) throw new TypeError('Usage: build.ts <exports-dir> <plugin-manifest.json> <output-dir>');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, '')) as { plugins: PluginFingerprint[] };
  const domains = await buildDomains(resolve(exportsDir), manifest.plugins);
  mkdirSync(outputDir, { recursive: true });
  for (const data of domains) {
    writeFileSync(join(outputDir, `${data.domain}.json`), `${canonicalJson(data)}\n`);
    console.log(`${data.domain}: roots=${data.roots.length}, records=${data.records.length}, unsupported=${data.unsupported.length}, signature=${data.signature}`);
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
