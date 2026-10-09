import type { PoolPort } from '../../shared/persistence/src/index.js';
import type { SkyMpCatalogApi } from '../../tools/catalog/host.ts';

export type Hook = (...args: number[]) => unknown;
// Retain the exact opaque object: official isCurrent checks reference identity.
// Never copy/enumerate it; the host also keeps private authentication metadata.
export interface OfficialIdentity { readonly actorId: number; readonly userId: number; readonly profile_id: number }
export interface RuntimeMp extends SkyMpCatalogApi {
  readonly aetheriusOfficialIdentity?: {
    session(actorId: number): OfficialIdentity | null;
    isCurrent(identity: OfficialIdentity): boolean;
  };
  onActivate?: Hook | undefined;
  get(id: number, property: string): unknown;
  getServerSettings(): { dataDir?: string; offlineMode?: boolean; aetheriusCombat?:{weaponPoison?:boolean} };
  getUserByActor?(actorId: number): number;
  on?(event: string, listener: (...args: number[]) => void): unknown;
  getDescFromId(id: number): string;
  makeProperty?(name: string, options: { isVisibleByOwner: boolean; isVisibleByNeighbors: boolean; updateOwner: string; updateNeighbor: string }): void;
  set?(id: number, property: string, value: unknown): void;
  callPapyrusFunction(type: string, cls: string, method: string, self: { type: 'form'; desc: string }, args: unknown[]): unknown;
}
export interface HostContext {
  readonly mp?: RuntimeMp;
  readonly pg: { init(): PoolPort };
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly log: { info(message: string): void };
}
