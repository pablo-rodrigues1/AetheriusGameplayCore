import { randomUUID } from 'node:crypto';
import type { RuntimeFormId, SessionBinding, StableFormKey } from '../../shared/contracts/src/index.ts';
import { executeCommand } from '../../shared/persistence/src/index.ts';
import { readRace, raceGrants, RaceError } from '../../modules/race-system/src/index.ts';
import type { RaceFact } from '../../modules/race-system/src/index.ts';
import type { SystemContext } from './index.ts';
import type { RuntimeMp } from './host.ts';
import { scopedPool } from './persistence-scope.ts';

export type RaceObservation = { readonly status:'SUPPORTED'; readonly raceKey:StableFormKey }
  | { readonly status:'UNSUPPORTED'; readonly raceKey:null; readonly reason:string };
export class RaceSystem {
  private tails = new Map<string,Promise<unknown>>();
  private stops: (()=>void)[] = [];
  private observations = new Map<string,RaceObservation>();
  constructor(private context:SystemContext, private mp:RuntimeMp|undefined, private schema:string) {}
  start(): void {
    if (['active','canary'].includes(this.context.mode) && this.context.catalog?.status === 'SUPPORTED' && this.context.persistence) {
      this.stops.push(this.context.composition.register({id:'races', read:async(tx,key)=>{
        const fact = await readRace(tx,key);
        return {grants:raceGrants(this.context.catalog,fact),revision:fact?.revision??0};
      }}));
    }
    this.stops.push(this.context.actors.onReady(({binding})=>{void this.observe(binding);}));
    this.stops.push(this.context.actors.onUnbound(binding=>{this.observations.delete(binding.characterKey);}));
    // ActionListener.cpp:219-227 fires AFTER SetAppearance if allowed. Read the
    // stored host property, never trust the appearance argument or isAllowed.
    this.stops.push(this.context.hooks.register('onUpdateAppearanceAttempt', actorId=>{
      const live=this.context.identity.lookup({actorId:actorId as SessionBinding['actorRef']['actorId']});
      if(live.status==='SUPPORTED') void this.observe(live.value);
      return undefined;
    }));
  }
  private read(binding:SessionBinding): RaceObservation {
    if(this.context.catalog?.status!=='SUPPORTED') return {status:'UNSUPPORTED',raceKey:null,reason:'RACE_CATALOG_UNAVAILABLE'};
    let appearance:unknown;
    try { appearance=this.mp?.get(binding.actorRef.actorId,'appearance'); } catch { /* explicit absence */ }
    const id=(appearance as {raceId?:unknown}|null)?.raceId;
    if(!appearance || typeof id!=='number' || !Number.isSafeInteger(id) || id<=0) return {status:'UNSUPPORTED',raceKey:null,reason:'RACE_APPEARANCE_UNAVAILABLE'};
    const root=this.context.catalog.byRuntimeId(id as RuntimeFormId);
    if(!root) {
      let type:unknown;
      try { type=this.mp?.lookupEspmRecordById(id)?.record?.type; } catch { /* unresolved */ }
      return {status:'UNSUPPORTED',raceKey:null,reason:type==='RACE'?'RACE_NOT_PLAYABLE':'RACE_UNRESOLVED'};
    }
    if(root.definition.recordType!=='RACE' || !this.context.catalog.roots.some(r=>r.definition.stableFormKey===root.definition.stableFormKey)) {
      return {status:'UNSUPPORTED',raceKey:null,reason:'RACE_NOT_PLAYABLE'};
    }
    return {status:'SUPPORTED',raceKey:root.definition.stableFormKey};
  }
  latest(binding:SessionBinding): RaceObservation|undefined { return this.observations.get(binding.characterKey); }
  /** Read the live host before reconnect delivery can reconcile an older head.
   * This is a delivery exclusion only; it never persists/provides an inferred fact. */
  nativeKeys(binding:SessionBinding):ReadonlySet<StableFormKey> {
    if(!['active','canary'].includes(this.context.mode)||!this.context.canMutate(binding))return new Set();
    const observed=this.read(binding);
    if(observed.status==='UNSUPPORTED')return new Set();
    return new Set(raceGrants(this.context.catalog,{status:'SUPPORTED',raceKey:observed.raceKey,reason:null,observedAt:'',revision:1})
      .map(g=>g.definition.stableFormKey));
  }
  observe(binding:SessionBinding): Promise<RaceObservation> {
    binding=Object.freeze({...binding,actorRef:Object.freeze({...binding.actorRef})});
    const task=(this.tails.get(binding.characterKey)??Promise.resolve()).catch(()=>{}).then(async()=>{
      const check=()=>{if(this.context.signal.aborted||!this.context.identity.isCurrent(binding)) throw new RaceError('STALE_BINDING');};
      check(); const observation=this.read(binding);this.observations.set(binding.characterKey,Object.freeze(observation));
      this.context.log.info(`[races] ${this.context.mode}: ${binding.characterKey} ${observation.status} ${observation.status==='SUPPORTED'?observation.raceKey:observation.reason}`);
      if(!this.context.canMutate(binding)) return observation;
      if(!this.context.persistence) throw new RaceError('DATABASE_UNAVAILABLE');
      const pool=scopedPool(this.context.persistence.pool,this.schema,()=>{check();if(!this.context.canMutate(binding))throw new RaceError('MODE_OR_STALE_BINDING');});
      await executeCommand(pool,{requestId:randomUUID(),characterKey:binding.characterKey,epoch:binding.epoch,
        type:'races.observe',payload:observation},async tx=>{
        check();const prior=await readRace(tx,binding.characterKey);check();
        const reason=observation.status==='UNSUPPORTED'?observation.reason:null;
        const changed=!prior||prior.status!==observation.status||prior.raceKey!==observation.raceKey||prior.reason!==reason;
        const revision=changed?(prior?.revision??0)+1:prior!.revision;
        if(!Number.isSafeInteger(revision))throw new RaceError('REVISION_EXHAUSTED');
        if(observation.status==='SUPPORTED') raceGrants(this.context.catalog,{status:'SUPPORTED',raceKey:observation.raceKey,reason:null,observedAt:'',revision});
        await tx.query(`INSERT INTO gc_race_observation(character_key,status,race_key,reason,revision) VALUES($1,$2,$3,$4,$5)
          ON CONFLICT(character_key) DO UPDATE SET status=EXCLUDED.status,race_key=EXCLUDED.race_key,
          reason=EXCLUDED.reason,revision=EXCLUDED.revision,observed_at=CURRENT_TIMESTAMP`,[binding.characterKey,observation.status,observation.raceKey,reason,revision]);
        check();return {status:observation.status,raceKey:observation.raceKey,revision};
      });check();
      // A racial observation never asks the host port to deliver anything,
      // including an unrelated grant which happens to share a racial record.
      // Stone commands keep using the normal full composition/projection path.
      await this.context.composition.inspect(binding);
      return observation;
    }).catch(error=>{
      const result={status:'UNSUPPORTED' as const,raceKey:null,reason:error instanceof RaceError?error.code:'RACE_OBSERVATION_FAILED'};
      this.context.log.info(`[races] ${binding.characterKey} UNSUPPORTED ${result.reason}`);return result;
    });
    const tail=task.finally(()=>{if(this.tails.get(binding.characterKey)===tail)this.tails.delete(binding.characterKey);});
    this.tails.set(binding.characterKey,tail);return tail;
  }
  async shutdown():Promise<void>{for(const stop of this.stops.splice(0).reverse())stop();await Promise.allSettled([...this.tails.values()]);this.observations.clear();}
}
