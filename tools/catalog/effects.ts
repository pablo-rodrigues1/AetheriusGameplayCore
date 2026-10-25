import { join, resolve } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { readExport, summarizeUnsupported } from './exports.ts';
import type { ExportRow } from './exports.ts';
import { EFFECT_FIELDS } from '../../shared/record-catalog/src/effects.ts';
import { decodeFormKey } from '../../shared/record-catalog/src/codecs.ts';
import { canonicalJson, contentSignature, recordSignature } from '../../shared/record-catalog/src/integrity.ts';
import type { CatalogRecord, DomainData, PluginFingerprint, UnsupportedLink } from '../../shared/record-catalog/src/types.ts';
import type { JsonObject, JsonValue } from '../../shared/contracts/src/messages.ts';
import type { RecordType, StableFormKey } from '../../shared/contracts/src/identity.ts';

const compare = (a: string, b: string) => a.localeCompare(b, 'en');
const address = /^[\da-f]{6}:[^:]+\.(esm|esp|esl)$/i;
const value = (row: ExportRow, path: string) => row.fields.find(f => f.path === path)?.value;
// Identities of Q8 controller definitions, not magnitude constants. Values below
// are read from their winner PERK entries, and retained with conditions as evidence.
const skill = '0CF788:Skyrim.esm', alchemy = '0A725C:Skyrim.esm', general = 'ADA501:Update.esm';
type Rule = readonly [family: string, unit: string, entryPoint: string | null, controller: string | null];
export const EFFECT_RULES: Readonly<Record<string, Rule>> = {
  OneHandedModifier: ['ONE_HANDED', 'PERCENT', 'ModAttackDamage', skill],
  OneHandedPowerModifier: ['ONE_HANDED', 'PERCENT', 'ModAttackDamage', alchemy],
  TwoHandedModifier: ['TWO_HANDED', 'PERCENT', 'ModAttackDamage', skill],
  TwoHandedPowerModifier: ['TWO_HANDED', 'PERCENT', 'ModAttackDamage', alchemy],
  MarksmanModifier: ['ARCHERY', 'PERCENT', 'ModAttackDamage', skill],
  MarksmanPowerModifier: ['ARCHERY', 'PERCENT', 'ModAttackDamage', alchemy],
  Fame: ['UNARMED', 'PERCENT', 'ModAttackDamage', general],
  UnarmedDamage: ['UNARMED', 'ADD', null, null],
  TwoHandedSkillAdvance: ['POWER_ATTACK', 'PERCENT', 'ModPowerAttackDamage', general],
  LockpickingSkillAdvance: ['BASH', 'PERCENT', 'ModBashingDamage', general],
  DamageResist: ['ARMOR_RATING', 'ADD', null, null],
  BlockModifier: ['BLOCK', 'PERCENT', 'ModPercentBlocked', skill],
  BlockPowerModifier: ['BLOCK', 'PERCENT', 'ModPercentBlocked', alchemy],
  AlterationSkillAdvance: ['RESIST_ARROW_BLOCKING', 'PERCENT', 'ModIncomingDamage', general],
  EnchantingSkillAdvance: ['RESIST_POWER_BLOCKING', 'PERCENT', 'ModIncomingDamage', general],
  SneakingSkillAdvance: ['SNEAK_ATTACK', 'PERCENT', 'ModSneakAttackMult', general]
};
const knownFlags = new Set(['Hostile','Recover','Detrimental','SnapToNavmesh','NoHitEvent','DispelWithKeywords',
  'NoDuration','NoMagnitude','NoArea','FXPersist','GoryVisuals','HideInUI','NoRecast',
  'PowerAffectsMagnitude','PowerAffectsDuration','Painless','NoHitEffect','NoDeathDispel']);
/** Classification uses actual fields, never EditorID, Name or Description.
 * Detrimental/on-hit weapon effects belong to the later Q15/function 22 slice. */
export function physicalEffectRule(row: ExportRow, perk?: ExportRow): Rule | undefined {
  const flags = value(row, 'Flags')?.split(',').map(s => s.trim()) ?? [];
  if (flags.includes('Hostile') || flags.includes('Detrimental')) return undefined;
  const direct = EFFECT_RULES[value(row, 'Archetype.ActorValue') ?? ''];
  if (direct) return direct;
  // Some premade sneak enchantments grant a constant PERK multiplier instead
  // of an AV magnitude. Record them as inactive/unsupported, never substitute
  // the carrier magnitude for the perk's constant.
  if (value(row,'Archetype.Type') === 'Script' && perk && perk.formid.toLowerCase() === value(row,'PerkToApply')?.toLowerCase()
    && perk.fields.some(f => /^Effects\[\d+\]\.EntryPoint$/.test(f.path) && f.value === 'ModSneakAttackMult')) {
    return ['SNEAK_ATTACK','PERK_CONSTANT','ModSneakAttackMult',perk.formid];
  }
  return undefined;
}

