import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
const require=createRequire(import.meta.url),{classGrants,developmentLevel,withDevelopmentLevel}=require('../../dist/aetherius-gameplay-core.cjs');
const data=JSON.parse(readFileSync(new URL('../../catalog/classes.json',import.meta.url),'utf8'));
const catalog={status:'SUPPORTED',byKey:key=>{const r=data.records.find(r=>r.stableFormKey===key);return r?{definition:{stableFormKey:key,recordType:r.recordType,catalogSignature:r.signature},data:r.data}:undefined;}};
test('18 classes, nine milestones; level 1/17/40 includes exactly configured supported records',()=>{
  assert.equal(data.classes.length,18);assert.equal(data.unsupported.length,0);
  const perks=data.classes.flatMap(c=>c.stages.flatMap(s=>s.perks));
  for(const label of ['Heavy Armor Mastery','Rune Master','Animage (1)','Animage (2)','Animage (3)','One-Handed Mastery'])
    assert(perks.some(p=>p.label===label&&p.status==='SUPPORTED'),`corrected perk must be supported: ${label}`);
  for(const c of data.classes){assert.deepEqual(c.stages.map(s=>s.level),[1,5,10,15,20,25,30,35,40]);
    for(const level of [1,17,40]){const grants=classGrants(data,catalog,{classId:c.id,revision:1},level);
      const wanted=c.stages.filter(s=>s.level<=level).flatMap(s=>s.perks.filter(p=>p.status==='SUPPORTED'));
      assert.deepEqual(grants.map(g=>g.definition.stableFormKey),[...new Set(wanted.map(p=>p.stableFormKey))].sort());
      for(const g of grants){assert.equal(g.source.kind,'CLASS');assert.equal(g.source.key,c.id);assert.equal(g.rank,wanted.find(p=>p.stableFormKey===g.definition.stableFormKey).rank);}
    }
  }
});
test('DEV option refuses online, absent host setting, malformed and out of range',()=>{
  for(const offline of [false,undefined])for(const raw of ['40','1','garbage'])assert.throws(()=>developmentLevel(raw,offline),/OFFLINE_MODE_REQUIRED/);
  for(const raw of ['', '0','41','NaN','1.5','-1',' 40','1e1','040'])assert.throws(()=>developmentLevel(raw,true),/INVALID/);
  assert.equal(developmentLevel(undefined,false),undefined);assert.equal(developmentLevel('40',true),40);
});
test('DEV decorates only a read; removal returns real leveling state',async()=>{
  const actual={level:17,origin:'LEVELING',revision:9},port={read:async()=>actual};
  assert.deepEqual(await withDevelopmentLevel(port,40).read(null,'profile:1'),{level:40,origin:'DEV',revision:9});
  assert.deepEqual(await withDevelopmentLevel(port,undefined).read(null,'profile:1'),actual);
});
