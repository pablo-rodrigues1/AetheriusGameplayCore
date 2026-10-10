// Reviewer only: REAL addon and CustomPacket bot; API imitation is explicitly
// limited to the game side. No poison OnEquip is sent. Required isolated port.
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { build } from 'esbuild';
import { game, load } from '../tests/weapon-poison-client.mjs';

const options={},args=process.argv.slice(2);
for(let i=0;i<args.length;i+=2){assert(args[i].startsWith('--')&&args[i+1],'Expected --name value');options[args[i].slice(2)]=args[i+1];}
for(const key of ['port','work-dir','addon','settings','fixture'])assert(options[key],`Missing --${key}`);
const port=Number(options.port);assert(Number.isInteger(port)&&port>0&&port<=65535&&port!==7777,'Use an isolated port');
const root=fileURLToPath(new URL('../../',import.meta.url));
const compiled=await build({stdin:{loader:'ts',resolveDir:root,contents:`export {ClientDelivery} from './runtime/src/client-delivery.ts';export {PoisonIntents} from './runtime/src/poison-intents.ts';export {Actors} from './runtime/src/actors.ts';export {Scope,Hooks} from './runtime/src/scope.ts';export {createOfficialIdentity} from '../aetherius-server/server/ts/systems/official-identity.ts';`},bundle:true,platform:'node',format:'esm',write:false});
const {ClientDelivery,PoisonIntents,Actors,Scope,Hooks,createOfficialIdentity}=await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const settingsFile=path.resolve(options.settings),input=JSON.parse(readFileSync(settingsFile,'utf8'));
const settings={port,listenHost:'127.0.0.1',maxPlayers:4,offlineMode:true,
  dataDir:path.resolve(path.dirname(settingsFile),input.dataDir??'data'),loadOrder:input.loadOrder,aetheriusCombat:{weaponPoison:true,shadow:false}};
