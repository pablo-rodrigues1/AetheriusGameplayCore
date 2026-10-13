import assert from 'node:assert/strict';
import {test,before,after} from 'node:test';
import {createRequire} from 'node:module';
import {randomBytes} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {spawn} from 'node:child_process';
import {api,utils,root,load,perkMigration} from './b5b-source.mjs';
import {classHost} from './class-host.mjs';
import {officialHost} from './official-host.mjs';
import {logger} from './host.mjs';
import {developmentEnv} from './development-env.mjs';
import {xpInput} from './xp-event.mjs';
const {Pool}=createRequire(import.meta.url)('pg'),url=new URL(process.env.AETHERIUS_TEST_DATABASE_URL??'missing:');
assert(['localhost','127.0.0.1','[::1]'].includes(url.hostname)&&url.pathname==='/aetherius_test','Only local aetherius_test');
const schema='gc_c3d_'+randomBytes(8).toString('hex'),pool=new Pool({connectionString:process.env.AETHERIUS_TEST_DATABASE_URL,max:8,options:'-c search_path='+schema+',pg_catalog'});
const data=load('catalog/classes.json'),cores=[];let profile=996000;
before(async()=>{await pool.query('CREATE SCHEMA "'+schema+'"');await utils.applyMigrations(pool,[...await utils.readMigrations(root+'/database/migrations'),perkMigration],schema);});
after(async()=>{await Promise.all(cores.map(c=>c.shutdown()));await pool.query('DROP SCHEMA "'+schema+'" CASCADE');await pool.end();});
const commands=key=>api.createClassCommands(pool,data).set({characterKey:key,classId:'viper',epoch:'test',requestId:randomBytes(8).toString('hex')});
const levels=n=>api.withDevelopmentLevel(api.levelingLevelPort,n);
const alloc=(key,n,health,magicka=0,stamina=0,requestId=randomBytes(8).toString('hex'))=>api.createAttributeCommands(pool,levels(n)).allocate({characterKey:key,health,magicka,stamina,epoch:'test',requestId});
const state=(key,n)=>utils.withTransaction(pool,tx=>api.readAttributeState(tx,key,levels(n)));
const stored=async(key)=>(await pool.query('SELECT * FROM gc_attribute_allocation WHERE character_key=$1',[key])).rows[0];
test('real PostgreSQL levels 1..40: zero at level 1, 15 per level, total 585; no balance column',async()=>{
  const key='profile:995001';await commands(key);
  for(let n=1;n<=40;n++){const s=await state(key,n);assert.equal(s.earned,15*(n-1));assert.equal(s.available,s.earned);assert.equal(s.levelOrigin,'DEV');}
  const columns=(await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='gc_attribute_allocation'",[schema])).rows.map(r=>r.column_name);
  assert.deepEqual(columns.sort(),['character_key','health','magicka','revision','stamina']);
});
test('validation, CLASS_REQUIRED, insufficient, replay with new epoch and conflicting request',async()=>{
  const key='profile:995002';await assert.rejects(()=>alloc(key,2,5),{code:'CLASS_REQUIRED'});await commands(key);
  for(const [h,m,s] of [[0,0,0],[-5,0,0],[1,0,0],[2.5,0,0],[NaN,0,0],[Infinity,0,0],['5',0,0],[5,-5,5],[Number.MAX_SAFE_INTEGER,0,0]])
    await assert.rejects(()=>alloc(key,2,h,m,s),{code:'ATTRIBUTE_POINTS_INVALID'});
  await assert.rejects(()=>alloc(key,1,5),{code:'ATTRIBUTE_POINTS_INSUFFICIENT'});
  await assert.rejects(()=>alloc(key,2,20),{code:'ATTRIBUTE_POINTS_INSUFFICIENT'});
  const receipt=await alloc(key,2,5,5,5,'allocation-replay');assert.equal(receipt.status,'accepted');assert.equal(receipt.result.available,0);
  const prior=await stored(key),replay=await api.createAttributeCommands(pool,levels(2)).allocate({characterKey:key,health:5,magicka:5,stamina:5,requestId:'allocation-replay',epoch:'replacement'});
  assert.equal(replay.replayed,true);assert.deepEqual(await stored(key),prior);
  assert.equal((await alloc(key,2,10,0,0,'allocation-replay')).status,'conflict');
});
test('concurrent allocations share the command character lock, no double spending',async()=>{
  const key='profile:995003';await commands(key);
  const results=await Promise.allSettled([alloc(key,2,10),alloc(key,2,10)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'ATTRIBUTE_POINTS_INSUFFICIENT');
  assert.equal((await state(key,2)).spentTotal,10);
  const replayKey='profile:995004';await commands(replayKey);
  const receipts=await Promise.all([alloc(replayKey,2,15,0,0,'concurrent-replay'),alloc(replayKey,2,15,0,0,'concurrent-replay')]);
  assert.equal(receipts.filter(r=>r.replayed).length,1);assert.equal((await state(replayKey,2)).spentTotal,15);
});
test('real Leveling level up releases 15 more; class changes atomically reset XP/level/allocation and preserve fatigue',async()=>{
  const key='profile:995005';await commands(key);
  const adapter=api.createDurableLeveling(pool,(await new utils.ConfigLoader(root+'/modules/leveling-system').load()).configs);
  await adapter.award({characterKey:key,epoch:'test',...xpInput('c3d-levelup')});
  const first=await state(key);assert(first.level>1);await alloc(key,undefined,first.earned);
  const before=await state(key);await adapter.award({characterKey:key,epoch:'test',...xpInput('c3d-levelup-second')});
  const next=await state(key);assert.equal(next.available,15*(next.level-before.level));
  const fatigue={dailyCycleKey:'2026-10-12',dailyXpGained:900,dailyXpCap:1000,isFatigued:true,nextResetAt:123456};
  await pool.query('UPDATE gc_leveling_progress SET progress=progress || $2::jsonb WHERE character_key=$1',[key,JSON.stringify(fatigue)]);
  const progressBefore=(await pool.query('SELECT * FROM gc_leveling_progress WHERE character_key=$1',[key])).rows[0],allocationBefore=await stored(key);
  const same={characterKey:key,classId:'viper',epoch:'test',requestId:'same-class-keeps'};
  await api.createClassCommands(pool,data).set(same);assert.deepEqual((await pool.query('SELECT * FROM gc_leveling_progress WHERE character_key=$1',[key])).rows[0],progressBefore);assert.deepEqual(await stored(key),allocationBefore);
  const switchInput={...same,classId:'guardiao',requestId:'reset-class'};await api.createClassCommands(pool,data).set(switchInput);
  const reset=(await pool.query('SELECT * FROM gc_leveling_progress WHERE character_key=$1',[key])).rows[0];
  assert.equal(Number(reset.total_xp),0);assert.equal(reset.character_level,1);assert.equal(reset.progress.currentXp,0);assert.equal(reset.progress.nextLevelXp,200);
  for(const [field,value] of Object.entries(fatigue))assert.equal(reset.progress[field],value);
  assert.equal(await stored(key),undefined);
  await adapter.award({characterKey:key,epoch:'test',...xpInput('after-reset')});const newProgress=(await pool.query('SELECT * FROM gc_leveling_progress WHERE character_key=$1',[key])).rows[0];
  const replay=await api.createClassCommands(pool,data).set({...switchInput,epoch:'new'});assert.equal(replay.replayed,true);
  assert.deepEqual((await pool.query('SELECT * FROM gc_leveling_progress WHERE character_key=$1',[key])).rows[0],newProgress);
});
test('remove DEV level: excess allocation declared, negative derived balance retained, no automatic delete',async()=>{
  const key='profile:995006';await commands(key);await alloc(key,40,585);
  const saved=await stored(key),real=await state(key);assert.equal(real.reason,'ATTRIBUTE_ALLOCATION_EXCEEDS_LEVEL');assert.equal(real.applicable,false);assert.equal(real.available,-585);
  await assert.rejects(()=>alloc(key,undefined,5),{code:'ATTRIBUTE_ALLOCATION_EXCEEDS_LEVEL'});assert.deepEqual(await stored(key),saved);
});
async function until(fn){for(let i=0;i<300;i++){if(await fn())return;await delay(5);}throw Error('C3d fixture timeout');}
async function fixture({env={},native=true,pgPool=pool}={}){
  const mp=classHost({catalogAvailable:true,offlineMode:true}),log=logger();mp.profiles.set(91,++profile);const official=officialHost(mp);official.authenticate(91);
  // Native property contract from AttributeBonusesBinding::Get/Set and DEV-A1:
  // base/maximum/origin object, additive deltas or null. No custom fallback.
  const base={health:100,magicka:120,stamina:80},writes=[],get=mp.get,set=mp.set;let bonus=null,dev=null;
  const maximum=()=>dev??{health:base.health+(bonus?.health??0),magicka:base.magicka+(bonus?.magicka??0),stamina:base.stamina+(bonus?.stamina??0)};
  mp.get=(id,key)=>key==='aetheriusAttributeBonuses'?native?{base,maximum:maximum(),origin:dev?'DEV':bonus?'CLASS_ADDITIVE':'RECORDS'}:undefined:key==='aetheriusDevAttributes'?null:get(id,key);
  mp.set=(id,key,value)=>{if(key==='aetheriusAttributeBonuses'){assert(native,'never custom persistence fallback');bonus=value;writes.push({id,key,value});}
    else if(key==='aetheriusDevAttributes'){dev=value;writes.push({id,key,value});}else set?.(id,key,value);};
  const core=api.createGameplayCore({mp,pg:{init:()=>pgPool},log,env:{...developmentEnv,GAMEPLAY_CORE_MODE_CLASSES:'active',GAMEPLAY_CORE_DATABASE_SCHEMA:schema,GAMEPLAY_CORE_DEV_CLASS_LEVEL:'2',...env}});
  cores.push(core);await core.initialize();const binding=core.identity.lookup({actorId:91}).value;
  await until(()=>log.messages.some(m=>m.includes('attribute maximum writer=')));
  return {mp,core,binding,official,log,writes,base,maximum,set:classId=>core.setCharacterClass({binding,classId,requestId:randomBytes(8).toString('hex')})};
}
test('runtime: bound, after COMMIT, ready/respawn/reconnect, clear, stale epoch, class reset maximum',async()=>{
  let committed=0;const watched={async connect(){const c=await pool.connect();return {release:e=>c.release(e),async query(sql,params){const r=await c.query(sql,params);if(sql==='COMMIT')committed++;return r;}};}};
  const f=await fixture({pgPool:watched});await f.set('viper');let count=committed;
  const input={binding:f.binding,requestId:'runtime-allocate',health:5,magicka:5,stamina:5};const allocated=await f.core.allocateAttributes(input);
  assert.equal(allocated.status,'SUPPORTED');assert.equal(allocated.committed,true);assert(committed>count);
  assert.deepEqual(f.maximum(),{health:105,magicka:125,stamina:85});assert.equal(allocated.state.available,0);assert.deepEqual(allocated.state.maximum,f.maximum());
  const persisted=await stored(f.binding.characterKey),before=f.writes.length;
  f.core.actorEvents.clientLoading(f.binding);f.core.actorEvents.clientReady(f.binding);await until(()=>f.writes.length>before);
  const respawnBefore=f.writes.length;f.core.actorEvents.respawn(f.binding);f.core.actorEvents.clientReady(f.binding);await until(()=>f.writes.length>respawnBefore);
  assert.deepEqual(await stored(f.binding.characterKey),persisted);
  const old=f.binding;f.official.clear(91);f.core.identity.poll();assert.equal(f.writes.at(-1).value,null);
  f.official.authenticate(91);f.core.identity.poll();f.binding=f.core.identity.lookup({actorId:91}).value;assert.notEqual(f.binding.epoch,old.epoch);
  await until(()=>f.maximum().health===105);count=f.writes.length;
  assert.equal((await f.core.allocateAttributes({...input,binding:old,requestId:'stale-allocation'})).reason,'MODE_OR_STALE_BINDING');assert.equal(f.writes.length,count);
  assert.equal((await f.core.attributeState(old)).reason,'MODE_OR_STALE_BINDING');
  await f.core.setCharacterClass({binding:f.binding,classId:'guardiao',requestId:'runtime-reset'});
  assert.deepEqual(f.maximum(),f.base);assert.equal((await f.core.attributeState(f.binding)).spentTotal,0);
  await f.core.shutdown();assert.equal(f.writes.at(-1).value,null);
});
test('allocation and class reset publish only after COMMIT; failed COMMIT rolls back all domain facts',async()=>{
  let f,inspected=false,resetInspected=false,resetMaximum,fail=false;
  const watched={async connect(){const c=await pool.connect();return {release:e=>c.release(e),async query(sql,params){
    if(sql.startsWith('INSERT INTO gc_attribute_allocation')){assert.deepEqual(f.maximum(),f.base);inspected=true;}
    if(sql.startsWith('DELETE FROM gc_attribute_allocation')&&resetMaximum){assert.deepEqual(f.maximum(),resetMaximum);resetInspected=true;}
    if(sql==='COMMIT'&&fail)throw Error('INJECTED_COMMIT_FAILURE');return c.query(sql,params);
  }};}};
  f=await fixture({pgPool:watched});await f.set('viper');await until(()=>f.writes.length>0);const before=f.writes.length;fail=true;
  const rejected=await f.core.allocateAttributes({binding:f.binding,requestId:'commit-fails',health:5,magicka:0,stamina:0});
  assert.equal(rejected.status,'UNSUPPORTED');assert.equal(rejected.committed,false);assert(inspected);assert.equal(await stored(f.binding.characterKey),undefined);assert.equal(f.writes.length,before);fail=false;
  assert.equal((await f.core.allocateAttributes({binding:f.binding,requestId:'commit-succeeds',health:5,magicka:0,stamina:0})).committed,true);
  await f.core.awardLevelingXp({characterKey:f.binding.characterKey,epoch:f.binding.epoch,...xpInput('reset-rollback-progress')});
  const savedAllocation=await stored(f.binding.characterKey),savedProgress=(await pool.query('SELECT * FROM gc_leveling_progress WHERE character_key=$1',[f.binding.characterKey])).rows,
    savedClass=(await pool.query('SELECT * FROM gc_character_class WHERE character_key=$1',[f.binding.characterKey])).rows;
  resetMaximum={...f.maximum()};const resetWrites=f.writes.length;fail=true;
  assert.equal((await f.core.setCharacterClass({binding:f.binding,classId:'guardiao',requestId:'reset-commit-fails'})).status,'UNSUPPORTED');
  assert(resetInspected);assert.equal(f.writes.length,resetWrites);assert.deepEqual(f.maximum(),resetMaximum);
  assert.deepEqual(await stored(f.binding.characterKey),savedAllocation);
  assert.deepEqual((await pool.query('SELECT * FROM gc_leveling_progress WHERE character_key=$1',[f.binding.characterKey])).rows,savedProgress);
  assert.deepEqual((await pool.query('SELECT * FROM gc_character_class WHERE character_key=$1',[f.binding.characterKey])).rows,savedClass);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM gc_commands WHERE request_id=$1',['reset-commit-fails'])).rows[0].n,0);
  fail=false;assert.equal((await f.core.setCharacterClass({binding:f.binding,classId:'guardiao',requestId:'reset-commit-fails'})).status,'SUPPORTED');
  assert.deepEqual(f.maximum(),f.base);await f.core.shutdown();
});
test('host missing native property: declared UNSUPPORTED; allocation is durable; zero custom writes',async()=>{
  const f=await fixture({native:false});await f.set('viper');
  const result=await f.core.allocateAttributes({binding:f.binding,requestId:'legacy-allocate',health:5,magicka:0,stamina:0});
  assert.equal(result.committed,true);assert.equal(result.state.host.status,'UNSUPPORTED');assert.equal(result.state.maximum,null);
  assert.equal(f.writes.length,0);assert(f.log.messages.some(m=>m.includes('ATTRIBUTE_NATIVE_PROPERTY_UNAVAILABLE')));await f.core.shutdown();
});
test('DEV-A1 absolute writer remains identical; normal bonus is not published or stacked',async()=>{
  const f=await fixture({env:{GAMEPLAY_CORE_DEV_ATTRIBUTES:'300,300,300'}});await f.set('viper');
  await f.core.allocateAttributes({binding:f.binding,requestId:'dev-allocation',health:5,magicka:5,stamina:5});
  const s=await f.core.attributeState(f.binding);assert.deepEqual(s.maximum,{health:300,magicka:300,stamina:300});assert.equal(s.maximumOrigin,'DEV');
  assert(f.writes.every(w=>w.key==='aetheriusDevAttributes'));assert.deepEqual(f.maximum(),{health:300,magicka:300,stamina:300});
  await f.core.shutdown();assert.equal(f.writes.at(-1).value,null);
});
test('runtime removing DEV suppresses bonus without altering saved allocation; explanation states reason',async()=>{
  const f=await fixture({env:{GAMEPLAY_CORE_DEV_CLASS_LEVEL:'40'}});await f.set('viper');await f.core.allocateAttributes({binding:f.binding,requestId:'dev585',health:585,magicka:0,stamina:0});
  const saved=await stored(f.binding.characterKey);await f.core.shutdown();
  const next=api.createGameplayCore({mp:f.mp,pg:{init:()=>pool},log:f.log,env:{...developmentEnv,GAMEPLAY_CORE_MODE_CLASSES:'active',GAMEPLAY_CORE_DATABASE_SCHEMA:schema}});
  cores.push(next);await next.initialize();const b=next.identity.lookup({actorId:91}).value;
  const s=await next.attributeState(b);assert.equal(s.reason,'ATTRIBUTE_ALLOCATION_EXCEEDS_LEVEL');assert.deepEqual(s.maximum,f.base);assert.deepEqual(await stored(b.characterKey),saved);
  assert(f.log.messages.some(m=>m.includes('ATTRIBUTE_ALLOCATION_EXCEEDS_LEVEL')));await next.shutdown();
});
test('staff CLI uses same command and DEV guard; persisted delta and request replay',async()=>{
  const key='profile:995007';await commands(key);const pgPath=root+'/../aetherius-server/server/gamemode/core/pg.js';
  const cli=(script,args,extra={})=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,['runtime/'+script,...args],{cwd:root,env:{...process.env,GAME_DATABASE_URL:process.env.AETHERIUS_TEST_DATABASE_URL,...extra},stdio:['ignore','pipe','pipe']});let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.on('error',reject);child.on('close',code=>resolve({code,out,err}));});
  const args=[pgPath,key,'5','5','5',schema,'staff-c3d'],env={...developmentEnv,GAMEPLAY_CORE_DEV_CLASS_LEVEL:'2'};
  const a=await cli('allocate-attributes.mjs',args,env),b=await cli('allocate-attributes.mjs',args,env);
  assert.equal(a.code,0,a.err);assert.equal(JSON.parse(b.out).receipt.replayed,true);
  const explain=await cli('explain-character.mjs',[pgPath,key,schema],env);assert.equal(explain.code,0,explain.err);
  assert.equal(JSON.parse(explain.out).attributes.available,0);assert.equal(JSON.parse(explain.out).attributes.levelOrigin,'DEV');
  const refused=await cli('allocate-attributes.mjs',[...args.slice(0,-1),'production-denied'],{NODE_ENV:'production',GAMEPLAY_CORE_DEV_CLASS_LEVEL:'2'});
  assert.equal(refused.code,1);assert(refused.err.includes('refused'));
});

