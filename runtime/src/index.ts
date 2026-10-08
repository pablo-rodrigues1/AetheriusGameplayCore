import type { FeatureMode } from '@aetherius/contracts';
import { createStandingStoneSpike } from '../spike-standing-stone/index.mjs';

declare const BUNDLE_VERSION: string;

interface HostContext {
  readonly mp: StandingStoneMp;
  readonly pg: { init(): { connect(): Promise<StandingStoneClient> } };
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly log: { info(message: string): void };
}

interface StandingStoneClient {
  query(sql: string, values?: readonly unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  release(): void;
}

interface StandingStoneMp {
  onActivate?: ((targetId: number, casterId: number) => unknown) | undefined;
  getIdFromDesc(desc: string): number;
  getDescFromId(formId: number): string;
  callPapyrusFunction(callType: string, className: string, functionName: string,
    self: { type: 'form'; desc: string }, args: unknown[]): unknown;
  isConnected?(userId: number): boolean;
  getUserActor?(userId: number): number | undefined;
  getActorsByProfileId?(profileId: number): number[] | undefined;
}

const coreFeatures = ['races', 'spells', 'perks', 'classes', 'religion', 'damage'];
const healthEvent = 'aetherius:gameplay-core:health-check';

/** A6-S1: diagnostic lifecycle only; injected host services remain untouched. */
export function createGameplayCore({ mp, pg, env, log }: HostContext) {
  let initialized = false;
  let standingStone: ReturnType<typeof createStandingStoneSpike> | null = null;
  const listener = (reply: (healthy: boolean) => void) => reply(initialized);
  const isStandingStoneEnabled = env.ENABLE_STANDING_STONE_SPIKE === 'true';
  const info = () => Object.freeze({
    version: BUNDLE_VERSION,
    features: Object.freeze([
      ...coreFeatures.map(id => Object.freeze({ id, mode: 'off' as FeatureMode })),
      Object.freeze({ id: 'standing-stones', mode: (isStandingStoneEnabled ? 'active' : 'off') as FeatureMode })
    ])
  });

  return Object.freeze({
    async initialize() {
      if (initialized) return;
      process.on(healthEvent, listener);
      if (isStandingStoneEnabled) {
        standingStone = createStandingStoneSpike({ mp, pg, log });
        try {
          await standingStone.initialize();
        } catch (error) {
          standingStone.shutdown();
          standingStone = null;
          process.removeListener(healthEvent, listener);
          throw error;
        }
      }
      initialized = true;
      log.info(`[gameplay-core] bundle ${BUNDLE_VERSION}; standing-stone spike ${isStandingStoneEnabled ? 'active' : 'off'}`);
    },
    async shutdown() {
      standingStone?.shutdown();
      standingStone = null;
      process.removeListener(healthEvent, listener);
      initialized = false;
    },
    healthCheck: () => initialized,
    info
  });
}
