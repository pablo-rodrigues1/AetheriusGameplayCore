import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
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
const {Pool}=createRequire(import.meta.url)('pg'),url=new URL(process.env.AETHERIUS_TEST_DATABASE_URL??'missing:');
assert(['localhost','127.0.0.1','[::1]'].includes(url.hostname)&&url.pathname==='/aetherius_test','Only local aetherius_test');
const schema=`gc_b5b_${process.pid}_${randomBytes(4).toString('hex')}`;
const pool=new Pool({connectionString:process.env.AETHERIUS_TEST_DATABASE_URL,max:8,connectionTimeoutMillis:2000,options:`-c search_path=${schema},pg_catalog`});
const classes=load('catalog/classes.json'),runtimes=[];let profile=98000;
before(async()=>{await pool.query(`CREATE SCHEMA "${schema}"`);const migrations=[...await utils.readMigrations(`${root}/database/migrations`),perkMigration];
  assert.equal((await utils.applyMigrations(pool,migrations,schema)).applied.length,9);assert.equal((await utils.applyMigrations(pool,migrations,schema)).unchanged,9);});
after(async()=>{await Promise.all(runtimes.map(c=>c.shutdown()));await pool.query(`DROP SCHEMA "${schema}" CASCADE`);await pool.end();});
async function until(fn){const end=performance.now()+10000;while(!(await fn())){if(performance.now()>end)throw Error('B5b condition timeout');await delay(10);}}
async function setup({mode='active',devLevel='40',natural=false,character,attach=true,shift=1000,env={}}={}){
  const mp=classHost({catalogAvailable:true,offlineMode:true}),log=logger(),c=client({shift}),packets=[];
  mp.profiles.set(91,character??++profile);mp.appearances.set(91,{raceId:mp.ids.get('skyrim.esm|013746')});
  mp.getUserActor=user=>[...mp.users].find(([,u])=>u===user)?.[0]??0;
  mp.sendCustomPacket=(user,raw)=>{assert.equal(user,0);const p=JSON.parse(raw);packets.push(p);if(attach)c.receive(p);};
  const official=officialHost(mp);official.authenticate(91);
  let auto=true,acks=[];
  c.emitter.on('sendMessage',e=>{const p=JSON.parse(e.message.contentJsonDump);if(p.type==='ack')acks.push(p);if(auto)mp.emitter.emit('customPacket',0,e.message.contentJsonDump);});
  for(const record of classes.records)c.register({stableFormKey:record.stableFormKey});
  const barrier=c.spawn();
  const core=api.createGameplayCore({mp,pg:{init:()=>pool},log,env:{...developmentEnv,GAMEPLAY_CORE_DATABASE_SCHEMA:schema,GAMEPLAY_CORE_MODE_CLASSES:'active',GAMEPLAY_CORE_CLIENT_PERKS_MODE:mode,...natural?{}:{GAMEPLAY_CORE_DEV_CLASS_LEVEL:devLevel},...env}});
  runtimes.push(core);await core.initialize();const binding=core.identity.lookup({actorId:91}).value;
  const set=classId=>core.setCharacterClass({binding,classId,requestId:randomBytes(8).toString('hex')});
  const ready=()=>{for(const task of ['spells','appearance','equipment','placement'])barrier.complete(task);};
  const refresh=()=>core.refreshClass(binding);
  const confirm=async()=>{await until(()=>packets.some(p=>p.type==='perks'));await until(()=>{c.update();return log.messages.some(m=>m.includes('perks ')&&m.includes('CONFIRMED'));});};
  return {mp,c,log,core,binding,packets,official,set,ready,refresh,confirm,barrier,acks,set auto(v){auto=v;},get auto(){return auto;}};
}
const rows=async key=>(await pool.query('SELECT * FROM gc_perk_projections WHERE character_key=$1 ORDER BY stable_form_key',[key])).rows;
test('viper 40: 19 correct distinct records, all ranks, duplicate revision sends no packet, first application confirmed durably',async()=>{
  const f=await setup();await f.set('viper');assert.equal(f.packets.filter(p=>p.type==='perks').length,0);f.ready();await f.confirm();
  const packet=f.packets.find(p=>p.type==='perks');assert.equal(packet.items.length,19);assert.equal(new Set(packet.items.map(i=>i.key)).size,19);
  const grants=(await f.core.inspectActor(f.binding)).grants;
  assert.deepEqual(packet.items.map(i=>i.key).sort(),grants.map(g=>g.definition.stableFormKey).sort());
  const poison=classes.records.filter(r=>r.data.editorId?.includes('ConcentratedPoison')).map(r=>r.stableFormKey);
  assert.equal(poison.length,3);assert(poison.every(k=>packet.items.some(i=>i.key===k)));
  assert.equal(f.c.calls.filter(c=>c[0]==='add').length,19);assert((await rows(f.binding.characterKey)).every(r=>r.owned&&r.active));
  const count=f.packets.length;const again=await f.refresh();assert.equal(again.delivery.state,'CONFIRMED');assert.equal(f.packets.length,count);assert.equal(f.c.calls.length,19);
});
test('class change removes only exclusive owned records and preserves shared ones',async()=>{
  const f=await setup();await f.set('viper');f.ready();await f.confirm();const old=(await rows(f.binding.characterKey)).filter(r=>r.active).map(r=>r.stable_form_key);
  f.log.messages.length=0;await f.set('assassino');f.c.update();await until(()=>{f.c.update();return f.log.messages.some(m=>m.includes('perks ')&&m.includes('CONFIRMED'));});
  const wanted=new Set((await f.core.inspectActor(f.binding)).grants.map(g=>g.definition.stableFormKey));
  assert.deepEqual(f.c.calls.filter(c=>c[0]==='remove').map(c=>c[1]).sort(),old.filter(k=>!wanted.has(k)).sort());
  assert.equal((await rows(f.binding.characterKey)).filter(r=>r.active).length,wanted.size);
});
test('preexisting perk never owned or removed on class revocation',async()=>{
  const f=await setup();await f.set('viper');const first=(await f.core.inspectActor(f.binding)).grants[0].definition;
  f.c.perks.add(f.c.forms.get(first.stableFormKey).id);f.ready();await f.confirm();
  assert.equal((await rows(f.binding.characterKey)).find(r=>r.stable_form_key===first.stableFormKey).owned,false);
  // Staff selects a class without that record; removal list contains Core authorship only.
  const other=classes.classes.find(cls=>!cls.stages.flatMap(s=>s.perks).some(p=>p.stableFormKey===first.stableFormKey)).id;
  await f.set(other);f.c.update();await until(async()=>!(await rows(f.binding.characterKey)).some(r=>r.owned&&r.active&&r.stable_form_key===first.stableFormKey));
  assert(!f.c.calls.some(c=>c[0]==='remove'&&c[1]===first.stableFormKey));assert(f.c.perks.has(f.c.forms.get(first.stableFormKey).id));
});
test('server level change from 1 to 5 adds only new milestone records, no duplicate calls for retained perks',async()=>{
  const f=await setup({natural:true});await f.set('viper');f.ready();await f.confirm();
  const old=(await f.core.inspectActor(f.binding)).grants.map(g=>g.definition.stableFormKey),priorCalls=f.c.calls.length;
  const configs=(await new utils.ConfigLoader(`${root}/modules/leveling-system`).load()).configs,leveling=api.createDurableLeveling(pool,configs);
  // Same SERVER event fixture as classes.acceptance.mjs. Exercises Leveling's
  // owner/transactions; no death listener or client-reported XP is introduced.
  for(let n=0;n<4;n++)await leveling.award({characterKey:f.binding.characterKey,epoch:f.binding.epoch,eventName:'aetherius.enemy.killed.v1',recipientId:91,
    event:{contractVersion:1,eventId:`b5b-level-${f.binding.characterKey}-${n}`,occurredAt:Date.UTC(2026,9,9,12),victimId:800,killerId:91,
      enemy:{contractVersion:1,managed:true,stableEnemyIdentity:'skyrim.esm|000001',enemyFamily:'DRAGON_PRIEST',spawnRole:'BOSS_UNIQUE',combatLevel:20,xpEligible:true,xpCategory:'dragon_priest',sourcePlugin:'Skyrim.esm',winningOverridePlugin:'Skyrim.esm',sourceRecordIdentity:'skyrim.esm|000001'},
      progressionContext:{contractVersion:1,sourceType:'OTHER',sourceId:'b5b-test',recommendedClassMin:1,recommendedClassMax:40,status:'ASSIGNED',valid:true},contributors:[]},
    partySnapshot:{source:'SERVER',center:{cell:'test-cell',position:[0,0,0]},members:[{id:91,isOnline:true,cellOrWorldDesc:'test-cell',pos:[0,0,0]}],isRaid:false}});
  f.log.messages.length=0;await f.refresh();await f.confirm();
  const next=(await f.core.inspectActor(f.binding)).grants.map(g=>g.definition.stableFormKey);
  assert.equal((await pool.query('SELECT character_level FROM gc_leveling_progress WHERE character_key=$1',[f.binding.characterKey])).rows[0].character_level,5);
  assert(next.length>old.length);assert.deepEqual(f.c.calls.slice(priorCalls).filter(c=>c[0]==='add').map(c=>c[1]).sort(),next.filter(k=>!old.includes(k)).sort());assert.equal(f.c.calls.filter(c=>c[0]==='remove').length,0);
});
test('shadow delivery sends no hello; canary excludes non-allowlisted binding',async()=>{
  for(const mode of ['shadow','canary']){const f=await setup({mode});await f.set('viper');f.ready();assert.equal(f.packets.length,0);assert.equal(f.c.calls.length,0);await f.core.shutdown();}
});
test('no ACK stays unconfirmed; reconciliation resends; wrong revision/session/user/item ACK changes no rows',async()=>{
  const f=await setup();await f.set('viper');f.ready();await until(()=>f.packets.some(p=>p.type==='perks'));f.auto=false;f.c.update();
  assert.equal((await f.refresh()).delivery.state,'SENT_UNCONFIRMED');assert.equal((await rows(f.binding.characterKey)).length,0);
  const ack=f.acks.at(-1),send=(p,user=0)=>f.mp.emitter.emit('customPacket',user,JSON.stringify(p));
  send({...ack,revision:{...ack.revision,facts:999}});send({...ack,session:'old'});send(ack,1);send({...ack,items:ack.items.slice(1)});send({...ack,items:ack.items.map(i=>({...i,status:'REMOVED'}))});
  await delay(30);assert.equal((await rows(f.binding.characterKey)).length,0);
  // An unexpired delivery is shared, including after an ACK was lost. Retry
  // only when the existing protocol deadline expires; never supersede its id.
  const pendingCount=f.packets.filter(p=>p.type==='perks').length;
  f.auto=true;await f.refresh();assert.equal(f.packets.filter(p=>p.type==='perks').length,pendingCount);
  await delay(10020);await f.refresh();assert.equal(f.packets.filter(p=>p.type==='perks').length,pendingCount+1);await until(async()=>{f.c.update();return (await rows(f.binding.characterKey)).length===19;});
  assert.equal(f.c.calls.filter(c=>c[0]==='add').length,19);
  const before=await rows(f.binding.characterKey);send(f.acks.at(-1));await delay(20);assert.deepEqual(await rows(f.binding.characterKey),before);
});
test('old official session ACK cannot record or publish; reconnect reapplies by stable identity at a different client position',async()=>{
  const f=await setup();await f.set('viper');f.ready();await until(()=>f.packets.some(p=>p.type==='perks'));f.auto=false;f.c.update();const ack=f.acks.at(-1),character=Number(f.binding.characterKey.slice(8));
  f.official.authenticate(91);f.mp.emitter.emit('customPacket',0,JSON.stringify(ack));await delay(20);assert.equal((await rows(f.binding.characterKey)).length,0);
  await f.core.shutdown();const g=await setup({character,shift:9000});g.ready();await g.confirm();assert.equal(g.c.calls.filter(c=>c[0]==='add').length,19);
  assert(!(JSON.stringify(await rows(g.binding.characterKey))).includes('runtimeFormId'));
});
test('new client with protocol off and legacy client with protocol on preserve approximation',async()=>{
  const off=await setup({mode:'off'});await off.set('viper');off.ready();assert.equal(off.packets.length,0);assert.equal((await off.refresh()).delivery.state,'UNSUPPORTED');assert.equal(off.c.calls.length,0);assert.equal(off.core.capabilityReport().actorReady.signal,'ONLINE_DELAY_APPROXIMATION');
  await off.core.shutdown();const old=await setup({attach:false});await old.set('viper');assert.equal(old.packets.filter(p=>p.type==='hello').length,1);assert.equal(old.packets.filter(p=>p.type==='perks').length,0);
  assert.equal((await old.refresh()).delivery.state,'CLIENT_UNSUPPORTED');assert.equal(old.core.capabilityReport().clientPerks.legacy,'ONLINE_DELAY_APPROXIMATION');
});
test('durable ownership restored on reconnect: existing save perks are not re-added; revoked owned save perk removed',async()=>{
  const f=await setup();await f.set('viper');f.ready();await f.confirm();const old=(await rows(f.binding.characterKey)).map(r=>r.stable_form_key),character=Number(f.binding.characterKey.slice(8));await f.core.shutdown();
  const g=await setup({character,shift:7000});for(const key of old)g.c.perks.add(g.c.forms.get(key).id);g.ready();await g.confirm();assert.equal(g.c.calls.filter(c=>c[0]==='add').length,0);
  g.log.messages.length=0;await g.set('guardiao');g.c.update();await until(()=>{g.c.update();return g.log.messages.some(m=>m.includes('perks ')&&m.includes('CONFIRMED'));});
  const next=new Set((await g.core.inspectActor(g.binding)).grants.map(r=>r.definition.stableFormKey));assert.deepEqual(g.c.calls.filter(c=>c[0]==='remove').map(c=>c[1]).sort(),old.filter(k=>!next.has(k)).sort());
});

