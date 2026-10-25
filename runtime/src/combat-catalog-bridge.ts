import type { RuntimeMp } from './host.ts';
import type { DomainCatalog, ResolvedRecord } from '../../shared/record-catalog/src/types.ts';

/** Runtime-only transport; runtimeId never enters catalogs, facts or persistence. */
interface NativeCombatApi {
  setAetheriusCombatCatalog?(json:string):boolean;
  getAetheriusCombatCapabilities?():string;
  getAetheriusCombatProfileRequests?():string;
}
/** Bounded native requests are drained outside the synchronous hit. The first
 * hit can be UNSUPPORTED; composition never calls back into JS from C++. */
export function startNpcCombatProfilePump(mp:RuntimeMp|undefined,
  scope:{interval(callback:()=>void,ms:number):void},inspect:(actorId:number)=>unknown) {
  const native=mp as (RuntimeMp&NativeCombatApi)|undefined;
  if(!native?.getAetheriusCombatProfileRequests)return;
  scope.interval(()=>{
    try {
      const ids:unknown=JSON.parse(native.getAetheriusCombatProfileRequests!());
      if(!Array.isArray(ids)||ids.length>2048)return;
      for(const id of ids)if(Number.isSafeInteger(id)&&id>0&&id<=4294967295) {
        try { inspect(id); }catch { /* absent/destroyed actor stays UNSUPPORTED */ }
      }
    }catch { /* absent native context never installs a neutral profile */ }
  },250);
}
interface RawRecord {type:string;editorId?:string;fields?:readonly {type:string;data:Uint8Array}[]}
const gmstKeys = {
  fDamagePCSkillMax:'skyrim.esm|0C5C0F',
  fArmorRatingBase:'skyrim.esm|01A157',
  fArmorRatingPCMax:'skyrim.esm|0C5C0C'
} as const;
const number=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1e7;
const descriptor=(key:string)=>{const [plugin,id]=key.split('|');return `${id}:${plugin}`;};
function readGmst(mp:RuntimeMp,key:string,name:string) {
  const runtimeId=mp.getIdFromDesc(descriptor(key));
  const record=mp.lookupEspmRecordById(runtimeId).record as RawRecord|undefined;
  const fields=record?.fields?.filter(f=>f.type==='DATA');
  if(record?.type!=='GMST'||record.editorId!==name||fields?.length!==1||fields[0]!.data.byteLength!==4)
    throw Error('GMST_WINNER_UNAVAILABLE');
  const bytes=fields[0]!.data;
  const value=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getFloat32(0,true);
  if(!number(value)||value>100)throw Error('GMST_WINNER_INVALID');
  return {stableFormKey:key,runtimeId,value};
}
function recordArmorEnchantment(record:ResolvedRecord,effects:DomainCatalog|undefined):number|null {
  const fields=record.data.fields as Record<string,unknown>;
  const key=fields.ObjectEffect;
  if(key===null)return 0;
  if(typeof key!=='string'||effects?.status!=='SUPPORTED')return null;
  const ench=effects.records.find(r=>r.definition.stableFormKey===key&&r.definition.recordType==='ENCH');
  if(!ench||!Array.isArray(ench.data.effects)||!Array.isArray(ench.data.unavailable)||ench.data.unavailable.length
    ||ench.data.excludedEffects!==0)return null; // omitted effects cannot prove legacy DamageResist completeness
  let sum=0;
  for(const tuple of ench.data.effects) {
    if(!Array.isArray(tuple))return null;
    const mgef=effects.records.find(r=>r.definition.stableFormKey===tuple[0]);
    if(!mgef)return null;
    if(mgef.data.family==='ARMOR_RATING') {
      if(!number(tuple[1]))return null;
      sum+=tuple[1]; // preserve existing record DamageResist once; no Q16 activation
    }
  }
  return sum;
}
export function prepareCombatCatalog(mp:RuntimeMp,combat:DomainCatalog|undefined,effects:DomainCatalog|undefined) {
  if(combat?.status!=='SUPPORTED')throw Error('COMBAT_CATALOG_UNAVAILABLE');
  const gmsts=Object.fromEntries(Object.entries(gmstKeys).map(([name,key])=>[name,readGmst(mp,key,name)]));
  const records=[];
  for(const record of combat.records) {
    const type=record.definition.recordType;
    if(!['WEAP','ARMO','AMMO','RACE'].includes(type))continue;
    const fields=record.data.fields as Record<string,unknown>;
    const base=fields[type==='WEAP'?'BasicStats.Damage':type==='ARMO'?'ArmorRating':type==='AMMO'?'Damage':'UnarmedDamage'];
    const clothing=type==='ARMO'&&fields['BodyTemplate.ArmorType']==='Clothing';
    const rawSkill=type==='WEAP'?fields['Data.Skill']:
      type==='ARMO'&&!clothing?fields['BodyTemplate.ArmorType']:'';
    // Mutagen's WEAP ActorValue spells Archery; the fixed profile uses Marksman.
    const skill=rawSkill==='Archery'?'Marksman':rawSkill;
    const ranged=type==='WEAP'&&['Bow','Crossbow'].includes(String(fields['Data.AnimationType']));
    const damageResist=type==='ARMO'?recordArmorEnchantment(record,effects):0;
    const template=record.data.template as {status?:string}|undefined;
    const supported=fields.IsDeleted===false&&number(base)&&damageResist!==null&&number(damageResist)
      &&Array.isArray(record.data.keywords)&&(!template||template.status==='SUPPORTED')
      &&(type!=='WEAP'||['OneHanded','TwoHanded','Marksman'].includes(String(skill)))
      &&(type!=='ARMO'||clothing||['LightArmor','HeavyArmor'].includes(String(skill)))
      &&(type!=='WEAP'||(ranged===(skill==='Marksman')));
    records.push({stableFormKey:record.definition.stableFormKey,runtimeId:record.runtimeFormId,type,
      status:supported?'SUPPORTED':'UNSUPPORTED',reason:supported?null:'EFFECTIVE_COMBAT_FIELD_UNAVAILABLE',
      base:supported?base:null,skill:typeof skill==='string'?skill:'',ranged,clothing,
      damageResist:supported?damageResist:null,keywords:record.data.keywords});
  }
  return {version:1,gmsts,records};
}
const installed=new WeakMap<object,string>();
export function deliverCombatCatalog(mp:RuntimeMp|undefined,combat:DomainCatalog|undefined,effects:DomainCatalog|undefined) {
  const native=mp as (RuntimeMp&NativeCombatApi)|undefined;
  if(!native?.setAetheriusCombatCatalog||!native.getAetheriusCombatCapabilities)
    return {status:'UNSUPPORTED',reason:'NATIVE_COMBAT_CATALOG_BRIDGE_NOT_DELIVERED (DS-5)',families:{}};
  try {
    const signature=`${combat?.signature}|${effects?.signature}`;
    if(installed.get(native)!==signature) {
      const prepared=prepareCombatCatalog(native,combat,effects);
      if(!native.setAetheriusCombatCatalog(JSON.stringify(prepared)))throw Error('NATIVE_COMBAT_CATALOG_REJECTED');
      installed.set(native,signature);
    }
    const capabilities=JSON.parse(native.getAetheriusCombatCapabilities()) as Record<string,unknown>;
    if(capabilities.version!==1||!capabilities.families||typeof capabilities.families!=='object')throw Error('NATIVE_OWNERSHIP_INVALID');
    for(const name of ['melee','ranged','unarmed']) {
      const family=(capabilities.families as Record<string,Record<string,unknown>>)[name];
      if(!family||family.owner!=='NATIVE_SERVER'||family.candidateOwner!=='AETHERIUS_SERVER'
        ||!['off','shadow','active'].includes(String(family.mode)))throw Error('NATIVE_OWNERSHIP_INVALID');
    }
    return {status:'SUPPORTED',reason:null,...capabilities};
  }catch(error) {
    return {status:'UNSUPPORTED',reason:error instanceof Error?error.message:'NATIVE_COMBAT_BRIDGE_FAILED',families:{}};
  }
}
