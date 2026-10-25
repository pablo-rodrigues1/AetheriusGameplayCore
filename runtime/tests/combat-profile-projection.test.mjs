import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=fileURLToPath(new URL('../../',import.meta.url));
const compiled=await build({
  absWorkingDir:root,
  stdin:{loader:'ts',resolveDir:root,contents:
    "export {composePlayerCombatProfile,composeNpcCombatProfile,CombatProfileProjectionPort} from './runtime/src/combat-profile.ts';\n"+
    "export {NPC_FIELDS,NPC_TEMPLATE_CATEGORIES,npcField,npcTemplateProvider} from './shared/record-catalog/src/npcs.ts';\n"+
    "export {compilePerk} from './modules/damage-system/compiler/dist/compiler.js';"},
  bundle:true,platform:'node',format:'esm',write:false
});
const api=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const exportsRoot=process.env.GAMEPLAY_CORE_TEST_EXPORTS??resolve(root,'../_work/exports');
function locateExport(name){
  const directories=readdirSync(exportsRoot,{withFileTypes:true})
    .filter(entry=>entry.isDirectory()).map(entry=>entry.name).sort((a,b)=>b.localeCompare(a));
  for(const directory of directories){
    const nested=resolve(exportsRoot,directory,name);
    if(existsSync(nested))return nested;
  }
  const direct=resolve(exportsRoot,name);
  if(existsSync(direct))return direct;
  throw new Error('Required FormID export unavailable: '+name);
}
function readJsonl(name){
  return readFileSync(locateExport(name),'utf8').split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));
}
function formIdFromStable(key){
  const split=key.lastIndexOf('|');
  return key.slice(split+1)+':'+key.slice(0,split);
}
function stableFromFormId(formid){
  const split=formid.indexOf(':');
  if(split<0)return null;
  return formid.slice(split+1).toLowerCase()+'|'+formid.slice(0,split).toUpperCase();
}
function domainFile(name){return JSON.parse(readFileSync(resolve(root,'catalog',name+'.json'),'utf8'));}
function entryFromRecord(record){
  return {
    definition:{stableFormKey:record.stableFormKey,recordType:record.recordType,catalogSignature:record.signature},
    winnerPlugin:record.winnerPlugin,
    data:record.data
  };
}
function domainCatalog(data){
  const byKey=new Map(data.records.map(record=>[record.stableFormKey,record]));
  return {status:'SUPPORTED',signature:data.signature,byKey(key){const record=byKey.get(key);return record?entryFromRecord(record):undefined;}};
}
const classData=domainFile('classes');
const raceData=domainFile('races');
const otherDomains=[domainFile('combat'),domainFile('standing-stones'),raceData,classData];
const perkExports=readJsonl('PERK.jsonl').filter(row=>typeof row.formid==='string'&&row.type==='Perk');
const perkByFormId=new Map(perkExports.map(row=>[row.formid.toLowerCase(),row]));
const allCatalogRecords=otherDomains.flatMap(domain=>domain.records);
function lookupPerkFactory(records){
  const recordsByKey=new Map(records.filter(record=>record.recordType==='PERK').map(record=>[record.stableFormKey,record]));
  const resolved=new Map();
  return key=>{
    if(resolved.has(key))return resolved.get(key);
    const formid=formIdFromStable(key).toLowerCase();
    const exported=perkByFormId.get(formid);
    if(!exported){resolved.set(key,undefined);return undefined;}
    const record=recordsByKey.get(key);
    if(!record){resolved.set(key,undefined);return undefined;}
    assert.equal(String(exported.winner).toLowerCase(),record.winnerPlugin.toLowerCase(),'catalog winner must match PERK export searched by FormID');
    const exportValues=Object.fromEntries((exported.fields??[]).filter(field=>typeof field.value==='string').map(field=>[field.path,field.value]));
    for(const [path,value] of Object.entries(record.data.fields??{}))
      assert.equal(exportValues[path],value,'catalog field must match PERK export searched by FormID: '+formid+' '+path);
    const entry=entryFromRecord(record);resolved.set(key,entry);return entry;
  };
}
const lookupPerk=lookupPerkFactory(allCatalogRecords);
const raceRecord=raceData.records.find(record=>record.recordType==='RACE');
assert.ok(raceRecord,'race catalog must have a reconciled RACE winner');
const raceKey=raceRecord.stableFormKey;
function makeBinding(actorId,epoch){
  return {profileKey:'profile:1',characterKey:'profile:1',actorRef:{actorId},epoch};
}
function makePlayerInput({classId,classRevision=1,level=40,grants=[],binding=makeBinding(71,'epoch-1'),lookup=lookupPerk}){
  return {
    binding,
    set:{characterKey:binding.characterKey,revision:{facts:classRevision,grants:classRevision,equipment:0,effects:0,catalog:1},grants},
    facts:{
      classes:{kind:'classes',classId,level,classRevision,levelRevision:1,attributeAllocationRevision:0,
        attributeMaximum:{status:'SUPPORTED',value:{health:123,magicka:87,stamina:111}}},
      races:{kind:'races',race:{status:'SUPPORTED',value:raceKey},revision:1}
    },
    classData,
    lookupPerk:lookup
  };
}
function makeClassGrant(classId,stage,perk){
  const exported=lookupPerk(perk.stableFormKey);
  assert.ok(exported,'class PERK record must be found in PERK.jsonl by FormID');
  return {kind:'perk',definition:exported.definition,rank:perk.rank,source:{kind:'CLASS',key:classId},revision:1};
}
function classFixture(){
  for(const definition of classData.classes??[]){
    for(const stage of definition.stages??[]){
      for(const perk of stage.perks??[]){
        if(perk.status!=='SUPPORTED'||!perk.stableFormKey||!Number.isSafeInteger(perk.rank)||perk.rank<1)continue;
        let grant;
        try{grant=makeClassGrant(definition.id,stage,perk);}catch{continue;}
        const input=makePlayerInput({classId:definition.id,grants:[grant]});
        const profile=api.composePlayerCombatProfile(input,1);
        const compiled=profile.perks.value.find(item=>item.stableFormKey===perk.stableFormKey);
        if(compiled)return {definition,stage,perk,grant,input,profile,compiled};
      }
    }
  }
  throw new Error('No class PERK grant matched a winner record in the FormID export');
}
const fixture=classFixture();

