import type { FeatureMode } from '@aetherius/contracts';

declare const BUNDLE_VERSION: string;

interface HostContext {
  readonly mp: unknown;
  readonly pg: unknown;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly log: { info(message: string): void };
}

const features = Object.freeze(
  ['races', 'spells', 'perks', 'classes', 'standing-stones', 'religion', 'damage']
    .map(id => Object.freeze({ id, mode: 'off' satisfies FeatureMode }))
);
const bundleInfo = Object.freeze({ version: BUNDLE_VERSION, features });
const healthEvent = 'aetherius:gameplay-core:health-check';

/** A6-S1: diagnostic lifecycle only; injected host services remain untouched. */
export function createGameplayCore({ log }: HostContext) {
  let initialized = false;
  const listener = (reply: (healthy: boolean) => void) => reply(initialized);

  return Object.freeze({
    initialize() {
      if (initialized) return;
      log.info(`[gameplay-core] bundle ${BUNDLE_VERSION}; all features off`);
      process.on(healthEvent, listener);
      initialized = true;
    },
    shutdown() {
      process.removeListener(healthEvent, listener);
      initialized = false;
    },
    healthCheck: () => initialized,
    info: () => bundleInfo
  });
}