test('invalid row inserted directly in PostgreSQL is declared, suppressed, retained and cannot be allocated',async()=>{
  const f=await fixture();await f.set('viper');
  await f.core.allocateAttributes({binding:f.binding,requestId:'valid-before-corruption',health:5,magicka:0,stamina:0});
  assert.equal(f.maximum().health,f.base.health+5);
  for(const [health,stamina,revision] of [[-5,0,1],[0,1,1],[0,0,0]]){
    await pool.query('UPDATE gc_attribute_allocation SET health=$2,magicka=0,stamina=$3,revision=$4 WHERE character_key=$1',[f.binding.characterKey,health,stamina,revision]);
    const saved=await stored(f.binding.characterKey),read=await f.core.attributeState(f.binding);
    assert.equal(read.status,'UNSUPPORTED');assert.equal(read.reason,'ATTRIBUTE_ALLOCATION_INVALID');assert.equal(read.applicable,false);assert.deepEqual(read.maximum,f.base);
    const before=f.writes.length;f.core.actorEvents.clientLoading(f.binding);f.core.actorEvents.clientReady(f.binding);
    await until(()=>f.writes.length>before);assert.deepEqual(f.maximum(),f.base);assert.equal(f.writes.at(-1).value,null);
    const result=await f.core.allocateAttributes({binding:f.binding,requestId:randomBytes(8).toString('hex'),health:5,magicka:0,stamina:0});
    assert.equal(result.status,'UNSUPPORTED');assert.equal(result.reason,'ATTRIBUTE_ALLOCATION_INVALID');assert.equal(result.committed,false);
    const explanation=await utils.withTransaction(pool,tx=>utils.explainCharacter(tx,f.binding.characterKey,load('catalog/standing-stones.json'),load('catalog/races.json'),load('modules/race-system/ownership.json'),data,2));
    assert.equal(explanation.attributes.reason,'ATTRIBUTE_ALLOCATION_INVALID');assert.equal(explanation.attributes.status,'UNSUPPORTED');
    assert.deepEqual(await stored(f.binding.characterKey),saved);
  }
  assert(f.log.messages.some(m=>m.includes('ATTRIBUTE_ALLOCATION_INVALID')));await f.core.shutdown();
});
