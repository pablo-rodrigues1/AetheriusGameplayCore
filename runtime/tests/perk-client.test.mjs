import assert from 'node:assert/strict';
import {test} from 'node:test';
import {client} from './perk-client.mjs';
const base={channel:'aetherius.gameplay.grants',v:1,session:'session-one'};
const revision=n=>({facts:n,grants:n,equipment:0,effects:0,catalog:1});
const item=(key='skyrim.esm|000123',action='ensure',owned=false)=>({key,plugin:key.split('|')[0],localFormId:parseInt(key.split('|')[1],16),signature:`sha256:${'a'.repeat(64)}`,action,owned});
function setup(){const c=client();c.register(item());const b=c.spawn();c.receive({...base,type:'hello'});c.receive({...base,type:'challenge',cycle:b.id,challenge:'challenge-one'});for(const t of ['spells','appearance','equipment','placement'])b.complete(t);
  const packet=(items=[item()],n=1,id=`revision-${n}`)=>({...base,type:'perks',cycle:b.id,challenge:'challenge-one',id,revision:revision(n),items});return {c,b,packet};}
test('passive until server hello; barrier waits for each known task, failures never ready',()=>{
  const c=client(),b=c.spawn();b.complete('spells');b.complete('appearance');b.complete('placement');assert.equal(c.sent.length,0);
  c.receive({...base,type:'hello'});assert.equal(c.sent.at(-1).type,'begin');c.receive({...base,type:'challenge',cycle:b.id,challenge:'challenge-one'});assert(!c.sent.some(p=>p.type==='ready'));
  b.complete('equipment');assert.equal(c.sent.at(-1).type,'ready');b.complete('equipment');assert.equal(c.sent.filter(p=>p.type==='ready').length,1);
  const next=c.spawn(['spells','appearance']);next.complete('spells',false);c.receive({...base,type:'challenge',cycle:next.id,challenge:'challenge-two'});next.complete('appearance');assert.equal(c.sent.filter(p=>p.type==='ready').length,1);
});
test('loadGame path includes post-load spell completion; old cycle callbacks cannot ready new cycle',()=>{
  const {c,b}=setup();b.loading=true;b.require('post-load-spells');
  c.emitter.emit('gameLoad',{isCausedBySkyrimPlatform:true});assert.equal(c.sent.filter(p=>p.type==='begin').length,1);
  const newBarrier=c.spawn(['post-load-spells']);c.receive({...base,type:'challenge',cycle:newBarrier.id,challenge:'challenge-two'});
  b.complete('post-load-spells');assert.equal(c.sent.filter(p=>p.type==='ready').length,1);
  newBarrier.complete('post-load-spells');assert.equal(c.sent.filter(p=>p.type==='ready').length,2);
  c.emitter.emit('gameLoad',{isCausedBySkyrimPlatform:false});assert.equal(c.sent.filter(p=>p.type==='begin').length,3);assert.equal(c.sent.filter(p=>p.type==='ready').length,2);
});
test('presence checks protect external perks; failed native calls, unresolved forms and removal are reported',()=>{
  const {c,packet}=setup();c.perks.add(c.forms.get(item().key).id);c.receive(packet());c.update();assert.equal(c.sent.at(-1).items[0].status,'ALREADY_PRESENT');assert.equal(c.calls.length,0);
  c.receive(packet([item(undefined,'remove',true)],2));c.update();assert.equal(c.sent.at(-1).items[0].status,'FAILED');assert.equal(c.calls.length,0);
  const missing=item('missing.esp|000234');c.receive(packet([missing],3));c.update();assert.equal(c.sent.at(-1).items[0].status,'UNRESOLVED');
  const failed=setup();failed.c.blockAdd();failed.c.receive(failed.packet());failed.c.update();assert.equal(failed.c.sent.at(-1).items[0].status,'FAILED');
});
test('duplicate exact request re-ACKs without mutation; lower revision, content conflict and invalid envelopes ignored',()=>{
  const {c,packet}=setup(),first=packet();c.receive(first);c.update();assert.equal(c.calls.length,1);c.receive(first);assert.equal(c.calls.length,1);assert.equal(c.sent.at(-1).type,'ack');
  const sent=c.sent.length;
  for(const p of ['{','null', {...first,v:2},{...first,session:'old'},{...first,challenge:'old'},packet([],0),packet([],1,'conflict'),{...first,items:[{...item(),localFormId:0}]},{...first,items:[item(),item()]},' '.repeat(65537)])c.receive(p);
  c.update();assert.equal(c.calls.length,1);assert.equal(c.sent.length,sent);
});
test('a newer publication before update replaces pending one; only latest revision applied',()=>{
  const {c,packet}=setup();const other=item('other.esl|000234');c.register(other);c.receive(packet());c.receive(packet([other],2));c.update();assert.deepEqual(c.calls,[['add',other.key]]);assert.deepEqual(c.sent.at(-1).revision,revision(2));
});
test('session replacement clears ownership; old hello/packets and callbacks cannot apply',()=>{
  const {c,packet,b}=setup();c.receive(packet());c.receive({...base,type:'hello',session:'session-two'});c.update();assert.equal(c.calls.length,0);
  c.receive({...base,type:'hello'});assert.equal(c.sent.at(-1).session,'session-two');
  c.receive({...base,type:'challenge',session:'session-two',cycle:b.id,challenge:'challenge-two'});assert.equal(c.sent.at(-1).type,'ready');
  c.receive({...packet(),session:'session-two',challenge:'challenge-two'});c.emitter.emit('connectionDisconnect',{});c.update();assert.equal(c.calls.length,0);
});
test('native calls can fail verification: removal stays failed and keeps ownership until actual absence',()=>{
  const {c,packet}=setup();c.receive(packet());c.update();c.blockRemove();c.receive(packet([item(undefined,'remove',true)],2));c.update();assert.equal(c.sent.at(-1).items[0].status,'FAILED');assert(c.perks.has(c.forms.get(item().key).id));
});
