// REVIEWER ONLY: loads the native addon and opens the explicitly supplied UDP
// port in a new working directory. Codex only checks arguments/syntax.
import assert from 'node:assert/strict';
import {existsSync,readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {build} from 'esbuild';
import path from 'node:path';
const [workspaceArg,evidenceArg,portArg,worldDesc,raceDesc]=process.argv.slice(2),port=Number(portArg);
if(!workspaceArg||!evidenceArg||!worldDesc||!raceDesc||!Number.isInteger(port)||port<=1024||port>65535||port===7777) {
  console.error('Usage: node runtime/review-races.mjs <workspace> <new-evidence-dir> <unused-port-except-7777> <cell-or-world-local:plugin> <race-local:plugin>');process.exit(2);
}
assert([worldDesc,raceDesc].every(d=>/^[0-9a-f]{1,6}:[^:]+\.(esm|esp|esl)$/i.test(d)),'Only local plugin descriptors');
const workspace=path.resolve(workspaceArg),evidence=path.resolve(evidenceArg),root=path.join(workspace,'AetheriusGameplayCore');
assert(!existsSync(evidence),'Use a new directory; never reuse the owner server working directory');
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
  export {RaceSystem} from './runtime/src/races.ts';
  export {explainCharacter} from './runtime/src/explanation.ts';
`},bundle:true,platform:'node',format:'esm',write:false});
const api=await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const require=createRequire(import.meta.url);globalThis.require=require;process.env.GAME_DATABASE_URL=process.env.AETHERIUS_TEST_DATABASE_URL;
const pg=require(path.join(server,'gamemode/core/pg.js')),addon=require(path.join(server,'scam_native.node'));
const {SpellProjection,ActorComposition}=require(path.join(root,'dist/aetherius-gameplay-core.cjs'));
const schema=`gc_c2_review_${process.pid}_${randomBytes(4).toString('hex')}`,oldCwd=process.cwd();
let raceSystem,projection,composition,created=false,current=true;
const abort=new AbortController(),ready=new Set(),hooks={};
process.chdir(evidence);
try {
  const settings={port,listenHost:'127.0.0.1',maxPlayers:1,dataDir,loadOrder,npcEnabled:false,logLevel:'warn',reloot:{},offlineMode:false};
  writeFileSync('server-settings.json',JSON.stringify(settings,null,2));
  const native=new addon.ScampServer(JSON.stringify(settings));native.tick();
  const pool=pg.init();await pool.query(`CREATE SCHEMA "${schema}"`);created=true;
  await api.applyMigrations(pool,await api.readMigrations(path.join(root,'database/migrations')),schema);
  const data=JSON.parse(readFileSync(path.join(root,'catalog/races.json'),'utf8'));
  const stones=JSON.parse(readFileSync(path.join(root,'catalog/standing-stones.json'),'utf8'));
  const catalog=api.loadDomain(data,api.createFileHost(native,dataDir,[data]));assert.equal(catalog.status,'SUPPORTED');
  const world=native.getIdFromDesc(worldDesc);assert(['CELL','WRLD'].includes(native.lookupEspmRecordById(world)?.record?.type));
  const rootRace=catalog.roots.find(r=>r.runtimeFormId===native.getIdFromDesc(raceDesc));assert(rootRace,'Playable race required');
  const profile=process.pid+2000000,actorId=native.createActor(0,[0,0,0],0,world,profile);
  // Test fixture setup only. Production RaceSystem never writes appearance.
  native.set(actorId,'appearance',{isFemale:false,raceId:rootRace.runtimeFormId,weight:0,skinColor:0,hairColor:0,
    headpartIds:[],headTextureSetId:0,options:[],presets:[],tints:[],name:'C2 isolated native test'});
  const mutationCalls=[];
  const mp=new Proxy(native,{get(target,key){
    if(key==='callPapyrusFunction')return(...args)=>{if(['AddSpell','RemoveSpell','AddPerk','RemovePerk','SetActorValue'].includes(args[2]))mutationCalls.push(args[2]);return target.callPapyrusFunction(...args);};
    const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
  }});
  const binding={profileKey:`profile:${profile}`,characterKey:`profile:${profile}`,actorRef:{actorId},epoch:`c2-review-${process.pid}`};
  const identity={lookup:ref=>current&&ref.actorId===actorId?{status:'SUPPORTED',value:binding}:{status:'UNSUPPORTED',reason:'TEST_BINDING_ABSENT'},
    isCurrent:b=>current&&b.epoch===binding.epoch&&b.actorRef.actorId===actorId&&native.get(actorId,'profileId')===profile};
  const actors={onReady:fn=>{ready.add(fn);return()=>ready.delete(fn);},onUnbound:()=>()=>{}};
  const canMutate=b=>!abort.signal.aborted&&identity.isCurrent(b);
  projection=new SpellProjection({pool,schema,mp,catalogs:[catalog],identity,actors,signal:abort.signal,canProject:canMutate,warn:console.log});
  composition=new ActorComposition({pool,schema,check:b=>assert(canMutate(b)),publish:(binding,set)=>projection.publish({binding,set})});
  const context={mode:'active',catalog,persistence:{pool,withTransaction:api.withTransaction,executeCommand:api.executeCommand},identity,
    projection,composition,actors,hooks:{register:(name,fn)=>{hooks[name]=fn;return()=>delete hooks[name];}},signal:abort.signal,log:{info:console.log},canMutate};
  raceSystem=new api.RaceSystem(context,mp,schema);raceSystem.start();
  const call=(method,args=[])=>mp.callPapyrusFunction('method','Actor',method,{type:'form',desc:native.getDescFromId(actorId)},args);
  const learned=()=>Array.from({length:call('GetSpellCount')},(_,i)=>call('GetNthSpell',[i]).desc).sort();
  const before=learned();for(const fn of [...ready])fn({binding,signal:'ONLINE_DELAY_APPROXIMATION',certified:false});
  assert.equal((await raceSystem.observe(binding)).raceKey,rootRace.definition.stableFormKey);
  // Exact registered hook, after the host appearance write. No Papyrus activation.
  assert.equal(hooks.onUpdateAppearanceAttempt(actorId,{raceId:rootRace.runtimeFormId},true),undefined);
  await raceSystem.observe(binding);assert.deepEqual(learned(),before);assert.equal(mutationCalls.length,0);
  const client=await pool.connect();let explanation;
  try{await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');await client.query(`SET LOCAL search_path TO "${schema}",pg_catalog`);
    explanation=await api.explainCharacter(client,binding.characterKey,stones,data,JSON.parse(readFileSync(path.join(root,'modules/race-system/ownership.json'),'utf8')));
    await client.query('COMMIT');}finally{client.release();}
  assert.equal(explanation.facts.race.raceKey,rootRace.definition.stableFormKey);assert.equal(explanation.portGrants.length,0);
  const receipt={result:'PASSED',scope:'NATIVE_RACE_OBSERVATION_NO_HOST_MUTATION_NO_CLIENT_RESULT_CERTIFICATION',port,race:rootRace.definition.stableFormKey,
    before,after:learned(),mutationCalls,explanation};writeFileSync('result.json',JSON.stringify(receipt,null,2));console.log('Native race observation and unchanged native spell enumeration PASSED');
}catch(error){const reason=/^[A-Z0-9_]+$/.test(error?.code??error?.message??'')?error.code??error.message:'ASSERTION_OR_NATIVE_FAILURE';
  writeFileSync('result.json',JSON.stringify({result:'FAILED',reason}));console.error(reason);process.exitCode=1;
}finally{current=false;abort.abort();await raceSystem?.shutdown();await composition?.shutdown();await projection?.shutdown();
  try{if(created)await pg.init().query(`DROP SCHEMA "${schema}" CASCADE`);}finally{await pg.close();process.chdir(oldCwd);}
  // No actor destruction API: the isolated actor dies with this native process.
}
