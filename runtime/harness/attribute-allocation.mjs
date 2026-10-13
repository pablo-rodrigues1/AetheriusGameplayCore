// Reviewer only: real compiled addon, real native bots and PostgreSQL aetherius_test.
// The upstream official-identity implementation binds a fixture authentication
// attempt to native user/profile state. No production login or Skyrim UI claim.
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,readdirSync} from 'node:fs';
import {randomUUID,randomBytes} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {transform} from 'esbuild';
import {utils,perkMigration,root} from '../tests/b5b-source.mjs';
import {xpInput} from '../tests/xp-event.mjs';
const usage='node runtime/harness/attribute-allocation.mjs --port <isolated, never 7777> --work-dir <empty directory> --addon <scam_native.node> --data-dir <plugins directory>';
if(process.argv.includes('--help')){console.log(usage);process.exit(0);}
const options={},args=process.argv.slice(2);
for(let i=0;i<args.length;i+=2){assert(['--port','--work-dir','--addon','--data-dir'].includes(args[i])&&args[i+1],'Expected '+usage);assert(!options[args[i].slice(2)],'Duplicate option');options[args[i].slice(2)]=args[i+1];}
for(const key of ['port','work-dir','addon','data-dir'])assert(options[key],'Missing --'+key);
const port=Number(options.port);assert(Number.isInteger(port)&&port>0&&port<=65535&&port!==7777,'Use an isolated port, never 7777');
const url=new URL(process.env.AETHERIUS_TEST_DATABASE_URL??'missing:');
assert(['localhost','127.0.0.1','[::1]'].includes(url.hostname)&&url.pathname==='/aetherius_test','Only local aetherius_test');
const work=path.resolve(options['work-dir']),addon=path.resolve(options.addon),dataDir=path.resolve(options['data-dir']);
assert(!/(?:^|[\\/])build[\\/]dist(?:[\\/]|$)/i.test(work),'Work directory must be isolated from build/dist');
mkdirSync(work,{recursive:true});assert.equal(readdirSync(work).length,0,'Use an empty work directory');
const manifest=JSON.parse(readFileSync(path.join(dataDir,'aetherius-loadorder.json'),'utf8'));
assert(Array.isArray(manifest.plugins)&&manifest.plugins.length>0,'Plugin manifest required');
// Source is the maintained TS identity authority itself, not a guessed facade.
const identitySource=readFileSync(path.resolve(root,'../aetherius-server/server/ts/systems/official-identity.ts'),'utf8');
const {code}=await transform(identitySource,{loader:'ts',format:'esm'});
const {createOfficialIdentity}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const require=createRequire(import.meta.url),{Pool}=require('pg');globalThis.require=require;process.chdir(work);
const {ScampServer}=require(addon),server=new ScampServer(JSON.stringify({port,listenHost:'127.0.0.1',maxPlayers:4,offlineMode:true,dataDir,loadOrder:manifest.plugins.map(p=>p.filename),aetheriusCombat:{weaponPoison:false,shadow:false}}));
server._setSelf(server);
const authority=createOfficialIdentity(server),schema='gc_c3d_native_'+randomBytes(8).toString('hex');
const pool=new Pool({connectionString:process.env.AETHERIUS_TEST_DATABASE_URL,max:8,options:'-c search_path='+schema+',pg_catalog'});
const {createGameplayCore}=require(path.join(root,'dist/aetherius-gameplay-core.cjs'));
const mp=new Proxy(server,{get(target,key){if(key==='aetheriusOfficialIdentity')return authority.view;const v=target[key];return typeof v==='function'?v.bind(target):v;}});
let core,bot,actor,ticker,binding;
const profile=991004,key='profile:'+profile;
const native=()=>server.get(actor,'aetheriusAttributeBonuses');
const tick=()=>{for(let i=0;i<20;i++)server.tick();};
async function until(predicate){const deadline=performance.now()+20000;while(!predicate()){assert(performance.now()<deadline,'Native attribute harness timeout');await delay(10);}}
function authenticate(){const attempt=authority.begin(bot.getUserId());assert(authority.bind(attempt,profile,'harness-fixture-only'),'Native official identity bind failed');}
try{
  await pool.query('CREATE SCHEMA "'+schema+'"');
  await utils.applyMigrations(pool,[...await utils.readMigrations(path.join(root,'database/migrations')),perkMigration],schema);
  bot=server.createBot();tick();actor=server.createActor(0,[0,0,0],0,server.getIdFromDesc('3c:Skyrim.esm'));
  server.set(actor,'profileId',profile);server.setUserActor(bot.getUserId(),actor);tick();authenticate();
  core=createGameplayCore({mp,pg:{init:()=>pool},log:{info:console.log},env:{NODE_ENV:'production',GAMEPLAY_CORE_DATABASE_SCHEMA:schema,GAMEPLAY_CORE_MODE_CLASSES:'active'}});
  ticker=setInterval(()=>server.tick(),5);await core.initialize();
  assert.equal(core.capabilityReport().systems.find(s=>s.id==='classes').status,'SUPPORTED');
  binding=core.identity.lookup({actorId:actor}).value;assert(binding);
  assert.equal((await core.setCharacterClass({binding,classId:'viper',requestId:randomUUID()})).status,'SUPPORTED');
  const baseline=native();assert.equal(baseline.origin,'CLASS_ADDITIVE');assert.deepEqual(baseline.maximum,baseline.base);
  // Actual durable Leveling adapter and math; fixture event is trusted test input,
  // not a newly connected death source or a client XP value.
  await core.awardLevelingXp({characterKey:key,epoch:binding.epoch,...xpInput('native-c3d-level')});
  assert((await core.attributeState(binding)).available>=15);
  const requestId=randomUUID(),intent={binding,requestId,health:5,magicka:5,stamina:5};
  const allocated=await core.allocateAttributes(intent);assert.equal(allocated.status,'SUPPORTED');assert.equal(allocated.committed,true);assert.equal(allocated.projection.status,'SUPPORTED');
  const expected=Object.fromEntries(Object.entries(baseline.base).map(([resource,value])=>[resource,value+5]));
  assert.deepEqual(native().maximum,expected);assert.equal(native().origin,'CLASS_ADDITIVE');assert.deepEqual(allocated.state.maximum,expected);
  assert.equal((await core.allocateAttributes(intent)).receipt.replayed,true);
  const saved=(await pool.query('SELECT * FROM gc_attribute_allocation WHERE character_key=$1',[key])).rows[0];
  assert.equal((await core.setCharacterClass({binding,classId:'viper',requestId:randomUUID()})).status,'SUPPORTED');assert.deepEqual(native().maximum,expected);
  console.log('PASS native allocate/replay/same class: '+JSON.stringify({base:baseline.base,maximum:native().maximum}));
  const old=binding,oldUser=bot.getUserId();authority.clear(oldUser);server.kick(oldUser);tick(); // bot.destroy() never disconnects the mock user on the compiled addon
core.identity.poll();
  await until(()=>!server.isConnected(oldUser));assert.equal(core.identity.lookup({actorId:actor}).status,'UNSUPPORTED');assert.deepEqual(native().maximum,baseline.base);
  bot=server.createBot();tick();server.setUserActor(bot.getUserId(),actor);tick();authenticate();core.identity.poll();
  binding=core.identity.lookup({actorId:actor}).value;assert(binding);assert.notEqual(binding.epoch,old.epoch);
  core.actorEvents.clientLoading(binding);core.actorEvents.clientReady(binding);
  await until(()=>native().maximum.health===expected.health);assert.deepEqual(native().maximum,expected);
  assert.deepEqual((await pool.query('SELECT * FROM gc_attribute_allocation WHERE character_key=$1',[key])).rows[0],saved);
  assert.equal((await core.allocateAttributes({...intent,binding:old,requestId:randomUUID()})).reason,'MODE_OR_STALE_BINDING');
  assert.equal((await core.setCharacterClass({binding,classId:'guardiao',requestId:randomUUID()})).status,'SUPPORTED');
  const reset=await core.attributeState(binding);assert.equal(reset.level,1);assert.equal(reset.spentTotal,0);assert.deepEqual(native().maximum,baseline.base);
  assert.equal((await pool.query('SELECT total_xp FROM gc_leveling_progress WHERE character_key=$1',[key])).rows[0].total_xp,'0');
  await core.shutdown();assert.deepEqual(native().maximum,baseline.base);assert.equal(native().origin,'RECORDS');
  console.log('PASS C3d compiled host: durable allocation, native maximum, native disconnect/reconnect, stale epoch, reset to records, shutdown. No Skyrim bars/effect certification.');
}catch(error){console.error('FAIL C3d native harness: '+(error.code??error.name)+' '+String(error.message).slice(0,600));process.exitCode=1;}
finally{clearInterval(ticker);await core?.shutdown();bot?.destroy();tick();await pool.query('DROP SCHEMA IF EXISTS "'+schema+'" CASCADE');await pool.end();process.exit(process.exitCode??0);}