test('profile keeps the class grant origin and declares incomplete catalog rules unsupported',()=>{
  const profile=fixture.profile;
  const definition=fixture.definition;
  const stage=definition.stages.filter(item=>item.level<=40).at(-1);
  assert.equal(profile.subject.kind,'PLAYER');
  assert.equal(profile.subject.characterKey,'profile:1');
  assert.equal(profile.level.status,'SUPPORTED');
  assert.equal(profile.level.value,40);
  assert.equal(profile.skills.OneHanded.status,'SUPPORTED');
  assert.equal(profile.skills.OneHanded.value,stage.skills.OneHanded);
  assert.equal(profile.attributes.health.value,123);
  const perk=profile.perks.value.find(item=>item.stableFormKey===fixture.perk.stableFormKey);
  assert.equal(perk.sourceKind,'CLASS');
  assert.equal(perk.sourceKey,definition.id);
  assert.equal(perk.rank,fixture.perk.rank);
  assert.equal(perk.status,'UNSUPPORTED');
  assert.equal(perk.compiled.rules.every(rule=>rule.status==='UNSUPPORTED'),true);
  assert.equal(perk.compiled.origin.sourceKind,'CLASS');
  assert.equal(perk.compiled.origin.sourceKey,definition.id);
  assert.equal(perk.compiled.origin.classId,definition.id);
  assert.equal(profile.effects.fortifyOneHandedDamage.status,'UNSUPPORTED');
  assert.equal(profile.effects.fortifyOneHandedDamage.value,null);
  assert.equal(profile.effects.fortifySneakAttacks.status,'INACTIVE');
});

