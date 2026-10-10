// Reviewer only. Instantiates the real addon and opens the explicit isolated port.
// Native bot.send takes the same JSON object as NetworkingService serializes.
// Bot has no receive callback: outgoing packets are observed at sendCustomPacket,
// after its real native call. This proves the bridge, not receipt inside Skyrim.
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
const args=process.argv.slice(2),options={};
for(let i=0;i<args.length;i+=2){assert(args[i].startsWith('--')&&args[i+1],'Expected --name value');options[args[i].slice(2)]=args[i+1];}
for(const key of ['port','work-dir','addon','settings'])assert(options[key],`Missing --${key}`);
const port=Number(options.port);assert(Number.isInteger(port)&&port>0&&port<=65535&&port!==7777,'Use an isolated port, never 7777');
const work=path.resolve(options['work-dir']),addon=path.resolve(options.addon),settingsFile=path.resolve(options.settings);
const sourceRoot=fileURLToPath(new URL('../../',import.meta.url));
const compiled=await build({absWorkingDir:sourceRoot,stdin:{loader:'ts',resolveDir:sourceRoot,contents:`export {ClientDelivery} from './runtime/src/client-delivery.ts';export {Actors} from './runtime/src/actors.ts';export {Scope,Hooks} from './runtime/src/scope.ts';`},bundle:true,platform:'node',format:'esm',write:false});
const {ClientDelivery,Actors,Scope,Hooks}=await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const input=JSON.parse(readFileSync(settingsFile,'utf8'));
// Allowlist necessary settings; no copying/logging credentials or production DB.
const settings={port,listenHost:'127.0.0.1',maxPlayers:4,offlineMode:true,
  dataDir:path.resolve(path.dirname(settingsFile),input.dataDir??'data'),loadOrder:input.loadOrder};
mkdirSync(work,{recursive:true});process.chdir(work);
globalThis.require=createRequire(import.meta.url);
const {ScampServer}=globalThis.require(addon),server=new ScampServer(JSON.stringify(settings));server._setSelf(server);
const scope=new Scope(),ready=[],outgoing=[];
function tick(){for(let i=0;i<20;i++)server.tick();}
try{
  const bot=server.createBot();tick();
  const actor=server.createActor(0,[0,0,0],0,server.getIdFromDesc('3c:Skyrim.esm'));
  server.set(actor,'profileId',991001);server.setUserActor(bot.getUserId(),actor);tick();
  const nativeSend=server.sendCustomPacket.bind(server);
  // A tap after the native send, not a replacement host/transport.
  const mp=new Proxy(server,{get(target,key){if(key==='sendCustomPacket')return(user,raw)=>{nativeSend(user,raw);outgoing.push(JSON.parse(raw));};const value=target[key];return typeof value==='function'?value.bind(target):value;}});
  const actors=new Actors(mp,scope,true,console.log);
  const delivery=new ClientDelivery(mp,actors,scope,()=>true,console.log);delivery.start(new Hooks(mp,scope,console.log));actors.onReady(e=>ready.push(e));actors.start();
  const binding=actors.lookup({actorId:actor});assert.equal(binding.status,'SUPPORTED');
  const hello=outgoing.find(p=>p.type==='hello');assert(hello,'Real actor bound and native hello sent');
  const packet=p=>{bot.send({t:1,contentJsonDump:JSON.stringify({channel:hello.channel,v:1,session:hello.session,...p})});tick();};
  packet({type:'begin',cycle:'native-bot-spawn'});const challenge=outgoing.find(p=>p.type==='challenge');assert(challenge);
  packet({type:'ready',cycle:'native-bot-spawn',challenge:'wrong'});assert.equal(ready.length,0);
  packet({type:'ready',cycle:'native-bot-spawn',challenge:challenge.challenge});assert.equal(ready.length,1);assert.equal(ready[0].signal,'CLIENT_SPAWN_TASKS_COMPLETED');
  packet({type:'ready',cycle:'native-bot-spawn',challenge:challenge.challenge});assert.equal(ready.length,1);
  let acknowledgements=0;delivery.onAck(()=>acknowledgements++);
  packet({type:'ack',cycle:'native-bot-spawn',challenge:challenge.challenge,id:'transport-only',revision:{facts:1,grants:1,equipment:0,effects:0,catalog:1},items:[]});assert.equal(acknowledgements,1);
  scope.close();console.log('PASS B5b real addon: native sender identity, CustomPacket begin/challenge/ready/ACK bridge, duplicate ready rejected. No DB or gameplay assertion.');process.exit(0);
}catch(error){scope.close();console.error('FAIL B5b real addon bridge:',error.message);process.exit(1);}
