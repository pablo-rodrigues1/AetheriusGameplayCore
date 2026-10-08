import type { SessionBinding, StableFormKey } from '../../../shared/contracts/src/index.ts';
import type { DomainCatalog } from '../../../shared/record-catalog/src/types.ts';
import { executeCommand } from '../../../shared/persistence/src/index.ts';
import type { CommandReceipt, PoolPort } from '../../../shared/persistence/src/index.ts';
import { readStandingStone, standingStoneGrants, StandingStoneError } from './provider.ts';
export * from './provider.ts';

export interface ChoiceResult {
  readonly stoneKey: StableFormKey;
  readonly previousStone: StableFormKey | null;
  readonly revision: number;
  readonly changed: boolean;
}
export interface ChoiceIntent { readonly binding: SessionBinding; readonly requestId: string; readonly stoneKey: StableFormKey }
export type ChoiceReceipt = CommandReceipt<ChoiceResult>;
export function createStandingStoneCommands(options: {
  readonly pool: PoolPort | undefined;
  readonly catalog: DomainCatalog | undefined;
  /** Includes mode, lifecycle, and the complete live SessionBinding. */
  readonly canMutate: (binding: SessionBinding) => boolean;
  /** Supplies schema and checks session again at COMMIT, without making a pool. */
  readonly transactionPool: (binding: SessionBinding) => PoolPort;
}) {
  return Object.freeze({
    async choose(input: ChoiceIntent): Promise<ChoiceReceipt> {
      const binding = Object.freeze({ ...input.binding, actorRef: Object.freeze({ ...input.binding.actorRef }) });
      const check = () => { if (!options.canMutate(binding)) throw new StandingStoneError('MODE_OR_STALE_BINDING'); };
      check();
      if (!options.pool) throw new StandingStoneError('DATABASE_UNAVAILABLE');
      // Validate every grant before admitting a durable choice, even on replay.
      standingStoneGrants(options.catalog, { stoneKey: input.stoneKey, revision: 1 });
      const receipt = await executeCommand<ChoiceResult>(options.transactionPool(binding), {
        requestId: input.requestId, characterKey: binding.characterKey, epoch: binding.epoch,
        type: 'standing-stones.choose', payload: { stoneKey: input.stoneKey }
      }, async (tx, command) => {
        check();
        const stoneKey = (command.payload as { readonly stoneKey: StableFormKey }).stoneKey;
        const prior = await readStandingStone(tx, binding.characterKey); check();
        const changed = prior?.stoneKey !== stoneKey;
        const revision = changed ? (prior?.revision ?? 0) + 1 : prior!.revision;
        if (!Number.isSafeInteger(revision)) throw new StandingStoneError('REVISION_EXHAUSTED');
        if (changed) {
          await tx.query(`INSERT INTO gc_standing_stone_choice (character_key,stone_key,revision) VALUES ($1,$2,$3)
            ON CONFLICT (character_key) DO UPDATE SET stone_key=EXCLUDED.stone_key,
            revision=EXCLUDED.revision,updated_at=CURRENT_TIMESTAMP`, [binding.characterKey, stoneKey, revision]); check();
        }
        return { stoneKey, previousStone: prior?.stoneKey ?? null, revision, changed };
      });
      // No host operation here. Callers compose/project only after this confirmed commit.
      check(); return receipt;
    }
  });
}
