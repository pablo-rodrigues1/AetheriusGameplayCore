// REVIEWER ONLY. Starts the real native addon on a caller-supplied isolated port.
import assert from 'node:assert/strict';
import {existsSync,readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import path from 'node:path';
const [workspaceArg,evidenceArg,portArg,worldDesc,classId='elementalista']=process.argv.slice(2),port=Number(portArg);
if(!workspaceArg||!evidenceArg||!worldDesc||!Number.isInteger(port)||port<=1024||port>65535||port===7777||!/^[0-9a-f]{1,6}:[^:]+\.(esm|esp|esl)$/i.test(worldDesc)){
  console.error('Usage: node runtime/review-classes.mjs <workspace> <new-C3a-evidence-dir> <unused-port-except-7777> <cell-or-world-local:plugin> [class]');process.exit(2);
}
const workspace=path.resolve(workspaceArg),evidence=path.resolve(evidenceArg),allowed=path.join(workspace,'_work/evidence/C3a');
assert(evidence.toLowerCase().startsWith(allowed.toLowerCase()+path.sep),'Evidence must stay within C3a');assert(!existsSync(evidence),'Use a new directory');
const url=new URL(process.env.AETHERIUS_TEST_DATABASE_URL??'missing:');assert(['127.0.0.1','localhost','[::1]'].includes(url.hostname)&&url.pathname==='/aetherius_test','Only local aetherius_test');
const check=spawnSync('pwsh',['-NoProfile','-Command',`if (Get-NetUDPEndpoint -LocalPort ${port} -ErrorAction SilentlyContinue) { exit 2 }; Write-Output 'UDP port free'`],{encoding:'utf8'});
assert.equal(check.status,0,'Requested port occupied/check failed; no running server is stopped');
const root=path.join(workspace,'AetheriusGameplayCore'),server=path.join(workspace,'aetherius-server/build/dist/server'),dataDir=path.join(server,'data');
const loadOrder=JSON.parse(readFileSync(path.join(dataDir,'aetherius-loadorder.json'),'utf8')).loadOrder;
const require=createRequire(import.meta.url);globalThis.require=require;process.env.GAME_DATABASE_URL=process.env.AETHERIUS_TEST_DATABASE_URL;
const pg=require(path.join(server,'gamemode/core/pg.js')),addon=require(path.join(server,'scam_native.node')),api=require(path.join(root,'dist/aetherius-gameplay-core.cjs'));
const schema=`gc_c3a_review_${process.pid}_${randomBytes(4).toString('hex')}`,oldCwd=process.cwd();let core,pump,created=false;
mkdirSync(evidence,{recursive:true});process.chdir(evidence);
try{
  const settings={port,listenHost:'127.0.0.1',maxPlayers:1,dataDir,loadOrder,npcEnabled:false,logLevel:'warn',reloot:{},offlineMode:true};
  writeFileSync('server-settings.json',JSON.stringify(settings,null,2));
  const native=new addon.ScampServer(JSON.stringify(settings));native.tick();
  const world=native.getIdFromDesc(worldDesc);assert(['CELL','WRLD'].includes(native.lookupEspmRecordById(world)?.record?.type));
  const profile=process.pid+3000000,actorId=native.createActor(0,[0,0,0],0,world,profile),mutations=[],logs=[];
  // Fixture readiness only: a real addon actor has no network client attached.
  // Host profile, records and Papyrus remain real. No client ACK/result is claimed.
  const mp=new Proxy(native,{get(target,key){
    if(key==='get')return(id,property)=>property==='onlinePlayers'?[actorId]:target.get(id,property);
    if(key==='callPapyrusFunction')return(...args)=>{if(['AddSpell','RemoveSpell','AddPerk','RemovePerk','SetActorValue'].includes(args[2]))mutations.push(args[2]);return target.callPapyrusFunction(...args);};
    const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
  }});
  core=api.createGameplayCore({mp,pg,env:{GAMEPLAY_CORE_DATABASE_SCHEMA:schema,GAMEPLAY_CORE_APPLY_MIGRATIONS_DEV:'true',GAMEPLAY_CORE_ALLOW_OFFLINE_IDENTITY:'true',GAMEPLAY_CORE_MODE_CLASSES:'active',GAMEPLAY_CORE_DEV_CLASS_LEVEL:'40'},log:{info:m=>{logs.push(m);console.log(m);}}});
  // Test schema only. The runtime's approved DEV migration runner applies all files.
  await pg.init().query(`CREATE SCHEMA "${schema}"`);created=true;await core.initialize();
  assert.equal(core.capabilityReport().systems.find(s=>s.id==='classes').status,'SUPPORTED');assert(logs.some(m=>m.includes('DEV')));
  const binding=core.identity.lookup({actorId}).value;assert(binding);
  assert.equal((await core.setCharacterClass({binding,classId,requestId:'native-class-choice'})).status,'SUPPORTED');
  pump=setInterval(()=>native.tick(),20);await new Promise(resolve=>setTimeout(resolve,3300));
  const set=await core.inspectActor(binding),data=JSON.parse(readFileSync(path.join(root,'catalog/classes.json'),'utf8')),
    c=data.classes.find(c=>c.id===classId),expected=[...new Set(c.stages.flatMap(s=>s.perks.filter(p=>p.status==='SUPPORTED').map(p=>p.stableFormKey)))].sort();
  assert.deepEqual(set.grants.map(g=>g.definition.stableFormKey).sort(),expected);assert.equal(mutations.length,0);
  assert.equal((await pg.init().query(`SELECT count(*)::int AS n FROM "${schema}".gc_leveling_progress`)).rows[0].n,0);
  writeFileSync('result.json',JSON.stringify({result:'PASSED',scope:'REAL_ADDON_SERVER_COMPOSITION_NO_CLIENT_DELIVERY',fixtureReadiness:'onlinePlayers includes unconnected native test actor',port,classId,levelOrigin:'DEV',grantSet:set,mutations,capabilities:core.capabilityReport(),logs},null,2));
  console.log('Native C3a composition PASSED; zero host mutations; no XP rows');
}catch(error){const reason=/^[A-Z0-9_]+$/.test(error?.code??error?.message??'')?error.code??error.message:'ASSERTION_OR_NATIVE_FAILURE';writeFileSync('result.json',JSON.stringify({result:'FAILED',reason}));console.error(reason);process.exitCode=1;}
finally{clearInterval(pump);await core?.shutdown();try{if(created)await pg.init().query(`DROP SCHEMA "${schema}" CASCADE`);}finally{await pg.close();process.chdir(oldCwd);}}
