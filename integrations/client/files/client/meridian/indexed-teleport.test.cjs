const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
// Tests the real RemoteServer handler. Object shapes follow IdManager,
// worldViewMisc.getObjectReference and RagdollService's completion callback.
// Native stubs test handler decisions, not Skyrim engine convergence.
function harness() {
  const updates=[],logs=[],moves=[],completed=[];
  let ragdollCallback,missing=false,throwApply=false,destination=true;
  const npc={getFormID:()=>901},player={getFormID:()=>0x14};
  let reference=npc,view={},mappedId=1;
  const forms=[{refrId:40},{refrId:91}];
  const storage={worldModel:{forms,playerCharacterFormIdx:0,playerCharacterRefrId:40},
    idManager:{getId:idx=>idx===7?mappedId:-1}};
  const sp={storage,on:()=>{},once:(_e,cb)=>updates.push(cb),
    Actor:{from:r=>r},ObjectReference:{from:r=>r},
    Cell:{from:r=>r?.kind==='cell'?r:null},WorldSpace:{from:r=>r?.kind==='world'?r:null},
    Game:{getPlayer:()=>player,getFormEx:id=>id===100&&destination?{kind:'world'}:id===200&&destination?{kind:'cell'}:id===901?reference:null},
    TESModPlatform:{moveRefrToPosition:(...args)=>{if(throwApply)throw Error('native failure');moves.push(args);}}};
  const exports={};
  const source=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/services/services/remoteServer.ts'),'utf8'),
    {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2017}}).outputText;
  vm.runInNewContext('(function(exports,require){'+source+'\n})',{})(exports,name=>{
    if(name==='skyrimPlatform')return sp;
    if(name==='../../logging')return {logTrace:(_self,...args)=>logs.push(args),logError:()=>{}};
    if(name==='./clientListener')return {ClientListener:class{}};
    if(name==='./skyDeathTravel')return {skyDeathCemeteryMarker:()=>null,skyDeathKeepsPhysics:()=>false};
    if(name==='../../view/worldViewMisc')return {getObjectReference:()=>missing?null:reference,
      getViewFromStorage:()=>({getFormViews:()=>({getNthFormView:()=>view})})};
    return new Proxy({},{get:()=>class{}});
  });
  const server=Object.create(exports.RemoteServer.prototype);
  server.sp=sp;server.controller={lookupListener:()=>({safeRemoveRagdollFromWorld:(_actor,cb)=>{ragdollCallback=cb;}})};
  const message={idx:7,pos:[1,2,3],rot:[4,5,6],worldOrCell:100};
  return {forms,storage,message,moves,logs,completed,
    receive:(msg=message)=>server.onTeleportMessage({message:msg},{complete:(_task,ok)=>completed.push(ok)}),
    update:()=>updates.splice(0).forEach(cb=>cb()),finish:()=>ragdollCallback(),
    statuses:()=>logs.filter(x=>x[0]==='indexedTeleport').map(x=>x[1]),
    missing:()=>{missing=true;},unmap:()=>{mappedId=-1;},mapToPlayer:()=>{mappedId=0;},
    replaceModel:()=>{forms[1]={refrId:92};},replaceView:()=>{view={};},
    replaceReference:()=>{reference={getFormID:()=>902};},
    failApply:()=>{throwApply=true;},missingDestination:()=>{destination=false;}};
}
test('indexed NPC teleport records receipt, local resolution, pending callback and native completion',()=>{
  const h=harness();h.receive();assert.deepEqual(h.statuses(),['RECEIVED']);h.update();
  assert.deepEqual(h.statuses(),['RECEIVED','RESOLVED','RAGDOLL_PENDING']);assert.equal(h.moves.length,0);
  h.finish();assert.equal(h.moves.length,1);assert.equal(h.moves[0][0].getFormID(),901);
  assert.deepEqual(h.moves[0].slice(3),[1,2,3,4,5,6]);assert.deepEqual(h.completed,[true]);
  assert.equal(h.statuses().at(-1),'APPLIED');
  const resolved=h.logs.find(x=>x[1]==='RESOLVED')[2];assert.equal(resolved.idx,7);assert.equal(resolved.remoteId,91);assert.equal(resolved.refrId,901);
});
test('indexed interior destination uses the same handler',()=>{
  const h=harness();h.message.worldOrCell=200;h.receive();h.update();h.finish();
  assert.equal(h.moves[0][1].kind,'cell');assert.equal(h.moves[0][2],null);
});
test('unknown idx logs failure without falling through to the player',()=>{
  const h=harness();h.unmap();h.receive();h.update();assert.equal(h.moves.length,0);
  assert.equal(h.statuses().at(-1),'IDX_UNRESOLVED');assert.deepEqual(h.completed,[false]);
});
test('missing local reference logs failure before ragdoll',()=>{
  const h=harness();h.missing();h.receive();h.update();assert.equal(h.moves.length,0);
  assert.equal(h.statuses().at(-1),'REFERENCE_ABSENT');assert.deepEqual(h.completed,[false]);
});
test('idx reuse between receipt and update cannot teleport the player',()=>{
  const h=harness();h.receive();h.mapToPlayer();h.update();assert.equal(h.moves.length,0);
  assert.equal(h.statuses().at(-1),'IDENTITY_CHANGED');assert.deepEqual(h.completed,[false]);
});
for(const change of ['unmap','mapToPlayer','replaceModel','replaceView','replaceReference','missing']) {
  test('callback rejects changed identity: '+change,()=>{
    const h=harness();h.receive();h.update();h[change]();h.finish();
    assert.equal(h.moves.length,0);assert.equal(h.statuses().at(-1),'IDENTITY_CHANGED');assert.deepEqual(h.completed,[false]);
  });
}
test('unresolved destination is reported explicitly',()=>{
  const h=harness();h.receive();h.update();h.missingDestination();h.finish();
  assert.equal(h.moves.length,0);assert.equal(h.statuses().at(-1),'DESTINATION_ABSENT');assert.deepEqual(h.completed,[false]);
});
test('native application exception records failure instead of success',()=>{
  const h=harness();h.receive();h.update();h.failApply();h.finish();
  assert.equal(h.moves.length,0);assert.equal(h.statuses().at(-1),'APPLY_FAILED');assert.deepEqual(h.completed,[false]);
});
test('Teleport2 continues to target only the player',()=>{
  const h=harness();const {idx,...msg}=h.message;h.receive(msg);h.update();h.finish();
  assert.equal(h.moves.length,1);assert.deepEqual(h.statuses(),[]);
});
