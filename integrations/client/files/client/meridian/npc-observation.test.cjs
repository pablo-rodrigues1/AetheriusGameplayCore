const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
// Shape: remoteServer.ts hostStart/hostStop/createActor/updateProperty;
// sendInputsService.ts hosted refs; Skyrim Platform 2.8.0 declarations.
// ActionListener.cpp OnHostAttempt adds 0x100000000 only to placed actor IDs;
// worldViewMisc.ts maps the hosted ID to a separate local reference.
function harness({hostedId=91,localId=hostedId}={}) {
  const events=new Map(), native=new Map(), sent=[], logs=[], forms=[], actors=new Map(), remoteReads=[], formReads=[];let now=1000;
  class ClientListener{} class NetworkingService{} class RemoteServer{}
  const sp={storage:{hosted:[hostedId]},Actor:{from:a=>a},Game:{getFormEx:id=>{formReads.push(id);return actors.get(id);},getModName:slot=>({1:'Creature.esp',4:'Creature.esp'})[slot],getLightModName:slot=>({2:'Light.esl',7:'Light.esl'})[slot]}};
  const controller={on:(e,f)=>native.set(e,f),emitter:{on:(e,f)=>events.set(e,f),emit:(e,p)=>sent.push([e,p])},lookupListener:type=>type===NetworkingService?{isConnected:()=>true}:{getWorldModel:()=>({forms})}};
  const exports={};const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/services/services/npcObservationService.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2017}}).outputText;
  const localDate=class extends Date{static now(){return now;}};
  vm.runInNewContext('(function(exports,require){'+code+'\n})',{Date:localDate})(exports,name=>{
    if(name==='../../messages')return {MsgType:{CustomPacket:1}};
    if(name==='../../logging')return {logTrace:(...args)=>logs.push(args.slice(1))};
    if(name==='../../view/worldViewMisc')return {remoteIdToLocalId:id=>{remoteReads.push(id);return id===hostedId?localId:0;}};
    if(name==='./clientListener')return {ClientListener};if(name==='./networkingService')return {NetworkingService};if(name==='./remoteServer')return {RemoteServer};throw Error(name);
  });
  new exports.NpcObservationService(sp,controller);
  const model={refrId:hostedId,aetheriusNpcObservation:{generation:1}};forms.push(model);
  let base=1*2**24+0xabc,level=2,loaded=true,fail=false,template=null,templateReads=0,race=null;
  const actor={is3DLoaded:()=>loaded,getLeveledActorBase:()=>{if(fail)throw Error('native read');return base===null?null:{getFormID:()=>base,getTemplate:()=>{templateReads++;return template===null?null:{getFormID:()=>template};}};},getLevel:()=>level,getRace:()=>race===null?null:{getFormID:()=>race}};actors.set(localId,actor);
  return {sp,model,forms,actors,sent,logs,events,remoteReads,formReads,get templateReads(){return templateReads;},set:(data)=>{if('base'in data)base=data.base;if('level'in data)level=data.level;if('loaded'in data)loaded=data.loaded;if('fail'in data)fail=data.fail;if('template'in data)template=data.template;if('race'in data)race=data.race;},tick:()=>{now+=501;native.get('update')();},allPackets:()=>sent.map(([,p])=>JSON.parse(p.message.contentJsonDump)),reports:()=>sent.filter(([,p])=>JSON.parse(p.message.contentJsonDump).channel==='aetherius.npc.observation'),packets:()=>sent.map(([,p])=>JSON.parse(p.message.contentJsonDump)).filter(p=>p.channel==='aetherius.npc.observation')};
}
test('one reliable report per loaded host ref, then base/level/generation changes',()=>{
  const h=harness();h.tick();h.tick();assert.equal(h.reports().length,1);assert.equal(h.sent[0][1].reliability,'reliable');
  assert.deepEqual(h.packets()[0],{channel:'aetherius.npc.observation',v:1,actor:91,base:'000abc:Creature.esp',level:2,generation:1});
  h.set({level:3});h.tick();h.model.aetheriusNpcObservation.generation=2;h.tick();h.set({base:4*2**24+0xdef});h.tick();assert.equal(h.reports().length,4);
});
test('stable base survives regular and light plugin reordering',()=>{
  const h=harness();h.tick();h.set({base:4*2**24+0xabc});h.tick();assert.equal(h.reports().length,1);
  h.set({base:0xfe*2**24+2*0x1000+0xabc});h.tick();assert.equal(h.packets().at(-1).base,'000abc:Light.esl');
  h.set({base:0xfe*2**24+7*0x1000+0xabc});h.tick();assert.equal(h.reports().length,2);
});
test('only hosted refs marked by records are reported; dead NPC waits',()=>{
  const h=harness();h.sp.storage.hosted=[];h.tick();assert.equal(h.reports().length,0);
  h.sp.storage.hosted=[91];delete h.model.aetheriusNpcObservation;h.tick();assert.equal(h.reports().length,0);
  h.model.aetheriusNpcObservation={generation:1};h.model.isDead=true;h.tick();assert.equal(h.reports().length,0);h.model.isDead=false;h.tick();assert.equal(h.reports().length,1);
});
test('unload/reload and host transfer release deduplication',()=>{
  const h=harness();h.tick();h.set({loaded:false});h.tick();h.tick();assert.equal(h.logs.length,1);h.set({loaded:true});h.tick();assert.equal(h.reports().length,2);
  h.sp.storage.hosted=[];h.tick();h.sp.storage.hosted=[91];h.tick();assert.equal(h.reports().length,3);
});
test('connection reset forces a fresh report',()=>{
  const h=harness();h.tick();h.events.get('connectionAccepted')();h.tick();assert.equal(h.reports().length,2);h.events.get('hostStopMessage')({message:{target:91}});h.tick();assert.equal(h.reports().length,3);
});
test('unreadable, dynamic or invalid engine observations send nothing and log reason once',()=>{
  const h=harness();h.set({fail:true});h.tick();h.tick();assert.equal(h.reports().length,0);assert.equal(h.logs.length,1);
  h.set({fail:false,base:0xff*2**24+123});h.tick();assert.equal(h.reports().length,0);assert.match(h.logs.at(-1).join(' '),/RACE_ABSENT/);
  h.set({base:1*2**24+0xabc,level:NaN});h.tick();assert.equal(h.reports().length,0);assert.match(h.logs.at(-1).join(' '),/INVALID_ENGINE_LEVEL/);
  h.set({level:2});h.tick();assert.equal(h.reports().length,1);
});

