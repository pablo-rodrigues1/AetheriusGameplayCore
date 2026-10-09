import type { CharacterKey, Grant, StableFormKey, SessionEpoch } from '../../../shared/contracts/src/index.ts';
import type { ClassDefinition, DomainData, ResolvedRecord } from '../../../shared/record-catalog/src/types.ts';
import type { QueryExecutor, PoolPort } from '../../../shared/persistence/src/index.ts';
import { executeCommand } from '../../../shared/persistence/src/index.ts';
import { assertCharacterKey } from '../../../shared/persistence/src/transaction.ts';
export interface ClassFact { readonly classId:string; readonly revision:number }
export interface CharacterLevel { readonly level:number; readonly origin:'LEVELING'|'LEVELING_DEFAULT'|'DEV'; readonly revision:number }
export interface CharacterLevelPort { read(tx:QueryExecutor,key:CharacterKey):Promise<CharacterLevel> }
export class ClassError extends Error { constructor(readonly code:string){super(code);} }
export function classDefinition(data:DomainData,id:string):ClassDefinition {
  const definition=data.classes?.find(c=>c.id===id);
  if(data.domain!=='classes'||!definition)throw new ClassError('CLASS_UNKNOWN');return definition;
}
export async function readClass(tx:QueryExecutor,key:CharacterKey):Promise<ClassFact|undefined> {
  assertCharacterKey(key);
  const row=(await tx.query<{class_id:string;revision:string}>('SELECT class_id,revision FROM gc_character_class WHERE character_key=$1',[key])).rows[0];
  if(!row)return undefined;const revision=Number(row.revision);
  if(!Number.isSafeInteger(revision)||revision<1)throw new ClassError('CLASS_REVISION_INVALID');
  return Object.freeze({classId:row.class_id,revision});
}
/** Pure entitlement calculation: no conditions are evaluated and no missing rank is inferred. */
export function classGrants(data:DomainData,catalog:{readonly status:'SUPPORTED'|'UNSUPPORTED';byKey(key:StableFormKey):Pick<ResolvedRecord,'definition'|'data'>|undefined}|undefined,fact:ClassFact|undefined,level:number,revision=fact?.revision??0):readonly Grant[] {
  if(!fact)return Object.freeze([]);
  if(catalog?.status!=='SUPPORTED')throw new ClassError('CLASS_CATALOG_UNAVAILABLE');
  if(!Number.isInteger(level)||level<1||level>40)throw new ClassError('CLASS_LEVEL_INVALID');
  const definition=classDefinition(data,fact.classId),grants=new Map<StableFormKey,Grant>();
  for(const stage of definition.stages.filter(s=>s.level<=level))for(const perk of stage.perks){
    if(perk.status==='UNSUPPORTED')continue;
    const record=perk.stableFormKey?catalog.byKey(perk.stableFormKey):undefined;
    if(!record||record.definition.recordType!=='PERK'||!perk.rank)throw new ClassError('CLASS_PERK_UNSUPPORTED');
    grants.set(record.definition.stableFormKey,Object.freeze({kind:'perk',definition:record.definition as Grant['definition']&{recordType:'PERK'},
      rank:perk.rank,source:Object.freeze({kind:'CLASS',key:fact.classId}),revision}));
  }
  return Object.freeze([...grants.values()].sort((a,b)=>a.definition.stableFormKey.localeCompare(b.definition.stableFormKey,'en')));
}
/** Same command is used by staff and the runtime; caller supplies the existing scoped pool. */
export function createClassCommands(pool:PoolPort,data:DomainData) {
  return {async set(input:{characterKey:CharacterKey;classId:string;requestId:string;epoch:SessionEpoch}) {
    classDefinition(data,input.classId);assertCharacterKey(input.characterKey);
    return executeCommand(pool,{requestId:input.requestId,characterKey:input.characterKey,epoch:input.epoch,type:'classes.set',payload:{classId:input.classId}},async(tx,command)=>{
      const classId=(command.payload as {classId:string}).classId,prior=await readClass(tx,command.characterKey);
      const changed=prior?.classId!==classId,revision=(prior?.revision??0)+(changed?1:0);
      if(!Number.isSafeInteger(revision))throw new ClassError('CLASS_REVISION_EXHAUSTED');
      await tx.query(`INSERT INTO gc_character_class(character_key,class_id,revision) VALUES($1,$2,$3)
        ON CONFLICT(character_key) DO UPDATE SET class_id=EXCLUDED.class_id,revision=EXCLUDED.revision`,[command.characterKey,classId,revision]);
      return {classId,previousClass:prior?.classId??null,revision,changed};
    });
  }};
}
/** Presence is strict: invalid/online override disables classes, including when mode=off. */
export function developmentLevel(raw:string|undefined,offlineMode:boolean|undefined):number|undefined {
  if(raw===undefined)return undefined;
  if(offlineMode!==true)throw new ClassError('DEV_CLASS_LEVEL_OFFLINE_MODE_REQUIRED');
  if(!/^(?:[1-9]|[12][0-9]|3[0-9]|40)$/.test(raw))throw new ClassError('DEV_CLASS_LEVEL_INVALID');
  return Number(raw);
}
export function withDevelopmentLevel(port:CharacterLevelPort,level:number|undefined):CharacterLevelPort {
  return {async read(tx,key){const actual=await port.read(tx,key);return level===undefined?actual:Object.freeze({level,origin:'DEV',revision:actual.revision});}};
}
