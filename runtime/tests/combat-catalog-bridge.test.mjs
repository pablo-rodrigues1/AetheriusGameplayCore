import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const compiled=await build({absWorkingDir:root,entryPoints:['runtime/src/combat-catalog-bridge.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {prepareCombatCatalog,deliverCombatCatalog,startNpcCombatProfilePump}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
// Unit fixtures mirror the public raw host fields and catalog contracts, as
// confirmed in ScampServer::LookupEspmRecordById and DS-2d. No host is simulated.
const keys={fDamagePCSkillMax:'0C5C0F',fArmorRatingBase:'01A157',fArmorRatingPCMax:'0C5C0C'};
function fixture(position=0) {
  let calls=0;
  const gmsts=new Map(Object.entries(keys).map(([name,id])=>[Number.parseInt(id,16)+position*(2**24),{name,value:name==='fDamagePCSkillMax'?1.5:name==='fArmorRatingBase'?1:1.4}]));
  const mp={getIdFromDesc(desc){calls++;return Number.parseInt(desc.split(':')[0],16)+position*(2**24);},
    lookupEspmRecordById(id){const gmst=gmsts.get(id);if(!gmst)return {};const bytes=Buffer.alloc(4);bytes.writeFloatLE(gmst.value);
      return {record:{type:'GMST',editorId:gmst.name,fields:[{type:'DATA',data:bytes}]}};}};
  const records=[['WEAP',10,'OneHanded'],['ARMO',40,'LightArmor'],['AMMO',12,''],['RACE',4,'']].map(([type,base,skill],i)=>({
    definition:{recordType:type,stableFormKey:`test.esp|00080${i}`},runtimeFormId:position*(2**24)+2048+i,
    data:{fields:{IsDeleted:false,'BasicStats.Damage':base,ArmorRating:base,Damage:base,UnarmedDamage:base,
      'Data.Skill':skill,'Data.AnimationType':'OneHandSword','BodyTemplate.ArmorType':skill,ObjectEffect:null},keywords:[]}}));
  const catalog={status:'SUPPORTED',signature:'fixture',records};
  return {mp,catalog,get calls(){return calls;}};
}
test('boot prepares only effective values and resolves each GMST by stable identity',()=>{
  const f=fixture();const table=prepareCombatCatalog(f.mp,f.catalog,undefined);
  assert.equal(table.records.length,4);assert.equal(table.records[1].base,40);assert.equal(f.calls,3);
  assert.equal(table.gmsts.fDamagePCSkillMax.stableFormKey,'skyrim.esm|0C5C0F');
});
test('changing plugin position changes only runtime addressing',()=>{
  const a=fixture(0),b=fixture(3);const x=prepareCombatCatalog(a.mp,a.catalog),y=prepareCombatCatalog(b.mp,b.catalog);
  assert.equal(x.records[0].stableFormKey,y.records[0].stableFormKey);assert.equal(x.records[0].base,y.records[0].base);
  assert.notEqual(x.records[0].runtimeId,y.records[0].runtimeId);assert.notEqual(x.gmsts.fDamagePCSkillMax.runtimeId,y.gmsts.fDamagePCSkillMax.runtimeId);
});
test('absent or unreconciled catalog refuses transport',()=>{
  assert.throws(()=>prepareCombatCatalog(fixture().mp,undefined),/COMBAT_CATALOG_UNAVAILABLE/);
  assert.throws(()=>prepareCombatCatalog(fixture().mp,{status:'UNSUPPORTED'}),/COMBAT_CATALOG_UNAVAILABLE/);
});
test('missing/invalid GMST never substitutes a constant',()=>{
  const f=fixture();f.mp.lookupEspmRecordById=()=>({});assert.throws(()=>prepareCombatCatalog(f.mp,f.catalog),/GMST_WINNER_UNAVAILABLE/);
});
test('missing base/template winner remains unsupported',()=>{
  const f=fixture();f.catalog.records[0].data.fields['BasicStats.Damage']=null;
  f.catalog.records[1].data.template={status:'UNSUPPORTED'};
  const rows=prepareCombatCatalog(f.mp,f.catalog).records;
  assert.equal(rows[0].status,'UNSUPPORTED');assert.equal(rows[0].base,null);assert.equal(rows[1].status,'UNSUPPORTED');
});
test('WEAP Archery enum maps to fixed profile Marksman without localized names',()=>{
  const f=fixture();f.catalog.records[0].data.fields['Data.Skill']='Archery';
  f.catalog.records[0].data.fields['Data.AnimationType']='Bow';
  const row=prepareCombatCatalog(f.mp,f.catalog).records[0];
  assert.equal(row.status,'SUPPORTED');assert.equal(row.skill,'Marksman');assert.equal(row.ranged,true);
});
test('record DamageResist is carried once, never from Q16 or client instance',()=>{
  const f=fixture();f.catalog.records[1].data.fields.ObjectEffect='test.esp|000900';
  const effects={status:'SUPPORTED',signature:'effects',records:[
    {definition:{recordType:'ENCH',stableFormKey:'test.esp|000900'},data:{unavailable:[],excludedEffects:0,effects:[['test.esp|000901',50,0,0,0,true]]}},
    {definition:{recordType:'MGEF',stableFormKey:'test.esp|000901'},data:{family:'ARMOR_RATING'}}]};
  assert.equal(prepareCombatCatalog(f.mp,f.catalog,effects).records[1].damageResist,50);
  assert.equal(prepareCombatCatalog(f.mp,f.catalog).records[1].status,'UNSUPPORTED');
});
test('native catalog is delivered once and ownership verified at boot',()=>{
  const f=fixture();let deliveries=0;
  f.mp.setAetheriusCombatCatalog=text=>{deliveries++;assert.equal(JSON.parse(text).version,1);return true;};
  const families=Object.fromEntries(['melee','ranged','unarmed'].map(name=>[name,{owner:'NATIVE_SERVER',candidateOwner:'AETHERIUS_SERVER',mode:'shadow',status:'SHADOW'}]));
  f.mp.getAetheriusCombatCapabilities=()=>JSON.stringify({version:1,families});
  assert.equal(deliverCombatCatalog(f.mp,f.catalog).status,'SUPPORTED');assert.equal(deliverCombatCatalog(f.mp,f.catalog).status,'SUPPORTED');assert.equal(deliveries,1);
  families.melee.owner='NATIVE_CLIENT';assert.equal(deliverCombatCatalog(f.mp,f.catalog).reason,'NATIVE_OWNERSHIP_INVALID');
});
test('absent bridge and rejected native table remain unsupported',()=>{
  const f=fixture();assert.equal(deliverCombatCatalog(f.mp,f.catalog).status,'UNSUPPORTED');
  f.mp.setAetheriusCombatCatalog=()=>false;f.mp.getAetheriusCombatCapabilities=()=>'';
  assert.equal(deliverCombatCatalog(f.mp,f.catalog).reason,'NATIVE_COMBAT_CATALOG_REJECTED');
});

test('NPC requests compose outside hits with bounded input and owned timer',()=>{
  let poll;const seen=[];const scope={interval(fn,ms){assert.equal(ms,250);poll=fn;}};
  const f=fixture();f.mp.getAetheriusCombatProfileRequests=()=>JSON.stringify([10,20,-1,'30']);
  startNpcCombatProfilePump(f.mp,scope,id=>seen.push(id));assert.deepEqual(seen,[]);poll();assert.deepEqual(seen,[10,20]);
  f.mp.getAetheriusCombatProfileRequests=()=>JSON.stringify(Array(2049).fill(10));poll();assert.deepEqual(seen,[10,20]);
});