test('unavailable channel uses exact closed reason once per actor, generation and reason',()=>{
  const h=harness();h.set({loaded:false});h.tick();h.tick();
  assert.deepEqual(h.allPackets(),[{channel:'aetherius.npc.observation.unavailable',v:1,actor:91,generation:1,reason:'ACTOR_NOT_LOADED'}]);
  assert.equal(h.sent[0][1].reliability,'reliable');
  h.set({loaded:true,fail:true});h.tick();
  h.set({fail:false,loaded:false});h.tick();assert.equal(h.allPackets().length,2,'a previous reason stays deduplicated');
  h.model.aetheriusNpcObservation.generation=2;h.tick();assert.equal(h.allPackets().length,3);
  assert.equal(h.allPackets().at(-1).generation,2);
  assert.equal(h.allPackets()[1].reason,'ENGINE_READ_FAILED');
  assert(!JSON.stringify(h.allPackets()).includes('native read'),'exception text must not leave the client');
  h.events.get('connectionAccepted')();h.tick();assert.equal(h.allPackets().length,4);
});
test('successful observation does not reset unavailable deduplication in the same generation',()=>{
  const h=harness();h.set({loaded:false});h.tick();h.set({loaded:true});h.tick();h.set({loaded:false});h.tick();
  assert.equal(h.allPackets().filter(p=>p.channel.endsWith('.unavailable')).length,1);
  assert.equal(h.reports().length,1);
});

test('temporary base with stable root template stays explicitly unsupported: root is not the selected NPC',()=>{
  const h=harness();h.set({base:0xff*2**24+123,template:1*2**24+0xabc});h.tick();h.tick();
  assert.equal(h.reports().length,0);assert.equal(h.templateReads,0);
  assert.deepEqual(h.allPackets(),[{channel:'aetherius.npc.observation.unavailable',v:1,actor:91,generation:1,reason:'RACE_ABSENT'}]);
});
test('temporary base without template and absent resolved base emit closed diagnostic reasons',()=>{
  const h=harness();h.set({base:0xff*2**24+123,template:null});h.tick();h.tick();
  assert.equal(h.reports().length,0);assert.equal(h.allPackets().length,1);
  assert.equal(h.allPackets()[0].reason,'RACE_ABSENT');
  h.set({base:null});h.tick();h.tick();assert.equal(h.allPackets().length,2);
  assert.equal(h.allPackets()[1].reason,'RESOLVED_BASE_ABSENT');
});

