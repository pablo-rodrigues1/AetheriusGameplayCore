/** Q15a: combat columns inherited as a unit from the terminal equipment winner.
 * Local ObjectEffect, identity, flags of the record, keywords and presentation stay local. */
export const WEAPON_COMBAT_FIELDS = ['BasicStats.Damage', 'Data.Speed', 'Data.Reach', 'Data.RangeMin',
  'Data.RangeMax', 'Data.Stagger', 'Critical.Damage', 'Critical.PercentMult', 'Data.AnimationType',
  'Data.Skill', 'Data.Flags', 'Critical.Flags', 'Critical.Effect', 'EquipmentType'] as const;
export const ARMOR_COMBAT_FIELDS = ['ArmorRating', 'BodyTemplate.ArmorType', 'BodyTemplate.FirstPersonFlags',
  'BodyTemplate.Flags', 'EquipmentType'] as const;
