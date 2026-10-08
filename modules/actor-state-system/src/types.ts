import type { CharacterKey, Grant, GrantSource, RevisionVector } from '../../../shared/contracts/src/index.ts';

/** The domain reads its own facts before invoking its pure provider. */
export type GrantProvider<Facts> = (facts: Facts) => readonly Grant[];

type Effective<G extends Grant> = G extends Grant
  ? Omit<G, 'source' | 'revision'> & { readonly sources: readonly GrantSource[] }
  : never;
/** Derived view of contract grants, not another grant ledger. */
export type EffectiveGrant = Effective<Grant>;
export interface EffectiveGrantSet {
  readonly characterKey: CharacterKey;
  readonly revision: RevisionVector;
  readonly grants: readonly EffectiveGrant[];
}
export interface EffectiveGrantChange {
  readonly previous: EffectiveGrant;
  readonly next: EffectiveGrant;
  /** false for changes limited to provenance, signature or owner. */
  readonly rankChanged: boolean;
}
export interface GrantDiff {
  readonly characterKey: CharacterKey;
  readonly previousRevision: RevisionVector;
  readonly revision: RevisionVector;
  readonly added: readonly EffectiveGrant[];
  readonly removed: readonly EffectiveGrant[];
  readonly changed: readonly EffectiveGrantChange[];
}
export type RevisionComparison = 'equal' | 'before' | 'after' | 'incomparable';
