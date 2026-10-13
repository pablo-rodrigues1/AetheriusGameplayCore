import assert from 'node:assert/strict';
import {test,before,after} from 'node:test';
import {createRequire} from 'node:module';
import {randomBytes} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {api,utils,root,load,perkMigration} from './b5b-source.mjs';
import {classHost} from './class-host.mjs';
import {officialHost} from './official-host.mjs';
import {logger} from './host.mjs';
import {client} from './perk-client.mjs';
import {xpInput} from './xp-event.mjs';
const {Pool}=createRequire(import.meta.url)('pg'),url=new URL(process.env.AETHERIUS_TEST_DATABASE_URL??'missing:');
assert(['localhost','127.0.0.1','[::1]'].includes(url.hostname)&&url.pathname==='/aetherius_test','Only local aetherius_test');
const schema='gc_perk_concurrency_'+randomBytes(8).toString('hex');
const pool=new Pool({connectionString:process.env.AETHERIUS_TEST_DATABASE_URL,max:8,connectionTimeoutMillis:2000,options:'-c search_path='+schema+',pg_catalog'});
const data=load('catalog/classes.json'),cores=[];let profile=78410000;
before(async()=>{await pool.query('CREATE SCHEMA "'+schema+'"');await utils.applyMigrations(pool,[...await utils.readMigrations(root+'/database/migrations'),perkMigration],schema);});
after(async()=>{await Promise.all(cores.map(c=>c.shutdown()));await pool.query('DROP SCHEMA "'+schema+'" CASCADE');await pool.end();});
async function until(fn){const end=performance.now()+15000;while(!(await fn())){if(performance.now()>end)throw Error('Perk concurrency condition timeout');await delay(5);}}
const gate=()=>{let release;const promise=new Promise(r=>release=r);return {promise,release};};
async function fixture({holdCommit=false,seedXp=false}={}){
  const mp=classHost({catalogAvailable:true,offlineMode:true}),official=officialHost(mp),log=logger(),c=client(),packets=[],acks=[],trace=[];
  mp.profiles.set(91,++profile);mp.appearances.set(91,{raceId:mp.ids.get('skyrim.esm|013746')});
  mp.getUserActor=user=>[...mp.users].find(([,u])=>u===user)?.[0]??0;
  let inFlight,violations=0;
  mp.sendCustomPacket=(user,raw)=>{assert.equal(user,0);const p=JSON.parse(raw);packets.push(p);
    if(['hello','challenge'].includes(p.type))inFlight=undefined;
    if(p.type==='perks'){trace.push({type:'send',id:p.id,revision:p.revision,prior:inFlight});if(inFlight)violations++;inFlight=p.id;}
    c.receive(p);
  };
  c.emitter.on('sendMessage',e=>{const p=JSON.parse(e.message.contentJsonDump);if(p.type==='ack'){acks.push(p);trace.push({type:'ack',id:p.id,revision:p.revision});if(inFlight===p.id)inFlight=undefined;}mp.emitter.emit('customPacket',0,e.message.contentJsonDump);});
  for(const record of data.records)c.register({stableFormKey:record.stableFormKey});
  // Same native contract fixture as attribute-allocation.test.mjs:
  // AttributeBonusesBinding::Get/Set returns base/maximum/origin and accepts deltas/null.
  const base={health:100,magicka:120,stamina:80},get=mp.get,setNative=mp.set;let bonus=null;
  mp.get=(id,key)=>key==='aetheriusAttributeBonuses'?{base,maximum:{health:100+(bonus?.health??0),magicka:120+(bonus?.magicka??0),stamina:80+(bonus?.stamina??0)},origin:bonus?'CLASS_ADDITIVE':'RECORDS'}:get(id,key);
  mp.set=(id,key,value)=>{if(key==='aetheriusAttributeBonuses'){bonus=value;trace.push({type:'attribute-publish',value});}else setNative?.(id,key,value);};
  const barrier=c.spawn(),entered=gate(),release=gate();let armed=holdCommit;
  const wrapped={async connect(){const conn=await pool.connect();let perkWrite=false;return {release:error=>conn.release(error),async query(sql,params){
    if(/INSERT INTO .*gc_perk_projections/.test(sql))perkWrite=true;
    if(sql==='COMMIT'&&perkWrite&&armed){armed=false;entered.release();await release.promise;}
    return conn.query(sql,params);
  }};}};
  official.authenticate(91);
  const core=api.createGameplayCore({mp,pg:{init:()=>wrapped},log,env:{GAMEPLAY_CORE_DATABASE_SCHEMA:schema,GAMEPLAY_CORE_MODE_CLASSES:'active',GAMEPLAY_CORE_CLIENT_PERKS_MODE:'active'}});
  cores.push(core);await core.initialize();const binding=core.identity.lookup({actorId:91}).value;
  const set=classId=>core.setCharacterClass({binding,classId,requestId:randomBytes(8).toString('hex')});
  await set('viper');
  if(seedXp)await core.awardLevelingXp({characterKey:binding.characterKey,epoch:binding.epoch,...xpInput('attribute-seed')});
  return {mp,log,c,core,binding,packets,acks,trace,set,entered,release,get violations(){return violations;},
    ready(){trace.push({type:'ready'});for(const task of ['spells','appearance','equipment','placement'])barrier.complete(task);},
    async refresh(){trace.push({type:'refresh'});return core.refreshClass(binding);},
    async settleReady(){await until(()=>log.messages.some(m=>m.startsWith('[classes] active:')&&m.includes('delivery=SENT_UNCONFIRMED')));},
    async confirm(){await until(()=>{c.update();const last=packets.filter(p=>p.type==='perks').at(-1);return last&&log.messages.some(m=>m.includes(': CONFIRMED;'))&&acks.some(a=>a.id===last.id);});},
    assertSerial(){assert.equal(violations,0,'never two deliveries in flight: '+JSON.stringify(trace));},
    async rows(){return (await pool.query('SELECT * FROM gc_perk_projections WHERE character_key=$1 ORDER BY stable_form_key',[binding.characterKey])).rows;}
  };
}
test('normal ready plus refresh shares the unacknowledged perk delivery with sweep off',async()=>{
  const f=await fixture();f.ready();await f.settleReady();await f.refresh();
  f.assertSerial();assert.equal(f.packets.filter(p=>p.type==='perks').length,1);assert.equal(f.acks.length,0);
  await f.confirm();f.assertSerial();assert.equal((await f.rows()).filter(r=>r.owned&&r.active).length,2);
  console.log('NORMAL_TRACE '+JSON.stringify(f.trace));
});
for(const trigger of ['classes.set','awardLevelingXp','attributes'])test('normal ready plus '+trigger+' never supersedes a delivery before its ACK commit',async()=>{
  const f=await fixture({holdCommit:true,seedXp:trigger==='attributes'});
  try {
    f.ready();await f.settleReady();
    f.trace.push({type:trigger});
    if(trigger==='classes.set')assert.equal((await f.set('piromante')).status,'SUPPORTED');
    if(trigger==='awardLevelingXp')for(let n=0;n<4;n++)assert.equal((await f.core.awardLevelingXp({characterKey:f.binding.characterKey,epoch:f.binding.epoch,...xpInput('perk-concurrency-'+n)})).status,'accepted');
    if(trigger==='attributes')assert.equal((await f.core.allocateAttributes({binding:f.binding,requestId:'perk-concurrency-allocation',health:5,magicka:0,stamina:0})).status,'SUPPORTED');
    const wanted=(await f.core.inspectActor(f.binding)).grants.filter(g=>g.kind==='perk').map(g=>g.definition.stableFormKey).sort();
    f.assertSerial();assert.equal(f.packets.filter(p=>p.type==='perks').length,1);assert.equal(f.acks.length,0);
    f.c.update();await f.entered.promise;
    assert.equal(f.packets.filter(p=>p.type==='perks').length,1,'queued delivery waits for durable ownership, not just ACK reception');
    f.release.release();
    await until(()=>{f.c.update();const last=f.packets.filter(p=>p.type==='perks').at(-1);return last&&JSON.stringify(last.items.filter(i=>i.action==='ensure').map(i=>i.key).sort())===JSON.stringify(wanted)&&f.log.messages.filter(m=>m.includes(': CONFIRMED;')).length===(trigger==='attributes'?1:2);});
    f.assertSerial();assert.deepEqual((await f.rows()).filter(r=>r.active).map(r=>r.stable_form_key).sort(),wanted);
    if(trigger==='classes.set')assert(f.packets.filter(p=>p.type==='perks').at(-1).items.some(i=>i.action==='remove'&&i.owned),'initial ACK authorship must reach the queued removal');
    console.log('NORMAL_TRACE '+JSON.stringify(f.trace));
  }finally{f.release.release();await f.core.shutdown();}
});

test('a new spawn cycle drops the deferred set and ignores the old ACK',async()=>{
  const f=await fixture();f.ready();await f.settleReady();
  const old=f.packets.filter(p=>p.type==='perks')[0];await f.set('piromante');f.assertSerial();
  const barrier=f.c.spawn();for(const task of ['spells','appearance','equipment','placement'])barrier.complete(task);
  await f.refresh();
  f.mp.emitter.emit('customPacket',0,JSON.stringify({...old,type:'ack',items:old.items.map(i=>({key:i.key,signature:i.signature,action:i.action,status:'APPLIED'}))}));
  assert.equal((await f.rows()).length,0,'old cycle cannot acquire ownership');
  await f.confirm();f.assertSerial();
  const latest=f.packets.filter(p=>p.type==='perks').at(-1),wanted=(await f.core.inspectActor(f.binding)).grants.filter(g=>g.kind==='perk').map(g=>g.definition.stableFormKey).sort();
  assert.notEqual(latest.challenge,old.challenge);assert.deepEqual((await f.rows()).filter(r=>r.active).map(r=>r.stable_form_key).sort(),wanted);
  assert.equal(f.packets.filter(p=>p.type==='perks').length,2,'only the first delivery in each cycle');
  await f.core.shutdown();
});