test('FIX-1010 legacy complete stone head, Nord/viper: reconnect and dev/perk/provider mode changes keep reconciliation and external grants',async()=>{
  const env={GAMEPLAY_CORE_MODE_STANDING_STONES:'active',GAMEPLAY_CORE_MODE_RACES:'active'};
  const first=await setup({mode:'off',env});await first.set('viper');
  await first.core.observeRace(first.binding);
  assert.equal((await first.core.chooseStandingStone({binding:first.binding,stoneKey:'skyrim.esm|0D232D',requestId:'FIX-1010-stone'})).status,'SUPPORTED');
  // Legacy protocol-off readiness is the documented 3 second approximation.
  await until(async()=> (await pool.query('SELECT complete FROM gc_spell_projection_heads WHERE character_key=$1',[first.binding.characterKey])).rows[0]?.complete);
  const head=()=>pool.query('SELECT grant_set,complete FROM gc_spell_projection_heads WHERE character_key=$1',[first.binding.characterKey]).then(r=>r.rows[0]);
  const old=await head();assert.equal(old.complete,true);
  assert(old.grant_set.grants.some(g=>g.source.kind==='STANDING_STONE'));
  assert(old.grant_set.grants.some(g=>g.source.kind==='RACE'));
  const externalPerk=old.grant_set.grants.find(g=>g.source.kind==='CLASS').definition.stableFormKey;
  // State equivalent to a complete B5a head before classes participated. Facts
  // already contain the viper choice, and stay unchanged throughout this test.
  const legacy={...old.grant_set,grants:old.grant_set.grants.filter(g=>g.source.kind!=='CLASS')};
  await pool.query('UPDATE gc_spell_projection_heads SET grant_set=$2::jsonb,complete=true WHERE character_key=$1',[first.binding.characterKey,JSON.stringify(legacy)]);
  const externalSpell=first.mp.data.records.find(r=>r.recordType==='SPEL'&&!old.grant_set.grants.some(g=>g.definition.stableFormKey===r.stableFormKey)).stableFormKey;
  first.mp.learned(91).add(first.mp.ids.get(externalSpell));
  const character=Number(first.binding.characterKey.slice(8));let previous=first,priorRevision=legacy.revision;
  const snapshots=[];
  for(const options of [{},{natural:true},{devLevel:'40'},{mode:'off'},{mode:'active'},{env:{...env,GAMEPLAY_CORE_MODE_CLASSES:'off'}},{env}]){
    const spellKeys=[...previous.mp.learned(91)].map(id=>[...previous.mp.ids].find(([,value])=>id===value)?.[0]).filter(Boolean);
    const perkKeys=[...previous.c.perks].map(id=>[...previous.c.forms].find(([,form])=>id===form.id)?.[0]).filter(Boolean);
    if(!perkKeys.includes(externalPerk))perkKeys.push(externalPerk);
    await previous.core.shutdown();const next=await setup({character,env,...options});
    for(const key of spellKeys)next.mp.learned(91).add(next.mp.ids.get(key));
    for(const key of perkKeys)next.c.perks.add(next.c.forms.get(key).id);
    next.ready();
    const expected=(await next.core.inspectActor(next.binding)).grants;
    await until(async()=>{next.c.update();const h=await head();return h?.complete&&isDeepStrictEqual(h.grant_set.grants,expected);});
    if(options.mode!=='off')await next.confirm();
    const h=await head();
    assert(h.grant_set.revision.grants>=priorRevision.grants);priorRevision=h.grant_set.revision;
    assert(!next.log.messages.some(m=>/REVISION_CONTENT_CONFLICT|STALE_OR_INCOMPARABLE/.test(m)),next.log.messages.join('\n'));
    assert(next.mp.learned(91).has(next.mp.ids.get(externalSpell)));
    assert(next.c.perks.has(next.c.forms.get(externalPerk).id));
    assert(!next.mp.mutations().some(c=>c.method==='RemoveSpell'&&c.args[0].desc===next.mp.getDescFromId(next.mp.ids.get(externalSpell))));
    assert(!next.c.calls.some(c=>c[0]==='remove'&&c[1]===externalPerk));
    snapshots.push({options,revision:h.grant_set.revision,classPerks:expected.filter(g=>g.source.kind==='CLASS').length});previous=next;
  }
  assert(snapshots[0].revision.grants>legacy.revision.grants);
  assert(snapshots[1].classPerks<snapshots[0].classPerks);
  assert(snapshots[2].classPerks===snapshots[0].classPerks);
});
