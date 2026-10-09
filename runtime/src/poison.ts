import type { GrantSet, StableFormKey, SessionBinding } from '../../shared/contracts/src/index.ts';
import type { DomainCatalog } from '../../shared/record-catalog/src/types.ts';
import type { RuntimeMp } from './host.ts';
type Outcome = { readonly bonus:number; readonly unsupported:readonly string[] };
/** Certified grammar: constant Add, with no predicate or Subject HasPerk == 0.
 * Acquisition predicates do not gate grants. No names/runtime slots are used. */
export function poisonDoseBonus(set:GrantSet,catalogs:readonly Pick<DomainCatalog,'byKey'>[]):Outcome {
  const owned=new Set(set.grants.filter(g=>g.kind==='perk').map(g=>g.definition.stableFormKey));
  const lookup=(key:StableFormKey)=>catalogs.map(c=>c.byKey(key)).find(Boolean);
  // Official rank chain: only the highest owned successor contributes, including
  // sparse admin grants. Entry-point predicates below remain mandatory.
  function hasOwnedSuccessor(key:StableFormKey):boolean {
    const seen=new Set<StableFormKey>([key]);let cursor=lookup(key)?.data.fields as Record<string,string>|undefined;
    while(cursor?.NextPerk){const next=cursor.NextPerk as StableFormKey;if(seen.has(next))return false;seen.add(next);
      if(owned.has(next))return true;cursor=lookup(next)?.data.fields as Record<string,string>|undefined;
    }
    return false;
  }
  let bonus=0;const unsupported:string[]=[];
  for(const key of owned){const record=catalogs.map(c=>c.byKey(key)).find(Boolean);
    if(!record){unsupported.push(`${key}:PERK_RECORD_ABSENT`);continue;}
    const fields=record.data.fields as Record<string,string>|undefined,notes=record.data.exportNotes as Record<string,string>|undefined;
    for(const [path,entry] of Object.entries(fields??{})){
      if(!path.endsWith('.EntryPoint')||entry!=='ModPoisonDoseCount')continue;
      const prefix=path.slice(0,-'.EntryPoint'.length),value=Number(fields![`${prefix}.Value`]);
      if(fields![`${prefix}.Modification`]!=='Add'||notes?.[prefix]!=='[PerkEntryPointModifyValue]'||
        !Number.isSafeInteger(value)||value<0){unsupported.push(`${key}:POISON_DOSE_OPERATION`);continue;}
      let passes=true;
      if(notes?.[`${prefix}.Conditions`]==='[list: 1 item(s)]'){
        const p=`${prefix}.Conditions[0].Conditions[0]`;
        if(fields![`${prefix}.Conditions[0].RunOnTabIndex`]!=='0'||notes?.[`${prefix}.Conditions[0].Conditions`]!=='[list: 1 item(s)]'||
          fields![`${p}.Data.Function`]!=='HasPerk'||fields![`${p}.Data.RunOnType`]!=='Subject'||
          fields![`${p}.CompareOperator`]!=='EqualTo'||fields![`${p}.ComparisonValue`]!=='0'||fields![`${p}.Flags`]!=='0'||
          fields![`${p}.Data.UseAliases`]!=='False'||fields![`${p}.Data.UsePackageData`]!=='False'||!fields![`${p}.Data.Perk`]){
          unsupported.push(`${key}:POISON_DOSE_CONDITIONS`);continue;
        }
        passes=!owned.has(fields![`${p}.Data.Perk`] as StableFormKey);
      }else if(notes?.[`${prefix}.Conditions`]!=='[list: 0 item(s)]'){
        unsupported.push(`${key}:POISON_DOSE_CONDITIONS`);continue;
      }
      if(passes&&!hasOwnedSuccessor(key))bonus+=value;
    }
  }
  if(!Number.isSafeInteger(bonus)||bonus>65534)return {bonus:0,unsupported:[...unsupported,'POISON_DOSE_OVERFLOW']};
  return Object.freeze({bonus,unsupported:Object.freeze(unsupported)});
}
/** One transient writer. Composition is serialized by ActorComposition, after
 * transaction commit and epoch check. No host/gameplay call occurs during hits. */
export class PoisonProjection {
  private delivered=new Map<number,SessionBinding>();
  constructor(private mp:RuntimeMp|undefined,private catalogs:()=>readonly DomainCatalog[],
    private current:(binding:SessionBinding)=>boolean,private warn:(message:string)=>void){}
  publish(binding:SessionBinding,set:GrantSet):void {
    if(!this.current(binding)||this.mp?.getServerSettings().aetheriusCombat?.weaponPoison!==true)return;
    const output=poisonDoseBonus(set,this.catalogs());
    if(!this.mp.set){this.warn('poison dose UNSUPPORTED: native property delivery unavailable');return;}
    try{this.mp.set(binding.actorRef.actorId,'aetheriusPoisonDoseBonus',output.bonus);this.delivered.set(binding.actorRef.actorId,binding);}
    catch{this.warn('poison dose UNSUPPORTED: native transient property unavailable');return;}
    if(output.unsupported.length)this.warn(`poison dose UNSUPPORTED: ${output.unsupported.join('; ')}`);
  }
  clear(binding:SessionBinding):void {
    if(this.delivered.get(binding.actorRef.actorId)?.epoch!==binding.epoch)return;
    this.delivered.delete(binding.actorRef.actorId);
    try{this.mp?.set?.(binding.actorRef.actorId,'aetheriusPoisonDoseBonus',0);}catch{/* actor may have been destroyed */}
  }
  shutdown():void{for(const binding of [...this.delivered.values()])this.clear(binding);}
}