export async function buildEffectsDomain(exportsDir: string, fingerprints: readonly PluginFingerprint[], report?: UnsupportedLink[]): Promise<DomainData> {
  const sigs = ['MGEF', 'ENCH', 'ALCH', 'PERK'] as const;
  const types = ['MagicEffect', 'ObjectEffect', 'Ingestible', 'Perk'];
  const files = await Promise.all(sigs.map(sig => readExport(join(exportsDir, sig + '.jsonl'))));
  const epoch = files[0]!.manifest.epoch;
  if (files.some(f => f.manifest.epoch !== epoch)) throw new TypeError('Effects exports have different epochs');
  const indexes = new Map<string, Map<string, ExportRow>>();
  for (const [i, sig] of sigs.entries()) {
    const rows = files[i]!.rows;
    for (const row of rows) {
      if (row.type !== types[i] || !address.test(row.formid)) throw new TypeError('Invalid ' + sig + ' row');
      if (new Set(row.fields.map(f => f.path)).size !== row.fields.length) throw new TypeError('Duplicate field: ' + row.formid);
    }
    indexes.set(sig, new Map(rows.map(row => [row.formid.toLowerCase(), row])));
  }
  const metadata = new Map<string, PluginFingerprint>();
  for (const p of fingerprints) {
    if (metadata.has(p.filename.toLowerCase())) throw new TypeError('Duplicate plugin metadata');
    if (!Number.isSafeInteger(p.size) || p.size < 12 || p.crc32 !== (p.crc32 | 0) || typeof p.isLight !== 'boolean') throw new TypeError('Invalid plugin metadata');
    metadata.set(p.filename.toLowerCase(), { filename:p.filename, size:p.size, crc32:p.crc32, isLight:p.isLight });
  }
  const dependencies = new Map<string, PluginFingerprint>();
  const depend = (name: string): PluginFingerprint => {
    const p = metadata.get(name.toLowerCase());
    if (!p) throw new TypeError('Required plugin metadata absent: ' + name);
    dependencies.set(p.filename.toLowerCase(), p); return p;
  };
  const key = (text: string): StableFormKey => {
    if (!address.test(text)) throw new TypeError('Invalid exported FormKey: ' + text);
    const p = depend(text.slice(text.indexOf(':') + 1));
    return decodeFormKey(text, 'housecarl', p.isLight ? 'LIGHT' : 'FULL');
  };
  const records: CatalogRecord[] = [], roots: StableFormKey[] = [], unsupported: UnsupportedLink[] = [];
  const issue = (row: ExportRow, reason: string) => unsupported.push({status:'UNSUPPORTED',stableFormKey:key(row.formid),reason});
  const put = (row: ExportRow, recordType: RecordType, data: JsonObject) => {
    const defining = depend(row.formid.slice(row.formid.indexOf(':') + 1)); depend(row.winner);
    const record = {stableFormKey:key(row.formid),recordType,definingPlugin:defining.filename,
      pluginKind:defining.isLight ? 'LIGHT' as const : 'FULL' as const,winnerPlugin:row.winner,data};
    records.push({...record,signature:recordSignature(record,defining)}); roots.push(record.stableFormKey);
  };
  const carriers = [...indexes.get('ENCH')!.values(), ...indexes.get('ALCH')!.values()];
  const carried = new Set(carriers.flatMap(row => row.fields.filter(f => /^Effects\[\d+\]\.BaseEffect$/.test(f.path)).map(f => f.value?.toLowerCase())));
  const selected = new Set<string>();
  for (const row of indexes.get('MGEF')!.values()) {
    if (!carried.has(row.formid.toLowerCase())) continue;
    const perkLink = value(row,'PerkToApply');
    const rule = physicalEffectRule(row, perkLink ? indexes.get('PERK')!.get(perkLink.toLowerCase()) : undefined); if (!rule) continue;
    selected.add(row.formid.toLowerCase());
    const unavailable: string[] = [], reasons: string[] = [];
    const read = (path: string): JsonValue => {
      const field = row.fields.find(f => f.path === path);
      if (field?.note === '(null link)') return null;
      if (field?.value === undefined) { unavailable.push(path); return null; }
      return address.test(field.value) ? key(field.value) : field.value;
    };
    const fields = EFFECT_FIELDS.map(read);
    if (value(row,'IsDeleted') !== 'False') reasons.push('deleted or unavailable MGEF winner');
    if (!['PeakValueModifier','ValueModifier'].includes(value(row,'Archetype.Type') ?? '')) reasons.push('archetype semantics unavailable');
    if (value(row,'SecondActorValue') !== 'None' || value(row,'SecondActorValueWeight') !== '0') reasons.push('secondary actor value semantics unavailable');
    const flags = value(row,'Flags');
    if (flags === undefined || (flags !== '0' && !flags.split(',').every(f => knownFlags.has(f.trim())))) reasons.push('unknown effect flags');
    if (flags?.split(',').some(f => f.trim() === 'NoMagnitude')) reasons.push('effect does not use magnitude');
    if (row.fields.find(f=>f.path==='VirtualMachineAdapter')?.note !== '(absent)') reasons.push('effect scripts not certified');
    if (row.fields.find(f=>f.path==='Conditions')?.note !== '[list: 0 item(s)]') reasons.push('effect conditions not certified');
    if (read('PerkToApply') !== null) reasons.push('additional PerkToApply semantics not certified');
    if (unavailable.length) reasons.push('effect fields unavailable');
    let controller: JsonValue = null;
    if (rule[3]) {
      const perk = indexes.get('PERK')!.get(rule[3].toLowerCase());
      const entry = perk?.fields.find(f => rule[1] === 'PERK_CONSTANT'
        ? /^Effects\[\d+\]\.EntryPoint$/.test(f.path) && f.value === rule[2]
        : /^Effects\[\d+\]\.ActorValue$/.test(f.path) && f.value === value(row,'Archetype.ActorValue')
          && value(perk,f.path.replace('ActorValue','EntryPoint')) === rule[2]);
      const prefix = entry?.path.replace(/\.(ActorValue|EntryPoint)$/, '');
      if (!perk || !prefix || value(perk,'IsDeleted') !== 'False') reasons.push('controller entry point unavailable');
      else {
        depend(perk.winner);
        const rawCoefficient = value(perk,prefix+'.Value');
        const coefficient = rawCoefficient?.trim() && Number.isFinite(Number(rawCoefficient)) ? Number(rawCoefficient) : null;
        const modification = value(perk,prefix+'.Modification') ?? null;
        if (modification !== 'MultiplyOnePlusAVMult' || coefficient === null) reasons.push('controller magnitude operation unsupported');
        // Keep semantic evidence and CTDA tree, excluding numeric FormLinkOrIndex.Index aliases.
        const evidence = perk.fields.filter(f => f.path.startsWith(prefix+'.')
          && !/\.Index$|Unused|Unknown|ButtonLabel|FragmentIndex/.test(f.path)
          && (f.value !== undefined || /Conditions|Data$/.test(f.path)))
          .map(f => [f.path.slice(prefix.length+1),f.value !== undefined ? (address.test(f.value) ? key(f.value) : f.value) : f.note ?? null]);
        controller = {key:key(perk.formid),entry:prefix,entryPoint:rule[2],modification,coefficient,evidence};
      }
    }
    const family = rule[0], enabled = family !== 'SNEAK_ATTACK';
    if (!enabled) reasons.push('Q9: sneak attack bonus inactive');
    reasons.push('Q16: player-created instances unsupported without authoritative instance magnitude');
    for (const reason of reasons) issue(row,reason);
    put(row,'MGEF',{layout:1,fields,family,unit:rule[1],entryPoint:rule[2],controller,enabled,
      definitionStatus:reasons.some(r=>!r.startsWith('Q16:')&&!r.startsWith('Q9:'))?'UNSUPPORTED':'SUPPORTED',
      reasons,unavailable,activation:'UNSUPPORTED',
      conditions:row.fields.filter(f=>f.path.startsWith('Conditions')).map(f=>[f.path,f.value !== undefined ? (address.test(f.value)?key(f.value):f.value) : f.note ?? null])});
  }
  for (const row of carriers) {
    const refs = row.fields.filter(f => /^Effects\[\d+\]\.BaseEffect$/.test(f.path));
    const included = refs.filter(f => selected.has(f.value?.toLowerCase() ?? ''));
    if (!included.length) continue;
    const reasons: string[] = [], unavailable: string[] = [];
    const countText = /^\[list: (\d+) item\(s\)\]$/.exec(row.fields.find(f=>f.path==='Effects')?.note ?? '');
    const total = countText ? Number(countText[1]) : null;
    if (total === null || total !== refs.length || refs.some((_,i)=>!row.fields.some(f=>f.path==='Effects['+i+'].BaseEffect'))) reasons.push('incomplete carrier effect list');
    if (value(row,'IsDeleted') !== 'False') reasons.push('deleted or unavailable carrier winner');
    const effects = included.map(f => {
      const prefix = f.path.replace(/\.BaseEffect$/, '');
      const number = (leaf: string, integer: boolean) => {
        const path = prefix+'.Data.'+leaf, text = value(row,path);
        if (text !== undefined && text.trim() !== '' && Number.isFinite(Number(text)) && Number(text)>=0 && (!integer||Number.isInteger(Number(text)))) return Number(text);
        unavailable.push(path); reasons.push('carrier effect magnitude/duration/area unavailable'); return null;
      };
      const unconditional = row.fields.find(f=>f.path===prefix+'.Conditions')?.note === '[list: 0 item(s)]';
      if (!unconditional) reasons.push('carrier effect conditions not certified');
      return [key(f.value!),number('Magnitude',false),number('Duration',true),number('Area',true),Number(/\[(\d+)\]/.exec(prefix)![1]),unconditional];
    });
    const recordType = row.type === 'ObjectEffect' ? 'ENCH' : 'ALCH';
    if (recordType === 'ENCH' && (value(row,'CastType') !== 'ConstantEffect' || value(row,'TargetType') !== 'Self')) reasons.push('non-worn enchantment activation not certified');
    for (const reason of new Set(reasons)) issue(row,reason);
    put(row,recordType,{layout:1,effects,totalEffects:total,excludedEffects:total === null?null:total-included.length,
      flags:value(row,'Flags')??null,castType:value(row,'CastType')??null,targetType:value(row,'TargetType')??null,
      isDeleted:value(row,'IsDeleted')==='False'?false:value(row,'IsDeleted')==='True'?true:null,
      definitionStatus:reasons.length?'UNSUPPORTED':'SUPPORTED',reasons:[...new Set(reasons)],unavailable,
      magnitudeSource:'PREMADE_RECORD_ONLY',activation:'UNSUPPORTED'});
  }
  // Preserve counts of omitted magic/elemental/utility definitions, not their bulk payload.
  for (const sig of ['MGEF','ENCH','ALCH']) {
    const total = indexes.get(sig)!.size, included = records.filter(r=>r.recordType===sig).length;
    if (total>included) unsupported.push({status:'UNSUPPORTED',stableFormKey:null,reason:sig+': outside Q15 physical Fortify carrier closure',count:total-included});
  }
  if (report) report.push(...unsupported);
  const payload = {schemaVersion:1 as const,domain:'effects' as const,exportEpoch:epoch,
    dependencies:[...dependencies.values()].sort((a,b)=>compare(a.filename.toLowerCase(),b.filename.toLowerCase())),
    records:records.sort((a,b)=>compare(a.stableFormKey,b.stableFormKey)),roots:roots.sort(compare),unsupported:summarizeUnsupported(unsupported)};
  return {...payload,signature:contentSignature(payload)};
}

