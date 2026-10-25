import type { JsonObject, JsonValue } from '../../contracts/src/messages.ts';
/** Version 1 NPC row columns; indices are schema positions, never plugin positions. */
export const NPC_FIELDS = [
  "IsDeleted",
  "Configuration.Flags",
  "Configuration.TemplateFlags",
  "Class",
  "Race",
  "Template",
  "Configuration.HealthOffset",
  "Configuration.MagickaOffset",
  "Configuration.StaminaOffset",
  "Configuration.CalcMinLevel",
  "Configuration.CalcMaxLevel",
  "PlayerSkills.SkillValues[OneHanded]",
  "PlayerSkills.SkillValues[TwoHanded]",
  "PlayerSkills.SkillValues[Archery]",
  "PlayerSkills.SkillValues[Block]",
  "PlayerSkills.SkillValues[Smithing]",
  "PlayerSkills.SkillValues[HeavyArmor]",
  "PlayerSkills.SkillValues[LightArmor]",
  "PlayerSkills.SkillValues[Pickpocket]",
  "PlayerSkills.SkillValues[Lockpicking]",
  "PlayerSkills.SkillValues[Sneak]",
  "PlayerSkills.SkillValues[Alchemy]",
  "PlayerSkills.SkillValues[Speech]",
  "PlayerSkills.SkillValues[Alteration]",
  "PlayerSkills.SkillValues[Conjuration]",
  "PlayerSkills.SkillValues[Destruction]",
  "PlayerSkills.SkillValues[Illusion]",
  "PlayerSkills.SkillValues[Restoration]",
  "PlayerSkills.SkillValues[Enchanting]",
  "PlayerSkills.SkillOffsets[OneHanded]",
  "PlayerSkills.SkillOffsets[TwoHanded]",
  "PlayerSkills.SkillOffsets[Archery]",
  "PlayerSkills.SkillOffsets[Block]",
  "PlayerSkills.SkillOffsets[Smithing]",
  "PlayerSkills.SkillOffsets[HeavyArmor]",
  "PlayerSkills.SkillOffsets[LightArmor]",
  "PlayerSkills.SkillOffsets[Pickpocket]",
  "PlayerSkills.SkillOffsets[Lockpicking]",
  "PlayerSkills.SkillOffsets[Sneak]",
  "PlayerSkills.SkillOffsets[Alchemy]",
  "PlayerSkills.SkillOffsets[Speech]",
  "PlayerSkills.SkillOffsets[Alteration]",
  "PlayerSkills.SkillOffsets[Conjuration]",
  "PlayerSkills.SkillOffsets[Destruction]",
  "PlayerSkills.SkillOffsets[Illusion]",
  "PlayerSkills.SkillOffsets[Restoration]",
  "PlayerSkills.SkillOffsets[Enchanting]",
  "PlayerSkills.Health",
  "PlayerSkills.Magicka",
  "PlayerSkills.Stamina",
  "PlayerSkills.GearedUpWeapons",
  "DefaultOutfit",
  "SleepingOutfit",
  "WornArmor",
  "AttackRace"
] as const;
export const NPC_TEMPLATE_CATEGORIES = ["Traits","Stats","Factions","SpellList","AIData","AIPackages","ModelAnimation","BaseData","Inventory","Script","DefPackList","AttackData","Keywords"] as const;
export const NPC_PROVIDER_REASONS = [
  "cycle in NPC template chain",
  "deleted NPC template winner",
  "template flags unavailable",
  "template link unavailable",
  "template absent from NPC_ export or LVLN requires an observed chain; no spawn selection"
] as const;
/** Local winner value. Null is unknown when its path is in unavailable, otherwise a known null link. */
export function npcField(data: JsonObject, path: typeof NPC_FIELDS[number]): JsonValue {
  if (data.layout !== 1 || !Array.isArray(data.fields) || data.fields.length !== NPC_FIELDS.length) throw new TypeError('Invalid NPC row layout');
  return data.fields[NPC_FIELDS.indexOf(path)]!;
}
export function npcTemplateProvider(data: JsonObject, category: typeof NPC_TEMPLATE_CATEGORIES[number]): JsonObject {
  if (data.layout !== 1 || !Array.isArray(data.providers)) throw new TypeError('Invalid NPC providers');
  const bit = 2 ** NPC_TEMPLATE_CATEGORIES.indexOf(category);
  const group = data.providers.find(row => Array.isArray(row) && typeof row[0] === 'number' && (row[0] & bit) !== 0);
  if (!Array.isArray(group)) throw new TypeError('NPC provider category absent');
  return group[3] === null ? { status: 'SUPPORTED', provider: group[1]!, chain: group[2]! }
    : { status: 'UNSUPPORTED', reason: NPC_PROVIDER_REASONS[Number(group[3])]!, chain: group[2]! };
}
