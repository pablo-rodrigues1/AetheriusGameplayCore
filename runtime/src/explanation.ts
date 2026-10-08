import type { CharacterKey } from '../../shared/contracts/src/index.ts';
import type { DomainData } from '../../shared/record-catalog/src/types.ts';
import { contentSignature, recordSignature } from '../../shared/record-catalog/src/index.ts';
import type { QueryExecutor } from '../../shared/persistence/src/index.ts';
import { compose, effectiveSet } from '../../modules/actor-state-system/src/index.ts';
import { readRace, raceGrants, initialRaceAttributes } from '../../modules/race-system/src/index.ts';
import type { RaceOwnership } from '../../modules/race-system/src/ownership.ts';
import { readStandingStone, standingStoneGrants } from '../../modules/standing-stone-system/src/index.ts';
import { nativeGrantKeys, portGrantSet } from './composition.ts';

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
export async function explainCharacter(tx:QueryExecutor,key:CharacterKey,stones:DomainData,races:DomainData,ownership:readonly RaceOwnership[]) {
  const stone=await readStandingStone(tx,key),race=await readRace(tx,key);
  const stoneCatalog=definitionCatalog(stones),raceCatalog=definitionCatalog(races);
  const revision=(stone?.revision??0)+(race?.revision??0);
  const set=compose(key,[standingStoneGrants(stoneCatalog,stone),raceGrants(raceCatalog,race)],
    {facts:revision,grants:revision,equipment:0,effects:0,catalog:1});
  const native=nativeGrantKeys(set);
  return {characterKey:key,facts:{standingStone:stone??null,race:race??null},revision:set.revision,
    observationStatus:race?.status??'UNSUPPORTED',
    initialAttributes:race?.status==='SUPPORTED'&&race.raceKey?initialRaceAttributes(raceCatalog,race.raceKey):null,
    grants:effectiveSet(set).grants.map(grant=>({ ...grant, delivery:native.has(grant.definition.stableFormKey)?'NATIVE_RACE_RECORD':'GRANT_PROJECTION_PORT',
      ownership:grant.sources.map(source=>({source, ...(source.kind==='RACE'?{
        detail:ownership.find(row=>row.raceKey===source.key&&row.stableFormKey===grant.definition.stableFormKey)??{status:'UNSUPPORTED',reason:'RACE_OWNERSHIP_ABSENT'}
      }:{grantOwner:'AETHERIUS_SERVER',resultOwner:'NATIVE_CLIENT',resultStatus:'NATIVE_RESULT_NOT_CERTIFIED'})}))})),
    portGrants:portGrantSet(set).grants};
}
