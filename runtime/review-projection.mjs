// Reviewer only. Opens native UDP, never execute in the Codex sandbox.
// node runtime/review-projection.mjs <workspace> <new-evidence-dir> <unused-port> <cell-or-world-desc>
import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
const [workspaceArg,evidenceArg,portArg,worldDesc] = process.argv.slice(2);
const port=Number(portArg);
assert(workspaceArg && evidenceArg && worldDesc && Number.isInteger(port) && port>1024 && port<=65535 && port!==7777,
  'Usage: node runtime/review-projection.mjs <workspace> <new-evidence-dir> <unused-port-except-7777> <cell-or-world-desc>');
assert(/^[0-9a-f]{1,6}:[^:]+\.(esm|esp|esl)$/i.test(worldDesc),'Expected local FormID:plugin descriptor');
const workspace=path.resolve(workspaceArg), evidence=path.resolve(evidenceArg), root=path.join(workspace,'AetheriusGameplayCore');
assert(!existsSync(evidence),'Use a new evidence directory; no existing server/workdir is modified');
const url=new URL(process.env.AETHERIUS_TEST_DATABASE_URL ?? 'missing:');
assert(['localhost','127.0.0.1','[::1]'].includes(url.hostname) && url.pathname==='/aetherius_test','Requires local aetherius_test');
const check=spawnSync('pwsh',['-NoProfile','-Command',`if (Get-NetUDPEndpoint -LocalPort ${port} -ErrorAction SilentlyContinue) { exit 2 }; Write-Output 'Requested UDP port free'`],{encoding:'utf8'});
assert.equal(check.status,0,'Requested UDP port occupied or check failed; no running server is stopped');
mkdirSync(evidence,{recursive:true});
const server=path.join(workspace,'aetherius-server/build/dist/server'), dataDir=path.join(server,'data');
const loadOrder=JSON.parse(readFileSync(path.join(dataDir,'aetherius-loadorder.json'),'utf8')).loadOrder;
const require=createRequire(import.meta.url); globalThis.require=require;
process.env.GAME_DATABASE_URL=process.env.AETHERIUS_TEST_DATABASE_URL;
const pg=require(path.join(server,'gamemode/core/pg.js'));
const addon=require(path.join(server,'scam_native.node'));
const {SpellProjection}=require(path.join(root,'dist/aetherius-gameplay-core.cjs'));
const compiled=await build({absWorkingDir:root,stdin:{contents:
  "export {loadDomain} from './shared/record-catalog/src/index.ts'; export {createFileHost} from './tools/catalog/host.ts'; export {readMigrations,applyMigrations} from './shared/persistence/src/index.ts';",
  resolveDir:root,loader:'ts'},bundle:true,platform:'node',format:'esm',write:false});
