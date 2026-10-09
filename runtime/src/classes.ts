import type { SessionBinding } from '../../shared/contracts/src/index.ts';
import type { DomainData } from '../../shared/record-catalog/src/types.ts';
import { classGrants, readClass, createClassCommands, withDevelopmentLevel } from '../../modules/class-progression-system/src/index.ts';
import { levelingLevelPort } from '../../modules/leveling-system/src/persistence/durable.ts';
import type { SystemContext } from './index.ts';
import { scopedPool } from './persistence-scope.ts';
/** Classes own facts; the common projection port owns client delivery. */
export class ClassSystem {
  private stops:(()=>void)[]=[];
  private tails=new Set<Promise<unknown>>();
  constructor(private context:SystemContext,private data:DomainData,private devLevel:number|undefined,private schema:string,private canCompose:(key:string)=>boolean=()=>true){}
  start(){
    const ctx=this.context,port=withDevelopmentLevel(levelingLevelPort,this.devLevel);
    if(['active','canary'].includes(ctx.mode))ctx.composition.register({id:'classes',read:async(tx,key)=>{
      if(!this.canCompose(key))return {revision:0,grants:[]};
      const fact=await readClass(tx,key),level=await port.read(tx,key),revision=(fact?.revision??0)+level.revision;
      return {revision,grants:classGrants(this.data,ctx.catalog,fact,level.level,revision)};
    }});
    this.stops.push(ctx.actors.onReady(({binding})=>{this.track(this.refresh(binding));}));
  }
  private track(task:Promise<unknown>){this.tails.add(task);void task.finally(()=>this.tails.delete(task)).catch(()=>{});}
  async refresh(binding:SessionBinding){
    try{const set=await this.context.composition.inspect(binding);
      const available=this.context.projection.capability().perks.status==='SUPPORTED';
      const projection=available&&this.context.canMutate(binding)?await this.context.composition.recompose(binding):undefined;
      const delivery=this.context.projection.perkStatus(binding);
      this.context.log.info(`[classes] ${this.context.mode}: ${binding.characterKey}; level origin=${this.devLevel===undefined?'LEVELING':'DEV'}; class perks=${set.grants.filter(g=>g.source.kind==='CLASS').length}; delivery=${delivery.state}`);
      return {status:'SUPPORTED' as const,set,delivery,projection};}
    catch{return {status:'UNSUPPORTED' as const,reason:'CLASS_COMPOSITION_UNAVAILABLE'};}
  }
  async set(input:{binding:SessionBinding;requestId:string;classId:string}){
    const binding=Object.freeze({...input.binding,actorRef:Object.freeze({...input.binding.actorRef})}),ctx=this.context;
    const check=()=>{if(ctx.signal.aborted||!ctx.canMutate(binding))throw Error('MODE_OR_STALE_BINDING');};
    try{check();if(!ctx.persistence)throw Error('DATABASE_UNAVAILABLE');
      const commands=createClassCommands(scopedPool(ctx.persistence.pool,this.schema,check),this.data);
      const receipt=await commands.set({characterKey:binding.characterKey,epoch:binding.epoch,requestId:input.requestId,classId:input.classId});check();
      if(receipt.status==='conflict')return {status:'UNSUPPORTED' as const,reason:receipt.reason};
      return {status:'SUPPORTED' as const,receipt,composition:await this.refresh(binding)};
    }catch(error){return {status:'UNSUPPORTED' as const,reason:(error as {code?:string}).code??((error as Error).message==='MODE_OR_STALE_BINDING'?'MODE_OR_STALE_BINDING':'CLASS_COMMAND_FAILED')};}
  }
  async shutdown(){for(const stop of this.stops.splice(0))stop();await Promise.allSettled([...this.tails]);}
}