test('a class perk from the full winner export compiles into the profile with its origin',()=>{
  let found;
  for(const definition of classData.classes??[]){
    for(const stage of definition.stages??[]){
      for(const perk of stage.perks??[]){
        if(!perk.stableFormKey)continue;
        const exported=perkByFormId.get(formIdFromStable(perk.stableFormKey).toLowerCase());
        const record=allCatalogRecords.find(item=>item.stableFormKey===perk.stableFormKey&&item.recordType==='PERK');
        if(!exported||!record||String(exported.winner).toLowerCase()!==record.winnerPlugin.toLowerCase())continue;
        const direct=api.compilePerk(exported,{sourceKind:'CLASS',sourceKey:definition.id,classId:definition.id,level:40});
        if(!direct.rules.some(rule=>rule.status==='SUPPORTED'))continue;
        const compact=entryFromRecord(record);
        const completeFields=Object.fromEntries((exported.fields??[])
          .filter(field=>typeof field.value==='string').map(field=>[field.path,field.value]));
        const fullExportLookup=key=>key===perk.stableFormKey
          ? {...compact,data:{...compact.data,fields:completeFields}}
          : lookupPerk(key);
        const grant={kind:'perk',definition:compact.definition,rank:perk.rank,source:{kind:'CLASS',key:definition.id},revision:1};
        const input=makePlayerInput({classId:definition.id,grants:[grant],lookup:fullExportLookup});
        const profile=api.composePlayerCombatProfile(input,1);
        const compiled=profile.perks.value.find(item=>item.stableFormKey===perk.stableFormKey);
        if(compiled?.status==='SUPPORTED'){
          found={definition,perk,exported,compiled};
          break;
        }
      }
      if(found)break;
    }
    if(found)break;
  }
  assert.ok(found,'a full PERK export linked by FormID must produce a supported class rule');
  assert.equal(found.compiled.sourceKind,'CLASS');
  assert.equal(found.compiled.sourceKey,found.definition.id);
  assert.equal(found.compiled.compiled.origin.sourceKind,'CLASS');
  assert.equal(found.compiled.compiled.origin.sourceKey,found.definition.id);
  assert.equal(found.compiled.compiled.origin.classId,found.definition.id);
  assert.ok(found.compiled.compiled.rules.some(rule=>rule.status==='SUPPORTED'));
});

test('class change and reconnect publish whole monotonic profile revisions',async()=>{
  const other=classData.classes.find(item=>item.id!==fixture.definition.id);
  assert.ok(other,'a second class definition must exist');
  const first=makePlayerInput({classId:fixture.definition.id,classRevision:1,grants:[fixture.grant],binding:makeBinding(71,'epoch-1')});
  const second=makePlayerInput({classId:other.id,classRevision:2,grants:[],binding:makeBinding(71,'epoch-1')});
  const replacement=makeBinding(72,'epoch-2');
  const reconnected={...second,binding:replacement,set:{...second.set,characterKey:replacement.characterKey}};
  const properties=new Map(),writes=[],registration=[];
  const mp={
    makeProperty(name,options){registration.push({name,options});},
    set(actorId,name,value){properties.set(actorId+':'+name,value);writes.push(value);},
    get(actorId,name){return properties.get(actorId+':'+name);}
  };
  const port=new api.CombatProfileProjectionPort({mp,current:()=>true,warn:()=>{}});
  await Promise.all([
    Promise.resolve().then(()=>port.publishPlayer(first)),
    Promise.resolve().then(()=>port.publishPlayer(second))
  ]);
  const oldProfile=properties.get('71:aetheriusCombatProfile');
  assert.equal(oldProfile.revision,2);
  assert.equal(oldProfile.sourceRevisions.classFact,2);
  assert.equal(oldProfile.skills.OneHanded.value,other.stages.filter(item=>item.level<=40).at(-1).skills.OneHanded);
  const reconnectedProfile=port.publishPlayer(reconnected);
  assert.equal(reconnectedProfile.revision,2,'same profile content survives reconnect without resetting its revision');
  assert.equal(properties.get('72:aetheriusCombatProfile').revision,2);
  port.clear(first.binding);
  assert.equal(properties.get('71:aetheriusCombatProfile'),null);
  assert.equal(port.read(replacement).value.revision,2);
  assert.equal(registration[0].name,'aetheriusCombatProfile');
  assert.equal(registration[0].options.isVisibleByOwner,false);
  assert.equal(registration[0].options.isVisibleByNeighbors,false);
  const versions=writes.filter(value=>value&&value.subject?.kind==='PLAYER');
  assert.deepEqual(versions.map(value=>value.revision),[1,2,2]);
  for(const version of versions) {
    assert.equal(version.sourceRevision.facts,version.sourceRevisions.classFact);
    assert.equal(version.skills.OneHanded.status,'SUPPORTED');
    assert.ok(version.attributes.health.status==='SUPPORTED'||version.attributes.health.status==='UNSUPPORTED');
  }
  port.shutdown();
});

