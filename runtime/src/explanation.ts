import type { CharacterKey } from '../../shared/contracts/src/index.ts';
import type { DomainData } from '../../shared/record-catalog/src/types.ts';
import { contentSignature, recordSignature } from '../../shared/record-catalog/src/index.ts';
import type { QueryExecutor } from '../../shared/persistence/src/index.ts';
import { compose, effectiveSet } from '../../modules/actor-state-system/src/index.ts';
import { readRace, raceGrants, initialRaceAttributes } from '../../modules/race-system/src/index.ts';
import type { RaceOwnership } from '../../modules/race-system/src/ownership.ts';
import { readStandingStone, standingStoneGrants } from '../../modules/standing-stone-system/src/index.ts';
import { nativeGrantKeys, portGrantSet } from './composition.ts';
import { readClass, classGrants, withDevelopmentLevel, classDefinition } from '../../modules/class-progression-system/src/index.ts';
import { levelingLevelPort } from '../../modules/leveling-system/src/persistence/durable.ts';

/** Signed offline definitions, with no fabricated runtime IDs or live-host claim. */
export function definitionCatalog(data:DomainData) {
  if(contentSignature(data)!==data.signature)throw Error('CATALOG_INTEGRITY_FAILED');
  const records=new Map(data.records.map(record=>{
    const plugin=data.dependencies.find(p=>p.filename.toLowerCase()===record.definingPlugin.toLowerCase());
    if(!plugin||recordSignature(record,plugin)!==record.signature)throw Error('RECORD_INTEGRITY_FAILED');
    return [record.stableFormKey,{definition:{stableFormKey:record.stableFormKey,recordType:record.recordType,catalogSignature:record.signature},data:record.data}];
  }));
  return {status:'SUPPORTED' as const,roots:data.roots.map(key=>{const record=records.get(key);if(!record)throw Error('ROOT_ABSENT');return record;}),
    unsupported:data.unsupported,byKey:(key:Parameters<typeof records.get>[0])=>records.get(key)};
}
export async function explainCharacter(tx:QueryExecutor,key:CharacterKey,stones:DomainData,races:DomainData,ownership:readonly RaceOwnership[],classes?:DomainData,devLevel?:number) {
  const stone=await readStandingStone(tx,key),race=await readRace(tx,key);
  const stoneCatalog=definitionCatalog(stones),raceCatalog=definitionCatalog(races);
  const classFact=classes?await readClass(tx,key):undefined,level=classes?await withDevelopmentLevel(levelingLevelPort,devLevel).read(tx,key):undefined;
  const classOutput=classes&&level?classGrants(classes,definitionCatalog(classes),classFact,level.level,(classFact?.revision??0)+level.revision):[];
  const revision=(stone?.revision??0)+(race?.revision??0)+(classFact?.revision??0)+(level?.revision??0);
  const set=compose(key,[standingStoneGrants(stoneCatalog,stone),raceGrants(raceCatalog,race),classOutput],
    {facts:revision,grants:revision,equipment:0,effects:0,catalog:1});
  const native=nativeGrantKeys(set);
  return {characterKey:key,facts:{standingStone:stone??null,race:race??null,...(classes?{class:classFact??null,level}: {})},revision:set.revision,
    ...(classes?{classMilestones:classFact?classDefinition(classes,classFact.classId).stages.map(stage=>({...stage,reached:stage.level<=level!.level,
      delivery:'UNSUPPORTED: class perks not delivered to client; awaits B5b'})):[],perkDelivery:'UNSUPPORTED: class perks not delivered to client; awaits B5b'}:{}),
    observationStatus:race?.status??'UNSUPPORTED',
    initialAttributes:race?.status==='SUPPORTED'&&race.raceKey?initialRaceAttributes(raceCatalog,race.raceKey):null,
    grants:effectiveSet(set).grants.map(grant=>({ ...grant, delivery:grant.sources.some(s=>s.kind==='CLASS')?'UNSUPPORTED: class perks not delivered to client; awaits B5b':native.has(grant.definition.stableFormKey)?'NATIVE_RACE_RECORD':'GRANT_PROJECTION_PORT',
      ownership:grant.sources.map(source=>({source, ...(source.kind==='RACE'?{
        detail:ownership.find(row=>row.raceKey===source.key&&row.stableFormKey===grant.definition.stableFormKey)??{status:'UNSUPPORTED',reason:'RACE_OWNERSHIP_ABSENT'}
      }:{grantOwner:'AETHERIUS_SERVER',resultOwner:source.kind==='CLASS'?'DISABLED':'NATIVE_CLIENT',resultStatus:source.kind==='CLASS'?'UNSUPPORTED_AWAITS_B5b':'NATIVE_RESULT_NOT_CERTIFIED'})}))})),
    portGrants:portGrantSet(set).grants};
}
