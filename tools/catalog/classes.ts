import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeFormKey } from '../../shared/record-catalog/src/codecs.ts';
import { canonicalJson, contentSignature, recordSignature } from '../../shared/record-catalog/src/integrity.ts';
import type { DomainData, PluginFingerprint, CatalogRecord, ClassDefinition, ClassPerk } from '../../shared/record-catalog/src/types.ts';
import type { JsonObject } from '../../shared/contracts/src/messages.ts';
import type { StableFormKey } from '../../shared/contracts/src/identity.ts';
interface Field { path:string; value?:string; note?:string }
interface Row { formid:string; type:string; editorid:string; winner:string; fields:Field[] }
interface Candidate { formid:string; chainRank:number; skill:string; editorid:string; winner:string }
interface Crosswalk { label:string; rank:number|null; status:string; candidates:Candidate[] }

export const CLASS_SKILL_NAMES = [
  'OneHanded','TwoHanded','Marksman','Block','Smithing','HeavyArmor','LightArmor','Pickpocket','Lockpicking',
  'Sneak','Alchemy','Speechcraft','Alteration','Conjuration','Destruction','Illusion','Restoration','Enchanting'
] as const;
export type ClassSkillName = typeof CLASS_SKILL_NAMES[number];
export type ClassSkillValues = Readonly<Record<ClassSkillName,number>>;

/** Exact Portuguese labels found in classes-config.json, mapped to stable ActorValue names. */
export const CLASS_SKILL_LABEL_TO_ACTOR_VALUE: Readonly<Record<string,ClassSkillName>> = Object.freeze({
  'Alteração':'Alteration',
  'Armadura Leve':'LightArmor',
  'Ilusão':'Illusion',
  'Furtividade':'Sneak',
  'Restauração':'Restoration',
  'Uma-Mão':'OneHanded',
  'Arquearia':'Marksman',
  'Duas-Mãos':'TwoHanded',
  'Armadura Pesada':'HeavyArmor',
  'Bloqueio':'Block',
  'Conjuração':'Conjuration',
  'Destruição':'Destruction'
});

const normalizedSkillLabels = new Map<string,ClassSkillName>(Object.entries(CLASS_SKILL_LABEL_TO_ACTOR_VALUE)
  .map(([label,actorValue])=>[label.toLowerCase(),actorValue] as const));
function emptyClassSkills(value=0):Record<ClassSkillName,number> {
  return Object.fromEntries(CLASS_SKILL_NAMES.map(name=>[name,value])) as Record<ClassSkillName,number>;
}
function skillValue(raw:string,source:string):number {
  if(!/^\d+$/.test(raw))throw new Error(`CLASS_SKILL_VALUE_INVALID: ${JSON.stringify(source)}`);
  const value=Number(raw);
  if(!Number.isSafeInteger(value))throw new Error(`CLASS_SKILL_VALUE_INVALID: ${JSON.stringify(source)}`);
  return value;
}
/** Parse one official Portuguese stage string. Missing names stay absent for cumulative application. */
export function parseClassSkillText(text:string):Partial<Record<ClassSkillName,number>> {
  if(typeof text!=='string')throw new Error(`CLASS_SKILL_TEXT_INVALID: ${JSON.stringify(text)}`);
  const source=text.trim();
  if(!source)return {};
  const all=/^Todas\s+(\d+)$/i.exec(source);
  if(all){const value=skillValue(all[1]!,text);return emptyClassSkills(value);}
  const parsed:Partial<Record<ClassSkillName,number>>={};
  for(const rawPart of source.split(',')){
    const part=rawPart.trim(),match=/^(.+?)\s+(\d+)$/.exec(part);
    if(!match)throw new Error(`CLASS_SKILL_ENTRY_INVALID: ${JSON.stringify(text)}`);
    const label=match[1]!.trim(),actorValue=normalizedSkillLabels.get(label.toLowerCase());
    if(!actorValue)throw new Error(`CLASS_SKILL_NAME_UNKNOWN: ${JSON.stringify(label)} in ${JSON.stringify(text)}`);
    if(Object.hasOwn(parsed,actorValue))throw new Error(`CLASS_SKILL_DUPLICATE: ${JSON.stringify(label)} in ${JSON.stringify(text)}`);
    parsed[actorValue]=skillValue(match[2]!,text);
  }
  return parsed;
}
/** Apply the Q14 cumulative rule in source order; a blank stage changes nothing. */
export function accumulateClassSkillStages(stages:readonly {readonly skills:string}[]):readonly ClassSkillValues[] {
  let current=emptyClassSkills();
  return stages.map(stage=>{
    const updates=parseClassSkillText(stage.skills),next={...current};
    for(const name of CLASS_SKILL_NAMES)if(updates[name]!==undefined)next[name]=updates[name]!;
    current=next;
    return Object.freeze({...current});
  });
}

