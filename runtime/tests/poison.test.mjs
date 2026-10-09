import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const data=JSON.parse(readFileSync(new URL('../../catalog/classes.json',import.meta.url),'utf8'));
const compiled=await build({stdin:{contents:`export {poisonDoseBonus,PoisonProjection} from './src/poison.ts';
  export {classGrants} from '../modules/class-progression-system/src/index.ts';
  export {definitionCatalog} from './src/explanation.ts';`,resolveDir:fileURLToPath(new URL('../',import.meta.url)),loader:'ts'},bundle:true,platform:'node',format:'esm',write:false});
const api=await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const catalog=api.definitionCatalog(data);
const set=(grants)=>({characterKey:'profile:1',grants,revision:{facts:1,grants:1,equipment:0,effects:0,catalog:1}});
const grants=(id,level)=>api.classGrants(data,catalog,{classId:id,revision:1},level);
for(const [level,bonus] of [[1,0],[10,2],[20,4],[40,6]])test(`viper level ${level}: official predicate bonus ${bonus}`,()=>{
  assert.deepEqual(api.poisonDoseBonus(set(grants('viper',level)),[catalog]),{bonus,unsupported:[]});
});
test('class without concentrated poison yields zero; duplicate grant origins count once',()=>{
  assert.equal(api.poisonDoseBonus(set(grants('guardiao',40)),[catalog]).bonus,0);
  const viper=grants('viper',40);assert.equal(api.poisonDoseBonus(set([...viper,...viper.map(g=>({...g,source:{kind:'ADMIN',key:'test'}}))]),[catalog]).bonus,6);
});
test('missing condition payload and other dose grammar report UNSUPPORTED',()=>{
  const viper=set(grants('viper',10));const altered={byKey(key){const r=catalog.byKey(key);if(!r)return r;
    const fields={...r.data.fields};delete fields['Effects[0].Conditions[0].Conditions[0].Data.Function'];return {...r,data:{...r.data,fields}};}};
  const output=api.poisonDoseBonus(viper,[altered]);assert.equal(output.bonus,0);assert(output.unsupported.some(x=>x.includes('CONDITIONS')));
  const multiply={byKey(key){const r=catalog.byKey(key);return r?{...r,data:{...r.data,fields:{...r.data.fields,'Effects[0].Modification':'Multiply'}}}:r;}};
  assert(api.poisonDoseBonus(viper,[multiply]).unsupported.some(x=>x.includes('OPERATION')));
});
test('transient projection: flag, epoch, zero, reconnect/reset and shutdown',()=>{
  const writes=[],warnings=[];let enabled=false,current=true;
  const binding={characterKey:'profile:1',profileKey:'profile:1',actorRef:{actorId:91},epoch:'a'};
  const mp={getServerSettings:()=>({aetheriusCombat:{weaponPoison:enabled}}),set:(...args)=>writes.push(args)};
  const projection=new api.PoisonProjection(mp,()=>[catalog],()=>current,m=>warnings.push(m));
  projection.publish(binding,set(grants('viper',40)));assert.equal(writes.length,0);
  enabled=true;projection.publish(binding,set(grants('viper',40)));assert.deepEqual(writes.at(-1),[91,'aetheriusPoisonDoseBonus',6]);
  current=false;projection.publish(binding,set(grants('guardiao',40)));assert.equal(writes.length,1);
  current=true;projection.publish({...binding,actorRef:{...binding.actorRef}},set(grants('guardiao',40)));assert.equal(writes.at(-1)[2],0);
  projection.publish({...binding,epoch:'b'},set(grants('viper',40)));projection.clear(binding);assert.equal(writes.at(-1)[2],6);
  projection.shutdown();assert.equal(writes.at(-1)[2],0);assert.equal(warnings.length,0);
});

test('sparse rank grants still select highest owned Concentrated Poison rank',()=>{
  const keys=['skyrim.esm|105F2F','vokrii - minimalistic perks of skyrim.esp|3120F8','vokrii - minimalistic perks of skyrim.esp|3120F9'];
  const all=grants('viper',40).filter(g=>keys.includes(g.definition.stableFormKey));assert.equal(all.length,3);
  for(const subset of [[all[0],all[2]],[all[1],all[2]],[all[2]]])assert.equal(api.poisonDoseBonus(set(subset),[catalog]).bonus,6);
});
