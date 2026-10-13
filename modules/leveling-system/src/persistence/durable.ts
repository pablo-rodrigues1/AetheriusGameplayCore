import progressionConfig from '../../config/level-progression.json' with { type: 'json' };
// @ts-expect-error immutable Leveling math has no TypeScript declarations
import { ProgressionRules } from '../domain/progression.mjs';
import type { CharacterKey } from '../../../../shared/contracts/src/identity.ts';
import type { QueryExecutor } from '../../../../shared/persistence/src/index.ts';
import { assertCharacterKey } from '../../../../shared/persistence/src/transaction.ts';
import type { CharacterLevelPort } from '../../../class-progression-system/src/index.ts';
export interface DurableProgress { readonly totalXp:number; readonly level:number; readonly revision:number; readonly state:Record<string,unknown> }
/** Transaction-bound repository, replacing in-memory progress in the durable adapter. */
export async function readProgress(tx:QueryExecutor,key:CharacterKey):Promise<DurableProgress|undefined> {
  assertCharacterKey(key);
  const row=(await tx.query<{total_xp:string;character_level:number;progress:Record<string,unknown>;revision:string}>(
    'SELECT total_xp,character_level,progress,revision FROM gc_leveling_progress WHERE character_key=$1',[key])).rows[0];
  if(!row)return undefined;
  const totalXp=Number(row.total_xp),revision=Number(row.revision),level=row.character_level;
  if(!Number.isFinite(totalXp)||totalXp<0||!Number.isSafeInteger(revision)||revision<1||!Number.isInteger(level)||level<1||level>40
    ||row.progress.classLevel!==level||row.progress.totalXpAccumulated!==totalXp)throw Error('LEVELING_PROGRESS_INVALID');
  return {totalXp,level,revision,state:row.progress};
}
export const levelingLevelPort:CharacterLevelPort={async read(tx,key){
  const progress=await readProgress(tx,key);return progress?{level:progress.level,origin:'LEVELING',revision:progress.revision}:{level:1,origin:'LEVELING_DEFAULT',revision:0};
}};
export async function saveProgress(tx:QueryExecutor,key:CharacterKey,state:Record<string,unknown>,revision:number) {
  if(!Number.isSafeInteger(revision)||revision<1)throw Error('LEVELING_REVISION_EXHAUSTED');
  // Persist only Leveling-owned facts. The legacy math's class/attribute fields
  // are temporary calculation inputs/outputs, never a second Class writer.
  const progress=Object.fromEntries(['classLevel','currentXp','totalXpAccumulated','nextLevelXp','dailyCycleKey',
    'dailyXpGained','dailyXpCap','isFatigued','nextResetAt'].map(field=>[field,state[field]]));
  await tx.query(`INSERT INTO gc_leveling_progress(character_key,total_xp,character_level,progress,revision) VALUES($1,$2,$3,$4::jsonb,$5)
    ON CONFLICT(character_key) DO UPDATE SET total_xp=EXCLUDED.total_xp,character_level=EXCLUDED.character_level,progress=EXCLUDED.progress,revision=EXCLUDED.revision`,
    [key,state.totalXpAccumulated,state.classLevel,JSON.stringify(progress),revision]);
}

/** Called under the command character lock, in the caller's transaction.
 * Keep fatigue/cycle/cap facts verbatim; no second ledger or XP writer. */
export async function resetProgress(tx:QueryExecutor,key:CharacterKey):Promise<void> {
  const prior=await readProgress(tx,key);
  if(!prior)return;
  const initial=new ProgressionRules(progressionConfig).createInitialState({playerId:key});
  await saveProgress(tx,key,{...prior.state,classLevel:initial.classLevel,currentXp:initial.currentXp,
    totalXpAccumulated:initial.totalXpAccumulated,nextLevelXp:initial.nextLevelXp},prior.revision+1);
}
