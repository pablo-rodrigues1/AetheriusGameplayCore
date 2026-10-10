import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const workspace=fileURLToPath(new URL('../../../',import.meta.url));
const compiled=await build({stdin:{loader:'ts',resolveDir:workspace,contents:`export * from './aetherius-client/client/src/sync/inventory.ts'; export * from './aetherius-client/client/src/services/services/gameplayGrantService.ts';`},
  bundle:true,platform:'node',format:'cjs',external:['skyrimPlatform'],write:false});
export function load(sp){const module={exports:{}};new Function('require','exports','module',compiled.outputFiles[0].text)(()=>sp,module.exports,module);return module.exports;}

/** Model, not game proof. InventoryApi.cpp exposes actual ExtraPoison/Worn lists.
 * PapyrusTESModPlatform::AddItemEx creates NEW extra lists (also for removal),
 * queues additions and EquipObject using the created list; CallNative.cpp's
 * IsRemoveItem calls RemoveItem synchronously with nullptr extras.
 * The executable engine's selection of a non-owned fabricated list is opaque.
 * We exercise the adverse choice compatible with H's observed two-copy loop:
 * negative AddItemEx removes a spare before the poisoned held copy. The new
 * path removes the whole base group, so works for any order of that choice.
 * No animation set, save, paused-game queue, native event or DLL is simulated. */
export function game(weaponId=4100,poisonId=4200,hand='right'){
  let entries=[{baseId:weaponId,count:1,name:'Blessed Northern Iron Dagger',chargePercent:0,[hand==='left'?'wornLeft':'worn']:true},
    {baseId:weaponId,count:1,name:'Blessed Northern Iron Dagger',chargePercent:0}, {baseId:poisonId,count:20}];
  const forms=new Map(),queue=[],calls=[],logs=[],storage={basesResetExists:true,basesReset:new Set([1])};
  class Form{constructor(id,type){this.id=id;this.type=type;}getFormID(){return this.id;}getType(){return this.type;}getName(){return this.id===weaponId?'Blessed Northern Iron Dagger':'Poison';}}
  class ObjectReference{getFormID(){return 20;}getBaseObject(){return {getFormID:()=>1};}removeAllItems(){entries=[];}
    removeItem(form,count,silent,destination){calls.push(['remove-base',form.id,count,silent,destination]);let remain=count;
      entries=entries.flatMap(e=>{if(e.baseId!==form.id)return [e];const n=Math.min(e.count,remain);remain-=n;return e.count>n?[{...e,count:e.count-n}]:[];});}}
  class Actor extends ObjectReference{static from(f){return f===player?f:null;}queueNiNodeUpdate(){}isEquipped(){return true;}}
  const player=new Actor(); forms.set(weaponId,new Form(weaponId,41));forms.set(poisonId,new Form(poisonId,46));
  let worn=false,left=false;
  const sp={storage,Form,ObjectReference,Actor,ActorBase:class{},FormType:{Weapon:41,Potion:46,Misc:32,Ingredient:30},
    Game:{getPlayer:()=>player,getFormEx:id=>forms.get(id),getFormFromFile:(local,plugin)=>forms.get(local)},
    Potion:{from:f=>f?.type===46?Object.assign(f,{isPoison:()=>true}):null},Enchantment:{from:f=>f},Ammo:{from:()=>null},
    Utility:{isInMenuMode:()=>false},printConsole:line=>logs.push(line),encodeUtf8:s=>Buffer.from(s),getContainer:()=>[],
    getExtraContainerChanges:()=>[...new Set(entries.map(e=>e.baseId))].map(baseId=>({baseId,countDelta:entries.filter(e=>e.baseId===baseId).reduce((n,e)=>n+e.count,0),
      extendDataList:entries.filter(e=>e.baseId===baseId).map(e=>{const extras=[{type:'Count',count:e.count}];
        for(const k of ['worn','wornLeft'])if(e[k])extras.push({type:k==='worn'?'Worn':'WornLeft'});
        if(e.name)extras.push({type:'TextDisplayData',name:e.name});if(e.chargePercent)extras.push({type:'Charge',charge:e.chargePercent});
        if(e.poisonId)extras.push({type:'Poison',poisonId:e.poisonId,count:e.poisonCount});return extras;})})),
    TESModPlatform:{resetContainer(){},pushWornState(w,l){worn=w;left=l;},addItemEx(refr,f,count,health,enchantment,maxCharge,removeOnUnequip,chargePercent,name,soul,poison,poisonCount){
      const w=worn,l=left;worn=left=false;calls.push(['add-ex',f.id,count,poison?.id,poisonCount,w,l]);
      queue.push(()=>{if(count<0){const i=entries.findIndex(e=>e.baseId===f.id&&!e.worn&&!e.wornLeft);if(i>=0)entries.splice(i,1);return;}
        const e={baseId:f.id,count,chargePercent,name};if(w)e.worn=true;if(l)e.wornLeft=true;if(poison){e.poisonId=poison.id;e.poisonCount=poisonCount;}
        if(f.type===46){const same=entries.find(x=>x.baseId===f.id);if(same){same.count+=count;return;}}entries.push(e);});}}};
  return {sp,player,calls,logs,weaponId,poisonId,get entries(){return entries;},pump(){for(const fn of queue.splice(0))fn();},
    applyLocal(){const e=entries.find(e=>e.worn||e.wornLeft);e.poisonId=poisonId;e.poisonCount=1;entries.find(e=>e.baseId===poisonId).count--;},
    spendLocal(n){const e=entries.find(e=>e.worn||e.wornLeft);if(n){e.poisonCount=n;}else{delete e.poisonId;delete e.poisonCount;}}};
}
