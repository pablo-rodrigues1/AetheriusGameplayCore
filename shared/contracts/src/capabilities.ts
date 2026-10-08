export type CapabilityStatus = 'SUPPORTED' | 'PARTIAL' | 'UNSUPPORTED' | 'DEGRADED';
export interface Capability {
  readonly id: string;
  readonly version: number;
  readonly status: CapabilityStatus;
  /** Evidence artifact/test references. SUPPORTED requires at least one. */
  readonly proof: readonly string[];
  readonly limitations: readonly string[];
}
export type FeatureMode = 'off' | 'audit' | 'shadow' | 'canary' | 'active';
/** UNKNOWN must never become TRUE; INVALID means malformed input/context. */
export type ConditionResult = 'TRUE' | 'FALSE' | 'UNSUPPORTED' | 'INVALID';
export type PortResult<T> =
  | { readonly status: 'SUPPORTED'; readonly value: T }
  | { readonly status: 'UNSUPPORTED'; readonly reason: string };
