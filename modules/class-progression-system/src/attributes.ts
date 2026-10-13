import type { CharacterKey, SessionEpoch } from '../../../shared/contracts/src/index.ts';
import type { QueryExecutor, PoolPort } from '../../../shared/persistence/src/index.ts';
import { executeCommand } from '../../../shared/persistence/src/index.ts';
import { assertCharacterKey } from '../../../shared/persistence/src/transaction.ts';
import { ClassError, readClass, type CharacterLevelPort } from './index.ts';
export interface AttributeValues { readonly health:number; readonly magicka:number; readonly stamina:number }
export interface AttributeState {
  readonly classId:string|null; readonly level:number; readonly levelOrigin:'LEVELING'|'LEVELING_DEFAULT'|'DEV';
  readonly earned:number; readonly spent:AttributeValues; readonly spentTotal:number; readonly available:number;
  readonly revision:number; readonly applicable:boolean; readonly reason?:'CLASS_REQUIRED'|'ATTRIBUTE_ALLOCATION_EXCEEDS_LEVEL'|'ATTRIBUTE_ALLOCATION_INVALID';
}
export function earnedAttributePoints(level:number):number {
  if(!Number.isInteger(level)||level<1||level>40)throw new ClassError('CLASS_LEVEL_INVALID');
  return 15*(level-1);
}
export async function readAllocation(tx:QueryExecutor,key:CharacterKey) {
  assertCharacterKey(key);
  const row=(await tx.query<{health:number;magicka:number;stamina:number;revision:string}>(
    'SELECT health,magicka,stamina,revision FROM gc_attribute_allocation WHERE character_key=$1',[key])).rows[0];
  const spent=Object.freeze({health:row?.health??0,magicka:row?.magicka??0,stamina:row?.stamina??0}),revision=Number(row?.revision??0);
  const valid=Object.values(spent).every(n=>Number.isSafeInteger(n)&&n>=0&&n%5===0)
    &&Number.isSafeInteger(revision)&&(row?revision>=1:revision===0);
  return {spent,revision,valid};
}
/** Caller holds the shared character lock (or a repeatable read staff snapshot). */
export async function readAttributeState(tx:QueryExecutor,key:CharacterKey,levels:CharacterLevelPort):Promise<AttributeState> {
  const fact=await readClass(tx,key),level=await levels.read(tx,key),allocation=await readAllocation(tx,key);
  const earned=earnedAttributePoints(level.level),spentTotal=Object.values(allocation.spent).reduce((a,b)=>a+b,0);
  const reason=!allocation.valid?'ATTRIBUTE_ALLOCATION_INVALID':spentTotal>earned?'ATTRIBUTE_ALLOCATION_EXCEEDS_LEVEL':!fact?'CLASS_REQUIRED':undefined;
  return Object.freeze({classId:fact?.classId??null,level:level.level,levelOrigin:level.origin,earned,
    spent:allocation.spent,spentTotal,available:earned-spentTotal,revision:allocation.revision,applicable:!reason,...reason?{reason}:{}});
}
export function createAttributeCommands(pool:PoolPort,levels:CharacterLevelPort) {
  return {async allocate(input:AttributeValues&{characterKey:CharacterKey;requestId:string;epoch:SessionEpoch}) {
    const {health,magicka,stamina}=input,sum=health+magicka+stamina;
    if([health,magicka,stamina].some(n=>!Number.isSafeInteger(n)||n<0||n%5!==0)||!Number.isSafeInteger(sum)||sum<=0)
      throw new ClassError('ATTRIBUTE_POINTS_INVALID');
    return executeCommand(pool,{requestId:input.requestId,characterKey:input.characterKey,epoch:input.epoch,
      type:'attributes.allocate',payload:{health,magicka,stamina}},async(tx,command)=>{
      const state=await readAttributeState(tx,command.characterKey,levels);
      if(!state.classId)throw new ClassError('CLASS_REQUIRED');
      if(!state.applicable)throw new ClassError(state.reason!);
      if(sum>state.available)throw new ClassError('ATTRIBUTE_POINTS_INSUFFICIENT');
      const revision=state.revision+1;if(!Number.isSafeInteger(revision))throw new ClassError('ATTRIBUTE_REVISION_EXHAUSTED');
      const delta=command.payload as unknown as AttributeValues;
      const spent={health:state.spent.health+delta.health,magicka:state.spent.magicka+delta.magicka,stamina:state.spent.stamina+delta.stamina};
      await tx.query(`INSERT INTO gc_attribute_allocation(character_key,health,magicka,stamina,revision) VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(character_key) DO UPDATE SET health=EXCLUDED.health,magicka=EXCLUDED.magicka,stamina=EXCLUDED.stamina,revision=EXCLUDED.revision`,
        [command.characterKey,spent.health,spent.magicka,spent.stamina,revision]);
      return {level:state.level,levelOrigin:state.levelOrigin,earned:state.earned,spent,spentTotal:state.spentTotal+sum,available:state.available-sum,revision};
    });
  }};
}