test('race and grant changes alter one complete profile snapshot with provenance preserved',()=>{
  const extra=fixture.grant;
  const sameDefinitionOtherOrigin={...extra,source:{kind:'STANDING_STONE',key:raceKey}};
  const first=fixture.input;
  const changedRace=raceData.records.find(record=>record.recordType==='RACE'&&record.stableFormKey!==raceKey)?.stableFormKey;
  assert.ok(changedRace,'a second exported RACE key must exist');
  const second={
    ...first,
    set:{...first.set,revision:{facts:2,grants:2,equipment:0,effects:0,catalog:1},grants:[extra,sameDefinitionOtherOrigin]},
    facts:{...first.facts,races:{kind:'races',race:{status:'SUPPORTED',value:changedRace},revision:2}}
  };
  const a=api.composePlayerCombatProfile(first,1);
  const b=api.composePlayerCombatProfile(second,2);
  assert.equal(a.revision,1);
  assert.equal(b.revision,2);
  assert.notEqual(a.race.value,b.race.value);
  assert.equal(b.perks.status,'UNSUPPORTED');
  const origins=b.perks.value.map(item=>[item.sourceKind,item.sourceKey]);
  assert.ok(origins.some(([kind,key])=>kind==='CLASS'&&key===fixture.definition.id));
  assert.ok(origins.some(([kind,key])=>kind==='STANDING_STONE'&&key===raceKey));
});

test('record lookup is invariant to catalog enumeration order and stores no runtime FormID',()=>{
  const reversed=lookupPerkFactory([...allCatalogRecords].reverse());
  const reordered=api.composePlayerCombatProfile({...fixture.input,lookupPerk:reversed},1);
  assert.deepEqual(reordered,fixture.profile);
  assert.equal(/runtime[_A-Z]?form.?id/i.test(JSON.stringify(reordered)),false);
});

