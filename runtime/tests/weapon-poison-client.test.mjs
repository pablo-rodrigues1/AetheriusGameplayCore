import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { api, utils } from './b5b-source.mjs';
import { fakeHost } from './host.mjs';
import { officialHost } from './official-host.mjs';

import { load, game } from './weapon-poison-client.mjs';
function setup(t,{refuse=false,shift=0,hand='right',enabled=true}={}){
  t.mock.timers.enable({apis:['setInterval','setTimeout','Date']});
  const g=game(4100+shift,4200+shift,hand),inv=load(g.sp),{GameplayGrantService}=inv;
  const mp=fakeHost(),scope=new utils.Scope(),actors=new utils.Actors(mp,scope,false,()=>{}),official=officialHost(mp),sent=[],native=[];
  mp.getServerSettings=()=>({offlineMode:false,aetheriusCombat:{weaponPoison:enabled}});
  mp.getUserActor=user=>user===0?91:0;mp.getUserByActor=actor=>actor===91?0:-1;
  let server={entries:[{baseId:g.weaponId,count:2},{baseId:g.poisonId,count:20}]};
  const originalGet=mp.get;mp.get=(actor,property)=>property==='inventory'?structuredClone(server):property==='aetheriusPoisonStatus'?{result:refuse?3:1}:originalGet(actor,property);
  mp.set=(actor,property,value)=>{assert.equal(actor,91);assert.equal(property,'aetheriusWeaponPoisonIntent');native.push(value);
    if(!refuse)server={entries:[{baseId:g.weaponId,count:1,[hand==='left'?'wornLeft':'worn']:true,poisonId:g.poisonId,poisonCount:7},
      {baseId:g.weaponId,count:1},{baseId:g.poisonId,count:19}]};};
  const emitter=new EventEmitter(),events=new EventEmitter(),updates=[],outgoing=[];
  const controller={emitter,on:(event,fn)=>events.on(event,fn),once:(event,fn)=>updates.push(fn)};
  const client=new GameplayGrantService(g.sp,controller);
  mp.sendCustomPacket=(user,raw)=>{sent.push(JSON.parse(raw));emitter.emit('customPacketMessage',{message:{contentJsonDump:raw}});};
  official.authenticate(91);
  const delivery=new api.ClientDelivery(mp,actors,scope,()=>true,()=>{});
  delivery.start(new utils.Hooks(mp,scope,()=>{}));new api.PoisonIntents(mp,delivery,()=>{});
  // Preserve reliable asynchronous network ordering; do not deliver during a diff.
  emitter.on('sendMessage',e=>outgoing.push(e.message.contentJsonDump));
  actors.start();
  let barrier;emitter.emit('gameplaySpawnBegin',{tasks:['equipment'],capture:b=>barrier=b});
  const flush=()=>{for(const raw of outgoing.splice(0))mp.emitter.emit('customPacket',0,raw);};
  flush();barrier.complete('equipment');flush();
  g.sp.storage.pcInv=structuredClone(server);
  t.after(()=>scope.close());
  return {g,inv,client,mp,official,sent,native,delivery,flush,outgoing,emitter,events,
    cycle(){t.mock.timers.tick(5001);inv.applyInventory(g.player,g.sp.storage.pcInv,false,true);g.pump();},
    get server(){return server;},spendServer(n){const e=server.entries.find(e=>e.worn||e.wornLeft);if(n){e.poisonCount=n;}else{delete e.poisonId;delete e.poisonCount;}g.sp.storage.pcInv=structuredClone(server);}};
}
for(const hand of ['left','right'])for(const shift of [0,70000])test(`local application -> authenticated intent -> native entry -> 7 charges -> repeated cycles (${hand}, shift ${shift})`,t=>{
  const f=setup(t,{hand,shift});f.g.applyLocal();f.events.emit('update');f.cycle();assert.equal(f.native.length,0);assert.equal(f.g.calls.length,0,'pending application must not be corrected prematurely');
  const packet=JSON.parse(f.outgoing[0]);assert.equal(packet.type,'weaponPoison');assert(!('poisonCount' in packet));f.flush();assert.equal(f.native.length,1);
  f.cycle();const removals=f.g.calls.filter(c=>c[0]==='remove-base');assert.equal(removals.length,1);assert.equal(removals[0][2],2);
  const held=f.g.entries.find(e=>e.worn||e.wornLeft);assert.equal(held.poisonCount,7);assert.equal(!!held.wornLeft,hand==='left');assert.equal(held.name,'Blessed Northern Iron Dagger');
  assert.equal(f.g.entries.find(e=>e.baseId===f.g.poisonId).count,19);assert.equal(f.inv.getDiff(f.server,f.inv.getInventory(f.g.player),true).entries.length,0);
  const calls=f.g.calls.length;for(let i=0;i<100;i++)f.cycle();assert.equal(f.g.calls.length,calls);assert.equal(f.native.length,1);
  f.mp.emitter.emit('customPacket',0,JSON.stringify(packet));assert.equal(f.native.length,1,'reliable retry must not consume a second dose');
  f.spendServer(6);f.cycle();assert.equal(f.g.entries.find(e=>e.worn||e.wornLeft).poisonCount,6);const spent=f.g.calls.length;
  f.mp.emitter.emit('customPacket',0,JSON.stringify(packet));assert.equal(f.g.sp.storage.pcInv.entries.find(e=>e.poisonId).poisonCount,6,'retry must not restore old seven charges');
  for(let i=0;i<100;i++)f.cycle();assert.equal(f.g.calls.length,spent);assert.equal(f.native.length,1,'charge correction must not look like an application');
  f.spendServer(0);f.cycle();assert(!f.g.entries.find(e=>e.worn||e.wornLeft).poisonId);const exhausted=f.g.calls.length;
  for(let i=0;i<100;i++)f.cycle();assert.equal(f.g.calls.length,exhausted);
});
test('refusal with two held copies restores clean copies and both hands in one base replacement',t=>{
  const f=setup(t,{refuse:true});f.g.entries[1].wornLeft=true;f.g.applyLocal();f.cycle();f.flush();f.cycle();
  assert.equal(f.g.calls.filter(c=>c[0]==='remove-base').length,1);assert.equal(f.g.entries.filter(e=>e.worn||e.wornLeft).length,2);
  assert(!f.g.entries.some(e=>e.poisonId));assert.equal(f.g.entries.find(e=>e.baseId===f.g.poisonId).count,20);
  const calls=f.g.calls.length;for(let i=0;i<100;i++)f.cycle();assert.equal(f.g.calls.length,calls);assert.equal(f.native.length,1);
});
test('wrong sender/session/cycle/hand/payload/replay/current official binding cannot invoke native command',t=>{
  const f=setup(t);f.g.applyLocal();f.cycle();const good=JSON.parse(f.outgoing[0]);
  for(const patch of [{session:'old'},{cycle:'other'},{hand:'both'},{poisonCount:7},{weaponId:0},{id:'bad id'},{poisonId:1.5}])f.mp.emitter.emit('customPacket',0,JSON.stringify({...good,...patch}));
  f.mp.emitter.emit('customPacket',1,JSON.stringify(good));assert.equal(f.native.length,0);
  f.flush();assert.equal(f.native.length,1);f.mp.emitter.emit('customPacket',0,JSON.stringify({...good,weaponId:good.weaponId+1}));assert.equal(f.native.length,1);
  f.official.authenticate(91);f.mp.emitter.emit('customPacket',0,JSON.stringify({...good,id:'new-application'}));assert.equal(f.native.length,1);
});
test('option off sends no poison intent; tracing is opt-in and captures equip, unequip and extras',t=>{
  const f=setup(t,{enabled:false});f.g.applyLocal();f.cycle();assert.equal(f.outgoing.length,0);assert.equal(f.native.length,0);assert.equal(f.g.logs.filter(x=>x.startsWith('[AETHERIUS')).length,0);
  f.g.sp.storage.aetheriusWeaponPoisonTrace=true;const event={actor:f.g.player,baseObj:f.g.sp.Game.getFormEx(f.g.poisonId),uniqueId:1};
  f.events.emit('equip',event);f.events.emit('unequip',event);f.events.emit('update');
  for(const name of ['equip','unequip','extra-changes'])assert(f.g.logs.some(x=>x.startsWith(`[AETHERIUS poison] ${name} `)));
});
test('same-base plain item changes retain the original path without group removal',t=>{
  const f=setup(t);f.g.sp.storage.pcInv.entries[0].count=3;f.cycle();assert.equal(f.g.calls.filter(c=>c[0]==='remove-base').length,0);
});
test('one held copy and refusal after missing server dose converge once; a later fresh application is detected',t=>{
  const f=setup(t,{refuse:true});f.g.entries.splice(1,1);f.server.entries[0].count=1;
  f.g.applyLocal();f.cycle();f.flush();f.cycle();assert.equal(f.g.calls.filter(c=>c[0]==='remove-base').length,1);
  assert.equal(f.g.entries.filter(e=>e.baseId===f.g.weaponId).length,1);assert(f.g.entries.find(e=>e.worn));
  const calls=f.g.calls.length;for(let i=0;i<10;i++)f.cycle();assert.equal(f.g.calls.length,calls);
  f.g.applyLocal();f.cycle();f.flush();f.cycle();assert.equal(f.native.length,2,'new local application after correction must send new id');
});
test('update observes application before five-second sync, even if local engine spends its only charge immediately',t=>{
  const f=setup(t);f.g.applyLocal();f.events.emit('update');assert.equal(f.outgoing.length,1);
  f.g.spendLocal(0);f.flush();f.cycle();assert.equal(f.native.length,1);assert.equal(f.g.entries.find(e=>e.worn).poisonCount,7);
});
test('paused UI defers poison group removal until AddItemEx can reconstruct it',t=>{
  const f=setup(t);f.g.applyLocal();f.events.emit('update');f.flush();f.g.sp.Utility.isInMenuMode=()=>true;f.cycle();
  assert.equal(f.g.calls.filter(c=>c[0]==='remove-base').length,0);assert(f.g.entries.find(e=>e.worn));
  f.g.sp.Utility.isInMenuMode=()=>false;f.cycle();assert.equal(f.g.calls.filter(c=>c[0]==='remove-base').length,1);
});
test('bounded request cache rejects new ids explicitly and never invokes native consumption beyond its limit',t=>{
  const f=setup(t);f.g.applyLocal();f.events.emit('update');const packet=JSON.parse(f.outgoing[0]);
  for(let i=0;i<257;i++)f.mp.emitter.emit('customPacket',0,JSON.stringify({...packet,id:`application-${i}`}));
  assert.equal(f.native.length,256);assert.equal(f.sent.at(-1).type,'weaponPoisonResult');assert.equal(f.sent.at(-1).result,0);
});
