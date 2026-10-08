import type { CharacterKey, DefinitionRef, SessionBinding } from './identity.js';
import type { RevisionVector } from './revisions.js';
export type GrantSourceKind = 'CLASS' | 'RACE' | 'STANDING_STONE' | 'RELIGION' | 'QUEST'
  | 'EQUIPMENT' | 'LEARNED' | 'ADMIN' | 'SYSTEM' | 'TRANSFORMATION';
export interface GrantSource { readonly kind: GrantSourceKind; readonly key: string }
export type EffectOwner = 'AETHERIUS_SERVER' | 'NATIVE_SERVER' | 'NATIVE_CLIENT' | 'DISABLED';
interface GrantBase { readonly source: GrantSource; readonly revision: number }
export interface PerkGrant extends GrantBase {
  readonly kind: 'perk'; readonly definition: DefinitionRef<'PERK'>; readonly rank: number;
}
export interface SpellGrant extends GrantBase { readonly kind: 'spell'; readonly definition: DefinitionRef<'SPEL'> }
export interface AbilityGrant extends GrantBase { readonly kind: 'ability'; readonly definition: DefinitionRef<'SPEL'> }
export interface PowerGrant extends GrantBase { readonly kind: 'power'; readonly definition: DefinitionRef<'SPEL'> }
/** A record-backed modifier; result semantics are supplied by its certified owner. */
export interface ModifierGrant extends GrantBase {
  readonly kind: 'modifier'; readonly definition: DefinitionRef; readonly owner: EffectOwner;
}
export type Grant = PerkGrant | SpellGrant | AbilityGrant | PowerGrant | ModifierGrant;
/** Full composition, unique by (kind, definition, source.kind, source.key). */
export interface GrantSet {
  readonly characterKey: CharacterKey;
  readonly revision: RevisionVector;
  readonly grants: readonly Grant[];
}
export interface GrantProjection {
  readonly binding: SessionBinding;
  readonly set: GrantSet;
}
/** Client confirmation is delivery evidence, never proof of gameplay results. */
export interface GrantProjectionAck {
  readonly binding: SessionBinding;
  readonly revision: RevisionVector;
  readonly status: 'applied' | 'unsupported' | 'invalid';
  readonly reason: string;
}
