import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {fakeHost,logger,unavailablePg} from './host.mjs';
import {officialHost} from './official-host.mjs';
import {developmentEnv} from './development-env.mjs';
import {createRequire} from 'node:module';
const compiled=await build({stdin:{contents:"export {developmentAttributes,DevelopmentAttributesProjection} from './src/attributes.ts';",resolveDir:fileURLToPath(new URL('../',import.meta.url)),loader:'ts'},bundle:true,platform:'node',format:'esm',write:false});
const {developmentAttributes,DevelopmentAttributesProjection}=await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const {createGameplayCore}=createRequire(import.meta.url)('../../dist/aetherius-gameplay-core.cjs');
const configured={...developmentEnv,GAMEPLAY_CORE_DEV_ATTRIBUTES:'300,300,300'};

for(const nodeEnv of [undefined,'production','staging','local'])
  for(const access of [undefined,'false','true']) for(const confirmation of [undefined,'false','true']) {
    const allowed=nodeEnv==='local'&&access!=='true'&&confirmation==='true';
    test(`DEV attributes gate: env=${nodeEnv}, access=${access}, opt-in=${confirmation}`,async t=>{
      t.mock.timers.enable({apis:['setTimeout','setInterval']});
      const mp=fakeHost(),authority=officialHost(mp);authority.authenticate(91);
      const writes=[],get=mp.get;mp.get=(id,key)=>key==='aetheriusDevAttributes'?null:get(id,key);
      mp.set=(...args)=>writes.push(args);const log=logger();let independent=false;
      const core=createGameplayCore({mp,pg:unavailablePg,log,env:{NODE_ENV:nodeEnv,GAME_ACCESS_CONTROL:access,
        GAMEPLAY_CORE_ALLOW_DEV_OPTIONS:confirmation,GAMEPLAY_CORE_DEV_ATTRIBUTES:'300,300,300',GAMEPLAY_CORE_MODE_PROBE:'active'}});
      core.register({id:'probe',requiresDatabase:false,start(){independent=true;}});
      try{
        await core.initialize();assert(independent);assert(core.healthCheck());
        assert.equal(log.messages.some(s=>s.includes('ERROR')&&s.includes('GAMEPLAY_CORE_DEV_ATTRIBUTES')),!allowed);
        assert.equal(writes.length,allowed?1:0);
        if(allowed){assert.deepEqual(writes[0],[91,'aetheriusDevAttributes',{health:300,magicka:300,stamina:300}]);assert(log.messages.some(s=>s.includes('DEV attributes override=300,300,300')));}
        t.mock.timers.tick(3100);assert.equal(writes.length,allowed?2:0);
      }finally{await core.shutdown();}
      if(allowed)assert.deepEqual(writes.at(-1),[91,'aetheriusDevAttributes',null]);else assert.equal(writes.length,0);
    });
  }

test('strict range, arity and integer validation; omitted option keeps records',()=>{
  assert.equal(developmentAttributes({NODE_ENV:'production'}),undefined);
  for(const raw of ['', 'false','0,300,300','-1,300,300','300,100001,300','300,300',
    '300,300,300,300','300.0,300,300','3e2,300,300','NaN,300,300',' 300,300,300','300,300,300\n','99999999999999999999,1,1'])
    assert.throws(()=>developmentAttributes({...configured,GAMEPLAY_CORE_DEV_ATTRIBUTES:raw}));
  assert.deepEqual(developmentAttributes({...configured,GAMEPLAY_CORE_DEV_ATTRIBUTES:'1,100000,300'}),{health:1,magicka:100000,stamina:300});
});

test('invalid local option has no effect and independent system continues',async t=>{
  t.mock.timers.enable({apis:['setTimeout','setInterval']});
  const mp=fakeHost(),authority=officialHost(mp);authority.authenticate(91);let calls=0;mp.set=()=>calls++;
  const log=logger(),core=createGameplayCore({mp,pg:unavailablePg,log,env:{...configured,GAMEPLAY_CORE_DEV_ATTRIBUTES:'0,300,300',GAMEPLAY_CORE_MODE_PROBE:'active'}});
  let started=false;core.register({id:'probe',requiresDatabase:false,start(){started=true;}});
  try{await core.initialize();t.mock.timers.tick(3100);assert(started);assert.equal(calls,0);assert(log.messages.some(s=>s.includes('ERROR')&&s.includes('requires three integers')));}finally{await core.shutdown();}
});

test('official session only, native availability, stale epoch clear, reconnect and ready redelivery',async t=>{
  t.mock.timers.enable({apis:['setTimeout','setInterval']});
  const mp=fakeHost(),authority=officialHost(mp);authority.authenticate(91);const get=mp.get,writes=[];
  mp.get=(id,key)=>key==='aetheriusDevAttributes'?null:get(id,key);mp.set=(...args)=>writes.push(args);
  const core=createGameplayCore({mp,pg:unavailablePg,log:logger(),env:configured});
  try{
    await core.initialize();const first=core.identity.lookup({actorId:91}).value;assert.equal(writes.length,1);
    core.actorEvents.clientLoading(first);core.actorEvents.clientReady(first);assert.equal(writes.length,2);
    core.actorEvents.respawn(first);core.actorEvents.clientReady(first);assert.equal(writes.length,3);
    authority.clear(91);core.identity.poll();assert.deepEqual(writes.at(-1),[91,'aetheriusDevAttributes',null]);
    authority.authenticate(91);core.identity.poll();const second=core.identity.lookup({actorId:91}).value;
    assert.notEqual(first.epoch,second.epoch);assert.deepEqual(writes.at(-1)[2],{health:300,magicka:300,stamina:300});
    const projection=new DevelopmentAttributesProjection(mp,developmentAttributes(configured),binding=>core.identity.isCurrent(binding),()=>{});
    const before=writes.length;projection.publish(first);assert.equal(writes.length,before);
    projection.publish(second);projection.clear(first);assert.notEqual(writes.at(-1)[2],null);projection.shutdown();assert.equal(writes.at(-1)[2],null);
  }finally{await core.shutdown();}
  const legacy=fakeHost();legacy.set=()=>assert.fail('legacy host cannot receive DEV attributes');
  const old=createGameplayCore({mp:legacy,pg:unavailablePg,log:logger(),env:{...configured,GAMEPLAY_CORE_ALLOW_OFFLINE_IDENTITY:'true'}});
  try{await old.initialize();t.mock.timers.tick(3100);}finally{await old.shutdown();}
  const warnings=[],nativeMissing=fakeHost(),auth=officialHost(nativeMissing);auth.authenticate(91);
  nativeMissing.set=()=>assert.fail('unknown native property must never fall back to custom persistence');
  const projection=new DevelopmentAttributesProjection(nativeMissing,developmentAttributes(configured),()=>true,m=>warnings.push(m));
  projection.publish({actorRef:{actorId:91},profileKey:'profile:108549',characterKey:'profile:108549',epoch:'test'});
  assert(warnings.some(s=>s.includes('UNSUPPORTED')));
});