function stableCatalogProvider(data,category){
  try{
    const result=api.npcTemplateProvider(data,category);
    if(result.status!=='SUPPORTED'||typeof result.provider!=='string')return null;
    return result;
  }catch{return null;}
}
let npcFixtureCache;
function confirmedNpcFixture(){
  if(npcFixtureCache)return npcFixtureCache;
  const npcData=domainFile('npcs');
  const npcExports=readJsonl('NPC_.jsonl').filter(row=>typeof row.formid==='string'&&row.type==='Npc');
  const npcByFormId=new Map(npcExports.map(row=>[row.formid.toLowerCase(),row]));
  const npcs=domainCatalog(npcData),races=domainCatalog(raceData);
  for(const record of npcData.records.filter(item=>item.recordType==='NPC_')){
    const selectedExport=npcByFormId.get(formIdFromStable(record.stableFormKey).toLowerCase());
    if(!selectedExport||record.data.autoCalcStats!==false||record.data.level?.kind!=='FIXED')continue;
    const stats=stableCatalogProvider(record.data,'Stats');
    const traits=stableCatalogProvider(record.data,'Traits');
    if(!stats||!traits)continue;
    const statsRecord=npcs.byKey(stats.provider),traitsRecord=npcs.byKey(traits.provider);
    if(!statsRecord||!traitsRecord||statsRecord.definition.recordType!=='NPC_'||traitsRecord.definition.recordType!=='NPC_')continue;
    if(statsRecord.data.autoCalcStats!==false||statsRecord.data.level?.kind!=='FIXED')continue;
    if(!npcByFormId.has(formIdFromStable(statsRecord.definition.stableFormKey).toLowerCase())
      ||!npcByFormId.has(formIdFromStable(traitsRecord.definition.stableFormKey).toLowerCase()))continue;
    const values=api.NPC_FIELDS.filter(name=>name.startsWith('PlayerSkills.SkillValues[')
      &&['OneHanded','TwoHanded','Archery','Block','HeavyArmor','LightArmor'].some(skill=>name.endsWith('['+skill+']')));
    if(values.some(name=>typeof api.npcField(statsRecord.data,name)!=='number'))continue;
    const raceValue=api.npcField(traitsRecord.data,'Race');
    if(typeof raceValue!=='string'||races.byKey(raceValue)?.definition.recordType!=='RACE')continue;
    npcFixtureCache={record,selectedExport,npcs,races};
    return npcFixtureCache;
  }
  throw new Error('No exported NPC_ FormID has resolved fixed level, Stats, and Traits data');
}
function npcBaseDataFixture(perksKind){
  const data=domainFile('npcs'),npcs=domainCatalog(data);
  const npcExports=readJsonl('NPC_.jsonl').filter(row=>typeof row.formid==='string'&&row.type==='Npc');
  const byFormId=new Map(npcExports.map(row=>[row.formid.toLowerCase(),row]));
  const recordsByKey=new Map(data.records.filter(record=>record.recordType==='NPC_').map(record=>[record.stableFormKey,record]));
  for(const record of recordsByKey.values()){
    const selected=byFormId.get(formIdFromStable(record.stableFormKey).toLowerCase());
    if(!selected||String(selected.winner).toLowerCase()!==record.winnerPlugin.toLowerCase())continue;
    const provider=stableCatalogProvider(record.data,'BaseData');
    if(!provider)continue;
    const baseData=recordsByKey.get(provider.provider);
    if(!baseData)continue;
    const baseExport=byFormId.get(formIdFromStable(baseData.stableFormKey).toLowerCase());
    if(!baseExport||String(baseExport.winner).toLowerCase()!==baseData.winnerPlugin.toLowerCase())continue;
    if(perksKind==='NULL'&&baseData.data.perks!==null)continue;
    if(perksKind==='ROWS'&&!Array.isArray(baseData.data.perks))continue;
    if(perksKind==='NULL'){
      const byCatalogKey=npcs.byKey.bind(npcs);
      const knownNullNpcs={...npcs,byKey(key){
        const entry=byCatalogKey(key);
        if(key!==baseData.stableFormKey||!entry)return entry;
        const unavailable=Array.isArray(entry.data.unavailable)?entry.data.unavailable.filter(field=>field!=='Perks'):[];
        return {...entry,data:{...entry.data,unavailable}};
      }};
      return {record,npcs:knownNullNpcs,races:domainCatalog(raceData)};
    }
    return {record,npcs,races:domainCatalog(raceData)};
  }
  throw new Error('No exported NPC_ FormID has the requested BaseData perks shape: '+perksKind);
}
test('NPC profile composition cache skips repeat work and publication until content changes',()=>{
  const npcFixture=confirmedNpcFixture();
  const actorId=81,observation={status:'CONFIRMED',generation:'npc-generation-cache',
    stableFormKey:npcFixture.record.stableFormKey,level:npcFixture.record.data.level.value};
  const values=new Map([[actorId+':aetheriusNpcObservation',observation]]),writes=[];
  const mp={makeProperty(){},set(id,name,value){values.set(id+':'+name,value);writes.push({id,name,value});},get(id,name){return values.get(id+':'+name);}};
  const port=new api.CombatProfileProjectionPort({mp,current:()=>true,warn:()=>{}});

  const first=port.inspectNpc(actorId,npcFixture.npcs,npcFixture.races,lookupPerk);
  const repeated=port.inspectNpc(actorId,npcFixture.npcs,npcFixture.races,lookupPerk);
  assert.equal(port.npcCompositionCount,1,'same observation and catalog identities compose once');
  assert.equal(repeated,first);
  assert.equal(repeated.revision,first.revision);
  assert.equal(writes.length,1,'repeat inspection does not call mp.set');

  values.set(actorId+':aetheriusNpcObservation',{...observation,generation:'npc-generation-next',level:observation.level+1});
  const changed=port.inspectNpc(actorId,npcFixture.npcs,npcFixture.races,lookupPerk);
  assert.equal(port.npcCompositionCount,2);
  assert.equal(changed.revision,first.revision+1,'changed observation advances the revision once');
  assert.equal(writes.length,2,'changed content publishes one complete profile');

  const replacementNpcs={...npcFixture.npcs};
  const replacementRaces={...npcFixture.races};
  const replacementLookup=key=>lookupPerk(key);
  assert.equal(port.inspectNpc(actorId,replacementNpcs,npcFixture.races,lookupPerk),changed);
  assert.equal(port.inspectNpc(actorId,npcFixture.npcs,replacementRaces,lookupPerk),changed);
  assert.equal(port.inspectNpc(actorId,npcFixture.npcs,npcFixture.races,replacementLookup),changed);
  assert.equal(port.npcCompositionCount,5,'swapped catalogs and perk lookup each force recomposition');
  assert.equal(writes.length,2,'same profile content does not publish a new revision');
  port.shutdown();
});

