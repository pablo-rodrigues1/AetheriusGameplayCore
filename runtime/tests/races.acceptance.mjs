import assert from 'node:assert/strict';
// Run after the historical runtime suites: their readiness polling uses a fixed
// number of DB round trips and should not compete with C2's repeated CRC boot.
import {before,after,test} from 'node:test';
import {createRequire} from 'node:module';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {build} from 'esbuild';
import {raceHost} from './race-host.mjs';
import {logger} from './host.mjs';
const require=createRequire(import.meta.url),{Pool}=require('pg'),{createGameplayCore}=require('../../dist/aetherius-gameplay-core.cjs');
const root=fileURLToPath(new URL('../../',import.meta.url));
const compiled=await build({absWorkingDir:root,stdin:{loader:'ts',resolveDir:root,contents:`
  export {readMigrations,applyMigrations} from './shared/persistence/src/index.ts';
  export {explainCharacter} from './runtime/src/explanation.ts';
  export {loadDomain} from './shared/record-catalog/src/index.ts';
  export {createFileHost} from './tools/catalog/host.ts';
`},bundle:true,platform:'node',format:'esm',write:false});
const api=await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const url=new URL(process.env.AETHERIUS_TEST_DATABASE_URL??'missing:');
assert(['localhost','127.0.0.1','[::1]'].includes(url.hostname)&&url.pathname==='/aetherius_test','local aetherius_test required');
const schema=`gc_c2_${process.pid}_${randomBytes(4).toString('hex')}`,table=name=>`"${schema}".${name}`;
const pool=new Pool({connectionString:process.env.AETHERIUS_TEST_DATABASE_URL,max:8,idleTimeoutMillis:0,connectionTimeoutMillis:2000,options:`-c search_path=${schema},pg_catalog`});
let profile=95000;const cores=[];
before(async()=>{await pool.query(`CREATE SCHEMA "${schema}"`);await api.applyMigrations(pool,await api.readMigrations(`${root}/database/migrations`),schema);});
after(async()=>{await Promise.all(cores.map(c=>c.shutdown()));await pool.query(`DROP SCHEMA "${schema}" CASCADE`);await pool.end();});
async function setup(t,{mode='active',shift=0,catalogAvailable=true,pgPool=pool,stoneMode='off',extra,env={}}={}) {
  t.mock.timers.enable({apis:['setTimeout','setInterval']});
  const mp=raceHost({shift,catalogAvailable}),log=logger();mp.profiles.set(91,++profile);
  mp.appearances.set(91,{raceId:mp.ids.get('skyrim.esm|013746')});
  const core=createGameplayCore({mp,pg:{init:()=>pgPool},log,env:{GAMEPLAY_CORE_DATABASE_SCHEMA:schema,GAMEPLAY_CORE_MODE_RACES:mode,GAMEPLAY_CORE_MODE_STANDING_STONES:stoneMode,GAMEPLAY_CORE_MODE_EXTRA:'active',...env}});
  if(extra)core.register({id:'extra',requiresDatabase:false,start:extra});
  cores.push(core);t.after(()=>core.shutdown());await core.initialize();
  const binding=core.identity.lookup({actorId:91}).value;
  const observe=()=>core.observeRace(binding);
  return {mp,log,core,binding,observe};
}
const fact=async b=>(await pool.query(`SELECT * FROM ${table('gc_race_observation')} WHERE character_key=$1`,[b.characterKey])).rows[0];
async function until(fn,timeoutMs=60_000){const deadline=performance.now()+timeoutMs;while(true){if(await fn())return;if(performance.now()>=deadline)throw Error('condition timed out');await new Promise(resolve=>setImmediate(resolve));}}
test('actor ready observes Nord, rehydrates on reconnect and changes race; no host mutation',async t=>{
  const f=await setup(t);t.mock.timers.tick(3000);await until(async()=>!!await fact(f.binding));
  assert.equal((await fact(f.binding)).race_key,'skyrim.esm|013746');assert.equal(f.mp.mutations().length,0);
  f.mp.emitter.emit('disconnect',0);f.core.identity.poll();const binding=f.core.identity.lookup({actorId:91}).value;
  assert.notEqual(binding.epoch,f.binding.epoch);t.mock.timers.tick(3000);await f.core.observeRace(binding);
  assert.equal((await fact(binding)).revision,'1');assert.equal(f.mp.mutations().length,0);
  const key=f.mp.raceData.roots.find(k=>k!=='skyrim.esm|013746');assert.equal(f.mp.changeAppearance(91,key),undefined);
  await until(async()=>(await fact(binding)).race_key===key);assert.equal((await fact(binding)).revision,'2');assert.equal(f.mp.mutations().length,0);
});
test('ten races and reordered host IDs resolve identically',async t=>{
  const f=await setup(t,{shift:20000});
  for(const key of f.mp.raceData.roots){f.mp.appearances.set(91,{raceId:f.mp.ids.get(key)});assert.equal((await f.observe()).raceKey,key);assert.equal((await fact(f.binding)).race_key,key);}
  assert.equal(f.mp.mutations().length,0);
});
test('missing appearance, unknown ID, nonplayable race: explicit unsupported with no valid race persisted',async t=>{
  const f=await setup(t);await f.observe();
  const lookup=f.mp.lookupEspmRecordById;f.mp.lookupEspmRecordById=id=>id===700000?{record:{type:'RACE'}}:lookup(id);
  for(const [appearance,reason] of [[null,'RACE_APPEARANCE_UNAVAILABLE'],[{raceId:600000},'RACE_UNRESOLVED'],[{raceId:700000},'RACE_NOT_PLAYABLE']]){
    f.mp.appearances.set(91,appearance);const result=await f.observe();assert.equal(result.status,'UNSUPPORTED');assert.equal(result.reason,reason);
    const saved=await fact(f.binding);assert.equal(saved.status,'UNSUPPORTED');assert.equal(saved.race_key,null);assert.equal(saved.reason,reason);
  }
  assert.equal(f.mp.mutations().length,0);
});
test('appearance hook reads committed property, ignores denied proposal and never vetoes',async t=>{
  const f=await setup(t);await f.observe();const other=f.mp.raceData.roots.find(k=>k!=='skyrim.esm|013746');
  assert.equal(f.mp.changeAppearance(91,other,{allowed:false}),undefined);await f.observe();assert.equal((await fact(f.binding)).race_key,'skyrim.esm|013746');
  assert.equal(f.mp.mutations().length,0);
});
for(const mode of ['off','audit','shadow'])test(`${mode}: no durable observation, grants, projection or player property`,async t=>{
  const f=await setup(t,{mode});t.mock.timers.tick(3000);
  const result=await f.observe();if(mode==='off')assert.equal(result.reason,'RACES_NOT_STARTED');else assert.equal(result.status,'SUPPORTED');
  assert.equal(await fact(f.binding),undefined);assert.equal(f.mp.mutations().length,0);assert.equal(f.mp.notices.length,0);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM ${table('gc_commands')} WHERE character_key=$1`,[f.binding.characterKey])).rows[0].n,0);
});
test('stone swap projects only stone difference; full composition and explanation include RACE',async t=>{
  const f=await setup(t,{stoneMode:'active'});t.mock.timers.tick(3000);await f.observe();
  const choose=stoneKey=>f.core.chooseStandingStone({binding:f.binding,stoneKey,requestId:randomBytes(8).toString('hex')});
  assert.equal((await choose('skyrim.esm|0D232D')).status,'SUPPORTED');assert.equal((await choose('skyrim.esm|0D232E')).status,'SUPPORTED');
  assert.deepEqual(f.mp.mutations().map(c=>c.method),['AddSpell','RemoveSpell','AddSpell']);
  const set=(await pool.query(`SELECT grant_set FROM ${table('gc_spell_projection_heads')} WHERE character_key=$1`,[f.binding.characterKey])).rows[0].grant_set;
  assert(set.grants.some(g=>g.source.kind==='RACE'&&g.definition.stableFormKey==='aetherius.esp|000805'));assert(set.grants.some(g=>g.source.kind==='STANDING_STONE'));
  assert.equal(f.mp.notices.length,0);
});
test('race plus another origin suppresses AddSpell/RemoveSpell even when race changes or reconnects',async t=>{
  let recompose;const f=await setup(t,{extra(ctx){recompose=b=>ctx.composition.recompose(b);const r=ctx.catalog;
    // Exact real definition, shared with the race; this provider is domain-neutral.
    const mpData=JSON.parse(require('node:fs').readFileSync(`${root}/catalog/races.json`));
    const spell=mpData.records.find(r=>r.stableFormKey==='skyrim.esm|0AA020');
    ctx.composition.register({id:'extra',read:async()=>({revision:0,grants:[{kind:'ability',definition:{stableFormKey:spell.stableFormKey,recordType:'SPEL',catalogSignature:spell.signature},source:{kind:'ADMIN',key:'extra'},revision:0}]})});
  }});
  await f.observe();t.mock.timers.tick(3000);await recompose(f.binding);assert.equal(f.mp.mutations().length,0);
  const oldHead=(await pool.query(`SELECT grant_set FROM ${table('gc_spell_projection_heads')} WHERE character_key=$1`,[f.binding.characterKey])).rows[0].grant_set;
  assert(oldHead.grants.filter(g=>g.definition.stableFormKey==='skyrim.esm|0AA020').length===2);
  for(const key of f.mp.raceData.roots){f.mp.appearances.set(91,{raceId:f.mp.ids.get(key)});await f.observe();assert.equal(f.mp.mutations().length,0);}
  // Reconnect as Nord: the shared record is natively delivered again.
  f.mp.appearances.set(91,{raceId:f.mp.ids.get('skyrim.esm|013746')});await f.observe();f.mp.emitter.emit('disconnect',0);f.core.identity.poll();
  await f.core.observeRace(f.core.identity.lookup({actorId:91}).value);t.mock.timers.tick(3000);await f.core.observeRace(f.core.identity.lookup({actorId:91}).value);
  assert.equal(f.mp.mutations().length,0);
});
test('racial observations never project an unrelated missing grant; its owner retains delivery authority',async t=>{
  const f=await setup(t,{extra(ctx){const data=JSON.parse(require('node:fs').readFileSync(`${root}/catalog/standing-stones.json`));
    const spell=data.records.find(r=>r.stableFormKey==='skyrim.esm|0E5F4C');
    ctx.composition.register({id:'extra',read:async()=>({revision:0,grants:[{kind:'ability',definition:{stableFormKey:spell.stableFormKey,recordType:'SPEL',catalogSignature:spell.signature},source:{kind:'ADMIN',key:'separate-owner'},revision:0}]})});
  }});
  t.mock.timers.tick(3000);await f.observe();assert.equal(f.mp.mutations().length,0);
  for(const key of f.mp.raceData.roots){f.mp.appearances.set(91,{raceId:f.mp.ids.get(key)});await f.observe();}
  assert.equal(f.mp.mutations().length,0);
});
test('UNSUPPORTED catalog and database, stale epoch: session remains intact and no racial mutation',async t=>{
  const f=await setup(t,{catalogAvailable:false});assert.equal((await f.observe()).reason,'RACE_CATALOG_UNAVAILABLE');
  assert.equal((await fact(f.binding)).status,'UNSUPPORTED');assert.equal(f.core.identity.isCurrent(f.binding),true);assert.equal(f.mp.mutations().length,0);
  f.mp.emitter.emit('disconnect',0);assert.equal((await f.observe()).reason,'STALE_BINDING');assert.equal(f.mp.mutations().length,0);
});
test('canary without the character selected observes but does not persist or project',async t=>{
  const f=await setup(t,{mode:'canary'});assert.equal((await f.observe()).status,'SUPPORTED');assert.equal(await fact(f.binding),undefined);assert.equal(f.mp.mutations().length,0);
});
test('database fails during observation: no command/fact committed, no host mutation, no private error log',async t=>{
  let down=false;const wrapped={connect:()=>down?Promise.reject(Error('private password must not appear')):pool.connect()};
  const f=await setup(t,{pgPool:wrapped});down=true;assert.equal((await f.observe()).status,'UNSUPPORTED');
  assert.equal(await fact(f.binding),undefined);assert.equal(f.mp.mutations().length,0);assert(!f.log.messages.join('').includes('password'));
});
test('reconnect reads live race before reconciling an old head and relinquishes prior port ownership without host mutation',async t=>{
  let recompose,sharedKey;
  const f=await setup(t,{extra(ctx){
    recompose=b=>ctx.composition.recompose(b);
    const data=JSON.parse(require('node:fs').readFileSync(`${root}/catalog/races.json`));
    const nord=data.records.find(r=>r.stableFormKey==='skyrim.esm|013746').data.actorEffects;
    const other=data.records.find(r=>r.recordType==='RACE'&&r.data.actorEffects.some(key=>!nord.includes(key)));
    sharedKey=other.data.actorEffects.find(key=>!nord.includes(key));const spell=data.records.find(r=>r.stableFormKey===sharedKey);
    ctx.composition.register({id:'extra',read:async()=>({revision:0,grants:[{kind:spell.data.spellType==='Ability'?'ability':'power',
      definition:{stableFormKey:spell.stableFormKey,recordType:'SPEL',catalogSignature:spell.signature},source:{kind:'ADMIN',key:'overlap-after-reconnect'},revision:0}]})});
  }});
  await f.observe();t.mock.timers.tick(3000);await recompose(f.binding);assert.equal(f.mp.mutations().length,1);
  const otherRace=f.mp.raceData.records.find(r=>r.recordType==='RACE'&&r.data.actorEffects.includes(sharedKey));
  f.mp.emitter.emit('disconnect',0);f.mp.appearances.set(91,{raceId:f.mp.ids.get(otherRace.stableFormKey)});
  // Runtime learned-spell enumeration can omit the inherited record after spawn.
  f.mp.learned(91).delete(f.mp.ids.get(sharedKey));f.mp.calls.length=0;f.core.identity.poll();
  const rebound=f.core.identity.lookup({actorId:91}).value;t.mock.timers.tick(3000);await f.core.observeRace(rebound);
  await recompose(rebound);assert.equal(f.mp.mutations().length,0);
  const row=(await pool.query(`SELECT owned,active FROM ${table('gc_spell_projections')} WHERE character_key=$1 AND stable_form_key=$2`,[rebound.characterKey,sharedKey])).rows[0];
  assert.equal(row.owned,false);assert.equal(row.active,false);
});
test('staff CLI uses real aetherius_test and a read-only transaction while server is stopped',async t=>{
  const f=await setup(t,{stoneMode:'active'});await f.observe();await f.core.chooseStandingStone({binding:f.binding,stoneKey:'skyrim.esm|0D232D',requestId:'cli-choice'});await f.core.shutdown();
  const pgPath=fileURLToPath(new URL('../../../aetherius-server/server/gamemode/core/pg.js',import.meta.url));
  const result=await new Promise(resolve=>{const child=spawn(process.execPath,[`${root}/runtime/explain-character.mjs`,pgPath,f.binding.characterKey,schema],{env:{...process.env,GAME_DATABASE_URL:process.env.AETHERIUS_TEST_DATABASE_URL},stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);child.on('close',status=>resolve({status,stdout,stderr}));});
  assert.equal(result.status,0,result.stderr);const explanation=JSON.parse(result.stdout);
  assert(explanation.grants.some(g=>g.sources.some(s=>s.kind==='RACE')));assert(explanation.grants.some(g=>g.sources.some(s=>s.kind==='STANDING_STONE')));
  assert.deepEqual(explanation.initialAttributes,{health:50,magicka:50,stamina:50});
  assert(explanation.grants.filter(g=>g.delivery==='NATIVE_RACE_RECORD').every(g=>g.ownership.every(o=>o.detail.grantOwner==='NATIVE_CLIENT')));
  assert(explanation.portGrants.every(g=>g.source.kind==='STANDING_STONE'));
});
test('missing optional C2 migration leaves existing stone feature supported and functional',async t=>{
  const oldSchema=`gc_c2_old_${process.pid}`,migrations=(await api.readMigrations(`${root}/database/migrations`)).filter(m=>!m.version.startsWith('0005_'));
  await pool.query(`CREATE SCHEMA "${oldSchema}"`);await api.applyMigrations(pool,migrations,oldSchema);
  const mp=raceHost(),core=createGameplayCore({mp,pg:{init:()=>pool},log:logger(),env:{GAMEPLAY_CORE_DATABASE_SCHEMA:oldSchema,GAMEPLAY_CORE_MODE_STANDING_STONES:'active'}});
  try{await core.initialize();assert.equal(core.capabilityReport().database.status,'SUPPORTED');assert.equal(core.capabilityReport().systems.find(s=>s.id==='standing-stones').status,'SUPPORTED');
    assert.equal(core.capabilityReport().systems.find(s=>s.id==='races').status,'UNSUPPORTED');
    assert.equal((await core.chooseStandingStone({binding:core.identity.lookup({actorId:91}).value,stoneKey:'skyrim.esm|0D232D',requestId:'old-install'})).status,'SUPPORTED');
  }finally{await core.shutdown();await pool.query(`DROP SCHEMA "${oldSchema}" CASCADE`);}
});
