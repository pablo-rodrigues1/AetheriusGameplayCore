import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {buildOwnership} from '../tools/ownership.mjs';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const compiled=await build({absWorkingDir:root,stdin:{loader:'ts',resolveDir:root,contents:`
  export {raceGrants,initialRaceAttributes} from './modules/race-system/src/index.ts';
  export {definitionCatalog} from './runtime/src/explanation.ts';
  export {compose,effectiveSet} from './modules/actor-state-system/src/index.ts';
  export {portGrantSet} from './runtime/src/composition.ts';
`},bundle:true,platform:'node',format:'esm',write:false});
const api=await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const data=JSON.parse(readFileSync(new URL('../../../catalog/races.json',import.meta.url),'utf8'));
const catalog=api.definitionCatalog(data);
const fact=key=>({status:'SUPPORTED',raceKey:key,revision:1,observedAt:'2026-10-08T00:00:00Z',reason:null});
test('ten playable races: exact record spells, linked perks, initial attributes; names are irrelevant',()=>{
  assert.equal(catalog.roots.length,10);
  let abilities=0,perks=0;
  for(const root of catalog.roots){
    const grants=api.raceGrants(catalog,fact(root.definition.stableFormKey));
    assert.deepEqual(grants.filter(g=>g.kind!=='perk').map(g=>g.definition.stableFormKey).sort(),[...root.data.actorEffects].sort());
    abilities+=root.data.actorEffects.length;perks+=grants.filter(g=>g.kind==='perk').length;
    assert(grants.every(g=>g.source.kind==='RACE'&&g.source.key===root.definition.stableFormKey));
    assert.deepEqual(api.initialRaceAttributes(catalog,root.definition.stableFormKey),{
      health:root.data.starting.Health,magicka:root.data.starting.Magicka,stamina:root.data.starting.Stamina});
    // Provider view differs only in presentation; no signed-artifact bypass.
    const view={...catalog,roots:catalog.roots.map(r=>({...r,data:{...r.data,editorId:'arbitrary-name'}}))};
    assert.deepEqual(api.raceGrants(view,fact(root.definition.stableFormKey)),grants);
  }
  assert.equal(abilities,37);assert.equal(perks,6);
});
test('Nord includes MAG_NordRacialPerk01 from MAG_NordRacialEffect01, rank one, and all three actor effects',()=>{
  const root=catalog.roots.find(r=>r.data.editorId==='NordRace');
  const grants=api.raceGrants(catalog,fact(root.definition.stableFormKey));
  assert.equal(grants.length,4);const perk=grants.find(g=>g.kind==='perk');assert.equal(perk.definition.stableFormKey,'aetherius.esp|000805');assert.equal(perk.rank,1);
  assert.equal(catalog.byKey('aetherius.esp|00081D').data.fields.PerkToApply,perk.definition.stableFormKey);
});
test('unsupported and absent facts grant nothing; missing linked perk is UNSUPPORTED rather than inferred',()=>{
  assert.deepEqual(api.raceGrants(catalog,undefined),[]);assert.deepEqual(api.raceGrants(catalog,{status:'UNSUPPORTED',raceKey:null,revision:2}),[]);
  assert.throws(()=>api.raceGrants(catalog,fact('skyrim.esm|000001')),/RACE_NOT_PLAYABLE/);
  assert.throws(()=>api.raceGrants({...catalog,byKey:key=>key==='aetherius.esp|000805'?undefined:catalog.byKey(key)},fact('skyrim.esm|013746')),/RACE_PERK_UNSUPPORTED/);
});
test('native delivery suppresses all origins of the same record; full composition keeps both origins',()=>{
  const grants=api.raceGrants(catalog,fact('skyrim.esm|013746')),other={...grants[0],source:{kind:'ADMIN',key:'another-origin'}};
  const set=api.compose('profile:42',[grants,[other]],{facts:1,grants:1,equipment:0,effects:0,catalog:1});
  assert.equal(api.effectiveSet(set).grants.find(g=>g.definition.stableFormKey===other.definition.stableFormKey).sources.length,2);
  assert.equal(api.portGrantSet(set).grants.length,0);
});
test('ownership deterministically consumes A3 and covers 37 spells + 6 perks; no server result ownership',()=>{
  const exportsDir=process.env.GAMEPLAY_CORE_TEST_EXPORTS??fileURLToPath(new URL('../../../../_work/exports/',import.meta.url));
  const classifications=readFileSync(`${exportsDir}/classification/spells.jsonl`,'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse);
  const rows=buildOwnership(data,classifications);
  assert.deepEqual(rows,buildOwnership(data,[...classifications].reverse()));
  assert.equal(rows.filter(r=>r.recordType==='SPEL').length,37);assert.equal(rows.filter(r=>r.recordType==='PERK').length,6);
  assert(rows.every(r=>r.grantOwner==='NATIVE_CLIENT'&&r.resultOwner==='NATIVE_CLIENT'));
  const nord=rows.find(r=>r.stableFormKey==='aetherius.esp|000805');assert.equal(nord.resultStatus,'NOT_VERIFIED_MULTIPLAYER_SERVER_HIT_DAMAGE');
  assert(nord.details.some(d=>d.entryPoint==='ModIncomingDamage'&&d.value==='0.75'));
  assert.throws(()=>buildOwnership(data,[]),/classification absent/);
});