async function main(): Promise<void> {
  const [exportsDir,manifestPath,outputDir,reportDir] = process.argv.slice(2);
  if (!exportsDir||!manifestPath||!outputDir||!reportDir) throw new TypeError('Usage: effects.ts <exports-dir> <plugin-manifest.json> <output-dir> <report-dir>');
  const {plugins} = JSON.parse((await readFile(manifestPath,'utf8')).replace(/^\uFEFF/,'')) as {plugins:PluginFingerprint[]};
  const {buildCombatDomain} = await import('./combat.ts');
  await mkdir(outputDir,{recursive:true}); await mkdir(reportDir,{recursive:true});
  for (const build of [buildCombatDomain,buildEffectsDomain]) {
    const report: UnsupportedLink[] = [], data = await build(resolve(exportsDir),plugins,report);
    await writeFile(join(outputDir,data.domain+'.json'),canonicalJson(data)+'\n');
    await writeFile(join(reportDir,data.domain+'-unsupported.json'),canonicalJson({signature:data.signature,unsupported:report})+'\n');
    console.log(JSON.stringify({domain:data.domain,records:data.records.length,roots:data.roots.length,signature:data.signature,
      recordsByType:data.records.reduce<Record<string,number>>((a,r)=>{a[r.recordType]=(a[r.recordType]??0)+1;return a;},{}),
      unsupportedGroups:data.unsupported.length,unsupportedOccurrences:data.unsupported.reduce((n,u)=>n+(u.count??1),0)}));
  }
}
if (import.meta.url.startsWith('file:') && process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1;});
