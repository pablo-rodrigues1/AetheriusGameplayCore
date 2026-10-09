import assert from 'node:assert/strict';
import {test,before,after} from 'node:test';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {setTimeout as realDelay} from 'node:timers/promises';
import {build} from 'esbuild';
import {classHost} from './class-host.mjs';
import {logger} from './host.mjs';
import {developmentEnv} from './development-env.mjs';
import {officialHost} from './official-host.mjs';
const require=createRequire(import.meta.url),{Pool}=require('pg'),coreApi=require('../../dist/aetherius-gameplay-core.cjs');
const root=fileURLToPath(new URL('../../',import.meta.url)),load=name=>JSON.parse(readFileSync(`${root}/${name}`,'utf8'));
const classes=load('catalog/classes.json'),stones=load('catalog/standing-stones.json'),races=load('catalog/races.json');
const compiled=await build({absWorkingDir:root,stdin:{loader:'ts',resolveDir:root,contents:`
  export {readMigrations,applyMigrations,withTransaction} from './shared/persistence/src/index.ts';
  export {scopedPool} from './runtime/src/persistence-scope.ts';
  export {explainCharacter,definitionCatalog} from './runtime/src/explanation.ts';
  export {compose,diff,effectiveSet} from './modules/actor-state-system/src/index.ts';
  export {buildClasses} from './tools/catalog/classes.ts';
  export {loadDomain} from './shared/record-catalog/src/index.ts';
  export {ConfigLoader} from './modules/leveling-system/src/config/loader.mjs';
`},bundle:true,platform:'node',format:'esm',write:false});
const api=await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const url=new URL(process.env.AETHERIUS_TEST_DATABASE_URL??'missing:');
assert(['localhost','127.0.0.1','[::1]'].includes(url.hostname)&&url.pathname==='/aetherius_test','Only local aetherius_test');
const schema=`gc_c3a_${process.pid}_${randomBytes(4).toString('hex')}`,pool=new Pool({connectionString:process.env.AETHERIUS_TEST_DATABASE_URL,max:8,idleTimeoutMillis:0,options:`-c search_path=${schema},pg_catalog`}),cores=[];
let configs,profile=96000;
before(async()=>{await pool.query(`CREATE SCHEMA "${schema}"`);await api.applyMigrations(pool,await api.readMigrations(`${root}/database/migrations`),schema);
  const result=await new api.ConfigLoader(`${root}/modules/leveling-system`).load();assert.notEqual(result.status,'NOT_READY');configs=result.configs;});
after(async()=>{await Promise.all(cores.map(c=>c.shutdown()));await pool.query(`DROP SCHEMA "${schema}" CASCADE`);await pool.end();});
async function setup(t,{offlineMode=false,mode='active',env={},stoneMode='off',raceMode='off',pgPool=pool,weaponPoison=false}={}){
  t.mock.timers.enable({apis:['setInterval','setTimeout']});const mp=classHost({catalogAvailable:true,offlineMode}),log=logger();mp.profiles.set(91,++profile);
  // D-P1 native shape from PoisonDoseBinding: numeric transient value on mp.set.
  if(weaponPoison){const settings=mp.getServerSettings;mp.getServerSettings=()=>({...settings(),aetheriusCombat:{weaponPoison:true}});
    mp.poisonDoses=[];const prior=mp.set;mp.set=(id,prop,value)=>prop==='aetheriusPoisonDoseBonus'?mp.poisonDoses.push({id,value}):prior?.(id,prop,value);}
  mp.appearances.set(91,{raceId:mp.ids.get('skyrim.esm|013746')});
  const core=coreApi.createGameplayCore({mp,pg:{init:()=>pgPool},log,env:{...developmentEnv,GAMEPLAY_CORE_DATABASE_SCHEMA:schema,GAMEPLAY_CORE_ALLOW_OFFLINE_IDENTITY:offlineMode?'true':undefined,GAMEPLAY_CORE_MODE_CLASSES:mode,GAMEPLAY_CORE_MODE_STANDING_STONES:stoneMode,GAMEPLAY_CORE_MODE_RACES:raceMode,...env}});
  cores.push(core);t.after(()=>core.shutdown());await core.initialize();const binding=core.identity.lookup({actorId:91}).value;
  return {mp,log,core,binding,set:classId=>core.setCharacterClass({binding,classId,requestId:randomBytes(8).toString('hex')})};
}
const progress=async key=>(await pool.query('SELECT * FROM gc_leveling_progress WHERE character_key=$1',[key])).rows[0];
const vector=n=>({facts:n,grants:n,equipment:0,effects:0,catalog:1});
function event(id,category='dragon_priest'){return {contractVersion:1,eventId:id,occurredAt:Date.UTC(2026,9,8,12),victimId:800,killerId:91,
  enemy:{contractVersion:1,managed:true,stableEnemyIdentity:'skyrim.esm|000001',enemyFamily:category.toUpperCase(),spawnRole:'BOSS_UNIQUE',combatLevel:20,xpEligible:true,xpCategory:category,sourcePlugin:'Skyrim.esm',winningOverridePlugin:'Skyrim.esm',sourceRecordIdentity:'skyrim.esm|000001'},
  progressionContext:{contractVersion:1,sourceType:'OTHER',sourceId:'c3a-test',recommendedClassMin:1,recommendedClassMax:40,status:'ASSIGNED',valid:true},contributors:[]};}
