// A genuinely new process against the existing isolated aetherius_test schema.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {standingHost} from './standing-host.mjs';
import {logger} from './host.mjs';
const [schema,profile,stoneKey]=process.argv.slice(2);
assert(/^gc_c1_[a-z0-9_]+$/.test(schema)&&/^[1-9][0-9]*$/.test(profile));
const url=new URL(process.env.AETHERIUS_TEST_DATABASE_URL??'missing:');
assert(['127.0.0.1','localhost','[::1]'].includes(url.hostname)&&url.pathname==='/aetherius_test');
const require=createRequire(import.meta.url),{Pool}=require('pg'),{createGameplayCore}=require('../../dist/aetherius-gameplay-core.cjs');
const pool=new Pool({connectionString:process.env.AETHERIUS_TEST_DATABASE_URL,connectionTimeoutMillis:2000});
const mp=standingHost({shift:1000});mp.profiles.set(91,Number(profile));
const core=createGameplayCore({mp,pg:{init:()=>pool},log:logger(),env:{GAMEPLAY_CORE_DATABASE_SCHEMA:schema,GAMEPLAY_CORE_MODE_STANDING_STONES:'active'}});
try{
  await core.initialize();
  await new Promise(resolve=>setTimeout(resolve,3500));
  for(let i=0;i<100&&!mp.mutations().length;i++)await pool.query('SELECT 1');
  const expected=mp.data.records.find(r=>r.stableFormKey===stoneKey).data.spells.map(key=>mp.ids.get(key));
  assert.deepEqual([...mp.learned(91)].sort((a,b)=>a-b),expected.sort((a,b)=>a-b));
  assert(mp.mutations().every(c=>c.method==='AddSpell'));
  console.log('NEW_PROCESS_REHYDRATION_PASSED');
}finally{await core.shutdown();await pool.end();}