const fixture=JSON.parse(readFileSync(path.resolve(options.fixture),'utf8')),addon=path.resolve(options.addon),work=path.resolve(options['work-dir']);
mkdirSync(work,{recursive:true});process.chdir(work);globalThis.require=createRequire(import.meta.url);
const {ScampServer}=globalThis.require(addon),server=new ScampServer(JSON.stringify(settings));server._setSelf(server);
const weaponMutations=g=>g.calls.filter(c=>c[1]===g.weaponId&&['remove-base','remove-all','add-ex','equip','node-update'].includes(c[0]));
const corrections=g=>g.calls.filter(c=>c[0]==='native'&&!c[2].startsWith('Get'));
const scope=new Scope();function tick(){for(let i=0;i<20;i++)server.tick();}
try {
  const bot=server.createBot();tick();const user=bot.getUserId();
  const actor=server.createActor(0,[0,0,0],0,server.getIdFromDesc('3c:Skyrim.esm'));
  server.set(actor,'profileId',991002);server.setUserActor(user,actor);tick();
  // Execute the upstream identity authority on REAL native methods. Bind a
  // harness-only token rather than logging in or contacting any database.
  const identity=createOfficialIdentity(server),attempt=identity.begin(user);assert(identity.bind(attempt,991002,'harness-only-token'));
  const emitter=new EventEmitter(),events=new EventEmitter(),updates=[],outgoing=[],packets=[];
  const nativeSend=server.sendCustomPacket.bind(server);
  const mp=new Proxy(server,{get(target,key){if(key==='aetheriusOfficialIdentity')return identity.view;
    if(key==='sendCustomPacket')return(u,raw)=>{nativeSend(u,raw);packets.push(JSON.parse(raw));emitter.emit('customPacketMessage',{message:{contentJsonDump:raw}});};
    const value=target[key];return typeof value==='function'?value.bind(target):value;}});
  const weapon=server.getIdFromDesc(fixture.weaponKey),poison=server.getIdFromDesc(fixture.poisonKey);
  const g=game(weapon,poison),client=load(g.sp);
  new client.GameplayGrantService(g.sp,{emitter,on:(event,fn)=>events.on(event,fn),once:(event,fn)=>updates.push(fn)});
  emitter.on('sendMessage',e=>outgoing.push(e.message));
  const actors=new Actors(mp,scope,false,console.log),delivery=new ClientDelivery(mp,actors,scope,()=>true,console.log);
  delivery.start(new Hooks(mp,scope,console.log));new PoisonIntents(mp,delivery,console.log);actors.start();
  const flush=()=>{for(const message of outgoing.splice(0))bot.send(message);tick();};
  let barrier;emitter.emit('gameplaySpawnBegin',{tasks:['equipment'],capture:b=>barrier=b});flush();barrier.complete('equipment');flush();
  const remap=inv=>({entries:inv.entries.map(e=>{const {baseKey,...rest}=e;return {...rest,baseId:server.getIdFromDesc(baseKey)};})});
  const cycle=()=>{client.applyInventory(g.player,g.sp.storage.pcInv,false,true);g.pump();};
  for(const refusal of [false,true]) {
    const inv=remap(fixture.inventory),eq={...fixture.equipment,inv:remap(fixture.equipment.inv)};
    if(refusal){g.entries[1].wornLeft=true;eq.inv.entries.find(e=>e.baseId===weapon&&!e.worn).wornLeft=true;}
    server.set(actor,'inventory',inv);server.set(actor,'aetheriusPoisonDoseBonus',6);
    bot.send({t:5,idx:server.get(actor,'idx'),data:eq});tick();g.sp.storage.pcInv=server.get(actor,'inventory');
    // Settle the clean baseline between scenarios; otherwise the previous
    // seven-charge coating would hide a fresh one-charge local application.
    cycle();cycle();
    g.applyLocal();cycle();flush();cycle();
    const result=packets.filter(p=>p.type==='weaponPoisonResult').at(-1);assert(result);assert.equal(result.result,refusal?3:1);
    const native=server.get(actor,'inventory');assert.equal(native.entries.find(e=>e.baseId===poison).count,refusal?20:19);
    if(!refusal)assert.equal(native.entries.find(e=>e.poisonId).poisonCount,7);
    const count=corrections(g).length;for(let i=0;i<100;i++)cycle();assert.equal(corrections(g).length,count);assert.deepEqual(weaponMutations(g),[]);
    assert.equal(g.entries.filter(e=>e.worn||e.wornLeft).length,refusal?2:1);
    console.log(`PASS real CustomPacket + native binding + API model: ${refusal?'refusal':'accepted 7 charges'}, zero weapon remove/add/equip, 100 cycles without repeated correction`);
    if(!refusal){
      // Project real native snapshots; this harness does not invent a hit.
      for(const remaining of [6,0]){
        const next=server.get(actor,'inventory'),coating=next.entries.find(e=>e.poisonId);
        if(remaining)coating.poisonCount=remaining;else{delete coating.poisonId;delete coating.poisonCount;}
        server.set(actor,'inventory',next);g.sp.storage.pcInv=server.get(actor,'inventory');cycle();
        const held=g.entries.find(e=>e.worn||e.wornLeft);assert.equal(held.poisonCount,remaining);
        const count=corrections(g).length;for(let i=0;i<100;i++)cycle();assert.equal(corrections(g).length,count);assert.deepEqual(weaponMutations(g),[]);
        console.log(`PASS native inventory projection: ${remaining} charges; 100 cycles, no reconstruction`);
      }
      const already=server.get(actor,'inventory'),heldServer=already.entries.find(e=>e.worn||e.wornLeft);
      assert(heldServer,'host retains its worn instance');heldServer.poisonId=poison;heldServer.poisonCount=7;
      server.set(actor,'inventory',already);g.sp.storage.pcInv=server.get(actor,'inventory');
      const held=g.entries.find(e=>e.worn||e.wornLeft);held.worn=false;
      const before=corrections(g).length;cycle();await new Promise(resolve=>setTimeout(resolve,300));cycle();assert.equal(corrections(g).length,before);
      held.worn=true;cycle();assert.equal(held.poisonCount,7);assert.equal(corrections(g).length,before+1);
      const settled=corrections(g).length;for(let i=0;i<100;i++)cycle();assert.equal(corrections(g).length,settled);assert.deepEqual(weaponMutations(g),[]);
      console.log('PASS already poisoned entry: two inventory applications 0.3 s apart wait for expected local weapon, then one in-place correction');
    }
  }
  console.log('NOT PROVED: bot receive in Skyrim, TESEquipEvent emission, PO3 VM registration, native in-place animation/hand/attack set. No DB/login was tested.');
  scope.close();process.exit(0);
} catch(error){scope.close();console.error('FAIL D-P1-fix3 native client harness:',error.stack);process.exit(1);}
