const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
// Uses the real TS service, with the declared Skyrim Platform hit shape and
// worldViewMisc remapping. Host packet remains the existing OnHit schema.
function harness({hosted=[91],aggressor=0xff001111,sourceId=0x1f4,kind='WEAP',targetType=43}={}) {
  const logs=[],sent=[],events=new Map(),map=new Map([[0xff001111,91],[0x14,0x14],[0xff002222,92]]);
  const source=kind===null?null:{getFormID:()=>sourceId,getType:()=>kind};
  const event={aggressor:{getFormID:()=>aggressor},target:{getFormID:()=>0xff002222,getBaseObject:()=>({getType:()=>targetType})},source,projectile:null,isBashAttack:false,isHitBlocked:true,isPowerAttack:false,isSneakAttack:false};
  class ClientListener{}
  const sp={Weapon:{from:s=>s&&kind==='WEAP'?s:null},Spell:{from:s=>s&&kind==='SPEL'?s:null},Scroll:{from:s=>s&&kind==='SCRL'?s:null}};
  const controller={on:(name,callback)=>events.set(name,callback),emitter:{emit:(...args)=>sent.push(args)}};
  const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/services/services/hitService.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2017}}).outputText;
  let now=1000;const storage={hosted};const exports={};
  vm.runInNewContext('(function(exports,require){'+code+'\n})',{Date:class extends Date{static now(){return now;}}})(exports,name=>{
    if(name==='../../view/worldViewMisc')return{localIdToRemoteId:id=>map.get(id)??id};
    if(name==='skyrimPlatform')return {storage,FormType:{Static:34,MovableStatic:35}};
    if(name==='./clientListener')return{ClientListener};
    if(name==='../../messages')return{MsgType:{OnHit:23}};
    if(name==='../../logging')return{logTrace:(_service,tag,text)=>logs.push({tag,...JSON.parse(text)})};
    throw Error(name);
  });new exports.HitService(sp,controller);
  return {logs,sent,event,storage,map,hit:()=>events.get('hit')(event),advance:ms=>now+=ms};
}
test('hosted NPC logs TESHitEvent entry and reliable send with source/type and remapped IDs',()=>{
  const h=harness();h.hit();assert.deepEqual(h.logs.map(r=>r.reason),['TES_HIT_EVENT','SEND_RELIABLE']);
  for(const r of h.logs){assert.equal(r.sourceId,0x1f4);assert.equal(r.sourceType,'WEAP');assert.equal(r.aggressorLocal,0xff001111);assert.equal(r.aggressorRemote,91);assert.equal(r.targetLocal,0xff002222);assert.equal(r.targetRemote,92);assert.equal(r.hosted,true);}
  assert.deepEqual(JSON.parse(JSON.stringify(h.sent)),[['sendMessage',{message:{t:23,data:{aggressor:91,isBashAttack:false,isHitBlocked:true,isPowerAttack:false,isSneakAttack:false,projectile:0,source:0x1f4,target:92}},reliability:'reliable'}]]);
});
for(const [name,options,reason] of [
  ['nonlocal NPC',{aggressor:0x123},'AGGRESSOR_NOT_LOCAL_NPC_OR_PLAYER'],
  ['non hoster',{hosted:[]},'AGGRESSOR_NOT_HOSTED'],
  ['static target',{targetType:34},'TARGET_STATIC'],
  ['movable static target',{targetType:35},'TARGET_STATIC'],
  ['null source',{kind:null},'SOURCE_NOT_WEAPON_SPELL_OR_SCROLL'],
  ['unexpected source type',{kind:'MGEF'},'SOURCE_NOT_WEAPON_SPELL_OR_SCROLL'],
])test(name+' logs the exact discard without sending',()=>{
  const h=harness(options);h.hit();assert.deepEqual(h.logs.map(r=>r.reason),['TES_HIT_EVENT',reason]);assert.equal(h.sent.length,0);
});
test('offset hosted identity remains accepted with unchanged remote packet ID',()=>{const h=harness({hosted:[91+0x100000000]});h.hit();assert.equal(h.sent.length,1);assert.equal(h.logs[0].hosted,true);assert.equal(h.sent[0][1].message.data.aggressor,91);});
for(const sourceId of [0x803,0xc5f2])test('magic '+sourceId.toString(16)+' is logged and sent unchanged, never unarmed',()=>{
  const h=harness({sourceId,kind:'SPEL'});h.hit();h.advance(50);h.hit();
  assert.equal(h.sent.length,1);assert.equal(h.sent[0][1].message.data.source,sourceId);assert.equal(h.logs.at(-1).reason,'MAGIC_DUPLICATE');assert.equal(h.logs.at(-1).sourceType,'SPEL');
  h.advance(100);h.hit();assert.equal(h.sent.length,2);
});
test('weapon hits are never deduplicated as magic',()=>{const h=harness();h.hit();h.hit();assert.equal(h.sent.length,2);assert.equal(h.logs.filter(r=>r.reason==='SEND_RELIABLE').length,2);});
test('diagnostic read failure leaves original hit payload and decision intact',()=>{const h=harness();h.event.source.getType=()=>{throw Error('diagnostic only');};h.hit();assert.equal(h.sent.length,1);assert.equal(h.logs[0].diagnostic,'UNAVAILABLE');assert.equal(h.sent[0][1].message.data.source,0x1f4);});
test('player path keeps its packet without NPC traces',()=>{const h=harness({aggressor:0x14});h.hit();assert.equal(h.sent.length,1);assert.equal(h.logs.length,0);});
