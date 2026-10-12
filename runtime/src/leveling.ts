import type { CharacterKey, SessionBinding } from '../../shared/contracts/src/index.ts';
import type { PoolPort } from '../../shared/persistence/src/index.ts';
import { createDurableLeveling, type XpEventInput } from '../../modules/leveling-system/src/integration/durable.ts';
import enemyBaseXp from '../../modules/leveling-system/config/enemy-base-xp.json' with { type: 'json' };
import levelProgression from '../../modules/leveling-system/config/level-progression.json' with { type: 'json' };
import enemyLevelScaling from '../../modules/leveling-system/config/enemy-level-scaling.json' with { type: 'json' };
import partyXp from '../../modules/leveling-system/config/party-xp.json' with { type: 'json' };
import fatigue from '../../modules/leveling-system/config/fatigue.json' with { type: 'json' };
import contentRelevance from '../../modules/leveling-system/config/content-relevance.json' with { type: 'json' };
import enemyCoveragePolicy from '../../modules/leveling-system/config/enemy-coverage-policy.json' with { type: 'json' };

export const levelingConfigs = {enemyBaseXp,levelProgression,enemyLevelScaling,partyXp,fatigue,contentRelevance,enemyCoveragePolicy};

/** Trusted internal entry only: the future server death owner supplies evidence.
 * Call outside the hit/tick path: award performs durable PostgreSQL I/O. */
export class RuntimeLeveling {
  private adapter;
  private tails = new Map<CharacterKey, Promise<unknown>>();
  constructor(private options: {
    pool: PoolPort;
    configs: Record<string,unknown>;
    check(): void;
    binding(key: CharacterKey): SessionBinding | undefined;
    current(binding: SessionBinding): boolean;
    refresh(binding: SessionBinding): Promise<unknown>;
    devLevel: number | undefined;
  }) {
    this.adapter = createDurableLeveling(options.pool, options.configs);
  }
  award(input: XpEventInput) {
    // Capture evidence and the epoch before queueing; never project into a replacement session.
    const captured = structuredClone(input), live = this.options.binding(captured.characterKey);
    const binding = live?.epoch === captured.epoch ? live : undefined;
    const task = (this.tails.get(captured.characterKey) ?? Promise.resolve()).catch(() => {}).then(async () => {
      this.options.check();
      const receipt = await this.adapter.award(captured); // Resolves only after COMMIT.
      if (receipt.status !== 'accepted' || receipt.replayed || receipt.result.oldLevel === receipt.result.level)
        return {...receipt, classDelivery: {state:'NOT_REQUIRED'}};
      // XP is still persisted; accepted DEV level fixes the effective class level.
      if (this.options.devLevel !== undefined) return {...receipt, classDelivery:{state:'DEV_LEVEL_UNCHANGED'}};
      if (!binding || !this.options.current(binding)) return {...receipt, classDelivery:{state:'NO_CURRENT_BINDING'}};
      try {
        this.options.check();
        return {...receipt, classDelivery:{state:'REFRESH_REQUESTED',result:await this.options.refresh(binding)}};
      } catch { return {...receipt, classDelivery:{state:'UNSUPPORTED',reason:'CLASS_REFRESH_UNAVAILABLE'}}; }
    });
    const tail = task.finally(() => { if (this.tails.get(captured.characterKey) === tail) this.tails.delete(captured.characterKey); });
    this.tails.set(captured.characterKey,tail); return tail;
  }
  async shutdown() { await Promise.allSettled([...this.tails.values()]); }
}
