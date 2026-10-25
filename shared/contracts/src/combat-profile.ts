import type { CharacterKey, StableFormKey } from './identity.js';
import type { GrantSourceKind } from './grants.js';
import type { JsonValue } from './messages.js';
import type { RevisionVector } from './revisions.js';

export type CombatProfileValue<T> =
  | { readonly status: 'SUPPORTED'; readonly value: T }
  | { readonly status: 'UNSUPPORTED'; readonly value: null; readonly reason: string };

export type CombatProfileEffectValue =
  | { readonly status: 'SUPPORTED'; readonly value: number; readonly activeWhen: string }
  | { readonly status: 'UNSUPPORTED'; readonly value: null; readonly activeWhen: string; readonly reason: string }
  | { readonly status: 'INACTIVE'; readonly value: null; readonly activeWhen: string; readonly reason: string };

export type CombatSkill =
  | 'OneHanded'
  | 'TwoHanded'
  | 'Marksman'
  | 'Block'
  | 'HeavyArmor'
  | 'LightArmor';

export interface CombatProfilePerk {
  readonly sourceKind: GrantSourceKind | 'NPC_RECORD';
  readonly sourceKey: string;
  readonly stableFormKey: StableFormKey;
  readonly rank: number;
  readonly status: 'SUPPORTED' | 'UNSUPPORTED';
  readonly reason: string | null;
  /** JSON-safe output from the approved DS-3 compiler; never client supplied. */
  readonly compiled: JsonValue | null;
}

export interface CombatProfilePerkSet {
  readonly status: 'SUPPORTED' | 'PARTIAL' | 'UNSUPPORTED';
  readonly value: readonly CombatProfilePerk[];
  readonly reason: string | null;
}

export interface CombatProfileTemplateCategory {
  readonly category: string;
  readonly status: 'SUPPORTED' | 'UNSUPPORTED';
  readonly provider: StableFormKey | null;
  readonly chain: readonly StableFormKey[];
  readonly reason: string | null;
}

export interface CombatProfileTemplateChain {
  readonly status: 'SUPPORTED' | 'PARTIAL' | 'UNSUPPORTED';
  readonly value: readonly CombatProfileTemplateCategory[];
  readonly reason: string | null;
}

export interface CombatProfileSourceRevisions {
  readonly classFact: number | null;
  readonly level: number | null;
  readonly attributeAllocation: number | null;
  readonly race: number | null;
}

interface CombatProfileBase {
  readonly version: 1;
  /** Monotonic for this subject while the Core runtime is alive. */
  readonly revision: number;
  readonly status: 'SUPPORTED' | 'PARTIAL' | 'UNSUPPORTED';
  readonly reason: string | null;
  readonly sourceRevision: RevisionVector | null;
  readonly sourceRevisions: CombatProfileSourceRevisions;
  readonly level: CombatProfileValue<number>;
  readonly race: CombatProfileValue<StableFormKey>;
  readonly skills: Readonly<Record<CombatSkill, CombatProfileValue<number>>>;
  readonly attributes: Readonly<{
    health: CombatProfileValue<number>;
    magicka: CombatProfileValue<number>;
    stamina: CombatProfileValue<number>;
  }>;
  readonly perks: CombatProfilePerkSet;
  readonly effects: Readonly<{
    fortifyOneHandedDamage: CombatProfileEffectValue;
    fortifyTwoHandedDamage: CombatProfileEffectValue;
    fortifyArcheryDamage: CombatProfileEffectValue;
    fortifyUnarmedDamage: CombatProfileEffectValue;
    fortifyPowerAttacks: CombatProfileEffectValue;
    fortifyBashDamage: CombatProfileEffectValue;
    fortifyArmorRating: CombatProfileEffectValue;
    fortifyBlock: CombatProfileEffectValue;
    resistArrowDamage: CombatProfileEffectValue;
    resistPowerAttackDamage: CombatProfileEffectValue;
    fortifySneakAttacks: CombatProfileEffectValue;
  }>;
}

export interface PlayerCombatProfileProjection extends CombatProfileBase {
  readonly subject: { readonly kind: 'PLAYER'; readonly characterKey: CharacterKey };
  readonly sourceRevision: RevisionVector;
  readonly templateChain: null;
}

export interface NpcCombatProfileProjection extends CombatProfileBase {
  readonly subject: {
    readonly kind: 'NPC';
    readonly characterKey: null;
    readonly stableFormKey: StableFormKey | null;
    readonly generation: string | null;
  };
  readonly templateChain: CombatProfileTemplateChain;
}

export type CombatProfileProjection = PlayerCombatProfileProjection | NpcCombatProfileProjection;