const api=await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const previousCwd=process.cwd(); process.chdir(evidence);
let mp, projection, actorId, schemaCreated=false;
const schema=`gc_b5a_review_${process.pid}_${randomBytes(4).toString('hex')}`;
try {
  mp=new addon.ScampServer(JSON.stringify({port,listenHost:'127.0.0.1',maxPlayers:1,dataDir,loadOrder,
    npcEnabled:false,logLevel:'warn',reloot:{},offlineMode:false})); mp.tick();
  assert.equal(typeof mp.createActor,'function','Addon cannot create isolated test actor');
  const pool=pg.init(); await pool.query(`CREATE SCHEMA "${schema}"`); schemaCreated=true;
  await api.applyMigrations(pool,await api.readMigrations(path.join(root,'database/migrations')),schema);
  const domains=['standing-stones','races'].map(name=>JSON.parse(readFileSync(path.join(root,'catalog',`${name}.json`),'utf8')));
  const adapter=api.createFileHost(mp,dataDir,domains);
  const catalogs=domains.map(d=>api.loadDomain(d,adapter)); assert(catalogs.every(c=>c.status==='SUPPORTED'),'Real catalog failed reconciliation');
  const world=mp.getIdFromDesc(worldDesc);
  const type=mp.lookupEspmRecordById(world)?.record?.type;
  assert(['CELL','WRLD'].includes(type),'Requested world/cell is absent or wrong type');
  const profile=process.pid+1000000;
  actorId=mp.createActor(0,[0,0,0],0,world,profile); assert(Number.isSafeInteger(actorId) && actorId>0);
  const binding=Object.freeze({characterKey:`profile:${profile}`,profileKey:`profile:${profile}`,actorRef:{actorId},epoch:`native-review-${process.pid}`});
  let current=true, readyListener;
  const identity={lookup:()=>({status:'SUPPORTED',value:binding}),isCurrent:b=>current && b.epoch===binding.epoch && b.actorRef.actorId===actorId && mp.get(actorId,'profileId')===profile};
  const actors={onReady:fn=>{readyListener=fn;return()=>{readyListener=undefined;}},onUnbound:()=>()=>{}};
  projection=new SpellProjection({pool,schema,mp,catalogs,identity,actors,signal:new AbortController().signal,warn:console.log});
  readyListener({binding,signal:'ONLINE_DELAY_APPROXIMATION',certified:false});
  const candidates=[...new Map(catalogs.flatMap(c=>c.records).filter(r=>r.definition.recordType==='SPEL').map(r=>[r.definition.stableFormKey,r])).values()];
  const self={type:'form',desc:mp.getDescFromId(actorId)};
  const call=(method,args=[])=>mp.callPapyrusFunction('method','Actor',method,self,args);
  const learned=()=>{
    const count=call('GetSpellCount'); assert(Number.isSafeInteger(count) && count>=0);
    return new Set(Array.from({length:count},(_,n)=>{const form=call('GetNthSpell',[n]);assert.equal(form.type,'espm');return mp.getIdFromDesc(form.desc);}));
  };
  // Select two spells not inherited by this actor, using real native outcomes.
  const usable=[];
  for(const record of candidates){
    const ref={type:'espm',desc:mp.getDescFromId(record.runtimeFormId)};
    if(call('AddSpell',[ref,false])===true){assert.equal(call('RemoveSpell',[ref]),true);usable.push(record);}
    if(usable.length===3)break;
  }
  assert.equal(usable.length,3,'Need three catalog spells not inherited from base');
  const [a,b,external]=usable;
  assert.equal(call('AddSpell',[{type:'espm',desc:mp.getDescFromId(external.runtimeFormId)},false]),true);
  const intent=(n,records)=>({binding,set:{characterKey:binding.characterKey,revision:{facts:n,grants:n,equipment:0,effects:0,catalog:1},
    grants:records.map(r=>({kind:'ability',definition:r.definition,source:{kind:'SYSTEM',key:'native-review'},revision:n}))}});
  const first=await projection.publish(intent(1,[a,external])); assert.equal(first.status,'SUPPORTED');
  assert(learned().has(a.runtimeFormId)); assert(learned().has(external.runtimeFormId));
  assert.equal((await projection.publish(intent(1,[a,external]))).value.state,'UNCHANGED');
  const swapped=await projection.publish(intent(2,[b])); assert.equal(swapped.status,'SUPPORTED');
  const after=learned(); assert(!after.has(a.runtimeFormId)); assert(after.has(b.runtimeFormId)); assert(after.has(external.runtimeFormId));
  const empty=await projection.publish(intent(3,[])); assert.equal(empty.status,'SUPPORTED');
  const final=learned(); assert(!final.has(b.runtimeFormId)); assert(final.has(external.runtimeFormId));
  current=false;
  writeFileSync(path.join(evidence,'result.json'),JSON.stringify({result:'PASSED',scope:'NATIVE_HOST_ONLY_NO_CLIENT_ACK',port,first,swapped,empty},null,2));
  console.log('Native actor: projection, duplicate, swap, external preservation and native enumeration PASSED; client delivery unconfirmed');
} catch(error) {
  const result={result:'FAILED',reason:/^[A-Z0-9_]+$/.test(error?.code)?error.code:'ASSERTION_OR_NATIVE_HOST_FAILURE'};
  writeFileSync(path.join(evidence,'result.json'),JSON.stringify(result)); console.error(result.reason); process.exitCode=1;
} finally {
  await projection?.shutdown();
  if(actorId!==undefined)mp.destroyActor(actorId);
  if(schemaCreated)await pg.init().query(`DROP SCHEMA "${schema}" CASCADE`);
  await pg.close(); process.chdir(previousCwd);
}