type CatalogClassDefinition = Omit<ClassDefinition,'stages'> & {
  readonly stages:readonly (ClassDefinition['stages'][number] & {readonly skills:ClassSkillValues})[]
};

const value=(r:Row,p:string)=>r.fields.find(f=>f.path===p)?.value;
function exported(file:string) {
  const lines=readFileSync(file,'utf8').replace(/^\uFEFF/,'').trim().split(/\r?\n/).map(l=>JSON.parse(l));
  const manifest=lines.shift();
  if(manifest.housecarl_artifact!==1||manifest.row_count!==lines.length)throw Error('EXPORT_MANIFEST_INVALID');
  return {manifest,rows:lines as Row[]};
}
/** Reconstruct ranks from AVIF roots and NextPerk, independently of the name crosswalk. */
export function buildClasses(exportsDir:string,configPath:string,fingerprints:readonly PluginFingerprint[]):DomainData {
  const perks=exported(join(exportsDir,'PERK.jsonl')),avif=exported(join(exportsDir,'AVIF.jsonl'));
  if(perks.manifest.epoch!==avif.manifest.epoch)throw Error('EXPORT_EPOCH_MISMATCH');
  const rows=new Map(perks.rows.map(r=>[r.formid.toLowerCase(),r]));
  // D-P1: deeper official evidence supplies the missing entry-point predicates.
  // Merge only effect fields; acquisition and other record payloads stay unchanged.
  const poison=exported(join(exportsDir,'classes/PERK-concentrated-poison-depth12.jsonl'));
  if(poison.manifest.epoch!==perks.manifest.epoch)throw Error('POISON_EXPORT_EPOCH_MISMATCH');
  for(const deep of poison.rows){const prior=rows.get(deep.formid.toLowerCase());
    if(!prior||prior.winner!==deep.winner||prior.editorid!==deep.editorid)throw Error('POISON_WINNER_MISMATCH');
    const fields=new Map(prior.fields.map(f=>[f.path,f]));
    for(const field of deep.fields.filter(f=>f.path.startsWith('Effects[')))fields.set(field.path,field);
    rows.set(deep.formid.toLowerCase(),{...prior,fields:[...fields.values()]});
  }
  const chains=new Map<string,{rank:number;skill:string;chain:string[]}>();
  for(const a of avif.rows)for(const f of a.fields.filter(f=>/^PerkTree\[\d+\]\.Perk$/.test(f.path)&&f.value)) {
    let address=f.value!;const chain:string[]=[];
    while(rows.has(address.toLowerCase())) {
      if(chain.some(p=>p.toLowerCase()===address.toLowerCase()))throw Error('PERK_CHAIN_CYCLE');
      chain.push(address);const found={rank:chain.length,skill:a.editorid,chain:[...chain]};
      const old=chains.get(address.toLowerCase());
      if(old&&(old.rank!==found.rank||old.skill!==found.skill))throw Error('PERK_CHAIN_AMBIGUOUS');
      chains.set(address.toLowerCase(),found);
      const next=value(rows.get(address.toLowerCase())!,'NextPerk');if(!next)break;address=next;
    }
  }
  const crosswalk=new Map((readFileSync(join(exportsDir,'classes/perk-crosswalk.jsonl'),'utf8').trim().split(/\r?\n/).map(l=>JSON.parse(l)) as Crosswalk[]).map(c=>[c.label,c]));
  const plugins=new Map(fingerprints.map(p=>[p.filename.toLowerCase(),p]));
  const dependencies=new Map<string,PluginFingerprint>(),records=new Map<StableFormKey,CatalogRecord>();
  function plugin(name:string){const p=plugins.get(name.toLowerCase());if(!p)throw Error(`PLUGIN_METADATA_ABSENT: ${name}`);dependencies.set(p.filename.toLowerCase(),p);return p;}
  function key(address:string){const p=plugin(address.slice(address.indexOf(':')+1));return decodeFormKey(address,'housecarl',p.isLight?'LIGHT':'FULL');}
  function put(address:string){const r=rows.get(address.toLowerCase());if(!r)throw Error('CHAIN_RECORD_ABSENT');
    const stableFormKey=key(r.formid);if(records.has(stableFormKey))return stableFormKey;
    const p=plugin(r.formid.slice(r.formid.indexOf(':')+1));plugin(r.winner);
    // Same canonical PERK payload as the approved race/stone builder: shared
    // record identity/signature is independent of the class's chain metadata.
    const data:JsonObject={editorId:r.editorid,fields:Object.fromEntries(r.fields
      .filter(f=>/^(NumRanks$|NextPerk$|Conditions\[|Effects\[|VirtualMachineAdapter\.)/.test(f.path)&&f.value!==undefined&&!/\.Parameter[12]\.Index$/.test(f.path))
      .sort((a,b)=>a.path.localeCompare(b.path,'en')).map(f=>[f.path,/^[\da-f]{6}:[^:]+\.(esm|esp|esl)$/i.test(f.value!)?key(f.value!):f.value!])),
      exportNotes:Object.fromEntries(r.fields.filter(f=>/^(Effects\[|Conditions|VirtualMachineAdapter)/.test(f.path)&&f.note!==undefined)
        .sort((a,b)=>a.path.localeCompare(b.path,'en')).map(f=>[f.path,f.note!]))};
    const record={stableFormKey,recordType:'PERK' as const,definingPlugin:p.filename,pluginKind:p.isLight?'LIGHT' as const:'FULL' as const,winnerPlugin:r.winner,data};
    records.set(stableFormKey,{...record,signature:recordSignature(record,p)});return stableFormKey;
  }
  const config=JSON.parse(readFileSync(configPath,'utf8')) as Record<string,{id:string;stages:{level:number;perks:string[];skills:string}[]}>;
  const unresolved=new Set(['Anímage (1)','Anímage (2)','Anímage (3)','Heavy Armor Mestre','One-Hand Mastery','Rune Mestre']);
  const classes:CatalogClassDefinition[]=Object.entries(config).sort(([a],[b])=>a.localeCompare(b,'en')).map(([id,c])=>{
    if(c.id!==id||c.stages.map(s=>s.level).join(',')!=='1,5,10,15,20,25,30,35,40')throw Error('CLASS_CONFIG_INVALID');
    if(c.stages.some(s=>typeof s.skills!=='string'))throw new Error(`CLASS_STAGE_SKILLS_MISSING: ${id}`);
    const cumulativeSkills=accumulateClassSkillStages(c.stages);
    const prior=new Set<StableFormKey>(),divergences:string[]=[];
    const stages=c.stages.map((s,index)=>({level:s.level,skills:cumulativeSkills[index]!,perks:s.perks.map(label=>{
      const x=crosswalk.get(label),candidate=x?.candidates[0],r=candidate?rows.get(candidate.formid.toLowerCase()):undefined;
      const chain=candidate?chains.get(candidate.formid.toLowerCase()):undefined;
      let reason=unresolved.has(label)?'UNRESOLVED_LABEL_OWNER_CONFIRMATION_REQUIRED':x?.status!=='RESOLVED'||x.candidates.length!==1?'CROSSWALK_NOT_RESOLVED':
        !r||r.type!=='Perk'||value(r,'IsDeleted')==='True'?'PERK_RECORD_ABSENT_OR_DELETED':
        !chain||chain.rank!==candidate!.chainRank||(x.rank!==null&&x.rank!==chain.rank)||chain.skill!==candidate!.skill||r.editorid!==candidate!.editorid||r.winner!==candidate!.winner?'CROSSWALK_RECORD_OR_RANK_MISMATCH':null;
      if(reason)return {label,status:'UNSUPPORTED',stableFormKey:null,rank:null,skill:null,chain:[],reason} as ClassPerk;
      const chainKeys=chain!.chain.map(put),stableFormKey=put(r!.formid);
      const prerequisites=r!.fields.filter(f=>/^Conditions\[\d+\]\.Data\.Perk$/.test(f.path)&&f.value).map(f=>{
        const prefix=f.path.replace(/\.Data\.Perk$/,'');return {key:key(f.value!),comparison:value(r!,`${prefix}.CompareOperator`)??'UNSUPPORTED',
          value:value(r!,`${prefix}.ComparisonValue`)??'UNSUPPORTED',flags:value(r!,`${prefix}.Flags`)??'UNSUPPORTED'};
      });
      return {label,status:'SUPPORTED',stableFormKey,rank:chain!.rank,skill:chain!.skill,chain:chainKeys,prerequisites,reason:null} as ClassPerk;
    })}));
    // Evaluate the previous milestone set (never automatically add missing ranks).
    for(const s of stages){for(const perk of s.perks)if(perk.status==='SUPPORTED')for(const p of perk.chain.slice(0,-1))if(!prior.has(p))divergences.push(`${perk.label}@${s.level}: previous rank not granted earlier: ${p}`);
      for(const perk of s.perks)if(perk.stableFormKey)prior.add(perk.stableFormKey);}
    return {id,stages,divergences};
  });
  if(classes.length!==18)throw Error('CLASS_COUNT_INVALID');
  const unsupported=[...new Set(classes.flatMap(c=>c.stages.flatMap(s=>s.perks.filter(p=>p.status==='UNSUPPORTED').map(p=>`${p.label}: ${p.reason}`))))].sort().map(reason=>({status:'UNSUPPORTED' as const,stableFormKey:null,reason}));
  const payload={schemaVersion:1 as const,domain:'classes' as const,exportEpoch:perks.manifest.epoch as string,
    dependencies:[...dependencies.values()].sort((a,b)=>a.filename.toLowerCase().localeCompare(b.filename.toLowerCase(),'en')),
    records:[...records.values()].sort((a,b)=>a.stableFormKey.localeCompare(b.stableFormKey,'en')),
    roots:[...new Set(classes.flatMap(c=>c.stages.flatMap(s=>s.perks.flatMap(p=>p.stableFormKey?[p.stableFormKey]:[]))))].sort(),unsupported,classes};
  return {...payload,signature:contentSignature(payload)};
}
if(import.meta.url.startsWith('file:')&&process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const [exportsDir,config,manifest,out]=process.argv.slice(2);
  if(!exportsDir||!config||!manifest||!out)throw Error('Usage: classes.ts <exports> <classes-config.json> <plugin-manifest.json> <classes.json>');
  const data=buildClasses(exportsDir,config,JSON.parse(readFileSync(manifest,'utf8').replace(/^\uFEFF/,'')).plugins);
  writeFileSync(out,canonicalJson(data)+'\n');console.log(`classes: ${data.classes!.length} classes; ${data.records.length} records; ${data.unsupported.length} unsupported labels; ${data.signature}`);
}
