import assert from 'node:assert/strict';
import {test,before,after} from 'node:test';
import {createRequire} from 'node:module';
import {randomBytes} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {api,utils,root,load,perkMigration} from './b5b-source.mjs';
import {classHost} from './class-host.mjs';
import {officialHost} from './official-host.mjs';
import {logger} from './host.mjs';
import {developmentEnv} from './development-env.mjs';
import {client} from './perk-client.mjs';
import {xpInput} from './xp-event.mjs';
const {Pool}=createRequire(import.meta.url)('pg'),url=new URL(process.env.AETHERIUS_TEST_DATABASE_URL??'missing:');
assert(['localhost','127.0.0.1','[::1]'].includes(url.hostname)&&url.pathname==='/aetherius_test','Only local aetherius_test');
const schema='gc_c3c_xp_'+randomBytes(8).toString('hex'),pool=new Pool({connectionString:process.env.AETHERIUS_TEST_DATABASE_URL,max:8,connectionTimeoutMillis:2000,options:'-c search_path='+schema+',pg_catalog'});
const data=load('catalog/classes.json'),cores=[];let profile=994000;
before(async()=>{await pool.query('CREATE SCHEMA "'+schema+'"');await utils.applyMigrations(pool,[...await utils.readMigrations(root+'/database/migrations'),perkMigration],schema);});
after(async()=>{await Promise.all(cores.map(c=>c.shutdown()));await pool.query('DROP SCHEMA "'+schema+'" CASCADE');await pool.end();});
async function until(fn){const end=performance.now()+10000;while(!(await fn())){assert(performance.now()<end,'XP delivery timeout');await delay(5);}}
async function fixture({env={},pgPool=pool}={}){
  const mp=classHost({catalogAvailable:true,offlineMode:true}),log=logger(),c=client(),packets=[],acks=[];
  mp.profiles.set(91,++profile);mp.getUserActor=user=>[...mp.users].find(([actor,u])=>u===user&&mp.online.includes(actor))?.[0]??0;
  const official=officialHost(mp);official.authenticate(91);
  mp.sendCustomPacket=(user,raw)=>{const p=JSON.parse(raw);packets.push(p);c.receive(p);};
  c.emitter.on('sendMessage',e=>{const p=JSON.parse(e.message.contentJsonDump);if(p.type==='ack')acks.push(p);mp.emitter.emit('customPacket',0,e.message.contentJsonDump);});
  for(const r of data.records)c.register({stableFormKey:r.stableFormKey});const barrier=c.spawn();
  const core=api.createGameplayCore({mp,pg:{init:()=>pgPool},log,env:{...developmentEnv,GAMEPLAY_CORE_DATABASE_SCHEMA:schema,GAMEPLAY_CORE_MODE_CLASSES:'active',GAMEPLAY_CORE_CLIENT_PERKS_MODE:'active',...env}});
  cores.push(core);await core.initialize();const binding=core.identity.lookup({actorId:91}).value;
  await core.setCharacterClass({binding,classId:'elementalista',requestId:randomBytes(8).toString('hex')});
  for(const task of ['spells','appearance','equipment','placement'])barrier.complete(task);
  await until(()=>{c.update();return core.refreshClass&&acks.length&&log.messages.some(l=>l.includes('CONFIRMED'));});
  return {core,binding,mp,official,c,packets,acks,log,
    award:(id,category)=>core.awardLevelingXp({characterKey:binding.characterKey,epoch:binding.epoch,...xpInput(id,category)}),
    async confirm(n){await until(()=>{c.update();return acks.length>=n&&log.messages.filter(l=>l.includes('CONFIRMED')).length>=n;});}};
}
const keysAt=level=>new Set(data.classes.find(c=>c.id==='elementalista').stages.filter(s=>s.level<=level).flatMap(s=>s.perks.map(p=>p.stableFormKey)));
const progress=async key=>(await pool.query('SELECT * FROM gc_leveling_progress WHERE character_key=$1',[key])).rows[0];

test('online XP enters the runtime, commits then refreshes; only new milestone perks are added without reentry; event replay has no delivery or revision',async()=>{
  const f=await fixture();let receipt;
  for(let i=0;i<4;i++){
    const n=f.acks.length;receipt=await f.award('online-'+i);assert.equal(receipt.status,'accepted');
    if(receipt.result.oldLevel!==receipt.result.level)await f.confirm(n+1);
  }
  assert(receipt.result.oldLevel<5&&receipt.result.level>=5);
  const last=f.acks.at(-1);assert.deepEqual(new Set(last.items.filter(i=>i.action==='ensure').map(i=>i.key)),keysAt(receipt.result.level));
  assert.deepEqual(new Set(f.c.calls.filter(c=>c[0]==='add').map(c=>c[1])),keysAt(receipt.result.level));
  assert(f.c.calls.every(c=>c[0]==='add'));assert.equal(f.c.calls.length,keysAt(receipt.result.level).size);
  const before=await progress(f.binding.characterKey),count=f.packets.length,rev=(await f.core.inspectActor(f.binding)).revision;
  const repeated=await f.award('online-3');assert(repeated.replayed);assert.equal(f.packets.length,count);assert.deepEqual(await progress(f.binding.characterKey),before);assert.deepEqual((await f.core.inspectActor(f.binding)).revision,rev);
  const concurrent=await Promise.all([f.award('replay-concurrent'),f.award('replay-concurrent')]);assert.equal(concurrent.filter(r=>!r.replayed).length,1);
  const cap=f.core.capabilityReport().systems.find(s=>s.id==='leveling');assert.equal(cap.status,'UNSUPPORTED');assert.equal(cap.eventSource.reason,'SERVER_CONFIRMED_DEATH_OWNER_NOT_DECIDED');assert.equal(cap.entryPoint.name,'awardLevelingXp');assert.equal(cap.entryPoint.caller,'NONE');
  await f.core.shutdown();
});

