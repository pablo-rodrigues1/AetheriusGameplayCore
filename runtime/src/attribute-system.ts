import type { SessionBinding } from '../../shared/contracts/src/index.ts';
import type { PoolPort } from '../../shared/persistence/src/index.ts';
import { withTransaction } from '../../shared/persistence/src/index.ts';
import { lockCharacter } from '../../shared/persistence/src/transaction.ts';
import { createAttributeCommands, readAttributeState, withDevelopmentLevel, type AttributeValues } from '../../modules/class-progression-system/src/index.ts';
import { levelingLevelPort } from '../../modules/leveling-system/src/persistence/durable.ts';
import type { Actors } from './actors.ts';
import type { RuntimeMp } from './host.ts';
import type { DevelopmentAttributes } from './attributes.ts';
import { scopedPool } from './persistence-scope.ts';

const property='aetheriusAttributeBonuses';
export class AttributeSystem {
  private delivered=new Map<number,SessionBinding>();
  private tails=new Map<string,Promise<unknown>>();
  private stops:(()=>void)[]=[];
  private stopped=false;
  private levels;
  constructor(private options:{mp:RuntimeMp|undefined;pool:PoolPort;schema:string;actors:Actors;
    current(binding:SessionBinding):boolean;warn(message:string):void;devLevel:number|undefined;devValues:DevelopmentAttributes|undefined}) {
    this.levels=withDevelopmentLevel(levelingLevelPort,options.devLevel);
  }
  start(){
    const actors=this.options.actors;
    this.stops.push(actors.onBound(b=>{void this.publish(b);}),actors.onReady(({binding})=>{void this.publish(binding);}),
      actors.onUnbound(b=>this.clear(b)));
    this.options.warn('attribute maximum writer='+ (this.options.devValues?'DEV':'CLASS_ADDITIVE') +'; records provide base maxima');
  }
  private check(binding:SessionBinding){
    if(this.stopped||!this.options.current(binding))throw Error('MODE_OR_STALE_BINDING');
  }
  private official(binding:SessionBinding){
    const mp=this.options.mp,auth=mp?.aetheriusOfficialIdentity,session=auth?.session(binding.actorRef.actorId);
    return !!session&&auth?.isCurrent(session)&&session.actorId===binding.actorRef.actorId
      &&session.profile_id===Number(binding.profileKey.slice(8))&&mp?.get(session.actorId,'profileId')===session.profile_id;
  }
  private native(binding:SessionBinding){
    if(!this.official(binding))throw Error('OFFICIAL_SESSION_REQUIRED');
    const value=this.options.mp?.get(binding.actorRef.actorId,property) as {base?:AttributeValues;maximum?:AttributeValues;origin?:string}|undefined;
    const valid=(v:AttributeValues|undefined)=>!!v&&Object.values(v).length===3&&['health','magicka','stamina'].every(k=>{
      const n=v[k as keyof AttributeValues];return typeof n==='number'&&Number.isFinite(n)&&n>0;
    });
    if(!value||!valid(value.base)||!valid(value.maximum))throw Error('ATTRIBUTE_NATIVE_PROPERTY_UNAVAILABLE');
    return value as {base:AttributeValues;maximum:AttributeValues;origin:string};
  }
  async state(binding:SessionBinding){
    this.check(binding);
    const state=await withTransaction(scopedPool(this.options.pool,this.options.schema,()=>this.check(binding)),async tx=>{
      await lockCharacter(tx,binding.characterKey);
      return readAttributeState(tx,binding.characterKey,this.levels);
    });
    this.check(binding);
    if(state.reason==='ATTRIBUTE_ALLOCATION_EXCEEDS_LEVEL'||state.reason==='ATTRIBUTE_ALLOCATION_INVALID')this.options.warn(binding.characterKey+': '+state.reason+'; saved allocation retained, bonuses suppressed');
    try {
      const native=this.native(binding),effective=this.options.devValues??(state.applicable
        ?{health:native.base.health+state.spent.health,magicka:native.base.magicka+state.spent.magicka,stamina:native.base.stamina+state.spent.stamina}:native.base);
      return {status:state.applicable?'SUPPORTED' as const:'UNSUPPORTED' as const,...state,
        maximum:effective,baseMaximum:native.base,maximumOrigin:this.options.devValues?'DEV':state.applicable?'CLASS_ADDITIVE':'RECORDS',
        host:{status:'SUPPORTED' as const,maximum:native.maximum,origin:native.origin}};
    }catch(error){return {status:'UNSUPPORTED' as const,...state,maximum:null,baseMaximum:null,
      maximumOrigin:this.options.devValues?'DEV':'CLASS_ADDITIVE',host:{status:'UNSUPPORTED' as const,reason:(error as Error).message}};}
  }
  publish(binding:SessionBinding):Promise<unknown>{
    const captured=Object.freeze({...binding,actorRef:Object.freeze({...binding.actorRef})});
    const key=captured.characterKey;
    const task=(this.tails.get(key)??Promise.resolve()).catch(()=>{}).then(async()=>{
      try {
        this.check(captured);
        // DEV-A1 owns the sole absolute override and its original lifecycle.
        if(this.options.devValues)return {status:'SUPPORTED',writer:'DEV'};
        const state=await this.state(captured);this.check(captured);
        if(state.host.status!=='SUPPORTED')throw Error(state.host.reason);
        if(!this.options.mp?.set)throw Error('ATTRIBUTE_NATIVE_DELIVERY_UNAVAILABLE');
        // native() already proved the property exists; never persist a custom substitute.
        this.options.mp.set(captured.actorRef.actorId,property,state.applicable?state.spent:null);
        this.delivered.set(captured.actorRef.actorId,captured);
        return {status:'SUPPORTED',writer:'CLASS_ADDITIVE',state};
      }catch(error){const reason=(error as Error).message;
        this.options.warn('attributes UNSUPPORTED: '+reason);return {status:'UNSUPPORTED',reason};}
    });
    const tail=task.finally(()=>{if(this.tails.get(key)===tail)this.tails.delete(key);});
    this.tails.set(key,tail);return tail;
  }
  async allocate(input:{binding:SessionBinding;requestId:string}&AttributeValues){
    const binding=Object.freeze({...input.binding,actorRef:Object.freeze({...input.binding.actorRef})});
    let committed=false;
    try{
      this.check(binding);
      const commands=createAttributeCommands(scopedPool(this.options.pool,this.options.schema,()=>this.check(binding)),this.levels);
      const receipt=await commands.allocate({characterKey:binding.characterKey,epoch:binding.epoch,requestId:input.requestId,
        health:input.health,magicka:input.magicka,stamina:input.stamina});
      committed=receipt.status==='accepted';
      this.check(binding);
      if(receipt.status==='conflict')return {status:'UNSUPPORTED' as const,reason:receipt.reason,committed:false};
      const projection=await this.publish(binding),state=await this.state(binding);
      return {status:'SUPPORTED' as const,committed:true,receipt,projection,state};
    }catch(error){return {status:'UNSUPPORTED' as const,committed,reason:(error as {code?:string}).code??(error as Error).message};}
  }
  clear(binding:SessionBinding){
    if(this.delivered.get(binding.actorRef.actorId)?.epoch!==binding.epoch)return;
    this.delivered.delete(binding.actorRef.actorId);
    try{this.options.mp?.set?.(binding.actorRef.actorId,property,null);}catch{/* destroyed actor */}
  }
  async shutdown(){
    this.stopped=true;
    for(const stop of this.stops.splice(0))stop();
    await Promise.allSettled([...this.tails.values()]);
    for(const binding of [...this.delivered.values()])this.clear(binding);
  }
}
