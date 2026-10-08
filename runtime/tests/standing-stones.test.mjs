import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { spawnSync } from 'node:child_process';
import { standingHost } from './standing-host.mjs';
import { logger } from './host.mjs';
const require=createRequire(import.meta.url), {Pool}=require('pg');
const {createGameplayCore}=require('../../dist/aetherius-gameplay-core.cjs');
const compiled=await build({absWorkingDir:fileURLToPath(new URL('../../',import.meta.url)),stdin:{loader:'ts',resolveDir:fileURLToPath(new URL('../../',import.meta.url)),contents:`
  export {readMigrations,applyMigrations} from './shared/persistence/src/index.ts';
  export {adoptSpikeChoice} from './runtime/src/adoption.ts';
  export {loadDomain} from './shared/record-catalog/src/index.ts';
  export {createFileHost} from './tools/catalog/host.ts';
  export {noticeOwnerCode} from './runtime/src/standing-stones.ts';
`},bundle:true,platform:'node',format:'esm',write:false});
const api=await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const databaseUrl=process.env.AETHERIUS_TEST_DATABASE_URL;
if(!databaseUrl)throw Error('AETHERIUS_TEST_DATABASE_URL required');
const url=new URL(databaseUrl);assert(['localhost','127.0.0.1','[::1]'].includes(url.hostname)&&url.pathname==='/aetherius_test');
const schema=`gc_c1_${process.pid}_${randomBytes(5).toString('hex')}`, table=name=>`"${schema}".${name}`;
// Node MockTimers are reset between tests. Do not attach real pool eviction to a
// retired test's mocked clock; character/session timing remains exercised.
const pool=new Pool({connectionString:databaseUrl,max:8,idleTimeoutMillis:0,connectionTimeoutMillis:2000,options:`-c search_path=${schema},pg_catalog`});
const roots=['skyrim.esm|0D232D','skyrim.esm|0D232E','skyrim.esm|0D232F'];
const cores=[];let profile=80000;
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};};
async function until(predicate){for(let i=0;i<180;i++){if(await predicate())return;await pool.query('SELECT 1');}throw Error('test condition did not complete');}
before(async()=>{await pool.query(`CREATE SCHEMA "${schema}"`);await api.applyMigrations(pool,await api.readMigrations(fileURLToPath(new URL('../../database/migrations/',import.meta.url))),schema);});
after(async()=>{await Promise.all(cores.map(core=>core.shutdown()));await pool.query(`DROP SCHEMA "${schema}" CASCADE`);await pool.end();});
async function setup(t,{mode='active',catalogAvailable=true,shift=0,characterProfile,pgPool=pool,env={}}={}){
  t.mock.timers.enable({apis:['setTimeout','setInterval']});
  const mp=standingHost({catalogAvailable,shift}),log=logger();
  mp.profiles.set(91,characterProfile??++profile);
  const core=createGameplayCore({mp,pg:{init:()=>pgPool},log,env:{GAMEPLAY_CORE_DATABASE_SCHEMA:schema,GAMEPLAY_CORE_MODE_STANDING_STONES:mode,...env}});
  cores.push(core);await core.initialize();const binding=core.identity.lookup({actorId:91}).value;
  const ready=async()=>{t.mock.timers.tick(3000);if(['active','canary'].includes(mode)&&catalogAvailable&&core.capabilityReport().database.status==='SUPPORTED'&&core.capabilityReport().systems.find(s=>s.id==='standing-stones').started){
    try { await until(async()=>!!(await pool.query(`SELECT complete FROM ${table('gc_spell_projection_heads')} WHERE character_key=$1`,[binding.characterKey])).rows[0]?.complete); }
    catch { throw Error(`Readiness failed: ${log.messages.join(' | ')}`); }
  }};
  const choose=(stoneKey=roots[0],requestId=randomBytes(8).toString('hex'))=>core.chooseStandingStone({binding,stoneKey,requestId});
  t.after(()=>core.shutdown());return{mp,core,binding,log,ready,choose};
}
async function fact(binding){return(await pool.query(`SELECT *,xmin::text AS version FROM ${table('gc_standing_stone_choice')} WHERE character_key=$1`,[binding.characterKey])).rows[0];}
async function commands(binding){return(await pool.query(`SELECT count(*)::int AS n FROM ${table('gc_commands')} WHERE character_key=$1`,[binding.characterKey])).rows[0].n;}
test('confirmed fact, provenance, difference, same stone no fact/projection/host mutation; request replay never rolls state back',async t=>{
  const f=await setup(t);await f.ready();
  const first=await f.choose(roots[0],'c1-first');assert.equal(first.status,'SUPPORTED');assert.equal(first.receipt.result.revision,1);
  assert.deepEqual(f.mp.mutations().map(c=>c.method),['AddSpell']);
  const a=await fact(f.binding),calls=f.mp.calls.length;
  const same=await f.choose(roots[0],'c1-same');assert.equal(same.receipt.result.changed,false);
  assert.equal((await fact(f.binding)).version,a.version);assert.equal(f.mp.calls.length,calls);
  const replay=await f.choose(roots[0],'c1-first');assert.equal(replay.receipt.replayed,true);assert.equal(await commands(f.binding),2);assert.equal(f.mp.calls.length,calls);
  const swapped=await f.choose(roots[1],'c1-swap');assert.equal(swapped.receipt.result.revision,2);
  assert.deepEqual(f.mp.mutations().map(c=>c.method),['AddSpell','RemoveSpell','AddSpell']);
  const head=(await pool.query(`SELECT grant_set FROM ${table('gc_spell_projection_heads')} WHERE character_key=$1`,[f.binding.characterKey])).rows[0].grant_set;
  assert.deepEqual(head.grants.map(g=>g.source),[{kind:'STANDING_STONE',key:roots[1]}]);
  const count=f.mp.calls.length;await f.choose(roots[0],'c1-first');assert.equal((await fact(f.binding)).stone_key,roots[1]);assert.equal(f.mp.calls.length,count);
  assert.equal((await f.choose(roots[2],'c1-first')).reason,'REQUEST_ID_REUSED');
});
test('all thirteen choices use the committed provider path, including two Apprentice grants and no Steed sprint',async t=>{
  const f=await setup(t);await f.ready();
  for(const key of f.mp.data.roots){const result=await f.choose(key);assert.equal(result.status,'SUPPORTED');
    const expected=f.mp.data.records.find(r=>r.stableFormKey===key).data.spells.map(spell=>f.mp.ids.get(spell));
    assert.deepEqual([...f.mp.learned(91)].sort((a,b)=>a-b),expected.sort((a,b)=>a-b));}
  assert(!f.mp.mutations().some(c=>c.args[0].desc==='818:mundus.esp'));
});
test('another provider sustains the same spell across a stone change',async t=>{
  t.mock.timers.enable({apis:['setTimeout','setInterval']});const mp=standingHost(),log=logger();mp.profiles.set(91,++profile);
  const core=createGameplayCore({mp,pg:{init:()=>pool},log,env:{GAMEPLAY_CORE_DATABASE_SCHEMA:schema,GAMEPLAY_CORE_MODE_STANDING_STONES:'active',GAMEPLAY_CORE_MODE_OTHER:'active'}});cores.push(core);t.after(()=>core.shutdown());
  core.register({id:'other',requiresDatabase:false,start(ctx){const record=mp.data.records.find(r=>r.stableFormKey==='skyrim.esm|0E5F4C');
    ctx.composition.register({id:'other',read:async()=>({revision:0,grants:[{kind:'ability',definition:{stableFormKey:record.stableFormKey,recordType:'SPEL',catalogSignature:record.signature},source:{kind:'ADMIN',key:'test-other-provider'},revision:0}]})});}});
  await core.initialize();const binding=core.identity.lookup({actorId:91}).value;t.mock.timers.tick(3000);
  await core.chooseStandingStone({binding,stoneKey:roots[0],requestId:'other-first'});
  await core.chooseStandingStone({binding,stoneKey:roots[1],requestId:'other-swap'});
  assert(mp.learned(91).has(mp.ids.get('skyrim.esm|0E5F4C')));assert(!mp.mutations().some(c=>c.method==='RemoveSpell'));
});
test('a binding replaced while waiting for the real character lock rolls back both fact and ledger',async t=>{
  const f=await setup(t);await f.ready();const lock=await pool.connect();await lock.query('BEGIN');await lock.query('SELECT pg_advisory_xact_lock($1::bigint)',[-Number(f.binding.characterKey.slice(8))]);
  const choice=f.choose(roots[0],'stale-locked');
  await until(async()=>!!(await pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event='advisory' AND query LIKE '%pg_advisory_xact_lock%'" )).rows[0].n);
  f.mp.emitter.emit('disconnect',0);await lock.query('ROLLBACK');lock.release();
  const result=await choice;assert.equal(result.status,'UNSUPPORTED');assert.equal(await fact(f.binding),undefined);assert.equal(await commands(f.binding),0);assert.equal(f.mp.mutations().length,0);
});
test('concurrent requests with same requestId have one effect; independent requests serialize revisions',async t=>{
  const f=await setup(t);await f.ready();const pair=await Promise.all([f.choose(roots[0],'concurrent-same'),f.choose(roots[0],'concurrent-same')]);
  assert(pair.every(r=>r.status==='SUPPORTED'));assert.equal(pair.filter(r=>r.receipt.replayed).length,1);assert.equal(await commands(f.binding),1);assert.equal(f.mp.mutations().length,1);
  const next=await Promise.all([f.choose(roots[1],'concurrent-b'),f.choose(roots[2],'concurrent-c')]);assert(next.every(r=>r.status==='SUPPORTED'));assert.equal(Number((await fact(f.binding)).revision),3);
});
test('placed reference activation, private success/failure notification, database loss stays vetoed and never grants',async t=>{
  let down=false;const wrapped={connect:()=>down?Promise.reject(Object.assign(Error('secret must never be printed'),{code:'ECONNREFUSED'})):pool.connect()};
  const f=await setup(t,{pgPool:wrapped});await f.ready();const ref=f.mp.reference(roots[0]);
  assert.notEqual(ref,f.mp.ids.get(roots[0]));assert.equal(f.mp.onActivate(ref,91),false);
  await until(()=>f.mp.notices.length===1);assert.equal(f.mp.notices[0].value.message,'Pedra guardiã escolhida.');
  const previous=await fact(f.binding),mutations=f.mp.mutations().length;down=true;
  assert.equal(f.mp.onActivate(f.mp.reference(roots[1]),91),false);await until(()=>f.mp.notices.length===2);
  assert.equal((await fact(f.binding)).version,previous.version);assert.equal(f.mp.mutations().length,mutations);assert.match(f.mp.notices[1].value.message,/Não foi possível/);
  assert(!f.log.messages.join('').includes('secret'));
  const property=f.mp.properties.get('gcStandingStoneNotice');assert.equal(property.isVisibleByOwner,true);assert.equal(property.isVisibleByNeighbors,false);assert.equal(property.updateNeighbor,'');
  const seen=[],ctx={state:{},value:f.mp.notices[1].value,sp:{Debug:{notification:m=>seen.push(m)}}};
  runInNewContext(property.updateOwner,{ctx,Date});runInNewContext(property.updateOwner,{ctx,Date});assert.equal(seen.length,1);
  down=false;f.mp.clearNoticeProperty();assert.equal(f.mp.onActivate(ref,91),false);await until(()=>f.mp.notices.length===3);assert.equal(f.mp.properties.size,1);
});
test('unavailable catalog or database at boot refuses recognized stones visibly without grants',async t=>{
  const f=await setup(t,{catalogAvailable:false});assert.equal(f.mp.onActivate(f.mp.reference(roots[0]),91),false);
  await until(()=>f.mp.notices.length===1);assert.equal(await fact(f.binding),undefined);assert.equal(await commands(f.binding),0);assert.equal(f.mp.mutations().length,0);
  assert.match(f.log.messages.join(' '),/CATALOG_UNAVAILABLE/);
});
for(const mode of ['off','audit','shadow'])test(`${mode}: native activation unchanged, no choices/projection/property state`,async t=>{
  const f=await setup(t,{mode});const hook=f.mp.onActivate;
  if(mode==='off')assert.equal(hook,undefined);else assert.equal(hook(f.mp.reference(roots[0]),91),undefined);
  t.mock.timers.tick(4000);assert.equal(await fact(f.binding),undefined);assert.equal(await commands(f.binding),0);assert.equal(f.mp.mutations().length,0);assert.equal(f.mp.properties.size,0);
  if(mode!=='off')assert(f.log.messages.some(m=>m.includes('WOULD_CHOOSE')));
});
test('canary applies only to listed profiles, leaving other characters native',async t=>{
  const p=++profile;const f=await setup(t,{mode:'canary',characterProfile:p,env:{GAMEPLAY_CORE_CANARY_CHARACTERS:`profile:${p}`}});await f.ready();
  f.mp.profiles.set(92,p+1);f.mp.users.set(92,1);f.mp.online.push(92);f.core.identity.poll();
  assert.equal(f.mp.onActivate(f.mp.reference(roots[1]),92),undefined);assert.equal(f.mp.onActivate(f.mp.reference(roots[0]),91),false);await until(()=>f.mp.notices.length===1);
  assert.equal((await fact(f.binding)).stone_key,roots[0]);assert.equal(f.mp.mutations().filter(c=>c.actor===92).length,0);
});
for(const mode of ['active','canary'])test(`${mode} refuses to start with the spike while preserving the legacy flag`,async t=>{
  const f=await setup(t,{mode,env:{ENABLE_STANDING_STONE_SPIKE:'true'}});const report=f.core.capabilityReport();
  const entry=report.systems.find(s=>s.id==='standing-stones');assert.equal(entry.started,false);assert.match(entry.missing.join(' '),/SPIKE_CONFLICT/);assert.equal(report.spike.running,true);
  assert.equal((await f.choose()).status,'UNSUPPORTED');assert.equal(await fact(f.binding),undefined);
});
test('changed plugin positions resolve the same catalog choices and grants with different runtime IDs',async t=>{
  const f=await setup(t,{shift:700});await f.ready();assert.equal((await f.choose(roots[1])).status,'SUPPORTED');
  assert.deepEqual([...f.mp.learned(91)],[f.mp.ids.get('skyrim.esm|0E5F47')]);assert.equal((await fact(f.binding)).stone_key,roots[1]);
  const persisted=JSON.stringify((await pool.query(`SELECT grant_set FROM ${table('gc_spell_projection_heads')} WHERE character_key=$1`,[f.binding.characterKey])).rows[0]);
  assert(!persisted.includes('runtimeFormId'));assert(!persisted.includes('actorId'));assert(!persisted.includes(f.binding.epoch));
});
test('reconnect reads the durable fact, then a genuinely new process reconstructs the current stone',async t=>{
  const f=await setup(t);await f.ready();await f.choose(roots[1],'reconnect-choice');
  const previous=f.binding;f.mp.emitter.emit('disconnect',0);f.mp.learned(91).clear();f.core.identity.poll();
  const binding=f.core.identity.lookup({actorId:91}).value;assert.notEqual(binding.epoch,previous.epoch);
  t.mock.timers.tick(3000);await until(()=>f.mp.learned(91).has(f.mp.ids.get('skyrim.esm|0E5F47')));
  assert.equal((await f.core.chooseStandingStone({binding:previous,stoneKey:roots[0],requestId:'obsolete-after-reconnect'})).status,'UNSUPPORTED');
  await f.core.shutdown();
  const child=spawnSync(process.execPath,[fileURLToPath(new URL('./standing-restart.mjs',import.meta.url)),schema,binding.characterKey.slice(8),roots[1]],{encoding:'utf8',env:process.env,timeout:20000});
  // Child emits only assertions and static markers; never a database URL.
  assert.equal(child.status,0,child.stderr);assert.match(child.stdout,/NEW_PROCESS_REHYDRATION_PASSED/);console.log(child.stdout.trim());
});
test('adoption is atomic/idempotent and a subsequent swap removes the imported spike spells',async t=>{
  const p=++profile,key=`profile:${p}`,mp=standingHost();
  const catalog=api.loadDomain(mp.data,api.createFileHost(mp,mp.getServerSettings().dataDir,[mp.data]));assert.equal(catalog.status,'SUPPORTED');
  await pool.query(`CREATE TABLE IF NOT EXISTS ${table('spike_standing_stone_choices')} (character_key text PRIMARY KEY,stone_key text NOT NULL,updated_at timestamptz DEFAULT now())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS ${table('spike_standing_stone_projections')} (character_key text PRIMARY KEY,grants jsonb NOT NULL,updated_at timestamptz DEFAULT now())`);
  const oldSpell='skyrim.esm|0E5F47';
  const oldGrants=[{kind:'spell',definition:{stableFormKey:oldSpell,recordType:'SPEL'},source:{kind:'STANDING_STONE',key:'standing-stone-choice'}}];
  await pool.query(`INSERT INTO ${table('spike_standing_stone_choices')} (character_key,stone_key) VALUES ($1,$2)`,[key,roots[1]]);
  await pool.query(`INSERT INTO ${table('spike_standing_stone_projections')} (character_key,grants) VALUES ($1,$2::jsonb)`,[key,JSON.stringify(oldGrants)]);
  const adoption=await api.adoptSpikeChoice(pool,catalog,key,schema);assert.equal(adoption.status,'accepted');assert.deepEqual(adoption.result.adopted,[oldSpell]);
  const first=(await pool.query(`SELECT xmin::text AS version FROM ${table('gc_standing_stone_choice')} WHERE character_key=$1`,[key])).rows[0].version;
  assert.equal((await api.adoptSpikeChoice(pool,catalog,key,schema)).replayed,true);
  assert.equal((await pool.query(`SELECT xmin::text AS version FROM ${table('gc_standing_stone_choice')} WHERE character_key=$1`,[key])).rows[0].version,first);
  const f=await setup(t,{characterProfile:p});f.mp.learned(91).add(f.mp.ids.get(oldSpell));await f.ready();
  const choice=await f.choose(roots[0],'adopted-swap');assert.equal(choice.status,'SUPPORTED');
  assert(!f.mp.learned(91).has(f.mp.ids.get(oldSpell)));assert(f.mp.learned(91).has(f.mp.ids.get('skyrim.esm|0E5F4C')));
  assert.deepEqual(f.mp.mutations().map(c=>c.method),['RemoveSpell','AddSpell']);
  assert.equal((await pool.query(`SELECT stone_key FROM ${table('spike_standing_stone_choices')} WHERE character_key=$1`,[key])).rows[0].stone_key,roots[1]);
  assert.equal((await api.adoptSpikeChoice(pool,catalog,key,schema)).replayed,true);assert.equal((await fact(f.binding)).stone_key,roots[0]);
});
test('adoption refuses mismatched spike projection and existing Core state, leaving no receipt or partial import',async()=>{
  const mp=standingHost(),catalog=api.loadDomain(mp.data,api.createFileHost(mp,mp.getServerSettings().dataDir,[mp.data]));
  const key=`profile:${++profile}`;
  await pool.query(`INSERT INTO ${table('spike_standing_stone_choices')} (character_key,stone_key) VALUES ($1,$2)`,[key,roots[0]]);
  await pool.query(`INSERT INTO ${table('spike_standing_stone_projections')} (character_key,grants) VALUES ($1,'[]'::jsonb)`,[key]);
  await assert.rejects(api.adoptSpikeChoice(pool,catalog,key,schema),/SPIKE_PROJECTION_MISMATCH/);
  assert.equal((await pool.query(`SELECT * FROM ${table('gc_commands')} WHERE character_key=$1`,[key])).rows.length,0);
  assert.equal((await pool.query(`SELECT * FROM ${table('gc_standing_stone_choice')} WHERE character_key=$1`,[key])).rows.length,0);
  const grants=[{kind:'spell',definition:{stableFormKey:'skyrim.esm|0E5F4C',recordType:'SPEL'},source:{kind:'STANDING_STONE'}}];
  await pool.query(`UPDATE ${table('spike_standing_stone_projections')} SET grants=$2::jsonb WHERE character_key=$1`,[key,JSON.stringify(grants)]);
  await pool.query(`INSERT INTO ${table('gc_standing_stone_choice')} (character_key,stone_key,revision) VALUES ($1,$2,1)`,[key,roots[1]]);
  await assert.rejects(api.adoptSpikeChoice(pool,catalog,key,schema),/CORE_STATE_ALREADY_EXISTS/);
  assert.equal((await pool.query(`SELECT stone_key FROM ${table('gc_standing_stone_choice')} WHERE character_key=$1`,[key])).rows[0].stone_key,roots[1]);
});
test('development CLI runs against aetherius_test only, verifies the actual plugin files, and replays adoption',async()=>{
  const key=`profile:${++profile}`,dataDir=standingHost().getServerSettings().dataDir;
  await pool.query(`INSERT INTO ${table('spike_standing_stone_choices')} (character_key,stone_key) VALUES ($1,$2)`,[key,roots[0]]);
  await pool.query(`INSERT INTO ${table('spike_standing_stone_projections')} (character_key,grants) VALUES ($1,$2::jsonb)`,[key,JSON.stringify([{kind:'spell',definition:{stableFormKey:'skyrim.esm|0E5F4C',recordType:'SPEL'},source:{kind:'STANDING_STONE'}}])]);
  const args=[fileURLToPath(new URL('../adopt-standing-stone.mjs',import.meta.url)),fileURLToPath(new URL('../../../aetherius-server/build/dist/server/gamemode/core/pg.js',import.meta.url)),dataDir,key,schema,'--development'];
  const env={...process.env,GAME_DATABASE_URL:databaseUrl,ENABLE_STANDING_STONE_SPIKE:'false',GAMEPLAY_CORE_MODE_STANDING_STONES:'off'};
  const child=spawnSync(process.execPath,args,{encoding:'utf8',env,timeout:20000});assert.equal(child.status,0,child.stderr);
  assert.equal(JSON.parse(child.stdout).replayed,false);
  const replay=spawnSync(process.execPath,args,{encoding:'utf8',env,timeout:20000});assert.equal(replay.status,0,replay.stderr);assert.equal(JSON.parse(replay.stdout).replayed,true);
});
test('database already unavailable at boot still vetoes active recognition and sends a failure without any grant',async t=>{
  const down={connect:async()=>{throw Object.assign(Error('private'),{code:'ECONNREFUSED'});}};
  const f=await setup(t,{pgPool:down});assert.equal(f.mp.onActivate(f.mp.reference(roots[0]),91),false);
  await until(()=>f.mp.notices.length===1);assert.match(f.mp.notices[0].value.message,/Não foi possível/);assert.equal(f.mp.mutations().length,0);assert.equal(await fact(f.binding),undefined);
});
test('lost COMMIT acknowledgement is declared unknown; repeat request recovers the persisted fact before projecting',async t=>{
  let failCommit=false;
  const wrapped={async connect(){const real=await pool.connect();return {async query(sql,args){const result=await real.query(sql,args);
    if(sql==='COMMIT'&&failCommit){failCommit=false;throw Error('injected lost acknowledgement');}return result;},release:error=>real.release(error)};}};
  const f=await setup(t,{pgPool:wrapped});await f.ready();failCommit=true;
  const first=await f.choose(roots[0],'commit-lost');assert.equal(first.status,'UNSUPPORTED');assert.equal(first.reason,'COMMIT_UNCONFIRMED');assert.equal(first.committed,'UNKNOWN');
  assert.equal((await fact(f.binding)).stone_key,roots[0]);assert.equal(f.mp.mutations().length,0);
  const retry=await f.choose(roots[0],'commit-lost');assert.equal(retry.status,'SUPPORTED');assert.equal(retry.receipt.replayed,true);assert.equal(f.mp.mutations().length,1);assert.equal(await commands(f.binding),1);
});
test('choice before actor-ready is persisted but not applied; readiness later projects the committed fact',async t=>{
  const f=await setup(t);const result=await f.choose(roots[2],'before-ready');assert.equal(result.status,'SUPPORTED');assert.equal(result.projection.value.state,'PENDING');
  assert.equal((await fact(f.binding)).stone_key,roots[2]);assert.equal(f.mp.mutations().length,0);
  await f.ready();assert.deepEqual([...f.mp.learned(91)],[f.mp.ids.get('skyrim.esm|0E5F45')]);
});
test('two active bindings retain independent facts and grants during concurrent commands',async t=>{
  const f=await setup(t);f.mp.profiles.set(92,++profile);f.mp.users.set(92,1);f.mp.online.push(92);f.core.identity.poll();
  const other=f.core.identity.lookup({actorId:92}).value;await f.ready();
  const [a,b]=await Promise.all([f.choose(roots[0],'two-actors-a'),f.core.chooseStandingStone({binding:other,stoneKey:roots[1],requestId:'two-actors-b'})]);
  assert.equal(a.status,'SUPPORTED');assert.equal(b.status,'SUPPORTED');
  assert.equal((await fact(f.binding)).stone_key,roots[0]);assert.equal((await fact(other)).stone_key,roots[1]);
  assert.deepEqual([...f.mp.learned(91)],[f.mp.ids.get('skyrim.esm|0E5F4C')]);assert.deepEqual([...f.mp.learned(92)],[f.mp.ids.get('skyrim.esm|0E5F47')]);
});
