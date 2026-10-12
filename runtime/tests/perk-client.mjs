import {build} from 'esbuild';
import {EventEmitter} from 'node:events';
import {fileURLToPath} from 'node:url';
const workspace=fileURLToPath(new URL('../../../',import.meta.url));
const result=await build({entryPoints:[`${workspace}/aetherius-client/client/src/services/services/gameplayGrantService.ts`],bundle:true,platform:'node',format:'esm',write:false});
export const {GameplayGrantService,GameplaySpawnBarrier}=await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
/** Minimal SP imitation: CallNativeApi.cpp:164-168 and CallNative.cpp:470-481
 * wait for the non-latent native call; they do NOT certify engine visibility.
 * SkyrimPlatform.cpp:138-145 emits update; main.cpp:72-84 ends that frame.
 * The next-frame removal visibility is an inference from the real B5b sweep:
 * _work/evidence/C3b/sessao-em-jogo-2026-10-12-1710.log (18 failed removals,
 * later ALREADY_ABSENT). AddPerk visibility was immediate in all 18 steps.
 * No ranks, saves, engine conditions or combat are simulated/certified. */
export function client({shift=1000}={}){
  const emitter=new EventEmitter(),updates=[],removals=[],sent=[],perks=new Set(),calls=[],forms=new Map();
  let playerPresent=true,addWorks=true,removeWorks=true;
  const player={hasPerk:p=>perks.has(p.id),addPerk:p=>{calls.push(['add',p.key]);if(addWorks)perks.add(p.id);},removePerk:p=>{calls.push(['remove',p.key]);if(removeWorks)removals.push(()=>perks.delete(p.id));}};
  const sp={Game:{getPlayer:()=>playerPresent?player:null,getFormFromFile:(local,plugin)=>forms.get(`${plugin.toLowerCase()}|${local.toString(16).toUpperCase().padStart(6,'0')}`)??null},Perk:{from:f=>f?.type==='PERK'?f:null},encodeUtf8:s=>Buffer.from(s,'utf8')};
  const controller={emitter,once:(event,fn)=>updates.push(fn),on:()=>{}};
  emitter.on('sendMessage',e=>{if(e.message.t!==undefined)sent.push(JSON.parse(e.message.contentJsonDump));});
  const service=new GameplayGrantService(sp,controller);
  const register=definition=>{const key=definition.stableFormKey??definition.key;forms.set(key,{id:shift+forms.size,type:'PERK',key});return forms.get(key);};
  return {emitter,sent,perks,calls,forms,service,register,sp,controller,
    receive:p=>emitter.emit('customPacketMessage',{message:{contentJsonDump:typeof p==='string'?p:JSON.stringify(p)}}),
    update(){for(const remove of removals.splice(0))remove();for(const fn of updates.splice(0))fn();},
    spawn(tasks=['spells','appearance','equipment','placement']){let barrier;emitter.emit('gameplaySpawnBegin',{tasks,capture:b=>barrier=b});return barrier;},
    blockAdd:()=>addWorks=false,blockRemove:()=>removeWorks=false,noPlayer:()=>playerPresent=false};
}
