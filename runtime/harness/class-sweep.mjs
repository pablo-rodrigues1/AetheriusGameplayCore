// Opus/reviewer only. Real compiled host + its native bot; simulated Skyrim
// presence/application uses the existing B5b client fixture. Never run on 7777.
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {utils,perkMigration,root,load} from '../tests/b5b-source.mjs';
import {client} from '../tests/perk-client.mjs';
const require=createRequire(import.meta.url),{Pool}=require('pg');
const args=process.argv.slice(2),options={};
for(let i=0;i<args.length;i+=2){assert(args[i].startsWith('--')&&args[i+1],'Expected --name value');options[args[i].slice(2)]=args[i+1];}
for(const key of ['port','work-dir','addon','settings'])assert(options[key],'Missing --'+key);
const port=Number(options.port);assert(Number.isInteger(port)&&port>0&&port<=65535&&port!==7777,'Use an isolated port, never 7777');
const url=new URL(process.env.AETHERIUS_TEST_DATABASE_URL??'missing:');
assert(['localhost','127.0.0.1','[::1]'].includes(url.hostname)&&url.pathname==='/aetherius_test','Only local aetherius_test');
const work=path.resolve(options['work-dir']),addon=path.resolve(options.addon),settingsFile=path.resolve(options.settings);
const input=JSON.parse(readFileSync(settingsFile,'utf8'));
// Only transport/plugins: no official credentials or running-server settings.
const settings={port,listenHost:'127.0.0.1',maxPlayers:4,offlineMode:true,
  dataDir:path.resolve(path.dirname(settingsFile),input.dataDir??'data'),loadOrder:input.loadOrder};
mkdirSync(work,{recursive:true});process.chdir(work);globalThis.require=require;
const {ScampServer}=require(addon),server=new ScampServer(JSON.stringify(settings));server._setSelf(server);
const schema='gc_c3b_native_'+randomBytes(8).toString('hex');
const pool=new Pool({connectionString:process.env.AETHERIUS_TEST_DATABASE_URL,max:8,options:'-c search_path='+schema+',pg_catalog'});
const data=load('catalog/classes.json'),packets=[],c=client(),log=[];
const {createGameplayCore,createClassCommands}=require(path.join(root,'dist/aetherius-gameplay-core.cjs'));
let core,ticker,actor,bot;
try{
  await pool.query('CREATE SCHEMA "'+schema+'"');
  await utils.applyMigrations(pool,[...await utils.readMigrations(path.join(root,'database/migrations')),perkMigration],schema);
  bot=server.createBot();for(let i=0;i<20;i++)server.tick();
  actor=server.createActor(0,[0,0,0],0,server.getIdFromDesc('3c:Skyrim.esm'));
  server.set(actor,'profileId',991003);server.setUserActor(bot.getUserId(),actor);for(let i=0;i<20;i++)server.tick();
  await createClassCommands(pool,data).set({characterKey:'profile:991003',classId:'viper',requestId:randomBytes(16).toString('hex'),epoch:'harness-seed'});
  for(const r of data.records)c.register({stableFormKey:r.stableFormKey});
  const barrier=c.spawn();
  // Queue client packets and send them between ticks, never re-entrantly from
  // inside a host callback (reviewer fix: a re-entrant bot.send was dropped).
  const outgoing=[];c.emitter.on('sendMessage',e=>outgoing.push({t:1,contentJsonDump:e.message.contentJsonDump}));
  const nativeSend=server.sendCustomPacket.bind(server);
  const mp=new Proxy(server,{get(target,key){
    if(key==='sendCustomPacket')return(user,raw)=>{nativeSend(user,raw);packets.push(JSON.parse(raw));c.receive(JSON.parse(raw));};
    const value=target[key];return typeof value==='function'?value.bind(target):value;
  }});
  core=createGameplayCore({mp,pg:{init:()=>pool},log:{info:m=>{log.push(m);console.log(m);}},env:{
    NODE_ENV:'local',GAMEPLAY_CORE_ALLOW_DEV_OPTIONS:'true',GAMEPLAY_CORE_ALLOW_OFFLINE_IDENTITY:'true',
    GAMEPLAY_CORE_DATABASE_SCHEMA:schema,GAMEPLAY_CORE_MODE_CLASSES:'active',
    GAMEPLAY_CORE_CLIENT_PERKS_MODE:'active',GAMEPLAY_CORE_DEV_CLASS_LEVEL:'40',GAMEPLAY_CORE_DEV_CLASS_SWEEP:'true'
  }});
  ticker=setInterval(()=>{for(const message of outgoing.splice(0))bot.send(message);server.tick();c.update();},5);
  await core.initialize();assert.equal(core.capabilityReport().systems.find(s=>s.id==='classes').status,'SUPPORTED');
  for(const task of ['spells','appearance','equipment','placement'])barrier.complete(task);
  const deadline=performance.now()+30000;
  while(!log.some(l=>l.includes('DEV sweep done:'))){assert(performance.now()<deadline,'Native sweep timed out');await delay(10);}
  const steps=log.filter(l=>/DEV sweep \d+\/18/.test(l));assert.equal(steps.length,18);assert(steps.every(l=>l.endsWith('result=OK')));
  assert(log.some(l=>l.includes('done: ok=18 fail=0; restored=viper; delivery=CONFIRMED')));
  assert.equal((await pool.query('SELECT class_id FROM gc_character_class WHERE character_key=$1',['profile:991003'])).rows[0].class_id,'viper');
  assert.equal(packets.filter(p=>p.type==='perks').length,20);
  console.log('PASS C3b compiled host: 18 domain changes, native bot ACK bridge, restore confirmed. Harness client evidence; no Skyrim effect certification.');
}catch(error){console.error('FAIL C3b native harness: '+(error.code??error.name)+' '+String(error.message).slice(0,600));try{console.error(JSON.stringify(core?.capabilityReport().systems.map(s=>[s.id,s.status,s.reason])));}catch{}process.exitCode=1;}
finally{
  clearInterval(ticker);await core?.shutdown();
  await pool.query('DROP SCHEMA IF EXISTS "'+schema+'" CASCADE');await pool.end();
  // Native addon has no disposal API. All Core/DB work is awaited first.
  process.exit(process.exitCode??0);
}