test('no projection before XP COMMIT; replacement epoch while commit is waiting receives no stale delivery',async()=>{
  let armed=false,release,reached=false;
  const gate=new Promise(resolve=>release=resolve),pgPool={async connect(){const c=await pool.connect();return {release:e=>c.release(e),async query(sql,params){
    if(armed&&sql==='COMMIT'){armed=false;reached=true;await gate;}return c.query(sql,params);
  }};}};
  const f=await fixture({pgPool});const count=f.packets.length,oldSession=f.packets.find(p=>p.type==='hello').session,oldPerks=f.packets.filter(p=>p.type==='perks'&&p.session===oldSession).length;armed=true;
  const task=f.award('epoch-commit');await until(()=>reached);
  assert.equal(f.packets.length,count);assert.equal(await progress(f.binding.characterKey),undefined,'uncommitted XP invisible to another connection');
  f.official.authenticate(91);f.core.identity.poll();assert(!f.core.identity.isCurrent(f.binding));release();
  const receipt=await task;assert.equal(receipt.status,'accepted');assert.equal(receipt.classDelivery.state,'NO_CURRENT_BINDING');
  assert.equal(f.packets.filter(p=>p.type==='perks'&&p.session===oldSession).length,oldPerks,'replacement ready may project its own epoch; no new perks for the captured old session');
  assert.equal((await progress(f.binding.characterKey)).revision,'1');await f.core.shutdown();
});

test('without a live binding XP persists and the next ready recomposes at the durable level',async()=>{
  const f=await fixture(),count=f.packets.filter(p=>p.type==='perks').length;
  f.mp.online=[];f.mp.emitter.emit('disconnect',0);
  let receipt;for(let i=0;i<4;i++)receipt=await f.award('offline-'+i);
  assert.equal(receipt.classDelivery.state,'NO_CURRENT_BINDING');assert.equal(f.packets.filter(p=>p.type==='perks').length,count);
  f.mp.online=[91];f.official.authenticate(91);const barrier=f.c.spawn();f.core.identity.poll();
  for(const task of ['spells','appearance','equipment','placement'])barrier.complete(task);
  await f.confirm(f.acks.length+1);
  assert.deepEqual(new Set(f.acks.at(-1).items.filter(i=>i.action==='ensure').map(i=>i.key)),keysAt(receipt.result.level));
  await f.core.shutdown();
});

test('stale caller epoch never projects into the current session, DEV persists XP without re-delivery, same-level award never publishes',async()=>{
  const f=await fixture({env:{GAMEPLAY_CORE_DEV_CLASS_LEVEL:'17'}}),n=f.packets.length;
  for(let i=0;i<4;i++){const r=await f.award('dev-'+i);assert.equal(r.status,'accepted');}
  assert.equal(f.packets.length,n);assert((await progress(f.binding.characterKey)).character_level>=5);
  assert.deepEqual(new Set(f.acks.at(-1).items.filter(i=>i.action==='ensure').map(i=>i.key)),keysAt(17));await f.core.shutdown();
  const g=await fixture();const count=g.packets.length;
  const stale=await g.core.awardLevelingXp({characterKey:g.binding.characterKey,epoch:'old-epoch',...xpInput('stale')});
  assert.equal(stale.classDelivery.state,'NO_CURRENT_BINDING');assert.equal(g.packets.length,count);
  await g.award('stale-next');await g.confirm(g.acks.length+1);
  // At level 4 (1000 XP), 30*scaling for this event stays below the next level threshold.
  const before=g.packets.length,r=await g.award('same-level','bandit');assert.equal(r.result.oldLevel,r.result.level);assert.equal(g.packets.length,before);
  await g.core.shutdown();await assert.rejects(()=>g.award('stopped'),/LEVELING_RUNTIME_UNAVAILABLE/);
});

test('one durable award crossing two catalog milestones refreshes both in one delivery (explicit balance fixture)',async()=>{
  const f=await fixture();
  // Current signed balance max award=1000 cannot cross both level 5 and 10.
  // A valid test-only balance changes the FIXED reward, never the server evidence
  // or leveling arithmetic. Actual durable adapter, database and client are used.
  const configs=structuredClone(utils.levelingConfigs),target=data.classes.find(c=>c.id==='elementalista').stages[2].level;
  const xp=configs.levelProgression.levels.find(l=>l.levelTo===target).totalAccumulated;
  configs.enemyBaseXp.profiles.find(p=>p.eventXpCategories.includes('dragon_priest')).fixedXp=xp;
  const point=new utils.RuntimeLeveling({pool,configs,check(){},binding:key=>f.core.identity.forCharacter(key),current:b=>f.core.identity.isCurrent(b),refresh:b=>f.core.refreshClass(b),devLevel:undefined});
  const n=f.acks.length,r=await point.award({characterKey:f.binding.characterKey,epoch:f.binding.epoch,...xpInput('two-milestones')});
  assert.equal(r.status,'accepted');assert.equal(r.result.oldLevel,1);assert.equal(r.result.level,target);await f.confirm(n+1);
  assert.deepEqual(new Set(f.acks.at(-1).items.filter(i=>i.action==='ensure').map(i=>i.key)),keysAt(target));
  assert.deepEqual(new Set(f.c.calls.filter(c=>c[0]==='add').map(c=>c[1])),keysAt(target));
  assert.equal(f.c.calls.length,keysAt(target).size);assert.equal(f.acks.length,n+1);
  await point.shutdown();await f.core.shutdown();
});
