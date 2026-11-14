/** Stable ActorValue names shared by catalog generation and class delivery. */
export const CLASS_SKILL_NAMES = [
  'OneHanded','TwoHanded','Marksman','Block','Smithing','HeavyArmor','LightArmor','Pickpocket','Lockpicking',
  'Sneak','Alchemy','Speechcraft','Alteration','Conjuration','Destruction','Illusion','Restoration','Enchanting'
] as const;
export type ClassSkillName = typeof CLASS_SKILL_NAMES[number];
export type ClassSkillValues = Readonly<Record<ClassSkillName,number>>;
