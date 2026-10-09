import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {client} from './perk-client.mjs';
const workspace=fileURLToPath(new URL('../../../',import.meta.url));let sequence=0;
// Executes the actual RemoteServer hooks. Surrounding services and SP calls are
// narrow imitations of the signatures in the client, not a local game/server.
async function setup({service=true}={}){
  const f=client(),queues={update:[],tick:[]},waits=[],appearances=[],calls=[];
  if(!service)f.emitter.removeAllListeners('gameplaySpawnBegin');
  const player=f.sp.Game.getPlayer();Object.assign(player,{getPositionX:()=>0,getPositionY:()=>0,getPositionZ:()=>0,setActorValue:()=>{}});
  f.sp.Game.getFormEx=()=>null;
  f.sp.Game.getModCount=()=>1;f.sp.Game.getModName=()=> 'fixture.esp';
  f.sp.Utility={wait:seconds=>new Promise(resolve=>waits.push({seconds,resolve}))};
  f.sp.storage={worldModel:{forms:[],playerCharacterFormIdx:-1,playerCharacterRefrId:0},idManager:{allocateIdFor:()=>0,getId:()=>0}};
  f.sp.once=(event,fn)=>queues[event].push(fn);f.sp.on=()=>{};
  f.sp.TESModPlatform={moveRefrToPosition:()=>calls.push('placement')};
  f.sp.Cell=f.sp.WorldSpace=f.sp.Actor=f.sp.ObjectReference=f.sp.Armor={from:x=>x};
  const stubs={
    '../../sync/appearance':"export const applyAppearanceToPlayer=(a,cb)=>globalThis.__B5B.appearances.push(cb);",
    '../../sync/spell':"export const removeAllSpells=()=>globalThis.__B5B.calls.push('removeAllSpells');export const learnSpells=()=>globalThis.__B5B.calls.push('learnSpells');",
    '../../sync/equipment':"export const applyEquipment=()=>{globalThis.__B5B.calls.push('equipment');return true};export const isBadMenuShown=()=>false;",
    '../../sync/inventory':"export const applyInventory=()=>{};",
    '../../sync/actorvalues':"export const setActorValuePercentage=()=>{};",
    '../../extensions/objectReferenceEx':"export const ObjectReferenceEx={};",
    '../../lib/idManager':"export class IdManager{}",
    '../../lib/nameof':"export const nameof=s=>s;",
    '../../lib/errors':"export class RespawnNeededError extends Error{}",
    '../../view/modelApplyUtils':"export const ModelApplyUtils={};",
    '../../view/worldViewMisc':"export const getObjectReference=()=>null;export const getViewFromStorage=()=>null;export const remoteIdToLocalId=id=>id;",
    '../../logging':"export const logTrace=()=>{};export const logError=()=>{};",
    './loadGameService':"export class LoadGameService{}",
    './timeService':"export class TimeService{}",
    './ragdollService':"export class RagdollService{}"
  };
  globalThis.__B5B={sp:f.sp,calls,appearances};
  const result=await build({entryPoints:[`${workspace}/aetherius-client/client/src/services/services/remoteServer.ts`],bundle:true,platform:'node',format:'esm',write:false,footer:{js:`// fixture ${sequence++}`},plugins:[{name:'narrow-SP-services',setup(b){
    b.onResolve({filter:/.*/},args=>args.path==='skyrimPlatform'||stubs[args.path]?{path:args.path,namespace:'b5b-stub'}:undefined);
    b.onLoad({filter:/.*/,namespace:'b5b-stub'},args=>({loader:'js',contents:args.path==='skyrimPlatform'?
      `const s=globalThis.__B5B.sp; export const Game=s.Game,Utility=s.Utility,once=s.once,on=s.on,storage=s.storage,TESModPlatform=s.TESModPlatform,Cell=s.Cell,WorldSpace=s.WorldSpace,Actor=s.Actor,ObjectReference=s.ObjectReference,Armor=s.Armor,FormType={},Menu={},Ui={},Form={};export const interruptCast=()=>{},castSpellImmediate=()=>{},printConsole=()=>{},applyAnimationVariablesToActor=()=>{}; //${sequence++}`:stubs[args.path]}));
  }}]});
  const {RemoteServer}=await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
  const controller={...f.controller,lookupListener:cls=>cls.name==='LoadGameService'?{loadGame:()=>calls.push('loadGame')}:{getTime:()=>({newGameHourValue:12})}};
  const remote=new RemoteServer(f.sp,controller);
  const flush=async event=>{for(const fn of queues[event].splice(0))fn();await Promise.resolve();};
  const resolve=async seconds=>{for(const wait of waits.filter(w=>w.seconds===seconds))wait.resolve();for(let i=waits.length-1;i>=0;i--)if(waits[i].seconds===seconds)waits.splice(i,1);await Promise.resolve();await Promise.resolve();};
  const spawn=()=>remote.onCreateActorMessage({message:{isMe:true,idx:1,transform:{pos:[0,0,0],rot:[0,0,0],worldOrCell:1},props:{learnedSpells:[1]},equipment:{},appearance:{},customPropsJsonDumps:[]}});
  const handshake=()=>{f.receive({channel:'aetherius.gameplay.grants',v:1,session:'session',type:'hello'});const begin=f.sent.at(-1);if(begin)f.receive({channel:'aetherius.gameplay.grants',v:1,session:'session',type:'challenge',cycle:begin.cycle,challenge:'challenge'});};
  return {f,calls,appearances,remote,flush,resolve,spawn,handshake};
}
test('real spawn without loadGame: ready after both equipment calls, spells, placement and deferred appearance',async()=>{
  const f=await setup();f.spawn();f.handshake();await f.flush('update');await f.resolve(1);assert(!f.f.sent.some(p=>p.type==='ready'));
  await f.resolve(1.3);assert(!f.f.sent.some(p=>p.type==='ready'));f.appearances[0](true);assert.equal(f.f.sent.at(-1).type,'ready');
  assert.deepEqual(f.calls.filter(c=>c==='equipment'),['equipment','equipment']);assert.equal(f.calls.filter(c=>c==='learnSpells').length,1);
});
test('real spawn with loadGame: gameLoad alone not ready; post-load spell reapplication is required',async()=>{
  const f=await setup();f.spawn();f.handshake();await f.flush('tick');await f.flush('tick');assert(f.calls.includes('loadGame'));
  await f.flush('update');await f.resolve(1);await f.resolve(0.3);f.appearances[0](true);assert(!f.f.sent.some(p=>p.type==='ready'));
  f.f.emitter.emit('gameLoad',{isCausedBySkyrimPlatform:true});assert(!f.f.sent.some(p=>p.type==='ready'));await f.flush('update');await f.resolve(1);
  assert.equal(f.f.sent.at(-1).type,'ready');assert.equal(f.calls.filter(c=>c==='learnSpells').length,2);assert.equal(f.calls.filter(c=>c==='equipment').length,2);
});
test('without registered service original spawn calls still execute; hook is optional',async()=>{
  const f=await setup({service:false});f.spawn();await f.flush('update');await f.resolve(1);await f.resolve(1.3);
  assert.equal(f.appearances[0],undefined);assert.equal(f.calls.filter(c=>c==='learnSpells').length,1);assert.equal(f.calls.filter(c=>c==='equipment').length,2);assert.equal(f.f.sent.length,0);
});
