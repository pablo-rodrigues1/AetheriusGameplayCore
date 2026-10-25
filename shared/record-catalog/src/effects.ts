/** Positional columns; never plugin positions. Null + unavailable path means unknown. */
export const EFFECT_FIELDS = ['IsDeleted', 'Archetype.Type', 'Archetype.ActorValue', 'SecondActorValue',
  'SecondActorValueWeight', 'Flags', 'CastType', 'TargetType', 'MagicSkill', 'PerkToApply'] as const;
/** Carrier effect tuple: [MGEF key, magnitude, duration seconds, area, source index, conditions complete-and-empty]. */
export const CARRIER_EFFECT_COLUMNS = ['baseEffect', 'magnitude', 'duration', 'area', 'sourceIndex', 'unconditional'] as const;