test('NPC profile cache evicts least recently inspected entries and clears their host property',()=>{
  const npcFixture=confirmedNpcFixture(),writes=[];
  const values=new Map();
  for(const actorId of [91,92,93])values.set(actorId+':aetheriusNpcObservation',{
    status:'CONFIRMED',generation:'npc-generation-'+actorId,stableFormKey:npcFixture.record.stableFormKey,
    level:npcFixture.record.data.level.value
  });
  const mp={makeProperty(){},set(id,name,value){values.set(id+':'+name,value);writes.push({id,name,value});},get(id,name){return values.get(id+':'+name);}};
  const port=new api.CombatProfileProjectionPort({mp,current:()=>true,warn:()=>{},npcProfileCacheLimit:2});
  const first=port.inspectNpc(91,npcFixture.npcs,npcFixture.races,lookupPerk);
  const second=port.inspectNpc(92,npcFixture.npcs,npcFixture.races,lookupPerk);
  port.inspectNpc(91,npcFixture.npcs,npcFixture.races,lookupPerk);
  port.inspectNpc(93,npcFixture.npcs,npcFixture.races,lookupPerk);
  assert.equal(port.npcCompositionCount,3);
  assert.equal(values.get('92:aetheriusCombatProfile'),null,'least recently inspected actor property is cleared');
  assert.ok(writes.some(write=>write.id===92&&write.name==='aetheriusCombatProfile'&&write.value===null));
  assert.equal(port.inspectNpc(91,npcFixture.npcs,npcFixture.races,lookupPerk),first,'most recently inspected entry remains cached');
  assert.equal(port.npcCompositionCount,3);
  const afterEviction=port.inspectNpc(92,npcFixture.npcs,npcFixture.races,lookupPerk);
  assert.equal(port.npcCompositionCount,4,'evicted actor is recomposed when observed again');
  assert.ok(afterEviction.revision>second.revision,'revision remains monotonic across bounded-cache eviction');
  port.shutdown();
});

