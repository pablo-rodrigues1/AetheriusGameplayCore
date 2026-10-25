// DS-5a / Opus only: real compiled host, isolated UDP port/work directory and aetherius_test schema.
// No gameplay server is started by the implementer. This validates the TS profile projection
// against the real host property API; it does not certify native damage consumption or Skyrim UI.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,mkdirSync} from 'node:fs';
import {randomBytes,randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {transform} from 'esbuild';
import {utils,perkMigration,root,load} from './b5b-source.mjs';

const usage='node runtime/tests/ds5a-host.mjs --port <isolated, never 7777> --work-dir <empty directory> --addon <scam_native.node> --data-dir <plugins directory> --actor-base "<plugin|localFormID>" --target-base "<plugin|localFormID>" --weapon "<plugin|localFormID>"';
if(process.argv.includes('--help')){console.log(usage);process.exit(0);}
const options={},args=process.argv.slice(2),allowed=['--port','--work-dir','--addon','--data-dir','--actor-base','--target-base','--weapon'];
for(let i=0;i<args.length;i+=2){
  assert(allowed.includes(args[i])&&args[i+1],'Expected '+usage);
  const key=args[i].slice(2);assert(!options[key],'Duplicate option '+args[i]);options[key]=args[i+1];
}
for(const key of ['port','work-dir','addon','data-dir','actor-base','target-base','weapon'])assert(options[key],'Missing --'+key);
const port=Number(options.port);
assert(Number.isInteger(port)&&port>0&&port<=65535&&port!==7777,'Use an isolated port, never 7777');
const work=path.resolve(options['work-dir']),addon=path.resolve(options.addon),dataDir=path.resolve(options['data-dir']);
assert(!/(?:^|[\\/])build[\\/]dist(?:[\\/]|$)/i.test(work),'Work directory must be isolated from build/dist');
mkdirSync(work,{recursive:true});assert.equal(readdirSync(work).length,0,'Use an empty work directory');

const workspace=path.resolve(root,'..');
const dbEnv=readFileSync(path.join(workspace,'_work','db.env'),'utf8').split(/\r?\n/);
const dbLine=dbEnv.find(line=>/^\s*(?:export\s+)?AETHERIUS_TEST_DATABASE_URL\s*=/.test(line));
assert(dbLine,'AETHERIUS_TEST_DATABASE_URL is absent from _work/db.env');
let databaseUrl=dbLine.slice(dbLine.indexOf('=')+1).trim();
if((databaseUrl.startsWith('"')&&databaseUrl.endsWith('"'))||(databaseUrl.startsWith("'")&&databaseUrl.endsWith("'")))databaseUrl=databaseUrl.slice(1,-1);
let database;try{database=new URL(databaseUrl);}catch{throw Error('AETHERIUS_TEST_DATABASE_URL is invalid');}
assert(['localhost','127.0.0.1','[::1]'].includes(database.hostname)&&database.pathname==='/aetherius_test',
  'Only local aetherius_test is allowed');

const stable=options['actor-base'],split=stable.lastIndexOf('|');
assert(split>0&&/^[0-9a-f]{6}$/i.test(stable.slice(split+1)),'--actor-base must be a StableFormKey from NPC_.jsonl');
const formid=stable.slice(split+1)+':'+stable.slice(0,split);
const exportRoot=path.join(workspace,'_work','exports');
function locateExport(name){
  const directories=readdirSync(exportRoot,{withFileTypes:true}).filter(entry=>entry.isDirectory())
    .map(entry=>entry.name).sort((a,b)=>b.localeCompare(a));
  for(const directory of directories){const candidate=path.join(exportRoot,directory,name);try{readFileSync(candidate);return candidate;}catch{}}
  const direct=path.join(exportRoot,name);readFileSync(direct);return direct;
}
const npcRows=readFileSync(locateExport('NPC_.jsonl'),'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse);
const actorBase=npcRows.find(row=>row.type==='Npc'&&String(row.formid).toLowerCase()===formid.toLowerCase());
assert(actorBase,'NPC_ export has no record for --actor-base searched by FormID');
const manifest=JSON.parse(readFileSync(path.join(dataDir,'aetherius-loadorder.json'),'utf8'));
assert(Array.isArray(manifest.plugins)&&manifest.plugins.length>0,'Plugin manifest required');
const loadedPlugins=manifest.plugins.map(item=>String(item.filename??'').toLowerCase());
assert(loadedPlugins.includes(String(actorBase.winner).toLowerCase()),'NPC_ winner from FormID export is not in the supplied active load order');
assert(loadedPlugins.includes(String(stable.slice(0,split)).toLowerCase()),'NPC_ defining plugin is not in the supplied active load order');

const classes=load('catalog/classes.json').classes;
assert(Array.isArray(classes)&&classes.length>1,'At least two class definitions are required');
const classOne=classes[0],classTwo=classes.find(item=>item.id!==classOne.id);
assert(classOne&&classTwo,'Two class definitions are required');
const classData=load('catalog/classes.json');
const classAt=(classId,level)=>{
  const definition=classData.classes.find(item=>item.id===classId);assert(definition,'Class must come from catalog/classes.json');
  return definition.stages.filter(stage=>stage.level<=level).sort((a,b)=>a.level-b.level).at(-1);
};
function assertSkillProjection(profile,classId){
  const stage=classAt(classId,profile.level.value);
  for(const skill of Object.keys(profile.skills)){
    assert.equal(profile.skills[skill].status,'SUPPORTED','Class skill '+skill+' must have an exported stage value');
    assert.equal(profile.skills[skill].value,stage.skills[skill],'Profile skill must match the cumulative class stage');
  }
}
const schema='gc_ds4_profile_'+randomBytes(8).toString('hex');
const require=createRequire(import.meta.url),{Pool}=require('pg');
const pool=new Pool({connectionString:databaseUrl,max:8,options:'-c search_path='+schema+',pg_catalog'});
const settings={port,listenHost:'127.0.0.1',maxPlayers:4,offlineMode:true,dataDir,
  loadOrder:manifest.plugins.map(item=>item.filename),damageMultFormulaSettings:{multiplier:1},aetheriusCombat:{weaponPoison:false,families:{melee:'shadow',ranged:'shadow',unarmed:'shadow'}}};
process.chdir(work);globalThis.require=require;
const {ScampServer}=require(addon),server=new ScampServer(JSON.stringify(settings));
server._setSelf(server);
const identitySource=readFileSync(path.resolve(root,'../aetherius-server/server/ts/systems/official-identity.ts'),'utf8');
const identityCode=await transform(identitySource,{loader:'ts',format:'esm'});
const {createOfficialIdentity}=await import('data:text/javascript;base64,'+Buffer.from(identityCode.code).toString('base64'));
const authority=createOfficialIdentity(server);
const mp=new Proxy(server,{get(target,key){if(key==='aetheriusOfficialIdentity')return authority.view;const value=target[key];return typeof value==='function'?value.bind(target):value;}});
let core,bot,actor,ticker,profileId;
const tick=()=>{for(let i=0;i<20;i++)server.tick();};
async function until(predicate,label){
  const deadline=performance.now()+20000;
  while(!predicate()){assert(performance.now()<deadline,label+' timeout');await delay(10);}
}
try{
  await pool.query('CREATE SCHEMA "'+schema+'"');
  const migrations=await utils.readMigrations(path.join(root,'database','migrations'));
  await utils.applyMigrations(pool,[...migrations,perkMigration],schema);
  const actorBaseId=server.getIdFromDesc(formid);assert(Number.isInteger(actorBaseId)&&actorBaseId>0,'Host could not resolve NPC_ StableFormKey');
  bot=server.createBot();tick();
  actor=server.createActor(0,[0,0,0],0,actorBaseId);
  profileId=10000000+(randomBytes(4).readUInt32LE(0)%900000000);
  server.set(actor,'profileId',profileId);server.setUserActor(bot.getUserId(),actor);tick();
  const attempt=authority.begin(bot.getUserId());
  assert(authority.bind(attempt,profileId,'harness-fixture-only'),'Official identity fixture did not bind');
  const {createGameplayCore}=require(path.join(root,'dist','aetherius-gameplay-core.cjs'));
  ticker=setInterval(tick,5);
  core=createGameplayCore({mp,pg:{init:()=>pool},log:{info:message=>console.log(String(message).split(databaseUrl).join('[REDACTED TEST DATABASE URL]'))},
    env:{NODE_ENV:'production',GAMEPLAY_CORE_DATABASE_SCHEMA:schema,GAMEPLAY_CORE_MODE_CLASSES:'active'}});
  await core.initialize();
  const classCapability=core.capabilityReport().systems.find(item=>item.id==='classes');
  assert.equal(classCapability?.status,'SUPPORTED',JSON.stringify(classCapability?.missing??[]));
  const bindingResult=core.identity.lookup({actorId:actor});
  assert.equal(bindingResult.status,'SUPPORTED',bindingResult.reason);
  const binding=bindingResult.value;
  const firstSet=await core.setCharacterClass({binding,classId:classOne.id,requestId:randomUUID()});
  assert.equal(firstSet.status,'SUPPORTED',firstSet.reason);
  core.actorEvents.clientLoading(binding);core.actorEvents.clientReady(binding);
  await core.inspectActor(binding);
  await until(()=>core.readCombatProfile(binding).status==='SUPPORTED','Initial combat profile');
  const first=core.readCombatProfile(binding).value;
  assert.equal(first.subject.kind,'PLAYER');assert.equal(first.subject.characterKey,binding.characterKey);
  assert.equal(first.level.status,'SUPPORTED');assertSkillProjection(first,classOne.id);
  assert(first.perks.value.some(item=>item.sourceKind==='CLASS'&&item.sourceKey===classOne.id),
    'At least one class perk must preserve its grant origin in the profile');
  for(const resource of ['health','magicka','stamina']){
    const value=first.attributes[resource];
    assert(value.status==='SUPPORTED'||value.status==='UNSUPPORTED','Maximum status must be explicit');
    if(value.status==='SUPPORTED')assert(Number.isFinite(value.value)&&value.value>0,'Supported maximum must be finite and positive');
    else assert(value.reason,'Unsupported maximum must include a reason');
  }
  const secondSet=await core.setCharacterClass({binding,classId:classTwo.id,requestId:randomUUID()});
  assert.equal(secondSet.status,'SUPPORTED',secondSet.reason);
  await core.inspectActor(binding);
  await until(()=>core.readCombatProfile(binding).status==='SUPPORTED'
    &&core.readCombatProfile(binding).value.sourceRevisions.classFact>first.sourceRevisions.classFact,'Changed class profile');
  const second=core.readCombatProfile(binding).value;
  assert(second.revision>first.revision,'Class change must publish a later whole-profile revision');
  assertSkillProjection(second,classTwo.id);
  const targetBase=options['target-base'],weaponKey=options.weapon;
  function runtimeKey(key){const parts=key.split('|');assert(parts.length===2&&/^[0-9a-f]{6}$/i.test(parts[1]),'StableFormKey required');return server.getIdFromDesc(parts[1]+':'+parts[0]);}
  const targetId=runtimeKey(targetBase),weaponId=runtimeKey(weaponKey);
  const npcExport=npcRows.find(row=>String(row.formid).toLowerCase()===(targetBase.split('|')[1]+':'+targetBase.split('|')[0]).toLowerCase());
  assert(npcExport,'Target must be present in the authoritative NPC_ export');
  const target=server.createActor(0,[0,0,0],0,targetId);
  // Real host equipment and packet contracts: EquipmentBinding, HitMessage.h,
  // MsgType::OnHit=17 and ScampServer::CreateBot object serialization.
  const equipment=server.get(actor,'equipment');
  equipment.inv={entries:[{baseId:weaponId,count:1,worn:true}]};
  server.set(actor,'equipment',equipment);
  const targetProfile=core.inspectNpcCombatProfile(target);
  assert(targetProfile.skills.LightArmor.status==='SUPPORTED','Choose a non-AutoCalc NPC with explicit skills; no neutral substitute');
  const caps=JSON.parse(server.getAetheriusCombatCapabilities());
  assert.equal(caps.families.melee.status,'SHADOW');
  const before=JSON.parse(server.getAetheriusCombatShadow()).hits;
  bot.send({t:17,data:{aggressor:actor,target,source:weaponId,projectile:0,isBashAttack:false,isHitBlocked:false,isPowerAttack:false,isSneakAttack:false}});
  await until(()=>JSON.parse(server.getAetheriusCombatShadow()).hits>before,'Native host accepted hit');
  const shadow=JSON.parse(server.getAetheriusCombatShadow());
  const sample=shadow.samples.find(row=>row.aggressor===actor&&row.target===target&&row.sequence>before);
  assert(sample,'Hit sample missing');assert.equal(sample.status,'CALCULATED',sample.reason);
  assert.equal(sample.attackerRevision,second.revision);assert.equal(sample.defenderRevision,targetProfile.revision);
  assert.equal(sample.hitIdentity,'HOST_RECEIVED_NO_UNIQUENESS_CLAIM');
  console.log('PASS DS-5a real host shadow: '+JSON.stringify({classOne:classOne.id,classTwo:classTwo.id,sample,profileParses:shadow.profileParses}));

}catch(error){
  const message=String(error?.message??error).split(databaseUrl).join('[REDACTED TEST DATABASE URL]');
  console.error('FAIL DS-5a host shadow: '+(error.code??error.name)+' '+message.slice(0,800));process.exitCode=1;
}finally{
  clearInterval(ticker);await core?.shutdown();bot?.destroy();tick();
  try{await pool.query('DROP SCHEMA IF EXISTS "'+schema+'" CASCADE');}catch{}
  await pool.end();
  process.exit(process.exitCode??0);
}