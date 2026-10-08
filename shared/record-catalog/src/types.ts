import type { CatalogSignature, PluginKind, RecordType, RuntimeFormId, StableFormKey } from '../../contracts/src/identity.ts';
import type { JsonObject } from '../../contracts/src/messages.ts';
import type { CatalogEntry, RecordCatalogPort } from '../../contracts/src/ports.ts';

export interface PluginFingerprint {
  readonly filename: string;
  readonly size: number;
  /** Signed CRC32, identical to the host's manifest. */
  readonly crc32: number;
  readonly isLight: boolean;
}
export interface UnavailablePluginFingerprint {
  readonly filename: string;
  readonly status: 'UNSUPPORTED';
  readonly reason: string;
}
export type PluginObservation = PluginFingerprint | UnavailablePluginFingerprint;
export interface CatalogRecord {
  /** Record content + defining plugin fingerprint; independent of domain. */
  readonly signature: CatalogSignature;
  readonly stableFormKey: StableFormKey;
  readonly recordType: RecordType;
  readonly definingPlugin: string;
  readonly pluginKind: PluginKind;
  readonly winnerPlugin: string;
  readonly data: JsonObject;
}
export interface UnsupportedLink {
  readonly status: 'UNSUPPORTED';
  readonly stableFormKey: StableFormKey | null;
  readonly reason: string;
}
export interface DomainData {
  readonly schemaVersion: 1;
  readonly domain: 'standing-stones' | 'races';
  readonly exportEpoch: string;
  readonly signature: CatalogSignature;
  readonly dependencies: readonly PluginFingerprint[];
  readonly records: readonly CatalogRecord[];
  readonly roots: readonly StableFormKey[];
  /** Incomplete grants/semantics are explicit, independent of boot reconciliation. */
  readonly unsupported: readonly UnsupportedLink[];
}
export interface RecordInspection { readonly type: string }
export interface CatalogHost {
  /** Boot-only snapshot of actual active files, never a global signature or positions. */
  plugins(): readonly PluginObservation[];
  /** SkyMP getIdFromDesc: numeric result, or throws. */
  getIdFromDesc(descriptor: string): number;
  /** getIdFromDesc maps names without checking existence. Check the winner too. */
  lookupEspmRecordById(id: number): RecordInspection;
}
export interface ResolvedRecord extends CatalogEntry { readonly runtimeFormId: RuntimeFormId }
export interface DomainCatalog extends RecordCatalogPort {
  readonly domain: DomainData['domain'];
  readonly signature: CatalogSignature;
  readonly status: 'SUPPORTED' | 'UNSUPPORTED';
  readonly issues: readonly string[];
  readonly unsupported: readonly UnsupportedLink[];
  readonly records: readonly ResolvedRecord[];
  readonly roots: readonly ResolvedRecord[];
  byKey(key: StableFormKey): ResolvedRecord | undefined;
  byRuntimeId(id: RuntimeFormId): ResolvedRecord | undefined;
}
