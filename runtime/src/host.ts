import type { PoolPort } from '../../shared/persistence/src/index.js';
import type { SkyMpCatalogApi } from '../../tools/catalog/host.ts';

export type Hook = (...args: number[]) => unknown;
export interface RuntimeMp extends SkyMpCatalogApi {
  onActivate?: Hook | undefined;
  get(id: number, property: string): unknown;
  getServerSettings(): { dataDir?: string; offlineMode?: boolean };
  getUserByActor?(actorId: number): number;
  on?(event: string, listener: (...args: number[]) => void): unknown;
  getDescFromId(id: number): string;
  callPapyrusFunction(type: string, cls: string, method: string, self: { type: 'form'; desc: string }, args: unknown[]): unknown;
}
export interface HostContext {
  readonly mp?: RuntimeMp;
  readonly pg: { init(): PoolPort };
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly log: { info(message: string): void };
}
