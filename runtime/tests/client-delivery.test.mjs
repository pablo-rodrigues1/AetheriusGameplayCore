import assert from 'node:assert/strict';
import {test} from 'node:test';
import {api,utils} from './b5b-source.mjs';
import {fakeHost} from './host.mjs';
import {officialHost} from './official-host.mjs';
const channel='aetherius.gameplay.grants';
function setup(t,{enabled=true}={}){
  t.mock.timers.enable({apis:['setTimeout','setInterval']});
  const mp=fakeHost(),scope=new utils.Scope(),actors=new utils.Actors(mp,scope,false,()=>{}),sent=[],events=[];
  mp.getUserActor=user=>[...mp.users].find(([,u])=>u===user)?.[0]??0;
  mp.sendCustomPacket=(user,raw)=>sent.push({user,...JSON.parse(raw)});
  const official=officialHost(mp);official.authenticate(91);
  const delivery=enabled?new api.ClientDelivery(mp,actors,scope,()=>true,()=>{}):undefined;
  delivery?.start(new utils.Hooks(mp,scope,()=>{}));actors.onReady(e=>events.push(e));actors.start();
  t.after(()=>scope.close());
  const binding=actors.lookup({actorId:91}).value;
  const send=p=>mp.emitter.emit('customPacket',0,JSON.stringify({channel,v:1,session:sent[0]?.session,...p}));
  const begin=cycle=>{send({type:'begin',cycle});return sent.at(-1);};
  return {mp,actors,delivery,sent,events,official,binding,send,begin,scope};
}
test('speaking client: ready waits for exact challenge, never the 3 seconds; respawn and new cycles invalidate',t=>{
  const f=setup(t),challenge=f.begin('spawn1');assert.equal(challenge.type,'challenge');
  t.mock.timers.tick(3000);assert.equal(f.events.length,0);
  f.send({type:'ready',cycle:'spawn1',challenge:'wrong'});assert.equal(f.events.length,0);
  f.send({type:'ready',cycle:'spawn1',challenge:challenge.challenge});assert.equal(f.events.length,1);assert.equal(f.events[0].signal,'CLIENT_SPAWN_TASKS_COMPLETED');
  f.send({type:'ready',cycle:'spawn1',challenge:challenge.challenge});assert.equal(f.events.length,1);
  const second=f.begin('spawn2');f.send({type:'ready',cycle:'spawn1',challenge:challenge.challenge});assert.equal(f.events.length,1);
  f.mp.onRespawn(91);assert.equal(f.delivery.current(f.binding).ready,false);
  f.send({type:'ready',cycle:'spawn2',challenge:second.challenge});assert.equal(f.events.length,1);
  const third=f.begin('respawn');f.send({type:'ready',cycle:'respawn',challenge:third.challenge});assert.equal(f.events.length,2);
});
test('malformed/version/size/user/session/replay/order packets have no effect; begin rate limited',t=>{
  const f=setup(t),initial=f.sent.length;
  for(const raw of ['{','null','[]',JSON.stringify({channel,v:2,type:'begin',cycle:'bad'}),' '.repeat(65537)])f.mp.emitter.emit('customPacket',0,raw);
  f.mp.emitter.emit('customPacket',1,JSON.stringify({channel,v:1,session:f.sent[0].session,type:'begin',cycle:'other'}));
  f.send({session:'old',type:'begin',cycle:'bad'});f.send({type:'ready',cycle:'bad',challenge:'missing'});
  f.send({type:'begin',cycle:'payload-identity',userId:0});assert.equal(f.sent.length,initial);
  f.begin('one');f.begin('one');assert.equal(f.sent.length,initial+1);
  for(const id of ['two','three','four','fifth'])f.begin(id);assert.equal(f.sent.length,initial+4);
  f.official.authenticate(91);f.send({type:'begin',cycle:'obsolete'});assert.equal(f.sent.length,initial+4);assert.equal(f.delivery.current(f.binding),undefined);
});
test('legacy client and protocol off retain declared approximation; native listeners do not accumulate',t=>{
  const f=setup(t);t.mock.timers.tick(3000);assert.equal(f.events[0].signal,'ONLINE_DELAY_APPROXIMATION');assert.equal(f.events[0].certified,false);
  f.scope.close();t.mock.timers.reset();
  const g=setup(t,{enabled:false});assert.equal(g.sent.length,0);t.mock.timers.tick(3000);assert.equal(g.events[0].signal,'ONLINE_DELAY_APPROXIMATION');
});
