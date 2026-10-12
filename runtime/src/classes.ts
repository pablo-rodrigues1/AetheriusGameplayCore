import type { SessionBinding } from '../../shared/contracts/src/index.ts';
import type { DomainData } from '../../shared/record-catalog/src/types.ts';
import { classGrants, readClass, createClassCommands, withDevelopmentLevel } from '../../modules/class-progression-system/src/index.ts';
import { levelingLevelPort } from '../../modules/leveling-system/src/persistence/durable.ts';
import type { SystemContext } from './index.ts';
import { DevelopmentClassSweep } from './class-sweep.ts';
import { withTransaction } from '../../shared/persistence/src/index.ts';
import { scopedPool } from './persistence-scope.ts';
/** Classes own facts; the common projection port owns client delivery. */
export class ClassSystem {
  private sweep?:DevelopmentClassSweep;
  private stops:(()=>void)[]=[];
  private tails=new Set<Promise<unknown>>();
  constructor(private context:SystemContext,private data:DomainData,private devLevel:number|undefined,private schema:string,private canCompose:(key:string)=>boolean=()=>true,private sweepEnabled=false,private sweepAttempts?:Set<string>){}
  start(){
    const ctx=this.context,port=withDevelopmentLevel(levelingLevelPort,this.devLevel);
    if(['active','canary'].includes(ctx.mode))ctx.composition.register({id:'classes',read:async(tx,key)=>{
      if(!this.canCompose(key))return {revision:0,grants:[]};
      const fact=await readClass(tx,key),actual=await port.read(tx,key),level={...actual,level:this.sweep?.level(key)??actual.level},revision=(fact?.revision??0)+level.revision;
      return {revision,grants:classGrants(this.data,ctx.catalog,fact,level.level,revision)};
    }});
    if(this.sweepEnabled){
      if(!ctx.persistence||ctx.projection.capability().perks.status!=='SUPPORTED'||!['active','canary'].includes(ctx.mode)){
        ctx.log.info('[classes] ERROR DEV sweep unavailable: classes, database and client delivery must be active');
      }else{
        const pool=ctx.persistence.pool;
        this.sweep=new DevelopmentClassSweep({context:ctx,data:this.data,settleInitial:()=>Promise.allSettled([...this.tails]).then(()=>{}),...this.sweepAttempts?{attempted:this.sweepAttempts}:{},
          readLevel:binding=>withTransaction(scopedPool(pool,this.schema,()=>this.check(binding)),async tx=>(await port.read(tx,binding.characterKey)).level),
          readOriginal:binding=>withTransaction(scopedPool(pool,this.schema,()=>this.check(binding)),async tx=>(await readClass(tx,binding.characterKey))?.classId),
          change:async(binding,classId,requestId,detached)=>{
            const commands=createClassCommands(scopedPool(pool,this.schema,detached?undefined:()=>this.check(binding)),this.data);
            const receipt=await commands.set({characterKey:binding.characterKey,epoch:binding.epoch,requestId,classId});
            if(receipt.status==='conflict')throw Error('CLASS_COMMAND_CONFLICT');
          }});
        this.sweep.start();
      }
    }
    this.stops.push(ctx.actors.onReady(({binding})=>{this.track(this.ready(binding));}));
  }
  private async ready(binding:SessionBinding){
    if(this.sweep?.active(binding.characterKey))await this.sweep.idle(binding.characterKey);
    if(!this.context.signal.aborted&&this.context.identity.isCurrent(binding))return this.refresh(binding);
    return undefined;
  }
  private check(binding:SessionBinding){if(this.context.signal.aborted||!this.context.canMutate(binding))throw Error('MODE_OR_STALE_BINDING');}
  private track(task:Promise<unknown>){this.tails.add(task);void task.finally(()=>this.tails.delete(task)).catch(()=>{});}
  async refresh(binding:SessionBinding){
    if(this.sweep?.active(binding.characterKey))await this.sweep.idle(binding.characterKey);
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
    try{check();if(this.sweep?.active(binding.characterKey))throw Object.assign(Error('DEV_SWEEP_IN_PROGRESS'),{code:'DEV_SWEEP_IN_PROGRESS'});if(!ctx.persistence)throw Error('DATABASE_UNAVAILABLE');
      const commands=createClassCommands(scopedPool(ctx.persistence.pool,this.schema,check),this.data);
      const receipt=await commands.set({characterKey:binding.characterKey,epoch:binding.epoch,requestId:input.requestId,classId:input.classId});check();
      if(receipt.status==='conflict')return {status:'UNSUPPORTED' as const,reason:receipt.reason};
      return {status:'SUPPORTED' as const,receipt,composition:await this.refresh(binding)};
    }catch(error){return {status:'UNSUPPORTED' as const,reason:(error as {code?:string}).code??((error as Error).message==='MODE_OR_STALE_BINDING'?'MODE_OR_STALE_BINDING':'CLASS_COMMAND_FAILED')};}
  }
  async shutdown(){await this.sweep?.shutdown();for(const stop of this.stops.splice(0))stop();await Promise.allSettled([...this.tails]);}
}
