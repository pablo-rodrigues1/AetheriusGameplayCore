import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const compiled = await build({ entryPoints:[fileURLToPath(new URL('../src/provider.ts',import.meta.url))], bundle:true, platform:'node', format:'esm', write:false });
const { standingStoneGrants } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const data = JSON.parse(await readFile(new URL('../../../catalog/standing-stones.json',import.meta.url),'utf8'));
const records = new Map(data.records.map(r => [r.stableFormKey,{ definition:{stableFormKey:r.stableFormKey,recordType:r.recordType,catalogSignature:r.signature},data:r.data }]));
const catalog = Object.freeze({status:'SUPPORTED', roots:data.roots.map(key=>records.get(key)), unsupported:data.unsupported, byKey:key=>records.get(key)});
test('all 13 catalog roots produce exactly their supported links and explicit standing-stone provenance',()=>{
  assert.equal(data.roots.length,13);
  for (const stoneKey of data.roots) {
    const fact={stoneKey,revision:2}; const grants=standingStoneGrants(catalog,fact);
    assert.deepEqual(grants.map(g=>g.definition.stableFormKey),records.get(stoneKey).data.spells);
    assert(grants.every(g=>g.source.kind==='STANDING_STONE' && g.source.key===stoneKey && g.revision===2));
    assert(grants.every(g=>g.kind==='ability' && g.definition.catalogSignature===records.get(g.definition.stableFormKey).definition.catalogSignature));
    assert.deepEqual(standingStoneGrants(catalog,fact),grants); assert(Object.isFrozen(grants));
  }
});
test('Warrior, Mage, Thief match the human spike session evidence of 2026-10-07',()=>{
  for(const [stoneKey,spell] of [['skyrim.esm|0D232D','skyrim.esm|0E5F4C'],['skyrim.esm|0D232E','skyrim.esm|0E5F47'],['skyrim.esm|0D232F','skyrim.esm|0E5F45']])
    assert.deepEqual(standingStoneGrants(catalog,{stoneKey,revision:1}).map(g=>g.definition.stableFormKey),[spell]);
});
test('Steed sprint is not inferred; even an explicitly unsupported linked key is excluded',()=>{
  assert.equal(data.unsupported[0].stableFormKey,'mundus.esp|000818');
  const stoneKey='skyrim.esm|0D2333';
  assert(!standingStoneGrants(catalog,{stoneKey,revision:1}).some(g=>g.definition.stableFormKey===data.unsupported[0].stableFormKey));
  const root=records.get(stoneKey);
  const linked={...catalog,roots:[{...root,data:{...root.data,spells:[...root.data.spells,data.unsupported[0].stableFormKey]}}]};
  assert.equal(standingStoneGrants(linked,{stoneKey,revision:1}).length,1);
});
test('absent fact is empty; unavailable catalog, invalid stone, missing spell and malformed revision refuse',()=>{
  assert.deepEqual(standingStoneGrants(undefined,undefined),[]);
  const fact={stoneKey:data.roots[0],revision:1};
  assert.throws(()=>standingStoneGrants({...catalog,status:'UNSUPPORTED'},fact),/CATALOG_UNAVAILABLE/);
  assert.throws(()=>standingStoneGrants(catalog,{...fact,stoneKey:'skyrim.esm|000001'}),/STONE_UNSUPPORTED/);
  assert.throws(()=>standingStoneGrants({...catalog,byKey:()=>undefined},fact),/SPELL_LINK_UNSUPPORTED/);
  for(const revision of [-1,0,1.5,Number.MAX_SAFE_INTEGER+1]) assert.throws(()=>standingStoneGrants(catalog,{...fact,revision}),/INVALID_FACT_REVISION/);
});