const party={source:'SERVER',center:{cell:'test-cell',position:[0,0,0]},members:[{id:91,isOnline:true,cellOrWorldDesc:'test-cell',pos:[0,0,0]}],isRaid:false};
const award=(adapter,key,id,category)=>adapter.award({characterKey:key,epoch:'test',eventName:'aetherius.enemy.killed.v1',event:event(id,category),recipientId:91,partySnapshot:party});
test('catalog deterministic, preserves every old signature, dynamically resolves reordered plugins',()=>{
  const plugins=[...new Map([classes,stones,races].flatMap(d=>d.dependencies).map(p=>[p.filename.toLowerCase(),p])).values()];
  const exportsDir=process.env.GAMEPLAY_CORE_TEST_EXPORTS,config=`${root}/modules/class-system/config/classes-config.json`;
  const generated=api.buildClasses(exportsDir,config,plugins);assert.deepEqual(generated,classes);assert.deepEqual(api.buildClasses(exportsDir,config,[...plugins].reverse()),classes);
  for(const old of [...stones.records,...races.records]){const current=classes.records.find(r=>r.stableFormKey===old.stableFormKey);if(current)assert.equal(current.signature,old.signature);}
  const corrected=['Heavy Armor Mastery','Rune Master','Animage (1)','Animage (2)','Animage (3)','One-Handed Mastery'];
  const classPerks=classes.classes.flatMap(c=>c.stages.flatMap(s=>s.perks));
  const labels=classPerks.map(p=>p.label);
  for(const label of corrected)assert(labels.includes(label),`corrected perk label missing: ${label}`);
  assert(!classPerks.some(p=>p.status==='UNSUPPORTED'&&corrected.includes(p.label)));
  const rune=classPerks.find(p=>p.label==='Rune Master');
  assert.equal(rune.rank,1,'unranked Rune Master label maps to the assumed rank 1 record');
  const animage=classPerks.filter(p=>/^Animage \([123]\)$/.test(p.label));
  assert.deepEqual(animage.map(p=>p.rank),[1,2,3]);
  function host(reverse){const ids=new Map(),types=new Map();let n=10000;for(const r of reverse?[...classes.records].reverse():classes.records){ids.set(r.stableFormKey,++n);types.set(n,r.recordType);}
    return {plugins:()=>reverse?[...classes.dependencies].reverse():classes.dependencies,getIdFromDesc:d=>{const [hex,p]=d.split(':');return ids.get(`${p.toLowerCase()}|${hex.padStart(6,'0').toUpperCase()}`);},lookupEspmRecordById:id=>({type:types.get(id)})};}
  const a=api.loadDomain(classes,host(false)),b=api.loadDomain(classes,host(true));assert.equal(a.status,'SUPPORTED');assert.equal(b.status,'SUPPORTED');
  assert.deepEqual(a.records.map(r=>r.definition),b.records.map(r=>r.definition));assert(a.records.some(r=>r.runtimeFormId!==b.byKey(r.definition.stableFormKey).runtimeFormId));
});
test('real PostgreSQL: durable XP sequence, curve, event replay and concurrent events',async()=>{
  const key='profile:97001',adapter=coreApi.createDurableLeveling(pool,configs);let total=0,last;
  const fixed=configs.enemyBaseXp.profiles.find(p=>p.eventXpCategories.includes('dragon_priest')).fixedXp;
  for(let i=0;i<10;i++){last=await award(adapter,key,`sequence-${i}`);assert.equal(last.status,'accepted');total+=last.result.xpAwarded;assert.equal(last.result.xpAwarded,fixed);
    const expected=1+configs.levelProgression.levels.filter(l=>l.totalAccumulated<=total).length;assert.equal(last.result.level,expected);assert.equal(last.result.totalXp,total);}
  const prior=await progress(key),replay=await award(adapter,key,'sequence-9');assert.equal(replay.replayed,true);assert.deepEqual(await progress(key),prior);
  assert(!('unspentAttributePoints' in prior.progress));assert(!('classId' in prior.progress));
  const concurrent=await Promise.all([award(adapter,key,'concurrent'),award(adapter,key,'concurrent')]);assert.equal(concurrent.filter(r=>!r.replayed).length,1);
  const two=await Promise.all([award(adapter,key,'distinct-1'),award(adapter,key,'distinct-2')]);assert(two.every(r=>r.status==='accepted'));assert.equal(Number((await progress(key)).total_xp),total+fixed*3);
});
test('durable leveling uses normal scaling/relevance/fatigue and refuses unsupported event evidence',async()=>{
  const adapter=coreApi.createDurableLeveling(pool,configs),key='profile:97002';
  const result=await award(adapter,key,'scaled','bandit');assert.equal(result.status,'accepted');assert.equal(result.result.calculation.awardMode,'SCALED');
  const invalid=event('invalid');invalid.finalXp=999;await assert.rejects(()=>adapter.award({characterKey:key,epoch:'test',eventName:'aetherius.enemy.killed.v1',event:invalid,recipientId:91,partySnapshot:party}),/INVALID/);
  await assert.rejects(()=>award(adapter,key,'unknown','not_in_catalog'));assert.equal((await progress(key)).revision,'1');
  const conflict=await adapter.award({characterKey:key,epoch:'new-epoch',eventName:'aetherius.enemy.killed.v1',event:{...event('scaled','bandit'),occurredAt:1},recipientId:91,partySnapshot:party});assert.equal(conflict.status,'conflict');
});
test('separate process preserves progress',async()=>{
  const code=`const {Pool}=require('pg');const p=new Pool({connectionString:process.env.AETHERIUS_TEST_DATABASE_URL});p.query('SELECT total_xp,character_level,revision FROM "${schema}".gc_leveling_progress WHERE character_key=$1',['profile:97001']).then(r=>console.log(JSON.stringify(r.rows[0]))).finally(()=>p.end());`;
  const output=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['-e',code],{cwd:root,env:process.env,stdio:['ignore','pipe','pipe']});let text='';child.stdout.on('data',b=>text+=b);child.on('error',reject);child.on('close',exit=>exit===0?resolve(text):reject(Error('CHILD_READ_FAILED')));});
  const prior=await progress('profile:97001'),row=JSON.parse(output);assert.equal(row.total_xp,prior.total_xp);assert.equal(row.character_level,prior.character_level);assert.equal(row.revision,prior.revision);
});
test('class command idempotent, default level 1, switching preserves progress and diffs grants',async t=>{
  const f=await setup(t);const result=await f.set('elementalista');assert.equal(result.status,'SUPPORTED');
  const before=await f.core.inspectActor(f.binding);assert.equal(before.grants.length,4);assert.equal(await progress(f.binding.characterKey),undefined);
  const input={binding:f.binding,classId:'elementalista',requestId:'staff-replay'};assert.equal((await f.core.setCharacterClass(input)).receipt.replayed,false);assert.equal((await f.core.setCharacterClass({...input,binding:{...f.binding,epoch:f.binding.epoch}})).receipt.replayed,true);
  assert.equal((await f.set('guardiao')).status,'SUPPORTED');const next=await f.core.inspectActor(f.binding);const delta=api.diff(before,next);assert(delta.added.length>0&&delta.removed.length>0);assert.equal(await progress(f.binding.characterKey),undefined);assert.equal(f.mp.mutations().length,0);
});
test('D-P1: viper DEV40 reenters on ready, class switch clears bonus, stale epoch refused',async t=>{
  const f=await setup(t,{offlineMode:true,env:{GAMEPLAY_CORE_DEV_CLASS_LEVEL:'40'},weaponPoison:true});
  assert.equal((await f.set('viper')).status,'SUPPORTED');assert.equal(f.mp.poisonDoses.at(-1).value,6);
  f.mp.poisonDoses.length=0;t.mock.timers.tick(3000);
  for(let i=0;i<200&&!f.mp.poisonDoses.length;i++)await realDelay(10);
  assert.equal(f.mp.poisonDoses.at(-1).value,6,'actor-ready must redeliver');
  assert.equal((await f.set('guardiao')).status,'SUPPORTED');assert.equal(f.mp.poisonDoses.at(-1).value,0);
  const n=f.mp.poisonDoses.length;
  assert.equal((await f.core.setCharacterClass({binding:{...f.binding,epoch:'stale'},classId:'viper',requestId:'stale-poison'})).status,'UNSUPPORTED');
  assert.equal(f.mp.poisonDoses.length,n);await f.core.shutdown();assert.equal(f.mp.poisonDoses.at(-1).value,0);
});
test('XP level up appends milestones on fresh composition, preserves class on process rehydration',async t=>{
  const f=await setup(t);await f.set('elementalista');const before=await f.core.inspectActor(f.binding),adapter=coreApi.createDurableLeveling(pool,configs);
  for(let i=0;i<4;i++)await award(adapter,f.binding.characterKey,`milestone-${i}`);
  const state=await progress(f.binding.characterKey),next=await f.core.inspectActor(f.binding);assert(state.character_level>=5);assert(next.grants.length>before.grants.length);assert.equal(api.diff(before,next).removed.length,0);
  await f.set('guardiao');assert.deepEqual(await progress(f.binding.characterKey),state);assert.equal(f.mp.mutations().length,0);
});
test('DEV 40: all milestones, warning/capability/explanation, no XP row; remove returns level 1',async t=>{
  const f=await setup(t,{offlineMode:true,env:{GAMEPLAY_CORE_DEV_CLASS_LEVEL:'40'}});assert.equal((await f.set('elementalista')).status,'SUPPORTED');
  assert.equal((await f.core.inspectActor(f.binding)).grants.length,19);assert.equal(await progress(f.binding.characterKey),undefined);assert(f.log.messages.some(m=>m.includes('DEV')));
  const capability=f.core.capabilityReport().systems.find(s=>s.id==='classes');assert.equal(capability.levelOrigin,'DEV');assert.equal(capability.devClassLevel,40);assert.equal(capability.perkDelivery.status,'UNSUPPORTED');
  const explain=await api.withTransaction(pool,tx=>api.explainCharacter(tx,f.binding.characterKey,stones,races,load('modules/race-system/ownership.json'),classes,40));
  assert.equal(explain.facts.level.origin,'DEV');assert(explain.classMilestones.every(s=>s.reached));assert(explain.grants.every(g=>g.delivery.includes('PERK_MIGRATION_UNAVAILABLE')));
  const actual=await api.withTransaction(pool,tx=>api.explainCharacter(tx,f.binding.characterKey,stones,races,[],classes));assert.equal(actual.facts.level.level,1);assert.equal(actual.grants.length,4);assert.equal(actual.facts.level.origin,'LEVELING_DEFAULT');
  assert.equal(f.core.capabilityReport().systems.find(s=>s.id==='leveling').status,'UNSUPPORTED');assert.equal(f.mp.mutations().length,0);
});
test('DEV read preserves existing XP/fatigue; removal restores durable level',async()=>{
  const key='profile:97001',before=await progress(key),port=coreApi.withDevelopmentLevel(coreApi.levelingLevelPort,40);
  const decorated=await api.withTransaction(pool,tx=>port.read(tx,key));assert.equal(decorated.level,40);assert.equal(decorated.origin,'DEV');
  assert.deepEqual(await progress(key),before);
  const real=await api.withTransaction(pool,tx=>coreApi.levelingLevelPort.read(tx,key));assert.equal(real.level,before.character_level);assert.equal(real.origin,'LEVELING');
});
for(const [nodeEnv,raw] of [['production','40'],['local','41'],['local','bad']])test(`boot refuses DEV=${raw} NODE_ENV=${nodeEnv}; stones retain support`,async t=>{
  const f=await setup(t,{env:{NODE_ENV:nodeEnv,GAMEPLAY_CORE_DEV_CLASS_LEVEL:raw},stoneMode:'active'});
  const c=f.core.capabilityReport().systems.find(s=>s.id==='classes');assert.equal(c.status,'UNSUPPORTED');assert.equal(c.started,false);assert(f.log.messages.some(m=>m.includes('ERROR')));
  assert.equal((await f.set('elementalista')).status,'UNSUPPORTED');assert.equal((await f.core.inspectActor(f.binding)).grants.length,0);assert.equal(f.core.capabilityReport().systems.find(s=>s.id==='standing-stones').status,'SUPPORTED');
});
test('perks remain unsupported; standing stone spell differences unchanged; zero perk host calls',async t=>{
  const f=await setup(t,{offlineMode:true,env:{GAMEPLAY_CORE_DEV_CLASS_LEVEL:'40'},stoneMode:'active',raceMode:'active'});await f.core.observeRace(f.binding);await f.set('elementalista');
  t.mock.timers.tick(3000);
  for(const stoneKey of ['skyrim.esm|0D232D','skyrim.esm|0D232E'])assert.equal((await f.core.chooseStandingStone({binding:f.binding,stoneKey,requestId:randomBytes(8).toString('hex')})).status,'SUPPORTED');
  assert.deepEqual(f.mp.mutations().map(c=>c.method),['AddSpell','RemoveSpell','AddSpell']);assert(!f.mp.calls.some(c=>/Perk/.test(c.method)));
});
test('same record from RACE and CLASS has two origins; class switch revokes only CLASS',()=>{
  const catalog=api.definitionCatalog(classes),classGrant=coreApi.classGrants(classes,catalog,{classId:'elementalista',revision:1},1)[0];
  const racial={...classGrant,source:{kind:'RACE',key:races.roots[0]}};
  const before=api.compose('profile:1',[[classGrant],[racial]],vector(1)),next=api.compose('profile:1',[[racial]],vector(2));
  assert.equal(api.effectiveSet(before).grants.length,1);assert.equal(api.effectiveSet(before).grants[0].sources.length,2);assert.equal(api.diff(before,next).removed.length,0);assert.equal(api.diff(before,next).changed.length,1);
});
for(const mode of ['off','audit','shadow'])test(`${mode}: existing class does not enter composition`,async t=>{
  const f=await setup(t,{mode});await coreApi.createClassCommands(pool,classes).set({characterKey:f.binding.characterKey,epoch:'staff',classId:'elementalista',requestId:randomBytes(8).toString('hex')});
  assert.equal((await f.core.inspectActor(f.binding)).grants.length,0);assert.equal((await f.set('guardiao')).status,'UNSUPPORTED');assert.equal(f.mp.mutations().length,0);
});
test('canary: only allowlisted durable class enters composition and commands',async t=>{
  const excluded=await setup(t,{mode:'canary'});await coreApi.createClassCommands(pool,classes).set({characterKey:excluded.binding.characterKey,epoch:'staff',classId:'elementalista',requestId:randomBytes(8).toString('hex')});
  assert.equal((await excluded.core.inspectActor(excluded.binding)).grants.length,0);assert.equal((await excluded.set('guardiao')).status,'UNSUPPORTED');
  await excluded.core.shutdown();t.mock.timers.reset();
  const included=await setup(t,{mode:'canary',env:{GAMEPLAY_CORE_CANARY_CHARACTERS:`profile:${profile+1}`}});assert.equal((await included.set('elementalista')).status,'SUPPORTED');assert.equal((await included.core.inspectActor(included.binding)).grants.length,4);
});
test('class transaction rollback leaves no fact or command receipt; conflicting request rejected',async()=>{
  const key='profile:97004',requestId='rollback-class';
  const failPool={async connect(){const client=await pool.connect();return {release:e=>client.release(e),query:(sql,params)=>sql.startsWith('INSERT INTO gc_commands')?Promise.reject(Error('INJECTED_WRITE_FAILURE')):client.query(sql,params)};}};
  await assert.rejects(()=>coreApi.createClassCommands(failPool,classes).set({characterKey:key,epoch:'staff',classId:'elementalista',requestId}),/INJECTED/);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM gc_character_class WHERE character_key=$1',[key])).rows[0].n,0);
  const commands=coreApi.createClassCommands(pool,classes),input={characterKey:key,epoch:'staff',classId:'elementalista',requestId};
  assert.equal((await commands.set(input)).replayed,false);assert.equal((await commands.set({...input,classId:'guardiao'})).status,'conflict');
});
test('staff and explain CLI against real test DB, request replay and DEV environment proof',async()=>{
  const pgPath=fileURLToPath(new URL('../../../aetherius-server/server/gamemode/core/pg.js',import.meta.url));
  async function cli(script,args,env={}){return new Promise((resolve,reject)=>{const child=spawn(process.execPath,[`runtime/${script}`,...args],{cwd:root,env:{...process.env,NODE_ENV:undefined,GAME_ACCESS_CONTROL:undefined,GAMEPLAY_CORE_ALLOW_DEV_OPTIONS:undefined,GAME_DATABASE_URL:process.env.AETHERIUS_TEST_DATABASE_URL,...env},stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',b=>output+=b);child.on('error',reject);child.on('close',code=>resolve({code,output}));});}
  const args=[pgPath,'profile:97003','elementalista',schema,'cli-request'];const a=await cli('set-character-class.mjs',args),b=await cli('set-character-class.mjs',args);assert.equal(a.code,0);assert.equal(b.code,0);assert.equal(JSON.parse(b.output).replayed,true);
  const read=await cli('explain-character.mjs',[pgPath,'profile:97003',schema]);assert.equal(read.code,0);assert.equal(JSON.parse(read.output).facts.class.classId,'elementalista');
  const denied=await cli('explain-character.mjs',[pgPath,'profile:97003',schema],{GAMEPLAY_CORE_DEV_CLASS_LEVEL:'40'});assert.equal(denied.code,1);
  const dev=await cli('explain-character.mjs',[pgPath,'profile:97003',schema],{...developmentEnv,GAMEPLAY_CORE_DEV_CLASS_LEVEL:'40',GAME_ACCESS_CONTROL:undefined});
  assert.equal(dev.code,0);assert.equal(JSON.parse(dev.output).facts.level.origin,'DEV');assert.equal(JSON.parse(dev.output).grants.length,19);assert.equal(await progress('profile:97003'),undefined);
});

test('official production offline login: accidental DEV 40 disables only classes; authenticated stones/races act; replacement invalidates commands',async t=>{
  t.mock.timers.enable({apis:['setInterval','setTimeout']});
  const mp=classHost({catalogAvailable:true,offlineMode:true}),log=logger();mp.profiles.set(91,++profile);
  mp.appearances.set(91,{raceId:mp.ids.get('skyrim.esm|013746')});
  const official=officialHost(mp);official.authenticate(91);
  const core=coreApi.createGameplayCore({mp,pg:{init:()=>pool},log,env:{NODE_ENV:'production',GAME_ACCESS_CONTROL:'true',
    GAMEPLAY_CORE_DATABASE_SCHEMA:schema,GAMEPLAY_CORE_MODE_CLASSES:'active',GAMEPLAY_CORE_MODE_STANDING_STONES:'active',
    GAMEPLAY_CORE_MODE_RACES:'active',GAMEPLAY_CORE_DEV_CLASS_LEVEL:'40'}});
  cores.push(core);t.after(()=>core.shutdown());await core.initialize();
  const binding=core.identity.lookup({actorId:91}).value;assert(binding);
  await coreApi.createClassCommands(pool,classes).set({characterKey:binding.characterKey,epoch:'staff',classId:'elementalista',requestId:randomBytes(8).toString('hex')});
  const c=core.capabilityReport().systems.find(s=>s.id==='classes');assert.equal(c.status,'UNSUPPORTED');assert.equal(c.started,false);assert.equal(c.devClassLevel,null);
  assert(log.messages.some(m=>m.includes('ERROR')&&m.includes('GAMEPLAY_CORE_DEV_CLASS_LEVEL')&&m.includes('NODE_ENV')));
  assert.equal((await core.setCharacterClass({binding,classId:'guardiao',requestId:'official-refused'})).status,'UNSUPPORTED');
  assert.equal((await core.observeRace(binding)).status,'SUPPORTED');
  t.mock.timers.tick(3000);
  assert.equal((await core.chooseStandingStone({binding,stoneKey:'skyrim.esm|0D232D',requestId:'official-stone'})).status,'SUPPORTED');
  assert.equal((await core.inspectActor(binding)).grants.filter(g=>g.source.kind==='CLASS').length,0);
  assert.equal(await progress(binding.characterKey),undefined);
  assert(mp.mutations().some(call=>call.method==='AddSpell'));
  for(const id of ['standing-stones','races'])assert.equal(core.capabilityReport().systems.find(s=>s.id===id).status,'SUPPORTED');
  official.authenticate(91);assert.equal(core.identity.isCurrent(binding),false);
  assert.equal((await core.chooseStandingStone({binding,stoneKey:'skyrim.esm|0D232E',requestId:'old-official'})).status,'UNSUPPORTED');
  core.identity.poll();const next=core.identity.lookup({actorId:91}).value;assert.notEqual(next.epoch,binding.epoch);
  assert.equal((await core.observeRace(next)).status,'SUPPORTED');
  await core.shutdown();
  // Removing the accidental option restores the real level and the stored class,
  // still authenticated in offlineMode=true, without any development flags.
  const restored=coreApi.createGameplayCore({mp,pg:{init:()=>pool},log,env:{NODE_ENV:'production',GAME_ACCESS_CONTROL:'true',
    GAMEPLAY_CORE_DATABASE_SCHEMA:schema,GAMEPLAY_CORE_MODE_CLASSES:'active'}});
  cores.push(restored);t.after(()=>restored.shutdown());await restored.initialize();
  const live=restored.identity.lookup({actorId:91}).value;assert(live);
  assert.equal(restored.capabilityReport().systems.find(s=>s.id==='classes').started,true);
  assert.equal((await restored.inspectActor(live)).grants.filter(g=>g.source.kind==='CLASS').length,4);
  assert.equal(await progress(live.characterKey),undefined);
});