test('NPC perks distinguish an explicit null list from rows that resolve to no perks',()=>{
  const rows=npcBaseDataFixture('ROWS');
  const unresolved=api.composeNpcCombatProfile({status:'CONFIRMED',generation:'npc-perks-rows',stableFormKey:rows.record.stableFormKey},
    rows.npcs,rows.races,()=>undefined,1);
  assert.equal(unresolved.perks.status,'UNSUPPORTED');
  assert.deepEqual(unresolved.perks.value,[]);
  assert.equal(unresolved.perks.reason,'NPC_PERK_ROWS_UNRESOLVED');

  const noPerks=npcBaseDataFixture('NULL');
  const explicitEmpty=api.composeNpcCombatProfile({status:'CONFIRMED',generation:'npc-perks-null',stableFormKey:noPerks.record.stableFormKey},
    noPerks.npcs,noPerks.races,lookupPerk,1);
  assert.equal(explicitEmpty.perks.status,'SUPPORTED');
  assert.deepEqual(explicitEmpty.perks.value,[]);
  assert.equal(explicitEmpty.perks.reason,null);
});

test('confirmed NPC profile uses the adopted NPC_ winner; unconfirmed observation stays unsupported',()=>{
  const npcFixture=confirmedNpcFixture();
  const confirmed=api.composeNpcCombatProfile({
    status:'CONFIRMED',generation:'npc-generation-fixture',stableFormKey:npcFixture.record.stableFormKey
  },npcFixture.npcs,npcFixture.races,lookupPerk,1);
  assert.equal(confirmed.subject.kind,'NPC');
  assert.equal(confirmed.subject.stableFormKey,npcFixture.record.stableFormKey);
  assert.equal(String(npcFixture.selectedExport.winner).toLowerCase(),npcFixture.record.winnerPlugin.toLowerCase());
  assert.equal(confirmed.level.status,'SUPPORTED');
  assert.equal(confirmed.level.value,npcFixture.record.data.level.value);
  assert.equal(confirmed.race.status,'SUPPORTED');
  assert.equal(confirmed.skills.OneHanded.status,'SUPPORTED');
  assert.equal(confirmed.templateChain.status==='SUPPORTED'||confirmed.templateChain.status==='PARTIAL',true);
  const unconfirmed=api.composeNpcCombatProfile({generation:'npc-generation-fixture'},
    npcFixture.npcs,npcFixture.races,lookupPerk,1);
  assert.equal(unconfirmed.status,'UNSUPPORTED');
  assert.equal(unconfirmed.subject.stableFormKey,null);
  assert.equal(unconfirmed.level.status,'UNSUPPORTED');
  assert.equal(unconfirmed.reason,'NPC_OBSERVATION_UNCONFIRMED');
});

test('the live DS-0g generation-only marker does not create an NPC identity',()=>{
  const npcFixture=confirmedNpcFixture();
  const values=new Map([[44+':aetheriusNpcObservation',{generation:'npc-generation-live'}]]);
  const mp={
    makeProperty(){},
    set(actorId,name,value){values.set(actorId+':'+name,value);},
    get(actorId,name){return values.get(actorId+':'+name);}
  };
  const port=new api.CombatProfileProjectionPort({mp,current:()=>true,warn:()=>{}});
  const profile=port.inspectNpc(44,npcFixture.npcs,npcFixture.races,lookupPerk);
  assert.equal(profile.status,'UNSUPPORTED');
  assert.equal(profile.subject.stableFormKey,null);
  assert.equal(profile.subject.generation,'npc-generation-live');
  assert.equal(values.get('44:aetheriusCombatProfile').status,'UNSUPPORTED');
  port.shutdown();
});
