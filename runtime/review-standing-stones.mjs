// REVIEWER ONLY: native addon opens UDP. Never execute in the Codex sandbox.
// Coverage: real placed reference -> registered onActivate hook -> synchronous veto,
// command/persistence/composition/projection and native spell application. It does
// not cover the client C++ path that forwards activation into the registered hook;
// only an in-game session exercises that segment.
// node runtime/review-standing-stones.mjs <workspace> <new-evidence-dir> <unused-port-except-7777> <cell-or-world-local:plugin>
import assert from 'node:assert/strict';
import {existsSync,readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {build} from 'esbuild';
import path from 'node:path';
const [workspaceArg,evidenceArg,portArg,worldDesc]=process.argv.slice(2),port=Number(portArg);
assert(workspaceArg&&evidenceArg&&worldDesc&&Number.isInteger(port)&&port>1024&&port<=65535&&port!==7777,
  'Usage: node runtime/review-standing-stones.mjs <workspace> <new-evidence-dir> <unused-port-except-7777> <cell-or-world-local:plugin>');
assert(/^[0-9a-f]{1,6}:[^:]+\.(esm|esp|esl)$/i.test(worldDesc),'World/cell must be a local plugin descriptor');
const workspace=path.resolve(workspaceArg),evidence=path.resolve(evidenceArg),root=path.join(workspace,'AetheriusGameplayCore');
assert(!existsSync(evidence),'Use a new workdir/evidence directory; never overwrite a running server');
const url=new URL(process.env.AETHERIUS_TEST_DATABASE_URL??'missing:');
assert(['127.0.0.1','localhost','[::1]'].includes(url.hostname)&&url.pathname==='/aetherius_test','Only local aetherius_test');
const check=spawnSync('pwsh',['-NoProfile','-Command',`if (Get-NetUDPEndpoint -LocalPort ${port} -ErrorAction SilentlyContinue) { exit 2 }; Write-Output 'Requested UDP port free'`],{encoding:'utf8'});
assert.equal(check.status,0,'UDP port occupied/check failed: no server is stopped');
mkdirSync(evidence,{recursive:true});
const server=path.join(workspace,'aetherius-server/build/dist/server'),dataDir=path.join(server,'data');
const loadOrder=JSON.parse(readFileSync(path.join(dataDir,'aetherius-loadorder.json'),'utf8')).loadOrder;
const compiled=await build({absWorkingDir:root,stdin:{loader:'ts',resolveDir:root,contents:`
  export {loadDomain} from './shared/record-catalog/src/index.ts';
  export {createFileHost} from './tools/catalog/host.ts';
  export {readMigrations,applyMigrations,withTransaction,executeCommand} from './shared/persistence/src/index.ts';
  export {StandingStoneSystem} from './runtime/src/standing-stones.ts';
`},bundle:true,platform:'node',format:'esm',write:false});
const api=await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const require=createRequire(import.meta.url);globalThis.require=require;
process.env.GAME_DATABASE_URL=process.env.AETHERIUS_TEST_DATABASE_URL;
const pg=require(path.join(server,'gamemode/core/pg.js')),addon=require(path.join(server,'scam_native.node'));
const {SpellProjection,ActorComposition}=require(path.join(root,'dist/aetherius-gameplay-core.cjs'));
const previousCwd=process.cwd(),schema=`gc_c1_review_${process.pid}_${randomBytes(4).toString('hex')}`;
process.chdir(evidence);
let system,projection,composition,created=false,current=true,mp;
const signal=new AbortController(),subscriptions=new Set();
try{
  mp=new addon.ScampServer(JSON.stringify({port,listenHost:'127.0.0.1',maxPlayers:1,dataDir,loadOrder,npcEnabled:false,logLevel:'warn',reloot:{},offlineMode:false}));mp.tick();
  const pool=pg.init();await pool.query(`CREATE SCHEMA "${schema}"`);created=true;
  await api.applyMigrations(pool,await api.readMigrations(path.join(root,'database/migrations')),schema);
  const data=JSON.parse(readFileSync(path.join(root,'catalog/standing-stones.json'),'utf8'));
  const catalog=api.loadDomain(data,api.createFileHost(mp,dataDir,[data]));assert.equal(catalog.status,'SUPPORTED');
  const world=mp.getIdFromDesc(worldDesc);assert(['CELL','WRLD'].includes(mp.lookupEspmRecordById(world)?.record?.type));
  const profile=process.pid+1000000,actorId=mp.createActor(0,[0,0,0],0,world,profile);
  const binding={profileKey:`profile:${profile}`,characterKey:`profile:${profile}`,actorRef:{actorId},epoch:`c1-review-${process.pid}`};
  // Controlled harness binding, with real profile and actor. No simulated login
  // or claim of client readiness/delivery; that remains a human/B5b check.
  const identity={lookup:ref=>ref.actorId===actorId&&current?{status:'SUPPORTED',value:binding}:{status:'UNSUPPORTED',reason:'test binding absent'},
    isCurrent:b=>current&&b.epoch===binding.epoch&&b.actorRef.actorId===actorId&&mp.get(actorId,'profileId')===profile};
  const actors={onReady:fn=>{subscriptions.add(fn);return()=>subscriptions.delete(fn);},onUnbound:()=>()=>{}};
  const canMutate=b=>!signal.signal.aborted&&identity.isCurrent(b);
  projection=new SpellProjection({pool,schema,mp,catalogs:[catalog],identity,actors,signal:signal.signal,canProject:canMutate,warn:console.log});
  composition=new ActorComposition({pool,schema,check:b=>assert(canMutate(b)),publish:(binding,set)=>projection.publish({binding,set})});
  const hooks={register:(name,fn)=>{const old=mp[name];mp[name]=fn;(globalThis.__rvHooks??={})[name]=fn;return()=>{if(mp[name]===fn)mp[name]=old;};}};
  system=new api.StandingStoneSystem({id:'standing-stones',mode:'active',catalog,persistence:{pool,withTransaction:api.withTransaction,executeCommand:api.executeCommand},
    identity,projection,composition,actors,hooks,signal:signal.signal,log:{info:console.log},canMutate},mp,data,schema);
  system.start();for(const fn of subscriptions)fn({binding,signal:'ONLINE_DELAY_APPROXIMATION',certified:false});
  const self={type:'form',desc:mp.getDescFromId(actorId)};
  const call=(method,args=[])=>mp.callPapyrusFunction('method','Actor',method,self,args);
  const learned=()=>new Set(Array.from({length:call('GetSpellCount')},(_,n)=>mp.getIdFromDesc(call('GetNthSpell',[n]).desc)));
  const roots=catalog.roots.slice(0,2);assert.equal(roots.length,2);
  const expected=root=>root.data.spells.map(key=>catalog.byKey(key).runtimeFormId);
  assert(roots.flatMap(expected).every(id=>!learned().has(id)),'Isolated actor unexpectedly inherits a stone; no false ownership claim');
  const waitFor=async fn=>{for(let i=0;i<400;i++){mp.tick();if(await fn())return;await delay(10);}throw Error('NATIVE_ACTIVATION_DID_NOT_COMPLETE');};
  const activate=async root=>{
    // ScampServer::Place + PapyrusObjectReference.cpp Activate +
    // MpObjectReference.cpp:484-502 normally fire the native onActivate hook.
    // Invoke the exact handler registered by this harness to avoid Papyrus
    // re-entering the hook (which aborts the addon).
    const reference=mp.place(root.runtimeFormId);assert.notEqual(reference,root.runtimeFormId);
    assert.equal(mp.getIdFromDesc(mp.get(reference,'baseDesc')),root.runtimeFormId);
    assert.equal(globalThis.__rvHooks.onActivate(reference,actorId),false,'native action must be vetoed synchronously');
    await waitFor(()=>Promise.resolve(expected(root).every(id=>learned().has(id))));
    await waitFor(async()=>!!(await pool.query(`SELECT complete FROM "${schema}".gc_spell_projection_heads WHERE character_key=$1`,[binding.characterKey])).rows[0]?.complete);
    return reference;
  };
  const firstReference=await activate(roots[0]);assert(expected(roots[0]).every(id=>learned().has(id)));
  const firstFact=(await pool.query(`SELECT *,xmin::text AS version FROM "${schema}".gc_standing_stone_choice WHERE character_key=$1`,[binding.characterKey])).rows[0];
  const repeat=await system.choose({binding,stoneKey:roots[0].definition.stableFormKey,requestId:'native-repeat'});assert.equal(repeat.status,'SUPPORTED');
  assert.equal(repeat.receipt.result.changed,false);assert.equal(repeat.projection.value.state,'UNCHANGED');
  assert.equal((await pool.query(`SELECT xmin::text AS version FROM "${schema}".gc_standing_stone_choice WHERE character_key=$1`,[binding.characterKey])).rows[0].version,firstFact.version);
  const secondReference=await activate(roots[1]);assert(expected(roots[0]).every(id=>!learned().has(id)));assert(expected(roots[1]).every(id=>learned().has(id)));
  const notice=mp.get(actorId,'gcStandingStoneNotice');assert(notice&&typeof notice.message==='string','Private notice was not sent through real host property');
  current=false;
  writeFileSync(path.join(evidence,'result.json'),JSON.stringify({result:'PASSED',scope:'NATIVE_ACTIVATION_AND_HOST_APPLICATION_NO_CLIENT_ACK',port,
    firstStone:roots[0].definition.stableFormKey,secondStone:roots[1].definition.stableFormKey,firstReference,secondReference,repeat,notice},null,2));
  console.log('Native activation -> confirmed stone command -> ActorState -> projection difference PASSED; in-game delivery unverified');
}catch(error){const reason=/^[A-Z0-9_]+$/.test(error?.code??error?.message??'')?error.code??error.message:'ASSERTION_OR_NATIVE_FAILURE';
  writeFileSync(path.join(evidence,'result.json'),JSON.stringify({result:'FAILED',reason}));console.error(reason);process.exitCode=1;
}finally{
  current=false;signal.abort();await system?.shutdown();await composition?.shutdown();await projection?.shutdown();
  try{if(created)await pg.init().query(`DROP SCHEMA "${schema}" CASCADE`);}finally{await pg.close();process.chdir(previousCwd);}
  // Never destroyActor: that native API aborted the B5a reviewer process.
  // The isolated test actor dies with this separate native process.
}