test('temporary base sends exact v2 race and level; root is never read',()=>{
  const h=harness();h.set({base:0xff*2**24+123,race:1*2**24+0xabc,template:1*2**24+0xdef});h.tick();h.tick();
  assert.deepEqual(h.packets(),[{channel:'aetherius.npc.observation',v:2,actor:91,race:'000abc:Creature.esp',level:2,generation:1}]);
  assert.equal(h.templateReads,0);assert.equal(h.sent[0][1].reliability,'reliable');
  h.set({race:4*2**24+0xabc});h.tick();assert.equal(h.packets().length,1);
  h.set({race:0xfe*2**24+2*0x1000+0xabc});h.tick();assert.equal(h.packets().at(-1).race,'000abc:Light.esl');
  h.set({race:0xfe*2**24+7*0x1000+0xabc});h.tick();assert.equal(h.packets().length,2);
  h.set({level:3});h.tick();h.model.aetheriusNpcObservation.generation=2;h.tick();assert.equal(h.packets().length,4);
  h.events.get('connectionAccepted')();h.tick();assert.equal(h.packets().length,5);
  h.set({base:1*2**24+0xabc});h.tick();assert.equal(h.packets().at(-1).v,1);
});
test('v2 missing race, unstable race and invalid engine level use closed deduplicated reasons',()=>{
  const h=harness();h.set({base:0xff*2**24+123});h.tick();h.tick();
  assert.equal(h.allPackets()[0].reason,'RACE_ABSENT');
  h.set({race:0xff*2**24+456});h.tick();h.tick();assert.equal(h.allPackets()[1].reason,'RACE_HAS_NO_STABLE_KEY');
  h.set({race:1*2**24+0xabc,level:0});h.tick();assert.equal(h.allPackets()[2].reason,'INVALID_ENGINE_LEVEL');
  h.set({level:2});h.tick();assert.equal(h.packets().length,1);
  h.set({race:null});h.tick();assert.equal(h.allPackets().length,4,'same generation reason remains deduplicated');
  h.sp.storage.hosted=[];h.tick();h.sp.storage.hosted=[91];h.tick();assert.equal(h.allPackets().length,5);
});

for (const [kind,hostedId,serverId] of [
  ['placed',0x100108307,0x108307],
  ['placed above signed 32-bit hosted range',0x16e391f8b,0x6e391f8b],
  ['server-created',0xff000123,0xff000123],
  ['server-created uint32 maximum',0xffffffff,0xffffffff],
]) {
  for (const version of [1,2]) test(kind+' v'+version+' sends server FormID and retains hosted lookup/deduplication',()=>{
    const localId=0xff123456,h=harness({hostedId,localId});
    if(version===2)h.set({base:0xff000789,race:1*2**24+0xabc});
    h.tick();h.tick();
    const expected={channel:'aetherius.npc.observation',v:version,actor:serverId,
      [version===1?'base':'race']:'000abc:Creature.esp',level:2,generation:1};
    assert.deepEqual(h.packets(),[expected]);
    assert.deepEqual(h.remoteReads,[hostedId,hostedId]);
    assert.deepEqual(h.formReads,[localId,localId]);
    assert.deepEqual(h.sp.storage.hosted,[hostedId]);
    assert.equal(h.model.refrId,hostedId);
    assert.equal(h.sent[0][1].reliability,'reliable');
    h.events.get('hostStopMessage')({message:{target:hostedId}});h.tick();
    assert.deepEqual(h.packets(),[expected,expected],'hostStop releases the original hosted key');
    h.model.aetheriusNpcObservation.generation=2;h.tick();
    assert.deepEqual(h.packets().at(-1),{...expected,generation:2});
  });
  test(kind+' unavailable sends server FormID and retains hosted failure deduplication',()=>{
    const localId=0xff123456,h=harness({hostedId,localId});h.set({loaded:false});h.tick();h.tick();
    const expected={channel:'aetherius.npc.observation.unavailable',v:1,actor:serverId,generation:1,reason:'ACTOR_NOT_LOADED'};
    assert.deepEqual(h.allPackets(),[expected]);
    assert.deepEqual(h.remoteReads,[hostedId,hostedId]);
    assert.deepEqual(h.formReads,[localId,localId]);
    assert.equal(h.sent[0][1].reliability,'reliable');
    h.events.get('hostStopMessage')({message:{target:hostedId}});h.tick();
    assert.deepEqual(h.allPackets(),[expected,expected]);
    h.model.aetheriusNpcObservation.generation=2;h.tick();
    assert.deepEqual(h.allPackets().at(-1),{...expected,generation:2});
  });
}
