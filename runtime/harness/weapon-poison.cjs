// Reviewer only: instantiates the REAL addon (opens the explicitly supplied port).
// Packet shapes: server/cpp/messages/{UpdateEquipment,OnEquip,Hit}Message.h,
// message numbers: MsgType.h. Bot is ScampServer::CreateBot's built-in client.
// No gamemode, database, destroyActor or Papyrus Activate is involved.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const argv=process.argv.slice(2),options={};
for(let i=0;i<argv.length;i+=2){if(!argv[i].startsWith('--')||!argv[i+1])throw Error('Expected --name value');options[argv[i].slice(2)]=argv[i+1];}
for(const key of ['port','work-dir','addon','settings'])assert(options[key],`Missing --${key}`);
const port=Number(options.port);assert(Number.isInteger(port)&&port>0&&port<=65535&&port!==7777,'Supply an isolated port, never the project owner port');
const work=path.resolve(options['work-dir']);fs.mkdirSync(work,{recursive:true});
const settingsFile=path.resolve(options.settings),input=JSON.parse(fs.readFileSync(settingsFile,'utf8'));
const settings={port,listenHost:'127.0.0.1',maxPlayers:4,offlineMode:true,npcEnabled:true,
  dataDir:path.resolve(path.dirname(settingsFile),input.dataDir??'data'),loadOrder:input.loadOrder,
  aetheriusCombat:{weaponPoison:(options.mode??'on')==='on',shadow:false}};
assert(['on','off'].includes(options.mode??'on'),'--mode on|off');
const addon=path.resolve(options.addon);
process.chdir(work);
globalThis.require=require;
const {ScampServer}=require(addon);
const server=new ScampServer(JSON.stringify(settings));server._setSelf(server);
function tick(){for(let i=0;i<10;i++)server.tick();}
try{
  const bot=server.createBot();tick();
  const cell=server.getIdFromDesc('3c:Skyrim.esm'),weapon=server.getIdFromDesc('1397e:Skyrim.esm'),poison=server.getIdFromDesc('3a5a4:Skyrim.esm');
  assert.equal(server.lookupEspmRecordById(weapon).record.type,'WEAP');
  assert.equal(server.lookupEspmRecordById(poison).record.type,'ALCH');
  const actor=server.createActor(0,[0,0,0],0,cell),target=server.createActor(0,[0,0,0],0,cell);
  server.setUserActor(bot.getUserId(),actor);
  bot.send({t:14,remoteId:target});tick(); // real hoster, needed by resource projection
  server.set(actor,'inventory',{entries:[{baseId:weapon,count:1},{baseId:poison,count:2}]});
  server.set(actor,'aetheriusPoisonDoseBonus',6);
  assert.equal(server.get(actor,'aetheriusPoisonDoseBonus'),6);
  bot.send({t:5,idx:server.get(actor,'idx'),data:{inv:{entries:[{baseId:weapon,count:1,worn:true}]},numChanges:1}});tick();
  bot.send({t:11,baseId:poison});tick();
  const inventory=server.get(actor,'inventory');
  if(!settings.aetheriusCombat.weaponPoison){
    assert(!inventory.entries.find(e=>e.baseId===weapon).poisonId);
    console.log('PASS FIX-1010 disabled maintainer poison use; native NPC scenario follows');
  } else {
  const coated=inventory.entries.find(e=>e.baseId===weapon);
  assert.equal(coated.poisonId,poison);assert.equal(coated.poisonCount,7);assert.equal(coated.worn,true);
  assert.equal(inventory.entries.find(e=>e.baseId===poison).count,1);
  const before=server.get(target,'percentages');
  bot.send({t:17,data:{aggressor:0x14,target,source:weapon,projectile:0,isBashAttack:false,isHitBlocked:false,isPowerAttack:false,isSneakAttack:false}});tick();
  assert.equal(server.get(actor,'inventory').entries.find(e=>e.baseId===weapon).poisonCount,6);
  const after=server.get(target,'percentages');
  assert(after.health<before.health,'accepted native hit must damage target');
  console.log('PASS D-P1 real addon: use, native inventory, worn state, 7 doses, accepted hit spends one; no database');
  console.log(JSON.stringify({coated:{count:coated.count,worn:coated.worn,poisonCount:coated.poisonCount},before,after,status:server.get(actor,'aetheriusPoisonStatus')}));
  }
  // ScampServer::Place makes MpActor from NPC_; LocationalDataBinding teleports
  // it; HostMessage/OnHostAttempt associates it with this bot's actor.
  const base=server.getIdFromDesc('422b4:Skyrim.esm');
  assert.equal(server.lookupEspmRecordById(base).record.type,'NPC_');
  const npc=server.place(base);server.set(npc,'locationalData',{cellOrWorldDesc:'3c:Skyrim.esm',pos:[0,0,0],rot:[0,0,0]});tick();
  bot.send({t:14,remoteId:npc});tick();
  const invBefore=server.get(npc,'inventory'),statusBefore=server.get(npc,'aetheriusPoisonStatus'),playerBefore=server.get(actor,'percentages');
  bot.send({t:17,data:{aggressor:npc,target:actor,source:server.getIdFromDesc('1f4:Skyrim.esm'),projectile:0,isBashAttack:false,isHitBlocked:false,isPowerAttack:false,isSneakAttack:false}});tick();
  assert(server.get(actor,'percentages').health<playerBefore.health,'Hosted NPC hit must reach native physical calculation');
  assert.deepEqual(server.get(npc,'inventory'),invBefore);
  assert.deepEqual(server.get(npc,'aetheriusPoisonStatus'),statusBefore,'NPC must never enter poison logic');
  console.log('PASS FIX-1010 hosted actual NPC hits bot player; native damage, no NPC poison mutation');
  process.exit(0);
}catch(error){console.error('FAIL D-P1 native harness:',error.message);process.exit(1);}
