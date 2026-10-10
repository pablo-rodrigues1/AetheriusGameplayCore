import type { SessionBinding } from '../../shared/contracts/src/index.ts';
import type { RuntimeMp } from './host.ts';
import { requireDevelopmentOption, type CoreEnvironment } from './development.ts';

export type DevelopmentAttributes = Readonly<{health:number;magicka:number;stamina:number}>;
export function developmentAttributes(env:CoreEnvironment):DevelopmentAttributes|undefined {
  const value=env.GAMEPLAY_CORE_DEV_ATTRIBUTES;
  if(value===undefined)return undefined;
  requireDevelopmentOption(env,'GAMEPLAY_CORE_DEV_ATTRIBUTES');
  if(!/^[0-9]+,[0-9]+,[0-9]+$/.test(value)||value.trim()!==value)throw Object.assign(Error('GAMEPLAY_CORE_DEV_ATTRIBUTES requires three integers 1..100000'),{code:'DEV_ATTRIBUTES_INVALID'});
  const values=value.split(',').map(Number);
  if(values.some(n=>!Number.isSafeInteger(n)||n<1||n>100000))
    throw Object.assign(Error('GAMEPLAY_CORE_DEV_ATTRIBUTES requires three integers 1..100000'),{code:'DEV_ATTRIBUTES_INVALID'});
  return Object.freeze({health:values[0]!,magicka:values[1]!,stamina:values[2]!});
}

/** No database, grants or client-supplied values. One transient host writer. */
export class DevelopmentAttributesProjection {
  private delivered=new Map<number,SessionBinding>();
  constructor(private mp:RuntimeMp|undefined,private values:DevelopmentAttributes|undefined,
    private current:(binding:SessionBinding)=>boolean,private warn:(message:string)=>void){}
  publish(binding:SessionBinding):void {
    if(!this.values||!this.current(binding))return;
    const authority=this.mp?.aetheriusOfficialIdentity;
    const official=authority?.session(binding.actorRef.actorId);
    if(!official||!authority?.isCurrent(official)||official.profile_id!==Number(binding.profileKey.slice(8))
      ||official.actorId!==binding.actorRef.actorId||this.mp?.get(binding.actorRef.actorId,'profileId')!==official.profile_id){
      this.warn('DEV attributes UNSUPPORTED: current official player session required');return;}
    if(!this.mp?.set){this.warn('DEV attributes UNSUPPORTED: native delivery unavailable');return;}
    try{
      // An old host would treat an unknown property as custom persisted state.
      if(this.mp.get(binding.actorRef.actorId,'aetheriusDevAttributes')===undefined)throw Error('NATIVE_PROPERTY_ABSENT');
      this.mp.set(binding.actorRef.actorId,'aetheriusDevAttributes',this.values);this.delivered.set(binding.actorRef.actorId,binding);
    }
    catch{this.warn('DEV attributes UNSUPPORTED: native transient property unavailable');}
  }
  clear(binding:SessionBinding):void {
    if(this.delivered.get(binding.actorRef.actorId)?.epoch!==binding.epoch)return;
    this.delivered.delete(binding.actorRef.actorId);
    try{this.mp?.set?.(binding.actorRef.actorId,'aetheriusDevAttributes',null);}catch{/* destroyed actor */}
  }
  shutdown():void{for(const binding of [...this.delivered.values()])this.clear(binding);}
}
