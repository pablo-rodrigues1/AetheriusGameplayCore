# Cobertura de perks de combate por classe

Gerado deterministicamente por modules/damage-system/compiler/tools/generate-coverage.cjs.
Fonte: crosswalk de classes e records PERK do epoch e2-771486e30fc46d2a; os 10 records truncados foram completados pelo export complementar, sempre buscando por formid e conferindo o winner.

SUPPORTED indica efeito nas dez famílias da Função 4 com condições certificadas. UNSUPPORTED é fail-closed. Outros entry points ficam fora do escopo e são contados.

## anti_mago

Perks concedidas no crosswalk: 19.
Efeitos nas famílias de combate: 7; suportados: 6; UNSUPPORTED nas famílias: 1; fora de escopo: 3.

| FormID local:plugin | Perk (crosswalk) | Entry point / operação | Valor / AV / prioridade / rank | Estado e motivo | Condições |
|---|---|---|---|---|---|
| 051B1B:Skyrim.esm | Light Armor Fit | ModArmorRating / Multiply | 1.15 / 190 / 0 | SUPPORTED | HasPerk, WornHasKeyword |
| 052D50:Skyrim.esm | Disciplined Fighter | ModPowerAttackStamina / Multiply | 0.75 / 190 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword |
| 0BABE4:Skyrim.esm | One-Handed Mastery | CalculateMyCriticalHitDamage / MultiplyOnePlusAVMult | 0.05 / OneHanded / 195 / 0 | SUPPORTED | HasKeyword, HasPerk |
| 0BABE4:Skyrim.esm | One-Handed Mastery | CalculateWeaponDamage / MultiplyOnePlusAVMult | 0.01 / OneHanded / 200 / 0 | SUPPORTED | HasKeyword, HasPerk |
| 0BE123:Skyrim.esm | Light Armor Mastery | ModArmorRating / MultiplyOnePlusAVMult | 0.01 / LightArmor / 200 / 0 | SUPPORTED | HasKeyword, HasPerk |
| 0F2CA6:Skyrim.esm | Alteration Mastery | ModSpellCost / MultiplyOnePlusAVMult | -0.005 / Alteration / 200 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasPerk, SpellHasCastingPerk |
| 0F2CA9:Skyrim.esm | Illusion Mastery | ModSpellCost / MultiplyOnePlusAVMult | -0.005 / Illusion / 200 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | SpellHasCastingPerk |
| 106256:Skyrim.esm | Dual Flurry (1) | ModAttackDamage / Multiply | 1.1 / 0 / 0 | SUPPORTED | GetEquippedItemType |
| 106257:Skyrim.esm | Dual Flurry (2) | ModAttackDamage / Multiply | 1.2 / 0 / 0 | SUPPORTED | GetEquippedItemType |
| 344BC9:Vokrii - Minimalistic Perks of Skyrim.esp | Bladedancer | ModIncomingDamage / Multiply | 0.7 / 105 / 0 | UNSUPPORTED: unsupported condition IsPowerAttacking at Effects[0].Conditions[0].Conditions[0] | GetEquippedItemType, IsPowerAttacking |

## arqueiro

Perks concedidas no crosswalk: 18.
Efeitos nas famílias de combate: 19; suportados: 9; UNSUPPORTED nas famílias: 10; fora de escopo: 6.

| FormID local:plugin | Perk (crosswalk) | Entry point / operação | Valor / AV / prioridade / rank | Estado e motivo | Condições |
|---|---|---|---|---|---|
| 007AB5:Vokrii - Minimalistic Perks of Skyrim.esp | Keen Senses | ModArmorRating / Multiply | 1.2 / 123 / 0 | SUPPORTED | HasKeyword, WornHasKeyword |
| 03AF81:Skyrim.esm | Furious Strength | ModPowerAttackDamage / MultiplyOnePlusAVMult | 0.001 / Stamina / 120 / 0 | SUPPORTED | HasKeyword |
| 051B12:Skyrim.esm | Hunter's Discipline | ModRecoverArrowChance / Set | 66 / 150 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | sem condições |
| 051B1B:Skyrim.esm | Light Armor Fit | ModArmorRating / Multiply | 1.15 / 190 / 0 | SUPPORTED | HasPerk, WornHasKeyword |
| 052D50:Skyrim.esm | Disciplined Fighter | ModPowerAttackStamina / Multiply | 0.75 / 190 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword |
| 058F61:Skyrim.esm | Eagle Eye | ModBowZoom / Set | 0.6 / 0 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | sem condições |
| 058F61:Skyrim.esm | Eagle Eye | ModPowerAttackStamina / Set | 10 / 255 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword |
| 0BABE4:Skyrim.esm | One-Handed Mastery | CalculateMyCriticalHitDamage / MultiplyOnePlusAVMult | 0.05 / OneHanded / 195 / 0 | SUPPORTED | HasKeyword, HasPerk |
| 0BABE4:Skyrim.esm | One-Handed Mastery | CalculateWeaponDamage / MultiplyOnePlusAVMult | 0.01 / OneHanded / 200 / 0 | SUPPORTED | HasKeyword, HasPerk |
| 0BABED:Skyrim.esm | Archery Mastery | CalculateMyCriticalHitDamage / MultiplyOnePlusAVMult | 0.05 / Archery / 195 / 0 | SUPPORTED | HasKeyword, HasPerk |
| 0BABED:Skyrim.esm | Archery Mastery | CalculateWeaponDamage / MultiplyOnePlusAVMult | 0.01 / Archery / 200 / 0 | SUPPORTED | HasKeyword, HasPerk |
| 0BE123:Skyrim.esm | Light Armor Mastery | ModArmorRating / MultiplyOnePlusAVMult | 0.01 / LightArmor / 200 / 0 | SUPPORTED | HasKeyword, HasPerk |
| 0BE126:Skyrim.esm | Sneak Mastery | ModDetectionSneakSkill / AddAVMult | 0.5 / Sneak / 200 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasPerk |
| 1036F0:Skyrim.esm | Deadly Aim | ModSneakAttackMult / Multiply | 1.5 / 150 / 0 | SUPPORTED | HasKeyword |
| 105F1C:Skyrim.esm | Far Shot (1) | ModAttackDamage / Multiply | 1.05 / 187 / 0 | UNSUPPORTED: unsupported condition GetDistance at Effects[3].Conditions[2].Conditions[1]; unsupported condition GetDistance at Effects[3].Conditions[2].Conditions[2] | GetDistance, GetIsID, HasKeyword, HasPerk |
| 105F1C:Skyrim.esm | Far Shot (1) | ModAttackDamage / Multiply | 1.1 / 188 / 0 | UNSUPPORTED: unsupported condition GetDistance at Effects[2].Conditions[2].Conditions[1]; unsupported condition GetDistance at Effects[2].Conditions[2].Conditions[2] | GetDistance, GetIsID, HasKeyword, HasPerk |
| 105F1C:Skyrim.esm | Far Shot (1) | ModAttackDamage / Multiply | 1.15 / 189 / 0 | UNSUPPORTED: unsupported condition GetDistance at Effects[1].Conditions[2].Conditions[1]; unsupported condition GetDistance at Effects[1].Conditions[2].Conditions[2] | GetDistance, GetIsID, HasKeyword, HasPerk |
| 105F1C:Skyrim.esm | Far Shot (1) | ModAttackDamage / Multiply | 1.2 / 190 / 0 | UNSUPPORTED: unsupported condition GetDistance at Effects[0].Conditions[2].Conditions[1] | GetDistance, GetIsID, HasKeyword, HasPerk |
| 105F1E:Skyrim.esm | Far Shot (2) | ModAttackDamage / Multiply | 1.1 / 187 / 0 | UNSUPPORTED: unsupported condition GetDistance at Effects[3].Conditions[1].Conditions[1]; unsupported condition GetDistance at Effects[3].Conditions[1].Conditions[2] | GetDistance, GetIsID, HasKeyword |
| 105F1E:Skyrim.esm | Far Shot (2) | ModAttackDamage / Multiply | 1.2 / 188 / 0 | UNSUPPORTED: unsupported condition GetDistance at Effects[2].Conditions[1].Conditions[1]; unsupported condition GetDistance at Effects[2].Conditions[1].Conditions[2] | GetDistance, GetIsID, HasKeyword |
| 105F1E:Skyrim.esm | Far Shot (2) | ModAttackDamage / Multiply | 1.3 / 189 / 0 | UNSUPPORTED: unsupported condition GetDistance at Effects[1].Conditions[1].Conditions[1]; unsupported condition GetDistance at Effects[1].Conditions[1].Conditions[2] | GetDistance, GetIsID, HasKeyword |
| 105F1E:Skyrim.esm | Far Shot (2) | ModAttackDamage / Multiply | 1.4 / 190 / 0 | UNSUPPORTED: unsupported condition GetDistance at Effects[0].Conditions[1].Conditions[1] | GetDistance, GetIsID, HasKeyword |
| 2EE98B:Vokrii - Minimalistic Perks of Skyrim.esp | Arrow to the Knee | ApplyCombatHitSpell |  / 187 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasPerk |
| 2EE98B:Vokrii - Minimalistic Perks of Skyrim.esp | Arrow to the Knee | CalculateMyCriticalHitChance / Set | 100 / 100 / 0 | UNSUPPORTED: unsupported condition HasMagicEffect at Effects[1].Conditions[1].Conditions[0] | HasKeyword, HasMagicEffect |
| 2EE98B:Vokrii - Minimalistic Perks of Skyrim.esp | Arrow to the Knee | CalculateMyCriticalHitDamage / Multiply | 2 / 99 / 0 | UNSUPPORTED: unsupported condition HasMagicEffect at Effects[2].Conditions[1].Conditions[0] | HasKeyword, HasMagicEffect |

## assassino

Perks concedidas no crosswalk: 20.
Efeitos nas famílias de combate: 16; suportados: 6; UNSUPPORTED nas famílias: 10; fora de escopo: 6.

| FormID local:plugin | Perk (crosswalk) | Entry point / operação | Valor / AV / prioridade / rank | Estado e motivo | Condições |
|---|---|---|---|---|---|
| 0363D5:Vokrii - Minimalistic Perks of Skyrim.esp | Backstab | CalculateMyCriticalHitDamage / Multiply | 1.25 / 211 / 0 | UNSUPPORTED: unsupported condition GetHeadingAngle at Effects[0].Conditions[2].Conditions[1]; unsupported condition GetHeadingAngle at Effects[0].Conditions[2].Conditions[2] | GetHeadingAngle, GetIsID, HasKeyword |
| 0363D5:Vokrii - Minimalistic Perks of Skyrim.esp | Backstab | CalculateWeaponDamage / Multiply | 1.25 / 210 / 0 | UNSUPPORTED: unsupported condition GetHeadingAngle at Effects[1].Conditions[2].Conditions[1]; unsupported condition GetHeadingAngle at Effects[1].Conditions[2].Conditions[2] | GetHeadingAngle, GetIsID, HasKeyword |
| 03AFA6:Skyrim.esm | Victory Rush | ApplyCombatHitSpell |  / 220 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword |
| 051B1B:Skyrim.esm | Light Armor Fit | ModArmorRating / Multiply | 1.15 / 190 / 0 | SUPPORTED | HasPerk, WornHasKeyword |
| 052D50:Skyrim.esm | Disciplined Fighter | ModPowerAttackStamina / Multiply | 0.75 / 190 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword |
| 0581FD:Skyrim.esm | Quiet Casting | ModSpellCastingSoundEvent / Set | 0 / 150 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | sem condições |
| 058210:Skyrim.esm | Sneak Attack | ModSneakAttackMult / Multiply | 2 / 190 / 0 | SUPPORTED | IsWeaponSkillType |
| 058211:Skyrim.esm | Assassin's Blade | ModSneakAttackMult / Multiply | 2.5 / 180 / 0 | SUPPORTED | HasKeyword |
| 058214:Skyrim.esm | Shadow Warrior | ApplySneakingSpell |  / 150 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasPerk, IsInCombat |
| 0BABE4:Skyrim.esm | One-Handed Mastery | CalculateMyCriticalHitDamage / MultiplyOnePlusAVMult | 0.05 / OneHanded / 195 / 0 | SUPPORTED | HasKeyword, HasPerk |
| 0BABE4:Skyrim.esm | One-Handed Mastery | CalculateWeaponDamage / MultiplyOnePlusAVMult | 0.01 / OneHanded / 200 / 0 | SUPPORTED | HasKeyword, HasPerk |
| 0BE123:Skyrim.esm | Light Armor Mastery | ModArmorRating / MultiplyOnePlusAVMult | 0.01 / LightArmor / 200 / 0 | SUPPORTED | HasKeyword, HasPerk |
| 0BE126:Skyrim.esm | Sneak Mastery | ModDetectionSneakSkill / AddAVMult | 0.5 / Sneak / 200 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasPerk |
| 0CB406:Skyrim.esm | Valorous Charge | CalculateMyCriticalHitDamage / Multiply | 1.5 / 175 / 0 | UNSUPPORTED: unsupported condition IsAttackType at Effects[3].Conditions[0].Conditions[0]; unsupported condition IsSprinting at Effects[3].Conditions[0].Conditions[1] | GetActorValuePercent, HasKeyword, IsAttackType, IsSprinting |
| 0CB406:Skyrim.esm | Valorous Charge | CalculateMyCriticalHitDamage / Multiply | 1.38 / 176 / 0 | UNSUPPORTED: unsupported condition IsAttackType at Effects[2].Conditions[0].Conditions[0]; unsupported condition IsSprinting at Effects[2].Conditions[0].Conditions[1] | GetActorValuePercent, HasKeyword, IsAttackType, IsSprinting |
| 0CB406:Skyrim.esm | Valorous Charge | CalculateMyCriticalHitDamage / Multiply | 1.25 / 177 / 0 | UNSUPPORTED: unsupported condition IsAttackType at Effects[1].Conditions[0].Conditions[0]; unsupported condition IsSprinting at Effects[1].Conditions[0].Conditions[1] | GetActorValuePercent, HasKeyword, IsAttackType, IsSprinting |
| 0CB406:Skyrim.esm | Valorous Charge | CalculateMyCriticalHitDamage / Multiply | 1.13 / 178 / 0 | UNSUPPORTED: unsupported condition IsAttackType at Effects[0].Conditions[0].Conditions[0]; unsupported condition IsSprinting at Effects[0].Conditions[0].Conditions[1] | GetActorValuePercent, HasKeyword, IsAttackType, IsSprinting |
| 0CB406:Skyrim.esm | Valorous Charge | ModAttackDamage / Multiply | 1.5 / 151 / 0 | UNSUPPORTED: unsupported condition IsAttackType at Effects[7].Conditions[0].Conditions[0]; unsupported condition IsSprinting at Effects[7].Conditions[0].Conditions[1] | GetActorValuePercent, HasKeyword, IsAttackType, IsSprinting |
| 0CB406:Skyrim.esm | Valorous Charge | ModAttackDamage / Multiply | 1.38 / 152 / 0 | UNSUPPORTED: unsupported condition IsAttackType at Effects[6].Conditions[0].Conditions[0]; unsupported condition IsSprinting at Effects[6].Conditions[0].Conditions[1] | GetActorValuePercent, HasKeyword, IsAttackType, IsSprinting |
| 0CB406:Skyrim.esm | Valorous Charge | ModAttackDamage / Multiply | 1.25 / 153 / 0 | UNSUPPORTED: unsupported condition IsAttackType at Effects[5].Conditions[0].Conditions[0]; unsupported condition IsSprinting at Effects[5].Conditions[0].Conditions[1] | GetActorValuePercent, HasKeyword, IsAttackType, IsSprinting |
| 0CB406:Skyrim.esm | Valorous Charge | ModAttackDamage / Multiply | 1.13 / 154 / 0 | UNSUPPORTED: unsupported condition IsAttackType at Effects[4].Conditions[0].Conditions[0]; unsupported condition IsSprinting at Effects[4].Conditions[0].Conditions[1] | GetActorValuePercent, HasKeyword, IsAttackType, IsSprinting |
| 0F2CA9:Skyrim.esm | Illusion Mastery | ModSpellCost / MultiplyOnePlusAVMult | -0.005 / Illusion / 200 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | SpellHasCastingPerk |

## berserker

Perks concedidas no crosswalk: 18.
Efeitos nas famílias de combate: 16; suportados: 10; UNSUPPORTED nas famílias: 6; fora de escopo: 26.

| FormID local:plugin | Perk (crosswalk) | Entry point / operação | Valor / AV / prioridade / rank | Estado e motivo | Condições |
|---|---|---|---|---|---|
| 005474:Vokrii - Minimalistic Perks of Skyrim.esp | Death or Glory | ModPowerAttackDamage / Multiply | 2 / 150 / 0 | SUPPORTED | GetActorValuePercent, HasKeyword |
| 005474:Vokrii - Minimalistic Perks of Skyrim.esp | Death or Glory | ModPowerAttackDamage / Multiply | 1.75 / 151 / 0 | SUPPORTED | GetActorValuePercent, HasKeyword |
| 005474:Vokrii - Minimalistic Perks of Skyrim.esp | Death or Glory | ModPowerAttackDamage / Multiply | 1.5 / 152 / 0 | SUPPORTED | GetActorValuePercent, HasKeyword |
| 005474:Vokrii - Minimalistic Perks of Skyrim.esp | Death or Glory | ModPowerAttackDamage / Multiply | 1.25 / 153 / 0 | SUPPORTED | GetActorValuePercent, HasKeyword |
| 007AB5:Vokrii - Minimalistic Perks of Skyrim.esp | Keen Senses | ModArmorRating / Multiply | 1.2 / 123 / 0 | SUPPORTED | HasKeyword, WornHasKeyword |
| 051B1B:Skyrim.esm | Light Armor Fit | ModArmorRating / Multiply | 1.15 / 190 / 0 | SUPPORTED | HasPerk, WornHasKeyword |
| 051B1C:Skyrim.esm | Light Armor Training | ModArmorWeight / Set | 0 / 165 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword |
| 051B1C:Skyrim.esm | Light Armor Training | ModArmorWeight / Set | 0 / 166 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword |
| 051B1C:Skyrim.esm | Light Armor Training | ModArmorWeight / Set | 0 / 167 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword |
| 051B1C:Skyrim.esm | Light Armor Training | ModArmorWeight / Set | 0 / 168 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword |
| 052D51:Skyrim.esm | Brutal Fighter | ModPowerAttackStamina / Multiply | 0.75 / 240 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword |
| 052D52:Skyrim.esm | Ferocious Strength | ModPowerAttackDamage / MultiplyOnePlusAVMult | 0.001 / Stamina / 120 / 0 | SUPPORTED | HasKeyword |
| 0BABE8:Skyrim.esm | Two-Handed Mastery | CalculateMyCriticalHitDamage / MultiplyOnePlusAVMult | 0.05 / TwoHanded / 190 / 0 | SUPPORTED | HasKeyword, HasPerk |
| 0BABE8:Skyrim.esm | Two-Handed Mastery | ModAttackDamage / MultiplyOnePlusAVMult | 0.01 / TwoHanded / 200 / 0 | SUPPORTED | HasKeyword, HasPerk |
| 0BE123:Skyrim.esm | Light Armor Mastery | ModArmorRating / MultiplyOnePlusAVMult | 0.01 / LightArmor / 200 / 0 | SUPPORTED | HasKeyword, HasPerk |
| 0C5C05:Skyrim.esm | Mortal Wounds (1) | ApplyCombatHitSpell |  / 179 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasMagicEffect, HasPerk, IsAttackType, IsPowerAttacking |
| 0C5C05:Skyrim.esm | Mortal Wounds (1) | ApplyCombatHitSpell |  / 180 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasMagicEffect, HasPerk, IsAttackType, IsPowerAttacking |
| 0C5C05:Skyrim.esm | Mortal Wounds (1) | ApplyCombatHitSpell |  / 184 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasMagicEffect, HasPerk, IsAttackType, IsPowerAttacking |
| 0C5C05:Skyrim.esm | Mortal Wounds (1) | ApplyCombatHitSpell |  / 185 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasMagicEffect, HasPerk, IsAttackType, IsPowerAttacking |
| 0C5C05:Skyrim.esm | Mortal Wounds (1) | ApplyCombatHitSpell |  / 189 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasMagicEffect, HasPerk, IsAttackType, IsPowerAttacking |
| 0C5C05:Skyrim.esm | Mortal Wounds (1) | ApplyCombatHitSpell |  / 190 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasMagicEffect, HasPerk, IsAttackType, IsPowerAttacking |
| 0C5C05:Skyrim.esm | Mortal Wounds (1) | ModAttackDamage / Multiply | 1.15 / 149 / 0 | UNSUPPORTED: unsupported condition HasMagicEffect at Effects[7].Conditions[1].Conditions[0]; unsupported condition HasMagicEffect at Effects[7].Conditions[1].Conditions[1] | GetIsID, HasMagicEffect, HasPerk |
| 0C5C05:Skyrim.esm | Mortal Wounds (1) | ModAttackDamage / Multiply | 1.15 / 150 / 0 | UNSUPPORTED: unsupported condition HasMagicEffect at Effects[6].Conditions[1].Conditions[0]; unsupported condition HasMagicEffect at Effects[6].Conditions[1].Conditions[1] | GetIsID, HasMagicEffect, HasPerk |
| 0C5C07:Skyrim.esm | Hook Blade | ApplyCombatHitSpell |  / 157 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasMagicEffect, HasPerk, IsAttackType, IsPowerAttacking |
| 0C5C07:Skyrim.esm | Hook Blade | ApplyCombatHitSpell |  / 158 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasMagicEffect, HasPerk, IsAttackType, IsPowerAttacking |
| 0C5C07:Skyrim.esm | Hook Blade | ApplyCombatHitSpell |  / 159 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasMagicEffect, HasPerk, IsAttackType, IsPowerAttacking |
| 0C5C07:Skyrim.esm | Hook Blade | ApplyCombatHitSpell |  / 160 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasMagicEffect, HasPerk, IsAttackType, IsPowerAttacking |
| 0C5C07:Skyrim.esm | Hook Blade | ApplyCombatHitSpell |  / 162 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasMagicEffect, HasPerk, IsAttackType, IsPowerAttacking |
| 0C5C07:Skyrim.esm | Hook Blade | ApplyCombatHitSpell |  / 163 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasMagicEffect, HasPerk, IsAttackType, IsPowerAttacking |
| 0C5C07:Skyrim.esm | Hook Blade | ApplyCombatHitSpell |  / 164 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasMagicEffect, HasPerk, IsAttackType, IsPowerAttacking |
| 0C5C07:Skyrim.esm | Hook Blade | ApplyCombatHitSpell |  / 165 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasMagicEffect, HasPerk, IsAttackType, IsPowerAttacking |
| 0C5C07:Skyrim.esm | Hook Blade | ApplyCombatHitSpell |  / 167 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasMagicEffect, HasPerk, IsAttackType, IsPowerAttacking |
| 0C5C07:Skyrim.esm | Hook Blade | ApplyCombatHitSpell |  / 168 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasMagicEffect, HasPerk, IsAttackType, IsPowerAttacking |
| 0C5C07:Skyrim.esm | Hook Blade | ApplyCombatHitSpell |  / 169 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasMagicEffect, HasPerk, IsAttackType, IsPowerAttacking |
| 0C5C07:Skyrim.esm | Hook Blade | ApplyCombatHitSpell |  / 170 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasMagicEffect, HasPerk, IsAttackType, IsPowerAttacking |
| 0C5C07:Skyrim.esm | Hook Blade | ApplyCombatHitSpell |  / 189 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasMagicEffect, HasPerk |
| 0C5C07:Skyrim.esm | Hook Blade | ApplyCombatHitSpell |  / 190 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasMagicEffect, HasPerk |
| 0C5C07:Skyrim.esm | Hook Blade | CalculateMyCriticalHitChance / Add | 100 / 100 / 0 | UNSUPPORTED: unsupported condition IsPowerAttacking at Effects[16].Conditions[0].Conditions[0]; unsupported condition HasMagicEffect at Effects[16].Conditions[2].Conditions[0] | HasKeyword, HasMagicEffect, IsPowerAttacking |
| 0C5C07:Skyrim.esm | Hook Blade | CalculateMyCriticalHitDamage / Multiply | 3 / 99 / 0 | UNSUPPORTED: unsupported condition IsPowerAttacking at Effects[17].Conditions[0].Conditions[0]; unsupported condition HasMagicEffect at Effects[17].Conditions[2].Conditions[0] | HasKeyword, HasMagicEffect, IsPowerAttacking |
| 0C5C07:Skyrim.esm | Hook Blade | ModAttackDamage / Multiply | 1.2 / 149 / 0 | UNSUPPORTED: unsupported condition HasMagicEffect at Effects[15].Conditions[1].Conditions[0]; unsupported condition HasMagicEffect at Effects[15].Conditions[1].Conditions[1] | GetIsID, HasMagicEffect, HasPerk |
| 0C5C07:Skyrim.esm | Hook Blade | ModAttackDamage / Multiply | 1.2 / 150 / 0 | UNSUPPORTED: unsupported condition HasMagicEffect at Effects[14].Conditions[1].Conditions[0]; unsupported condition HasMagicEffect at Effects[14].Conditions[1].Conditions[1] | GetIsID, HasMagicEffect, HasPerk |
| 105F2A:Skyrim.esm | Slow Metabolism (1) | ModSpellDuration / Multiply | 2 / 140 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasPerk |

## cavaleiro_negro

Perks concedidas no crosswalk: 20.
Efeitos nas famílias de combate: 18; suportados: 14; UNSUPPORTED nas famílias: 4; fora de escopo: 21.

| FormID local:plugin | Perk (crosswalk) | Entry point / operação | Valor / AV / prioridade / rank | Estado e motivo | Condições |
|---|---|---|---|---|---|
| 005474:Vokrii - Minimalistic Perks of Skyrim.esp | Death or Glory | ModPowerAttackDamage / Multiply | 2 / 150 / 0 | SUPPORTED | GetActorValuePercent, HasKeyword |
| 005474:Vokrii - Minimalistic Perks of Skyrim.esp | Death or Glory | ModPowerAttackDamage / Multiply | 1.75 / 151 / 0 | SUPPORTED | GetActorValuePercent, HasKeyword |
| 005474:Vokrii - Minimalistic Perks of Skyrim.esp | Death or Glory | ModPowerAttackDamage / Multiply | 1.5 / 152 / 0 | SUPPORTED | GetActorValuePercent, HasKeyword |
| 005474:Vokrii - Minimalistic Perks of Skyrim.esp | Death or Glory | ModPowerAttackDamage / Multiply | 1.25 / 153 / 0 | SUPPORTED | GetActorValuePercent, HasKeyword |
| 008037:Vokrii - Minimalistic Perks of Skyrim.esp | Reap the Whirlwind | CalculateMyCriticalHitDamage / Multiply | 1.2 / 116 / 0 | UNSUPPORTED: unsupported condition HasMagicEffect at Effects[1].Conditions[1].Conditions[0] | GetIsID, HasMagicEffect |
| 008037:Vokrii - Minimalistic Perks of Skyrim.esp | Reap the Whirlwind | ModAttackDamage / Multiply | 1.2 / 117 / 0 | UNSUPPORTED: unsupported condition HasMagicEffect at Effects[0].Conditions[1].Conditions[0] | GetIsID, HasMagicEffect |
| 00ECC6:Vokrii - Minimalistic Perks of Skyrim.esp | Bear Hide | ModIncomingDamage / Multiply | 0.7 / 105 / 0 | UNSUPPORTED: unsupported condition IsPowerAttacking at Effects[0].Conditions[0].Conditions[0] | GetEquippedItemType, IsPowerAttacking |
| 03AF83:Skyrim.esm | Overbearing Assault (1) | ApplyCombatHitSpell |  / 179 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasMagicEffect, HasPerk, IsAttackType, IsPowerAttacking |
| 03AF83:Skyrim.esm | Overbearing Assault (1) | ApplyCombatHitSpell |  / 180 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasMagicEffect, HasPerk, IsAttackType, IsPowerAttacking |
| 03AF83:Skyrim.esm | Overbearing Assault (1) | ApplyCombatHitSpell |  / 184 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasMagicEffect, HasPerk, IsAttackType, IsPowerAttacking |
| 03AF83:Skyrim.esm | Overbearing Assault (1) | ApplyCombatHitSpell |  / 185 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasMagicEffect, HasPerk, IsAttackType, IsPowerAttacking |
| 03AF83:Skyrim.esm | Overbearing Assault (1) | ApplyCombatHitSpell |  / 189 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasMagicEffect, HasPerk, IsAttackType, IsPowerAttacking |
| 03AF83:Skyrim.esm | Overbearing Assault (1) | ApplyCombatHitSpell |  / 190 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasMagicEffect, HasPerk, IsAttackType, IsPowerAttacking |
| 052D51:Skyrim.esm | Brutal Fighter | ModPowerAttackStamina / Multiply | 0.75 / 240 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword |
| 052D52:Skyrim.esm | Ferocious Strength | ModPowerAttackDamage / MultiplyOnePlusAVMult | 0.001 / Stamina / 120 / 0 | SUPPORTED | HasKeyword |
| 058F6C:Skyrim.esm | Tower of Strength | ModIncomingDamage / Multiply | 0.75 / 200 / 0 | UNSUPPORTED: unsupported condition IsPowerAttacking at Effects[0].Conditions[1].Conditions[0]; unsupported condition IsAttackType at Effects[0].Conditions[1].Conditions[1] | HasPerk, IsAttackType, IsPowerAttacking, WornHasKeyword |
| 058F6D:Skyrim.esm | Heavy Armor Training | ModArmorWeight / Multiply | 0 / 165 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword |
| 058F6D:Skyrim.esm | Heavy Armor Training | ModArmorWeight / Multiply | 0 / 166 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword |
| 058F6D:Skyrim.esm | Heavy Armor Training | ModArmorWeight / Multiply | 0 / 167 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword |
| 058F6D:Skyrim.esm | Heavy Armor Training | ModArmorWeight / Multiply | 0 / 168 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword |
| 058F6F:Skyrim.esm | Heavy Armor Fit | ModArmorRating / Multiply | 1.15 / 190 / 0 | SUPPORTED | HasPerk, WornHasKeyword |
| 0BABE8:Skyrim.esm | Two-Handed Mastery | CalculateMyCriticalHitDamage / MultiplyOnePlusAVMult | 0.05 / TwoHanded / 190 / 0 | SUPPORTED | HasKeyword, HasPerk |
| 0BABE8:Skyrim.esm | Two-Handed Mastery | ModAttackDamage / MultiplyOnePlusAVMult | 0.01 / TwoHanded / 200 / 0 | SUPPORTED | HasKeyword, HasPerk |
| 0BCD2A:Skyrim.esm | Heavy Armor Mastery | ModArmorRating / MultiplyOnePlusAVMult | 0.01 / HeavyArmor / 200 / 0 | SUPPORTED | HasKeyword, HasPerk |
| 0C1E94:Skyrim.esm | Overbearing Assault (2) | ApplyCombatHitSpell |  / 179 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasMagicEffect, HasPerk, IsAttackType, IsPowerAttacking |
| 0C1E94:Skyrim.esm | Overbearing Assault (2) | ApplyCombatHitSpell |  / 180 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasMagicEffect, HasPerk, IsAttackType, IsPowerAttacking |
| 0C1E94:Skyrim.esm | Overbearing Assault (2) | ApplyCombatHitSpell |  / 184 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasMagicEffect, HasPerk, IsAttackType, IsPowerAttacking |
| 0C1E94:Skyrim.esm | Overbearing Assault (2) | ApplyCombatHitSpell |  / 185 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasMagicEffect, HasPerk, IsAttackType, IsPowerAttacking |
| 0C1E94:Skyrim.esm | Overbearing Assault (2) | ApplyCombatHitSpell |  / 189 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasMagicEffect, HasPerk, IsAttackType, IsPowerAttacking |
| 0C1E94:Skyrim.esm | Overbearing Assault (2) | ApplyCombatHitSpell |  / 190 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasMagicEffect, HasPerk, IsAttackType, IsPowerAttacking |
| 0F2CA8:Skyrim.esm | Destruction Mastery | ModSpellCost / MultiplyOnePlusAVMult | -0.005 / Destruction / 200 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | SpellHasCastingPerk |
| 107832:Skyrim.esm | Matching Heavy Set | ModArmorRating / Multiply | 1.15 / 155 / 0 | SUPPORTED | WornApparelHasKeywordCount |
| 2C1037:Vokrii - Minimalistic Perks of Skyrim.esp | Battle Fatigue | ModIncomingDamage / Multiply | 0.95 / 197 / 0 | SUPPORTED | GetActorValuePercent, HasPerk, WornHasKeyword |
| 2C1037:Vokrii - Minimalistic Perks of Skyrim.esp | Battle Fatigue | ModIncomingDamage / Multiply | 0.9 / 198 / 0 | SUPPORTED | GetActorValuePercent, HasPerk, WornHasKeyword |
| 2C1037:Vokrii - Minimalistic Perks of Skyrim.esp | Battle Fatigue | ModIncomingDamage / Multiply | 0.85 / 199 / 0 | SUPPORTED | GetActorValuePercent, HasPerk, WornHasKeyword |
| 2C1037:Vokrii - Minimalistic Perks of Skyrim.esp | Battle Fatigue | ModIncomingDamage / Multiply | 0.8 / 200 / 0 | SUPPORTED | GetActorValuePercent, HasPerk, WornHasKeyword |
| 344BCE:Vokrii - Minimalistic Perks of Skyrim.esp | Crowd Pleaser | ApplyCombatHitSpell |  / 220 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword |
| 63237F:Vokrii - Minimalistic Perks of Skyrim.esp | Raw Power (1) | ModSpellMagnitude / Multiply | 1.1 / 195 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasPerk, SpellHasCastingPerk |
| 632380:Vokrii - Minimalistic Perks of Skyrim.esp | Raw Power (2) | ModSpellMagnitude / Multiply | 1.2 / 195 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasPerk, SpellHasCastingPerk |

## criomante

Perks concedidas no crosswalk: 20.
Efeitos nas famílias de combate: 4; suportados: 2; UNSUPPORTED nas famílias: 2; fora de escopo: 13.

| FormID local:plugin | Perk (crosswalk) | Entry point / operação | Valor / AV / prioridade / rank | Estado e motivo | Condições |
|---|---|---|---|---|---|
| 0153CF:Skyrim.esm | Destruction Dual Casting | CanDualCastSpell / Set | 1 / 200 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | EPMagic_SpellHasSkill |
| 01BB2E:Vokrii - Minimalistic Perks of Skyrim.esp | Hellstorm | ModSpellMagnitude / Multiply | 1.5 / 115 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasMagicEffect |
| 0581EA:Skyrim.esm | Augmented Frost (1) | ModSpellMagnitude / Multiply | 1.2 / 195 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | EPMagic_SpellHasKeyword, HasPerk |
| 0581FC:Skyrim.esm | Stability | ModSpellDuration / Multiply | 1.25 / 180 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | EPMagic_SpellHasSkill, GetIsObjectType |
| 068BCC:Skyrim.esm | Ward Absorb | ModWardMagickaAbsorptionPct / Add | 0.2 / 149 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasMagicEffectKeyword |
| 068BCC:Skyrim.esm | Ward Absorb | ModWardMagickaAbsorptionPct / Add | 0.4 / 150 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasMagicEffectKeyword |
| 0BABE4:Skyrim.esm | One-Handed Mastery | CalculateMyCriticalHitDamage / MultiplyOnePlusAVMult | 0.05 / OneHanded / 195 / 0 | SUPPORTED | HasKeyword, HasPerk |
| 0BABE4:Skyrim.esm | One-Handed Mastery | CalculateWeaponDamage / MultiplyOnePlusAVMult | 0.01 / OneHanded / 200 / 0 | SUPPORTED | HasKeyword, HasPerk |
| 0F2CA6:Skyrim.esm | Alteration Mastery | ModSpellCost / MultiplyOnePlusAVMult | -0.005 / Alteration / 200 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasPerk, SpellHasCastingPerk |
| 0F2CA8:Skyrim.esm | Destruction Mastery | ModSpellCost / MultiplyOnePlusAVMult | -0.005 / Destruction / 200 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | SpellHasCastingPerk |
| 0F2CAA:Skyrim.esm | Restoration Mastery | ModSpellCost / MultiplyOnePlusAVMult | -0.005 / Restoration / 200 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | SpellHasCastingPerk |
| 105F32:Skyrim.esm | Rune Master | ModSpellMagnitude / Multiply | 1.1 / 150 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | EPMagic_SpellHasKeyword, HasPerk |
| 105F32:Skyrim.esm | Rune Master | ModSpellRange / Multiply | 3 / 200 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | EPMagic_SpellHasKeyword, HasPerk |
| 10FCF9:Skyrim.esm | Augmented Frost (2) | ModSpellMagnitude / Multiply | 1.4 / 195 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | EPMagic_SpellHasKeyword |
| 2BBF34:Vokrii - Minimalistic Perks of Skyrim.esp | Vigilant Ward (1) | ModIncomingDamage / Multiply | 0.85 / 138 / 0 | UNSUPPORTED: unsupported condition HasMagicEffectKeyword at Effects[2].Conditions[0].Conditions[1]; unsupported condition HasMagicEffectKeyword at Effects[2].Conditions[0].Conditions[2]; unsupported condition HasMagicEffect at Effects[2].Conditions[0].Conditions[3] | HasMagicEffect, HasMagicEffectKeyword, HasPerk |
| 2BBF34:Vokrii - Minimalistic Perks of Skyrim.esp | Vigilant Ward (1) | ModIncomingDamage / Multiply | 0.7 / 139 / 0 | UNSUPPORTED: unsupported condition HasMagicEffectKeyword at Effects[1].Conditions[0].Conditions[1] | HasMagicEffectKeyword, HasPerk |
| 2BBF34:Vokrii - Minimalistic Perks of Skyrim.esp | Vigilant Ward (1) | ModSpellCost / Multiply | 0.5 / 140 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasPerk |

## curandeiro

Perks concedidas no crosswalk: 19.
Efeitos nas famílias de combate: 6; suportados: 2; UNSUPPORTED nas famílias: 4; fora de escopo: 12.

| FormID local:plugin | Perk (crosswalk) | Entry point / operação | Valor / AV / prioridade / rank | Estado e motivo | Condições |
|---|---|---|---|---|---|
| 0153D1:Skyrim.esm | Restoration Dual Casting | CanDualCastSpell / Set | 1 / 200 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | EPMagic_SpellHasSkill |
| 052D50:Skyrim.esm | Disciplined Fighter | ModPowerAttackStamina / Multiply | 0.75 / 190 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword |
| 0581F8:Skyrim.esm | Mercy | ModSpellMagnitude / Multiply | 1.5 / 172 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | GetActorValuePercent, SpellHasCastingPerk |
| 0581F8:Skyrim.esm | Mercy | ModSpellMagnitude / Multiply | 1.37 / 173 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | GetActorValuePercent, SpellHasCastingPerk |
| 0581F8:Skyrim.esm | Mercy | ModSpellMagnitude / Multiply | 1.25 / 174 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | GetActorValuePercent, SpellHasCastingPerk |
| 0581F8:Skyrim.esm | Mercy | ModSpellMagnitude / Multiply | 1.12 / 175 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | GetActorValuePercent, SpellHasCastingPerk |
| 068BCC:Skyrim.esm | Ward Absorb | ModWardMagickaAbsorptionPct / Add | 0.2 / 149 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasMagicEffectKeyword |
| 068BCC:Skyrim.esm | Ward Absorb | ModWardMagickaAbsorptionPct / Add | 0.4 / 150 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasMagicEffectKeyword |
| 0BABE4:Skyrim.esm | One-Handed Mastery | CalculateMyCriticalHitDamage / MultiplyOnePlusAVMult | 0.05 / OneHanded / 195 / 0 | SUPPORTED | HasKeyword, HasPerk |
| 0BABE4:Skyrim.esm | One-Handed Mastery | CalculateWeaponDamage / MultiplyOnePlusAVMult | 0.01 / OneHanded / 200 / 0 | SUPPORTED | HasKeyword, HasPerk |
| 0F2CA8:Skyrim.esm | Destruction Mastery | ModSpellCost / MultiplyOnePlusAVMult | -0.005 / Destruction / 200 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | SpellHasCastingPerk |
| 0F2CAA:Skyrim.esm | Restoration Mastery | ModSpellCost / MultiplyOnePlusAVMult | -0.005 / Restoration / 200 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | SpellHasCastingPerk |
| 2BBF34:Vokrii - Minimalistic Perks of Skyrim.esp | Vigilant Ward (1) | ModIncomingDamage / Multiply | 0.85 / 138 / 0 | UNSUPPORTED: unsupported condition HasMagicEffectKeyword at Effects[2].Conditions[0].Conditions[1]; unsupported condition HasMagicEffectKeyword at Effects[2].Conditions[0].Conditions[2]; unsupported condition HasMagicEffect at Effects[2].Conditions[0].Conditions[3] | HasMagicEffect, HasMagicEffectKeyword, HasPerk |
| 2BBF34:Vokrii - Minimalistic Perks of Skyrim.esp | Vigilant Ward (1) | ModIncomingDamage / Multiply | 0.7 / 139 / 0 | UNSUPPORTED: unsupported condition HasMagicEffectKeyword at Effects[1].Conditions[0].Conditions[1] | HasMagicEffectKeyword, HasPerk |
| 2BBF34:Vokrii - Minimalistic Perks of Skyrim.esp | Vigilant Ward (1) | ModSpellCost / Multiply | 0.5 / 140 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasPerk |
| 35E12F:Vokrii - Minimalistic Perks of Skyrim.esp | Vigilant Ward (2) | ModIncomingDamage / Multiply | 0.7 / 138 / 0 | UNSUPPORTED: unsupported condition HasMagicEffectKeyword at Effects[2].Conditions[0].Conditions[0]; unsupported condition HasMagicEffectKeyword at Effects[2].Conditions[0].Conditions[1]; unsupported condition HasMagicEffect at Effects[2].Conditions[0].Conditions[2] | HasMagicEffect, HasMagicEffectKeyword |
| 35E12F:Vokrii - Minimalistic Perks of Skyrim.esp | Vigilant Ward (2) | ModIncomingDamage / Multiply | 0.4 / 139 / 0 | UNSUPPORTED: unsupported condition HasMagicEffectKeyword at Effects[1].Conditions[0].Conditions[0] | HasMagicEffectKeyword |
| 35E12F:Vokrii - Minimalistic Perks of Skyrim.esp | Vigilant Ward (2) | ModSpellCost / Multiply | 0.2 / 140 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword |

## druida

Perks concedidas no crosswalk: 20.
Efeitos nas famílias de combate: 4; suportados: 2; UNSUPPORTED nas famílias: 2; fora de escopo: 14.

| FormID local:plugin | Perk (crosswalk) | Entry point / operação | Valor / AV / prioridade / rank | Estado e motivo | Condições |
|---|---|---|---|---|---|
| 0153CE:Skyrim.esm | Conjuration Dual Casting | CanDualCastSpell / Set | 1 / 200 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | EPMagic_SpellHasSkill |
| 0153D1:Skyrim.esm | Restoration Dual Casting | CanDualCastSpell / Set | 1 / 200 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | EPMagic_SpellHasSkill |
| 052D50:Skyrim.esm | Disciplined Fighter | ModPowerAttackStamina / Multiply | 0.75 / 190 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword |
| 0581F8:Skyrim.esm | Mercy | ModSpellMagnitude / Multiply | 1.5 / 172 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | GetActorValuePercent, SpellHasCastingPerk |
| 0581F8:Skyrim.esm | Mercy | ModSpellMagnitude / Multiply | 1.37 / 173 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | GetActorValuePercent, SpellHasCastingPerk |
| 0581F8:Skyrim.esm | Mercy | ModSpellMagnitude / Multiply | 1.25 / 174 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | GetActorValuePercent, SpellHasCastingPerk |
| 0581F8:Skyrim.esm | Mercy | ModSpellMagnitude / Multiply | 1.12 / 175 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | GetActorValuePercent, SpellHasCastingPerk |
| 0BABE4:Skyrim.esm | One-Handed Mastery | CalculateMyCriticalHitDamage / MultiplyOnePlusAVMult | 0.05 / OneHanded / 195 / 0 | SUPPORTED | HasKeyword, HasPerk |
| 0BABE4:Skyrim.esm | One-Handed Mastery | CalculateWeaponDamage / MultiplyOnePlusAVMult | 0.01 / OneHanded / 200 / 0 | SUPPORTED | HasKeyword, HasPerk |
| 0D5F1C:Skyrim.esm | Twin Souls | ModCommandedActorLimit / Add | 1 / 100 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | sem condições |
| 0F2CA6:Skyrim.esm | Alteration Mastery | ModSpellCost / MultiplyOnePlusAVMult | -0.005 / Alteration / 200 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasPerk, SpellHasCastingPerk |
| 0F2CA7:Skyrim.esm | Conjuration Mastery | ModSpellCost / MultiplyOnePlusAVMult | -0.005 / Conjuration / 200 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | SpellHasCastingPerk |
| 0F2CAA:Skyrim.esm | Restoration Mastery | ModSpellCost / MultiplyOnePlusAVMult | -0.005 / Restoration / 200 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | SpellHasCastingPerk |
| 105F30:Skyrim.esm | Rift Summoner (1) | ModSpellRange / Add | 25 / 190 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | EPMagic_SpellHasKeyword, HasPerk |
| 105F31:Skyrim.esm | Rift Summoner (2) | ModSpellRange / Add | 50 / 190 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | EPMagic_SpellHasKeyword |
| 2BBF34:Vokrii - Minimalistic Perks of Skyrim.esp | Vigilant Ward (1) | ModIncomingDamage / Multiply | 0.85 / 138 / 0 | UNSUPPORTED: unsupported condition HasMagicEffectKeyword at Effects[2].Conditions[0].Conditions[1]; unsupported condition HasMagicEffectKeyword at Effects[2].Conditions[0].Conditions[2]; unsupported condition HasMagicEffect at Effects[2].Conditions[0].Conditions[3] | HasMagicEffect, HasMagicEffectKeyword, HasPerk |
| 2BBF34:Vokrii - Minimalistic Perks of Skyrim.esp | Vigilant Ward (1) | ModIncomingDamage / Multiply | 0.7 / 139 / 0 | UNSUPPORTED: unsupported condition HasMagicEffectKeyword at Effects[1].Conditions[0].Conditions[1] | HasMagicEffectKeyword, HasPerk |
| 2BBF34:Vokrii - Minimalistic Perks of Skyrim.esp | Vigilant Ward (1) | ModSpellCost / Multiply | 0.5 / 140 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasPerk |

## elementalista

Perks concedidas no crosswalk: 19.
Efeitos nas famílias de combate: 4; suportados: 2; UNSUPPORTED nas famílias: 2; fora de escopo: 12.

| FormID local:plugin | Perk (crosswalk) | Entry point / operação | Valor / AV / prioridade / rank | Estado e motivo | Condições |
|---|---|---|---|---|---|
| 0153CF:Skyrim.esm | Destruction Dual Casting | CanDualCastSpell / Set | 1 / 200 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | EPMagic_SpellHasSkill |
| 0153D1:Skyrim.esm | Restoration Dual Casting | CanDualCastSpell / Set | 1 / 200 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | EPMagic_SpellHasSkill |
| 0581E7:Skyrim.esm | Augmented Flames (1) | ModSpellMagnitude / Multiply | 1.2 / 195 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | EPMagic_SpellHasKeyword, HasPerk |
| 0581EA:Skyrim.esm | Augmented Frost (1) | ModSpellMagnitude / Multiply | 1.2 / 195 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | EPMagic_SpellHasKeyword, HasPerk |
| 0581FC:Skyrim.esm | Stability | ModSpellDuration / Multiply | 1.25 / 180 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | EPMagic_SpellHasSkill, GetIsObjectType |
| 058200:Skyrim.esm | Augmented Shock (1) | ModSpellMagnitude / Multiply | 1.2 / 195 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | EPMagic_SpellHasKeyword, HasPerk |
| 068BCC:Skyrim.esm | Ward Absorb | ModWardMagickaAbsorptionPct / Add | 0.2 / 149 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasMagicEffectKeyword |
| 068BCC:Skyrim.esm | Ward Absorb | ModWardMagickaAbsorptionPct / Add | 0.4 / 150 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasMagicEffectKeyword |
| 0BABE4:Skyrim.esm | One-Handed Mastery | CalculateMyCriticalHitDamage / MultiplyOnePlusAVMult | 0.05 / OneHanded / 195 / 0 | SUPPORTED | HasKeyword, HasPerk |
| 0BABE4:Skyrim.esm | One-Handed Mastery | CalculateWeaponDamage / MultiplyOnePlusAVMult | 0.01 / OneHanded / 200 / 0 | SUPPORTED | HasKeyword, HasPerk |
| 0F2CA6:Skyrim.esm | Alteration Mastery | ModSpellCost / MultiplyOnePlusAVMult | -0.005 / Alteration / 200 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasPerk, SpellHasCastingPerk |
| 0F2CA8:Skyrim.esm | Destruction Mastery | ModSpellCost / MultiplyOnePlusAVMult | -0.005 / Destruction / 200 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | SpellHasCastingPerk |
| 0F2CAA:Skyrim.esm | Restoration Mastery | ModSpellCost / MultiplyOnePlusAVMult | -0.005 / Restoration / 200 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | SpellHasCastingPerk |
| 2BBF34:Vokrii - Minimalistic Perks of Skyrim.esp | Vigilant Ward (1) | ModIncomingDamage / Multiply | 0.85 / 138 / 0 | UNSUPPORTED: unsupported condition HasMagicEffectKeyword at Effects[2].Conditions[0].Conditions[1]; unsupported condition HasMagicEffectKeyword at Effects[2].Conditions[0].Conditions[2]; unsupported condition HasMagicEffect at Effects[2].Conditions[0].Conditions[3] | HasMagicEffect, HasMagicEffectKeyword, HasPerk |
| 2BBF34:Vokrii - Minimalistic Perks of Skyrim.esp | Vigilant Ward (1) | ModIncomingDamage / Multiply | 0.7 / 139 / 0 | UNSUPPORTED: unsupported condition HasMagicEffectKeyword at Effects[1].Conditions[0].Conditions[1] | HasMagicEffectKeyword, HasPerk |
| 2BBF34:Vokrii - Minimalistic Perks of Skyrim.esp | Vigilant Ward (1) | ModSpellCost / Multiply | 0.5 / 140 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasPerk |

## eletromante

Perks concedidas no crosswalk: 20.
Efeitos nas famílias de combate: 4; suportados: 2; UNSUPPORTED nas famílias: 2; fora de escopo: 13.

| FormID local:plugin | Perk (crosswalk) | Entry point / operação | Valor / AV / prioridade / rank | Estado e motivo | Condições |
|---|---|---|---|---|---|
| 0153CF:Skyrim.esm | Destruction Dual Casting | CanDualCastSpell / Set | 1 / 200 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | EPMagic_SpellHasSkill |
| 01BB2E:Vokrii - Minimalistic Perks of Skyrim.esp | Hellstorm | ModSpellMagnitude / Multiply | 1.5 / 115 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasMagicEffect |
| 0581FC:Skyrim.esm | Stability | ModSpellDuration / Multiply | 1.25 / 180 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | EPMagic_SpellHasSkill, GetIsObjectType |
| 058200:Skyrim.esm | Augmented Shock (1) | ModSpellMagnitude / Multiply | 1.2 / 195 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | EPMagic_SpellHasKeyword, HasPerk |
| 068BCC:Skyrim.esm | Ward Absorb | ModWardMagickaAbsorptionPct / Add | 0.2 / 149 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasMagicEffectKeyword |
| 068BCC:Skyrim.esm | Ward Absorb | ModWardMagickaAbsorptionPct / Add | 0.4 / 150 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasMagicEffectKeyword |
| 0BABE4:Skyrim.esm | One-Handed Mastery | CalculateMyCriticalHitDamage / MultiplyOnePlusAVMult | 0.05 / OneHanded / 195 / 0 | SUPPORTED | HasKeyword, HasPerk |
| 0BABE4:Skyrim.esm | One-Handed Mastery | CalculateWeaponDamage / MultiplyOnePlusAVMult | 0.01 / OneHanded / 200 / 0 | SUPPORTED | HasKeyword, HasPerk |
| 0F2CA6:Skyrim.esm | Alteration Mastery | ModSpellCost / MultiplyOnePlusAVMult | -0.005 / Alteration / 200 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasPerk, SpellHasCastingPerk |
| 0F2CA8:Skyrim.esm | Destruction Mastery | ModSpellCost / MultiplyOnePlusAVMult | -0.005 / Destruction / 200 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | SpellHasCastingPerk |
| 0F2CAA:Skyrim.esm | Restoration Mastery | ModSpellCost / MultiplyOnePlusAVMult | -0.005 / Restoration / 200 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | SpellHasCastingPerk |
| 105F32:Skyrim.esm | Rune Master | ModSpellMagnitude / Multiply | 1.1 / 150 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | EPMagic_SpellHasKeyword, HasPerk |
| 105F32:Skyrim.esm | Rune Master | ModSpellRange / Multiply | 3 / 200 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | EPMagic_SpellHasKeyword, HasPerk |
| 10FCFA:Skyrim.esm | Augmented Shock (2) | ModSpellMagnitude / Multiply | 1.4 / 195 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | EPMagic_SpellHasKeyword |
| 2BBF34:Vokrii - Minimalistic Perks of Skyrim.esp | Vigilant Ward (1) | ModIncomingDamage / Multiply | 0.85 / 138 / 0 | UNSUPPORTED: unsupported condition HasMagicEffectKeyword at Effects[2].Conditions[0].Conditions[1]; unsupported condition HasMagicEffectKeyword at Effects[2].Conditions[0].Conditions[2]; unsupported condition HasMagicEffect at Effects[2].Conditions[0].Conditions[3] | HasMagicEffect, HasMagicEffectKeyword, HasPerk |
| 2BBF34:Vokrii - Minimalistic Perks of Skyrim.esp | Vigilant Ward (1) | ModIncomingDamage / Multiply | 0.7 / 139 / 0 | UNSUPPORTED: unsupported condition HasMagicEffectKeyword at Effects[1].Conditions[0].Conditions[1] | HasMagicEffectKeyword, HasPerk |
| 2BBF34:Vokrii - Minimalistic Perks of Skyrim.esp | Vigilant Ward (1) | ModSpellCost / Multiply | 0.5 / 140 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasPerk |

## guardiao

Perks concedidas no crosswalk: 19.
Efeitos nas famílias de combate: 12; suportados: 10; UNSUPPORTED nas famílias: 2; fora de escopo: 10.

| FormID local:plugin | Perk (crosswalk) | Entry point / operação | Valor / AV / prioridade / rank | Estado e motivo | Condições |
|---|---|---|---|---|---|
| 052D50:Skyrim.esm | Disciplined Fighter | ModPowerAttackStamina / Multiply | 0.75 / 190 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword |
| 058F68:Skyrim.esm | Deflect Arrows | ModIncomingDamage / Multiply | 0.5 / 191 / 0 | UNSUPPORTED: unsupported condition IsBlocking at Effects[0].Conditions[0].Conditions[0]; unsupported condition IsAttackType at Effects[0].Conditions[1].Conditions[0] | HasKeyword, IsAttackType, IsBlocking |
| 058F68:Skyrim.esm | Deflect Arrows | ModShieldDefectArrowChance / Set | 100 / 190 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | IsBlocking, WornHasKeyword |
| 058F69:Skyrim.esm | Elemental Protection | ModIncomingSpellMagnitude / Multiply | 0.5 / 185 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, IsBlocking, WornHasKeyword |
| 058F6C:Skyrim.esm | Tower of Strength | ModIncomingDamage / Multiply | 0.75 / 200 / 0 | UNSUPPORTED: unsupported condition IsPowerAttacking at Effects[0].Conditions[1].Conditions[0]; unsupported condition IsAttackType at Effects[0].Conditions[1].Conditions[1] | HasPerk, IsAttackType, IsPowerAttacking, WornHasKeyword |
| 058F6D:Skyrim.esm | Heavy Armor Training | ModArmorWeight / Multiply | 0 / 165 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword |
| 058F6D:Skyrim.esm | Heavy Armor Training | ModArmorWeight / Multiply | 0 / 166 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword |
| 058F6D:Skyrim.esm | Heavy Armor Training | ModArmorWeight / Multiply | 0 / 167 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword |
| 058F6D:Skyrim.esm | Heavy Armor Training | ModArmorWeight / Multiply | 0 / 168 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword |
| 058F6F:Skyrim.esm | Heavy Armor Fit | ModArmorRating / Multiply | 1.15 / 190 / 0 | SUPPORTED | HasPerk, WornHasKeyword |
| 0BABE4:Skyrim.esm | One-Handed Mastery | CalculateMyCriticalHitDamage / MultiplyOnePlusAVMult | 0.05 / OneHanded / 195 / 0 | SUPPORTED | HasKeyword, HasPerk |
| 0BABE4:Skyrim.esm | One-Handed Mastery | CalculateWeaponDamage / MultiplyOnePlusAVMult | 0.01 / OneHanded / 200 / 0 | SUPPORTED | HasKeyword, HasPerk |
| 0BCCAE:Skyrim.esm | Block Mastery | ModPercentBlocked / MultiplyOnePlusAVMult | 0.005 / Block / 200 / 0 | SUPPORTED | HasPerk |
| 0BCD2A:Skyrim.esm | Heavy Armor Mastery | ModArmorRating / MultiplyOnePlusAVMult | 0.01 / HeavyArmor / 200 / 0 | SUPPORTED | HasKeyword, HasPerk |
| 0BCD2B:Skyrim.esm | Cushioned (1) | ModFallingDamage / Multiply | 0.5 / 170 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasPerk, WornHasKeyword |
| 106253:Skyrim.esm | Block Runner | SetBooleanGraphVariable |  / 20 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | sem condições |
| 107832:Skyrim.esm | Matching Heavy Set | ModArmorRating / Multiply | 1.15 / 155 / 0 | SUPPORTED | WornApparelHasKeywordCount |
| 2C1037:Vokrii - Minimalistic Perks of Skyrim.esp | Battle Fatigue | ModIncomingDamage / Multiply | 0.95 / 197 / 0 | SUPPORTED | GetActorValuePercent, HasPerk, WornHasKeyword |
| 2C1037:Vokrii - Minimalistic Perks of Skyrim.esp | Battle Fatigue | ModIncomingDamage / Multiply | 0.9 / 198 / 0 | SUPPORTED | GetActorValuePercent, HasPerk, WornHasKeyword |
| 2C1037:Vokrii - Minimalistic Perks of Skyrim.esp | Battle Fatigue | ModIncomingDamage / Multiply | 0.85 / 199 / 0 | SUPPORTED | GetActorValuePercent, HasPerk, WornHasKeyword |
| 2C1037:Vokrii - Minimalistic Perks of Skyrim.esp | Battle Fatigue | ModIncomingDamage / Multiply | 0.8 / 200 / 0 | SUPPORTED | GetActorValuePercent, HasPerk, WornHasKeyword |
| 2DF673:Vokrii - Minimalistic Perks of Skyrim.esp | Stoneheart | ModIncomingStagger / Multiply | 0 / 200 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | IsBlocking |

## invocador

Perks concedidas no crosswalk: 20.
Efeitos nas famílias de combate: 4; suportados: 2; UNSUPPORTED nas famílias: 2; fora de escopo: 14.

| FormID local:plugin | Perk (crosswalk) | Entry point / operação | Valor / AV / prioridade / rank | Estado e motivo | Condições |
|---|---|---|---|---|---|
| 0153CE:Skyrim.esm | Conjuration Dual Casting | CanDualCastSpell / Set | 1 / 200 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | EPMagic_SpellHasSkill |
| 068BCC:Skyrim.esm | Ward Absorb | ModWardMagickaAbsorptionPct / Add | 0.2 / 149 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasMagicEffectKeyword |
| 068BCC:Skyrim.esm | Ward Absorb | ModWardMagickaAbsorptionPct / Add | 0.4 / 150 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasMagicEffectKeyword |
| 0BABE4:Skyrim.esm | One-Handed Mastery | CalculateMyCriticalHitDamage / MultiplyOnePlusAVMult | 0.05 / OneHanded / 195 / 0 | SUPPORTED | HasKeyword, HasPerk |
| 0BABE4:Skyrim.esm | One-Handed Mastery | CalculateWeaponDamage / MultiplyOnePlusAVMult | 0.01 / OneHanded / 200 / 0 | SUPPORTED | HasKeyword, HasPerk |
| 0CB419:Skyrim.esm | Atromancy | ModSpellDuration / Multiply | 2 / 190 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | EPMagic_SpellHasKeyword |
| 0D5F1C:Skyrim.esm | Twin Souls | ModCommandedActorLimit / Add | 1 / 100 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | sem condições |
| 0F2CA6:Skyrim.esm | Alteration Mastery | ModSpellCost / MultiplyOnePlusAVMult | -0.005 / Alteration / 200 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasPerk, SpellHasCastingPerk |
| 0F2CA7:Skyrim.esm | Conjuration Mastery | ModSpellCost / MultiplyOnePlusAVMult | -0.005 / Conjuration / 200 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | SpellHasCastingPerk |
| 0F2CAA:Skyrim.esm | Restoration Mastery | ModSpellCost / MultiplyOnePlusAVMult | -0.005 / Restoration / 200 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | SpellHasCastingPerk |
| 105F30:Skyrim.esm | Rift Summoner (1) | ModSpellRange / Add | 25 / 190 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | EPMagic_SpellHasKeyword, HasPerk |
| 105F31:Skyrim.esm | Rift Summoner (2) | ModSpellRange / Add | 50 / 190 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | EPMagic_SpellHasKeyword |
| 2BBF34:Vokrii - Minimalistic Perks of Skyrim.esp | Vigilant Ward (1) | ModIncomingDamage / Multiply | 0.85 / 138 / 0 | UNSUPPORTED: unsupported condition HasMagicEffectKeyword at Effects[2].Conditions[0].Conditions[1]; unsupported condition HasMagicEffectKeyword at Effects[2].Conditions[0].Conditions[2]; unsupported condition HasMagicEffect at Effects[2].Conditions[0].Conditions[3] | HasMagicEffect, HasMagicEffectKeyword, HasPerk |
| 2BBF34:Vokrii - Minimalistic Perks of Skyrim.esp | Vigilant Ward (1) | ModIncomingDamage / Multiply | 0.7 / 139 / 0 | UNSUPPORTED: unsupported condition HasMagicEffectKeyword at Effects[1].Conditions[0].Conditions[1] | HasMagicEffectKeyword, HasPerk |
| 2BBF34:Vokrii - Minimalistic Perks of Skyrim.esp | Vigilant Ward (1) | ModSpellCost / Multiply | 0.5 / 140 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasPerk |
| 31721F:Vokrii - Minimalistic Perks of Skyrim.esp | Elemental Conflux | ModSpellMagnitude / Multiply | 1.2 / 131 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasMagicEffect |
| 31721F:Vokrii - Minimalistic Perks of Skyrim.esp | Elemental Conflux | ModSpellMagnitude / Multiply | 1.2 / 132 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasMagicEffect |
| 31721F:Vokrii - Minimalistic Perks of Skyrim.esp | Elemental Conflux | ModSpellMagnitude / Multiply | 1.2 / 133 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasMagicEffect |

## mestre_espadachim

Perks concedidas no crosswalk: 20.
Efeitos nas famílias de combate: 20; suportados: 8; UNSUPPORTED nas famílias: 12; fora de escopo: 27.

| FormID local:plugin | Perk (crosswalk) | Entry point / operação | Valor / AV / prioridade / rank | Estado e motivo | Condições |
|---|---|---|---|---|---|
| 007AB5:Vokrii - Minimalistic Perks of Skyrim.esp | Keen Senses | ModArmorRating / Multiply | 1.2 / 123 / 0 | SUPPORTED | HasKeyword, WornHasKeyword |
| 03AF81:Skyrim.esm | Furious Strength | ModPowerAttackDamage / MultiplyOnePlusAVMult | 0.001 / Stamina / 120 / 0 | SUPPORTED | HasKeyword |
| 03AFA6:Skyrim.esm | Victory Rush | ApplyCombatHitSpell |  / 220 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword |
| 051B1B:Skyrim.esm | Light Armor Fit | ModArmorRating / Multiply | 1.15 / 190 / 0 | SUPPORTED | HasPerk, WornHasKeyword |
| 051B1C:Skyrim.esm | Light Armor Training | ModArmorWeight / Set | 0 / 165 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword |
| 051B1C:Skyrim.esm | Light Armor Training | ModArmorWeight / Set | 0 / 166 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword |
| 051B1C:Skyrim.esm | Light Armor Training | ModArmorWeight / Set | 0 / 167 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword |
| 051B1C:Skyrim.esm | Light Armor Training | ModArmorWeight / Set | 0 / 168 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword |
| 052D50:Skyrim.esm | Disciplined Fighter | ModPowerAttackStamina / Multiply | 0.75 / 190 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword |
| 05F56F:Skyrim.esm | Overpowering Assault (1) | ApplyCombatHitSpell |  / 179 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasMagicEffect, HasPerk, IsAttackType, IsPowerAttacking |
| 05F56F:Skyrim.esm | Overpowering Assault (1) | ApplyCombatHitSpell |  / 180 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasMagicEffect, HasPerk, IsAttackType, IsPowerAttacking |
| 05F56F:Skyrim.esm | Overpowering Assault (1) | ApplyCombatHitSpell |  / 184 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasMagicEffect, HasPerk, IsAttackType, IsPowerAttacking |
| 05F56F:Skyrim.esm | Overpowering Assault (1) | ApplyCombatHitSpell |  / 185 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasMagicEffect, HasPerk, IsAttackType, IsPowerAttacking |
| 05F56F:Skyrim.esm | Overpowering Assault (1) | ApplyCombatHitSpell |  / 189 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasMagicEffect, HasPerk, IsAttackType, IsPowerAttacking |
| 05F56F:Skyrim.esm | Overpowering Assault (1) | ApplyCombatHitSpell |  / 190 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasMagicEffect, HasPerk, IsAttackType, IsPowerAttacking |
| 0BABE4:Skyrim.esm | One-Handed Mastery | CalculateMyCriticalHitDamage / MultiplyOnePlusAVMult | 0.05 / OneHanded / 195 / 0 | SUPPORTED | HasKeyword, HasPerk |
| 0BABE4:Skyrim.esm | One-Handed Mastery | CalculateWeaponDamage / MultiplyOnePlusAVMult | 0.01 / OneHanded / 200 / 0 | SUPPORTED | HasKeyword, HasPerk |
| 0BE123:Skyrim.esm | Light Armor Mastery | ModArmorRating / MultiplyOnePlusAVMult | 0.01 / LightArmor / 200 / 0 | SUPPORTED | HasKeyword, HasPerk |
| 0C1E91:Skyrim.esm | Execute | ApplyCombatHitSpell |  / 157 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasMagicEffect, HasPerk, IsAttackType, IsPowerAttacking |
| 0C1E91:Skyrim.esm | Execute | ApplyCombatHitSpell |  / 158 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasMagicEffect, HasPerk, IsAttackType, IsPowerAttacking |
| 0C1E91:Skyrim.esm | Execute | ApplyCombatHitSpell |  / 159 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasMagicEffect, HasPerk, IsAttackType, IsPowerAttacking |
| 0C1E91:Skyrim.esm | Execute | ApplyCombatHitSpell |  / 160 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasMagicEffect, HasPerk, IsAttackType, IsPowerAttacking |
| 0C1E91:Skyrim.esm | Execute | ApplyCombatHitSpell |  / 162 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasMagicEffect, HasPerk, IsAttackType, IsPowerAttacking |
| 0C1E91:Skyrim.esm | Execute | ApplyCombatHitSpell |  / 163 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasMagicEffect, HasPerk, IsAttackType, IsPowerAttacking |
| 0C1E91:Skyrim.esm | Execute | ApplyCombatHitSpell |  / 164 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasMagicEffect, HasPerk, IsAttackType, IsPowerAttacking |
| 0C1E91:Skyrim.esm | Execute | ApplyCombatHitSpell |  / 165 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasMagicEffect, HasPerk, IsAttackType, IsPowerAttacking |
| 0C1E91:Skyrim.esm | Execute | ApplyCombatHitSpell |  / 167 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasMagicEffect, HasPerk, IsAttackType, IsPowerAttacking |
| 0C1E91:Skyrim.esm | Execute | ApplyCombatHitSpell |  / 168 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasMagicEffect, HasPerk, IsAttackType, IsPowerAttacking |
| 0C1E91:Skyrim.esm | Execute | ApplyCombatHitSpell |  / 169 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasMagicEffect, HasPerk, IsAttackType, IsPowerAttacking |
| 0C1E91:Skyrim.esm | Execute | ApplyCombatHitSpell |  / 170 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasMagicEffect, HasPerk, IsAttackType, IsPowerAttacking |
| 0C1E91:Skyrim.esm | Execute | ApplyCombatHitSpell |  / 189 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasMagicEffect, HasPerk |
| 0C1E91:Skyrim.esm | Execute | ApplyCombatHitSpell |  / 190 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasMagicEffect, HasPerk |
| 0C1E91:Skyrim.esm | Execute | CalculateMyCriticalHitChance / Add | 100 / 100 / 0 | UNSUPPORTED: unsupported condition IsPowerAttacking at Effects[14].Conditions[0].Conditions[0]; unsupported condition HasMagicEffect at Effects[14].Conditions[2].Conditions[0] | HasKeyword, HasMagicEffect, IsPowerAttacking |
| 0C1E91:Skyrim.esm | Execute | CalculateMyCriticalHitDamage / Multiply | 10 / 99 / 0 | UNSUPPORTED: unsupported condition IsPowerAttacking at Effects[15].Conditions[0].Conditions[0]; unsupported condition HasMagicEffect at Effects[15].Conditions[2].Conditions[0] | HasKeyword, HasMagicEffect, IsPowerAttacking |
| 0CB406:Skyrim.esm | Valorous Charge | CalculateMyCriticalHitDamage / Multiply | 1.5 / 175 / 0 | UNSUPPORTED: unsupported condition IsAttackType at Effects[3].Conditions[0].Conditions[0]; unsupported condition IsSprinting at Effects[3].Conditions[0].Conditions[1] | GetActorValuePercent, HasKeyword, IsAttackType, IsSprinting |
| 0CB406:Skyrim.esm | Valorous Charge | CalculateMyCriticalHitDamage / Multiply | 1.38 / 176 / 0 | UNSUPPORTED: unsupported condition IsAttackType at Effects[2].Conditions[0].Conditions[0]; unsupported condition IsSprinting at Effects[2].Conditions[0].Conditions[1] | GetActorValuePercent, HasKeyword, IsAttackType, IsSprinting |
| 0CB406:Skyrim.esm | Valorous Charge | CalculateMyCriticalHitDamage / Multiply | 1.25 / 177 / 0 | UNSUPPORTED: unsupported condition IsAttackType at Effects[1].Conditions[0].Conditions[0]; unsupported condition IsSprinting at Effects[1].Conditions[0].Conditions[1] | GetActorValuePercent, HasKeyword, IsAttackType, IsSprinting |
| 0CB406:Skyrim.esm | Valorous Charge | CalculateMyCriticalHitDamage / Multiply | 1.13 / 178 / 0 | UNSUPPORTED: unsupported condition IsAttackType at Effects[0].Conditions[0].Conditions[0]; unsupported condition IsSprinting at Effects[0].Conditions[0].Conditions[1] | GetActorValuePercent, HasKeyword, IsAttackType, IsSprinting |
| 0CB406:Skyrim.esm | Valorous Charge | ModAttackDamage / Multiply | 1.5 / 151 / 0 | UNSUPPORTED: unsupported condition IsAttackType at Effects[7].Conditions[0].Conditions[0]; unsupported condition IsSprinting at Effects[7].Conditions[0].Conditions[1] | GetActorValuePercent, HasKeyword, IsAttackType, IsSprinting |
| 0CB406:Skyrim.esm | Valorous Charge | ModAttackDamage / Multiply | 1.38 / 152 / 0 | UNSUPPORTED: unsupported condition IsAttackType at Effects[6].Conditions[0].Conditions[0]; unsupported condition IsSprinting at Effects[6].Conditions[0].Conditions[1] | GetActorValuePercent, HasKeyword, IsAttackType, IsSprinting |
| 0CB406:Skyrim.esm | Valorous Charge | ModAttackDamage / Multiply | 1.25 / 153 / 0 | UNSUPPORTED: unsupported condition IsAttackType at Effects[5].Conditions[0].Conditions[0]; unsupported condition IsSprinting at Effects[5].Conditions[0].Conditions[1] | GetActorValuePercent, HasKeyword, IsAttackType, IsSprinting |
| 0CB406:Skyrim.esm | Valorous Charge | ModAttackDamage / Multiply | 1.13 / 154 / 0 | UNSUPPORTED: unsupported condition IsAttackType at Effects[4].Conditions[0].Conditions[0]; unsupported condition IsSprinting at Effects[4].Conditions[0].Conditions[1] | GetActorValuePercent, HasKeyword, IsAttackType, IsSprinting |
| 106256:Skyrim.esm | Dual Flurry (1) | ModAttackDamage / Multiply | 1.1 / 0 / 0 | SUPPORTED | GetEquippedItemType |
| 106257:Skyrim.esm | Dual Flurry (2) | ModAttackDamage / Multiply | 1.2 / 0 / 0 | SUPPORTED | GetEquippedItemType |
| 106258:Skyrim.esm | Dual Savagery | ModAttackDamage / Multiply | 1.5 / 100 / 0 | UNSUPPORTED: unsupported condition IsPowerAttacking at Effects[0].Conditions[0].Conditions[0] | GetEquippedItemType, IsPowerAttacking |
| 106258:Skyrim.esm | Dual Savagery | ModTargetStagger / Multiply | 1.5 / 60 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | GetEquippedItemType, IsPowerAttacking |
| 344BC9:Vokrii - Minimalistic Perks of Skyrim.esp | Bladedancer | ModIncomingDamage / Multiply | 0.7 / 105 / 0 | UNSUPPORTED: unsupported condition IsPowerAttacking at Effects[0].Conditions[0].Conditions[0] | GetEquippedItemType, IsPowerAttacking |

## paladino

Perks concedidas no crosswalk: 19.
Efeitos nas famílias de combate: 15; suportados: 12; UNSUPPORTED nas famílias: 3; fora de escopo: 23.

| FormID local:plugin | Perk (crosswalk) | Entry point / operação | Valor / AV / prioridade / rank | Estado e motivo | Condições |
|---|---|---|---|---|---|
| 03AF81:Skyrim.esm | Furious Strength | ModPowerAttackDamage / MultiplyOnePlusAVMult | 0.001 / Stamina / 120 / 0 | SUPPORTED | HasKeyword |
| 052D50:Skyrim.esm | Disciplined Fighter | ModPowerAttackStamina / Multiply | 0.75 / 190 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword |
| 0581F8:Skyrim.esm | Mercy | ModSpellMagnitude / Multiply | 1.5 / 172 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | GetActorValuePercent, SpellHasCastingPerk |
| 0581F8:Skyrim.esm | Mercy | ModSpellMagnitude / Multiply | 1.37 / 173 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | GetActorValuePercent, SpellHasCastingPerk |
| 0581F8:Skyrim.esm | Mercy | ModSpellMagnitude / Multiply | 1.25 / 174 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | GetActorValuePercent, SpellHasCastingPerk |
| 0581F8:Skyrim.esm | Mercy | ModSpellMagnitude / Multiply | 1.12 / 175 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | GetActorValuePercent, SpellHasCastingPerk |
| 058F6C:Skyrim.esm | Tower of Strength | ModIncomingDamage / Multiply | 0.75 / 200 / 0 | UNSUPPORTED: unsupported condition IsPowerAttacking at Effects[0].Conditions[1].Conditions[0]; unsupported condition IsAttackType at Effects[0].Conditions[1].Conditions[1] | HasPerk, IsAttackType, IsPowerAttacking, WornHasKeyword |
| 058F6D:Skyrim.esm | Heavy Armor Training | ModArmorWeight / Multiply | 0 / 165 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword |
| 058F6D:Skyrim.esm | Heavy Armor Training | ModArmorWeight / Multiply | 0 / 166 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword |
| 058F6D:Skyrim.esm | Heavy Armor Training | ModArmorWeight / Multiply | 0 / 167 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword |
| 058F6D:Skyrim.esm | Heavy Armor Training | ModArmorWeight / Multiply | 0 / 168 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword |
| 058F6F:Skyrim.esm | Heavy Armor Fit | ModArmorRating / Multiply | 1.15 / 190 / 0 | SUPPORTED | HasPerk, WornHasKeyword |
| 05F592:Skyrim.esm | Denting Blows (1) | ApplyCombatHitSpell |  / 179 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasMagicEffect, HasPerk, IsAttackType, IsPowerAttacking |
| 05F592:Skyrim.esm | Denting Blows (1) | ApplyCombatHitSpell |  / 180 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasMagicEffect, HasPerk, IsAttackType, IsPowerAttacking |
| 05F592:Skyrim.esm | Denting Blows (1) | ApplyCombatHitSpell |  / 184 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasMagicEffect, HasPerk, IsAttackType, IsPowerAttacking |
| 05F592:Skyrim.esm | Denting Blows (1) | ApplyCombatHitSpell |  / 185 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasMagicEffect, HasPerk, IsAttackType, IsPowerAttacking |
| 05F592:Skyrim.esm | Denting Blows (1) | ApplyCombatHitSpell |  / 189 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasMagicEffect, HasPerk, IsAttackType, IsPowerAttacking |
| 05F592:Skyrim.esm | Denting Blows (1) | ApplyCombatHitSpell |  / 190 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasMagicEffect, HasPerk, IsAttackType, IsPowerAttacking |
| 05F592:Skyrim.esm | Denting Blows (1) | ModTargetDamageResistance / Add | -0.12 / 20 / 0 | SUPPORTED | HasKeyword, HasPerk |
| 0BABE4:Skyrim.esm | One-Handed Mastery | CalculateMyCriticalHitDamage / MultiplyOnePlusAVMult | 0.05 / OneHanded / 195 / 0 | SUPPORTED | HasKeyword, HasPerk |
| 0BABE4:Skyrim.esm | One-Handed Mastery | CalculateWeaponDamage / MultiplyOnePlusAVMult | 0.01 / OneHanded / 200 / 0 | SUPPORTED | HasKeyword, HasPerk |
| 0BCD2A:Skyrim.esm | Heavy Armor Mastery | ModArmorRating / MultiplyOnePlusAVMult | 0.01 / HeavyArmor / 200 / 0 | SUPPORTED | HasKeyword, HasPerk |
| 0C1E92:Skyrim.esm | Denting Blows (2) | ApplyCombatHitSpell |  / 179 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasMagicEffect, HasPerk, IsAttackType, IsPowerAttacking |
| 0C1E92:Skyrim.esm | Denting Blows (2) | ApplyCombatHitSpell |  / 180 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasMagicEffect, HasPerk, IsAttackType, IsPowerAttacking |
| 0C1E92:Skyrim.esm | Denting Blows (2) | ApplyCombatHitSpell |  / 184 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasMagicEffect, HasPerk, IsAttackType, IsPowerAttacking |
| 0C1E92:Skyrim.esm | Denting Blows (2) | ApplyCombatHitSpell |  / 185 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasMagicEffect, HasPerk, IsAttackType, IsPowerAttacking |
| 0C1E92:Skyrim.esm | Denting Blows (2) | ApplyCombatHitSpell |  / 189 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasMagicEffect, HasPerk, IsAttackType, IsPowerAttacking |
| 0C1E92:Skyrim.esm | Denting Blows (2) | ApplyCombatHitSpell |  / 190 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasMagicEffect, HasPerk, IsAttackType, IsPowerAttacking |
| 0C1E92:Skyrim.esm | Denting Blows (2) | ModTargetDamageResistance / Add | -0.18 / 20 / 0 | SUPPORTED | HasKeyword |
| 0F2CAA:Skyrim.esm | Restoration Mastery | ModSpellCost / MultiplyOnePlusAVMult | -0.005 / Restoration / 200 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | SpellHasCastingPerk |
| 107832:Skyrim.esm | Matching Heavy Set | ModArmorRating / Multiply | 1.15 / 155 / 0 | SUPPORTED | WornApparelHasKeywordCount |
| 2BBF34:Vokrii - Minimalistic Perks of Skyrim.esp | Vigilant Ward (1) | ModIncomingDamage / Multiply | 0.85 / 138 / 0 | UNSUPPORTED: unsupported condition HasMagicEffectKeyword at Effects[2].Conditions[0].Conditions[1]; unsupported condition HasMagicEffectKeyword at Effects[2].Conditions[0].Conditions[2]; unsupported condition HasMagicEffect at Effects[2].Conditions[0].Conditions[3] | HasMagicEffect, HasMagicEffectKeyword, HasPerk |
| 2BBF34:Vokrii - Minimalistic Perks of Skyrim.esp | Vigilant Ward (1) | ModIncomingDamage / Multiply | 0.7 / 139 / 0 | UNSUPPORTED: unsupported condition HasMagicEffectKeyword at Effects[1].Conditions[0].Conditions[1] | HasMagicEffectKeyword, HasPerk |
| 2BBF34:Vokrii - Minimalistic Perks of Skyrim.esp | Vigilant Ward (1) | ModSpellCost / Multiply | 0.5 / 140 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasPerk |
| 2C1037:Vokrii - Minimalistic Perks of Skyrim.esp | Battle Fatigue | ModIncomingDamage / Multiply | 0.95 / 197 / 0 | SUPPORTED | GetActorValuePercent, HasPerk, WornHasKeyword |
| 2C1037:Vokrii - Minimalistic Perks of Skyrim.esp | Battle Fatigue | ModIncomingDamage / Multiply | 0.9 / 198 / 0 | SUPPORTED | GetActorValuePercent, HasPerk, WornHasKeyword |
| 2C1037:Vokrii - Minimalistic Perks of Skyrim.esp | Battle Fatigue | ModIncomingDamage / Multiply | 0.85 / 199 / 0 | SUPPORTED | GetActorValuePercent, HasPerk, WornHasKeyword |
| 2C1037:Vokrii - Minimalistic Perks of Skyrim.esp | Battle Fatigue | ModIncomingDamage / Multiply | 0.8 / 200 / 0 | SUPPORTED | GetActorValuePercent, HasPerk, WornHasKeyword |

## piromante

Perks concedidas no crosswalk: 20.
Efeitos nas famílias de combate: 4; suportados: 2; UNSUPPORTED nas famílias: 2; fora de escopo: 14.

| FormID local:plugin | Perk (crosswalk) | Entry point / operação | Valor / AV / prioridade / rank | Estado e motivo | Condições |
|---|---|---|---|---|---|
| 0153CF:Skyrim.esm | Destruction Dual Casting | CanDualCastSpell / Set | 1 / 200 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | EPMagic_SpellHasSkill |
| 01BB2E:Vokrii - Minimalistic Perks of Skyrim.esp | Hellstorm | ModSpellMagnitude / Multiply | 1.5 / 115 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasMagicEffect |
| 0581E7:Skyrim.esm | Augmented Flames (1) | ModSpellMagnitude / Multiply | 1.2 / 195 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | EPMagic_SpellHasKeyword, HasPerk |
| 0581FC:Skyrim.esm | Stability | ModSpellDuration / Multiply | 1.25 / 180 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | EPMagic_SpellHasSkill, GetIsObjectType |
| 068BCC:Skyrim.esm | Ward Absorb | ModWardMagickaAbsorptionPct / Add | 0.2 / 149 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasMagicEffectKeyword |
| 068BCC:Skyrim.esm | Ward Absorb | ModWardMagickaAbsorptionPct / Add | 0.4 / 150 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasMagicEffectKeyword |
| 0BABE4:Skyrim.esm | One-Handed Mastery | CalculateMyCriticalHitDamage / MultiplyOnePlusAVMult | 0.05 / OneHanded / 195 / 0 | SUPPORTED | HasKeyword, HasPerk |
| 0BABE4:Skyrim.esm | One-Handed Mastery | CalculateWeaponDamage / MultiplyOnePlusAVMult | 0.01 / OneHanded / 200 / 0 | SUPPORTED | HasKeyword, HasPerk |
| 0F2CA6:Skyrim.esm | Alteration Mastery | ModSpellCost / MultiplyOnePlusAVMult | -0.005 / Alteration / 200 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasPerk, SpellHasCastingPerk |
| 0F2CA8:Skyrim.esm | Destruction Mastery | ModSpellCost / MultiplyOnePlusAVMult | -0.005 / Destruction / 200 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | SpellHasCastingPerk |
| 0F2CAA:Skyrim.esm | Restoration Mastery | ModSpellCost / MultiplyOnePlusAVMult | -0.005 / Restoration / 200 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | SpellHasCastingPerk |
| 0F392E:Skyrim.esm | Devouring Flames | ModSpellMagnitude / MultiplyAVMult | 0.01 / Destruction / 173 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword |
| 105F32:Skyrim.esm | Rune Master | ModSpellMagnitude / Multiply | 1.1 / 150 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | EPMagic_SpellHasKeyword, HasPerk |
| 105F32:Skyrim.esm | Rune Master | ModSpellRange / Multiply | 3 / 200 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | EPMagic_SpellHasKeyword, HasPerk |
| 10FCF8:Skyrim.esm | Augmented Flames (2) | ModSpellMagnitude / Multiply | 1.4 / 195 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | EPMagic_SpellHasKeyword |
| 2BBF34:Vokrii - Minimalistic Perks of Skyrim.esp | Vigilant Ward (1) | ModIncomingDamage / Multiply | 0.85 / 138 / 0 | UNSUPPORTED: unsupported condition HasMagicEffectKeyword at Effects[2].Conditions[0].Conditions[1]; unsupported condition HasMagicEffectKeyword at Effects[2].Conditions[0].Conditions[2]; unsupported condition HasMagicEffect at Effects[2].Conditions[0].Conditions[3] | HasMagicEffect, HasMagicEffectKeyword, HasPerk |
| 2BBF34:Vokrii - Minimalistic Perks of Skyrim.esp | Vigilant Ward (1) | ModIncomingDamage / Multiply | 0.7 / 139 / 0 | UNSUPPORTED: unsupported condition HasMagicEffectKeyword at Effects[1].Conditions[0].Conditions[1] | HasMagicEffectKeyword, HasPerk |
| 2BBF34:Vokrii - Minimalistic Perks of Skyrim.esp | Vigilant Ward (1) | ModSpellCost / Multiply | 0.5 / 140 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasPerk |

## ranger

Perks concedidas no crosswalk: 20.
Efeitos nas famílias de combate: 19; suportados: 7; UNSUPPORTED nas famílias: 12; fora de escopo: 11.

| FormID local:plugin | Perk (crosswalk) | Entry point / operação | Valor / AV / prioridade / rank | Estado e motivo | Condições |
|---|---|---|---|---|---|
| 03AF81:Skyrim.esm | Furious Strength | ModPowerAttackDamage / MultiplyOnePlusAVMult | 0.001 / Stamina / 120 / 0 | SUPPORTED | HasKeyword |
| 051B1B:Skyrim.esm | Light Armor Fit | ModArmorRating / Multiply | 1.15 / 190 / 0 | SUPPORTED | HasPerk, WornHasKeyword |
| 051B1C:Skyrim.esm | Light Armor Training | ModArmorWeight / Set | 0 / 165 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword |
| 051B1C:Skyrim.esm | Light Armor Training | ModArmorWeight / Set | 0 / 166 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword |
| 051B1C:Skyrim.esm | Light Armor Training | ModArmorWeight / Set | 0 / 167 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword |
| 051B1C:Skyrim.esm | Light Armor Training | ModArmorWeight / Set | 0 / 168 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword |
| 052D50:Skyrim.esm | Disciplined Fighter | ModPowerAttackStamina / Multiply | 0.75 / 190 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword |
| 058F63:Skyrim.esm | Ranger | SetBooleanGraphVariable |  / 0 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | IsSneaking |
| 0BABE4:Skyrim.esm | One-Handed Mastery | CalculateMyCriticalHitDamage / MultiplyOnePlusAVMult | 0.05 / OneHanded / 195 / 0 | SUPPORTED | HasKeyword, HasPerk |
| 0BABE4:Skyrim.esm | One-Handed Mastery | CalculateWeaponDamage / MultiplyOnePlusAVMult | 0.01 / OneHanded / 200 / 0 | SUPPORTED | HasKeyword, HasPerk |
| 0BABED:Skyrim.esm | Archery Mastery | CalculateMyCriticalHitDamage / MultiplyOnePlusAVMult | 0.05 / Archery / 195 / 0 | SUPPORTED | HasKeyword, HasPerk |
| 0BABED:Skyrim.esm | Archery Mastery | CalculateWeaponDamage / MultiplyOnePlusAVMult | 0.01 / Archery / 200 / 0 | SUPPORTED | HasKeyword, HasPerk |
| 0BE123:Skyrim.esm | Light Armor Mastery | ModArmorRating / MultiplyOnePlusAVMult | 0.01 / LightArmor / 200 / 0 | SUPPORTED | HasKeyword, HasPerk |
| 105F19:Skyrim.esm | Quick Shot | SetBooleanGraphVariable |  / 0 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | sem condições |
| 105F2A:Skyrim.esm | Slow Metabolism (1) | ModSpellDuration / Multiply | 2 / 140 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasPerk |
| 219DCC:Vokrii - Minimalistic Perks of Skyrim.esp | Gore | ApplyCombatHitSpell |  / 188 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasPerk |
| 219DCC:Vokrii - Minimalistic Perks of Skyrim.esp | Gore | CalculateMyCriticalHitChance / Set | 100 / 100 / 0 | UNSUPPORTED: unsupported condition HasMagicEffectKeyword at Effects[1].Conditions[1].Conditions[0] | HasKeyword, HasMagicEffectKeyword |
| 219DCC:Vokrii - Minimalistic Perks of Skyrim.esp | Gore | CalculateMyCriticalHitDamage / Multiply | 1 / 99 / 0 | UNSUPPORTED: unsupported condition HasMagicEffectKeyword at Effects[2].Conditions[1].Conditions[0] | HasKeyword, HasMagicEffectKeyword |
| 2EE983:Vokrii - Minimalistic Perks of Skyrim.esp | Point Blank Shot (1) | ModAttackDamage / Multiply | 1.05 / 182 / 0 | UNSUPPORTED: unsupported condition GetDistance at Effects[3].Conditions[2].Conditions[1]; unsupported condition GetDistance at Effects[3].Conditions[2].Conditions[2] | GetDistance, GetIsID, HasKeyword, HasPerk |
| 2EE983:Vokrii - Minimalistic Perks of Skyrim.esp | Point Blank Shot (1) | ModAttackDamage / Multiply | 1.1 / 183 / 0 | UNSUPPORTED: unsupported condition GetDistance at Effects[2].Conditions[2].Conditions[1]; unsupported condition GetDistance at Effects[2].Conditions[2].Conditions[2] | GetDistance, GetIsID, HasKeyword, HasPerk |
| 2EE983:Vokrii - Minimalistic Perks of Skyrim.esp | Point Blank Shot (1) | ModAttackDamage / Multiply | 1.15 / 184 / 0 | UNSUPPORTED: unsupported condition GetDistance at Effects[1].Conditions[2].Conditions[1]; unsupported condition GetDistance at Effects[1].Conditions[2].Conditions[2] | GetDistance, GetIsID, HasKeyword, HasPerk |
| 2EE983:Vokrii - Minimalistic Perks of Skyrim.esp | Point Blank Shot (1) | ModAttackDamage / Multiply | 1.2 / 185 / 0 | UNSUPPORTED: unsupported condition GetDistance at Effects[0].Conditions[2].Conditions[1] | GetDistance, GetIsID, HasKeyword, HasPerk |
| 2EE984:Vokrii - Minimalistic Perks of Skyrim.esp | Point Blank Shot (2) | ModAttackDamage / Multiply | 1.1 / 182 / 0 | UNSUPPORTED: unsupported condition GetDistance at Effects[3].Conditions[0].Conditions[1]; unsupported condition GetDistance at Effects[3].Conditions[0].Conditions[2] | GetDistance, GetIsID, HasKeyword |
| 2EE984:Vokrii - Minimalistic Perks of Skyrim.esp | Point Blank Shot (2) | ModAttackDamage / Multiply | 1.2 / 183 / 0 | UNSUPPORTED: unsupported condition GetDistance at Effects[2].Conditions[1].Conditions[1]; unsupported condition GetDistance at Effects[2].Conditions[1].Conditions[2] | GetDistance, GetIsID, HasKeyword |
| 2EE984:Vokrii - Minimalistic Perks of Skyrim.esp | Point Blank Shot (2) | ModAttackDamage / Multiply | 1.3 / 184 / 0 | UNSUPPORTED: unsupported condition GetDistance at Effects[1].Conditions[1].Conditions[1]; unsupported condition GetDistance at Effects[1].Conditions[1].Conditions[2] | GetDistance, GetIsID, HasKeyword |
| 2EE984:Vokrii - Minimalistic Perks of Skyrim.esp | Point Blank Shot (2) | ModAttackDamage / Multiply | 1.4 / 185 / 0 | UNSUPPORTED: unsupported condition GetDistance at Effects[0].Conditions[1].Conditions[1] | GetDistance, GetIsID, HasKeyword |
| 2EE98B:Vokrii - Minimalistic Perks of Skyrim.esp | Arrow to the Knee | ApplyCombatHitSpell |  / 187 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasPerk |
| 2EE98B:Vokrii - Minimalistic Perks of Skyrim.esp | Arrow to the Knee | CalculateMyCriticalHitChance / Set | 100 / 100 / 0 | UNSUPPORTED: unsupported condition HasMagicEffect at Effects[1].Conditions[1].Conditions[0] | HasKeyword, HasMagicEffect |
| 2EE98B:Vokrii - Minimalistic Perks of Skyrim.esp | Arrow to the Knee | CalculateMyCriticalHitDamage / Multiply | 2 / 99 / 0 | UNSUPPORTED: unsupported condition HasMagicEffect at Effects[2].Conditions[1].Conditions[0] | HasKeyword, HasMagicEffect |
| 2EE993:Vokrii - Minimalistic Perks of Skyrim.esp | Pinning Shot | ApplyCombatHitSpell |  / 186 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword |

## trapaceiro

Perks concedidas no crosswalk: 20.
Efeitos nas famílias de combate: 1; suportados: 1; UNSUPPORTED nas famílias: 0; fora de escopo: 13.

| FormID local:plugin | Perk (crosswalk) | Entry point / operação | Valor / AV / prioridade / rank | Estado e motivo | Condições |
|---|---|---|---|---|---|
| 0153CD:Skyrim.esm | Alteration Dual Casting | CanDualCastSpell / Set | 1 / 200 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | EPMagic_SpellHasSkill |
| 03799E:Vokrii - Minimalistic Perks of Skyrim.esp | Shadowcaster | ModSpellMagnitude / Multiply | 2 / 215 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | EPMagic_SpellHasSkill, GetDetected, GetIsID, GetIsObjectType, HasKeyword, SpellHasCastingPerk |
| 0581E1:Skyrim.esm | Animage (1) | ModSpellMagnitude / Add | 5 / 174 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasPerk |
| 0581E1:Skyrim.esm | Animage (1) | ModSpellMagnitude / Add | 5 / 175 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasPerk |
| 0581E2:Skyrim.esm | Animage (2) | ModSpellMagnitude / Add | 10 / 174 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasPerk |
| 0581E2:Skyrim.esm | Animage (2) | ModSpellMagnitude / Add | 10 / 175 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasPerk |
| 0581FC:Skyrim.esm | Stability | ModSpellDuration / Multiply | 1.25 / 180 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | EPMagic_SpellHasSkill, GetIsObjectType |
| 058214:Skyrim.esm | Shadow Warrior | ApplySneakingSpell |  / 150 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasPerk, IsInCombat |
| 0BE123:Skyrim.esm | Light Armor Mastery | ModArmorRating / MultiplyOnePlusAVMult | 0.01 / LightArmor / 200 / 0 | SUPPORTED | HasKeyword, HasPerk |
| 0BE126:Skyrim.esm | Sneak Mastery | ModDetectionSneakSkill / AddAVMult | 0.5 / Sneak / 200 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasPerk |
| 0F2CA6:Skyrim.esm | Alteration Mastery | ModSpellCost / MultiplyOnePlusAVMult | -0.005 / Alteration / 200 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasPerk, SpellHasCastingPerk |
| 0F2CA9:Skyrim.esm | Illusion Mastery | ModSpellCost / MultiplyOnePlusAVMult | -0.005 / Illusion / 200 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | SpellHasCastingPerk |
| 3B4293:Vokrii - Minimalistic Perks of Skyrim.esp | Animage (3) | ModSpellMagnitude / Add | 20 / 174 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword |
| 3B4293:Vokrii - Minimalistic Perks of Skyrim.esp | Animage (3) | ModSpellMagnitude / Add | 20 / 175 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword |

## viper

Perks concedidas no crosswalk: 19.
Efeitos nas famílias de combate: 11; suportados: 5; UNSUPPORTED nas famílias: 6; fora de escopo: 12.

| FormID local:plugin | Perk (crosswalk) | Entry point / operação | Valor / AV / prioridade / rank | Estado e motivo | Condições |
|---|---|---|---|---|---|
| 004EFA:Vokrii - Minimalistic Perks of Skyrim.esp | Fangs (1) | ModAttackDamage / Multiply | 1.1 / 190 / 0 | UNSUPPORTED: unsupported condition HasMagicEffectKeyword at Effects[0].Conditions[2].Conditions[0]; unsupported condition HasMagicEffect at Effects[0].Conditions[2].Conditions[1]; unsupported condition HasMagicEffect at Effects[0].Conditions[2].Conditions[2] | HasKeyword, HasMagicEffect, HasMagicEffectKeyword, HasPerk |
| 004EFB:Vokrii - Minimalistic Perks of Skyrim.esp | Fangs (2) | ModAttackDamage / Multiply | 1.2 / 190 / 0 | UNSUPPORTED: unsupported condition HasMagicEffectKeyword at Effects[0].Conditions[1].Conditions[0]; unsupported condition HasMagicEffect at Effects[0].Conditions[1].Conditions[1]; unsupported condition HasMagicEffect at Effects[0].Conditions[1].Conditions[2] | HasKeyword, HasMagicEffect, HasMagicEffectKeyword |
| 051B1B:Skyrim.esm | Light Armor Fit | ModArmorRating / Multiply | 1.15 / 190 / 0 | SUPPORTED | HasPerk, WornHasKeyword |
| 052D50:Skyrim.esm | Disciplined Fighter | ModPowerAttackStamina / Multiply | 0.75 / 190 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword |
| 0BABE4:Skyrim.esm | One-Handed Mastery | CalculateMyCriticalHitDamage / MultiplyOnePlusAVMult | 0.05 / OneHanded / 195 / 0 | SUPPORTED | HasKeyword, HasPerk |
| 0BABE4:Skyrim.esm | One-Handed Mastery | CalculateWeaponDamage / MultiplyOnePlusAVMult | 0.01 / OneHanded / 200 / 0 | SUPPORTED | HasKeyword, HasPerk |
| 0BE123:Skyrim.esm | Light Armor Mastery | ModArmorRating / MultiplyOnePlusAVMult | 0.01 / LightArmor / 200 / 0 | SUPPORTED | HasKeyword, HasPerk |
| 105F2A:Skyrim.esm | Slow Metabolism (1) | ModSpellDuration / Multiply | 2 / 140 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasPerk |
| 105F2B:Skyrim.esm | Alkahest | ModTargetDamageResistance / Multiply | 0.5 / 125 / 0 | UNSUPPORTED: unsupported condition HasMagicEffectKeyword at Effects[0].Conditions[0].Conditions[0] | GetActorValue, GetIsID, HasMagicEffectKeyword |
| 105F2F:Skyrim.esm | Concentrated Poison (1) | ModPoisonDoseCount / Add | 2 / 150 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasPerk |
| 106256:Skyrim.esm | Dual Flurry (1) | ModAttackDamage / Multiply | 1.1 / 0 / 0 | SUPPORTED | GetEquippedItemType |
| 3120F8:Vokrii - Minimalistic Perks of Skyrim.esp | Concentrated Poison (2) | ModPoisonDoseCount / Add | 4 / 150 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasPerk |
| 3120F9:Vokrii - Minimalistic Perks of Skyrim.esp | Concentrated Poison (3) | ModPoisonDoseCount / Add | 6 / 150 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | sem condições |
| 321425:Vokrii - Minimalistic Perks of Skyrim.esp | Slow Metabolism (2) | ModSpellDuration / Multiply | 3 / 140 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword |
| 344BC9:Vokrii - Minimalistic Perks of Skyrim.esp | Bladedancer | ModIncomingDamage / Multiply | 0.7 / 105 / 0 | UNSUPPORTED: unsupported condition IsPowerAttacking at Effects[0].Conditions[0].Conditions[0] | GetEquippedItemType, IsPowerAttacking |
| 353F1B:Vokrii - Minimalistic Perks of Skyrim.esp | Spitting Cobra | ApplyCombatHitSpell |  / 159 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasMagicEffect, HasPerk, IsAttackType, IsPowerAttacking |
| 353F1B:Vokrii - Minimalistic Perks of Skyrim.esp | Spitting Cobra | ApplyCombatHitSpell |  / 160 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasMagicEffect, HasPerk, IsAttackType, IsPowerAttacking |
| 353F1B:Vokrii - Minimalistic Perks of Skyrim.esp | Spitting Cobra | ApplyCombatHitSpell |  / 164 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasMagicEffect, HasPerk, IsAttackType, IsPowerAttacking |
| 353F1B:Vokrii - Minimalistic Perks of Skyrim.esp | Spitting Cobra | ApplyCombatHitSpell |  / 165 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasMagicEffect, HasPerk, IsAttackType, IsPowerAttacking |
| 353F1B:Vokrii - Minimalistic Perks of Skyrim.esp | Spitting Cobra | ApplyCombatHitSpell |  / 169 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasMagicEffect, HasPerk, IsAttackType, IsPowerAttacking |
| 353F1B:Vokrii - Minimalistic Perks of Skyrim.esp | Spitting Cobra | ApplyCombatHitSpell |  / 170 / 0 | UNSUPPORTED: fora do escopo: entry point não pertence à função 4 | HasKeyword, HasMagicEffect, HasPerk, IsAttackType, IsPowerAttacking |
| 353F1B:Vokrii - Minimalistic Perks of Skyrim.esp | Spitting Cobra | CalculateMyCriticalHitChance / Add | 100 / 100 / 0 | UNSUPPORTED: unsupported condition IsPowerAttacking at Effects[6].Conditions[0].Conditions[0]; unsupported condition HasMagicEffect at Effects[6].Conditions[2].Conditions[0] | HasKeyword, HasMagicEffect, IsPowerAttacking |
| 353F1B:Vokrii - Minimalistic Perks of Skyrim.esp | Spitting Cobra | CalculateMyCriticalHitDamage / Multiply | 3 / 99 / 0 | UNSUPPORTED: unsupported condition IsPowerAttacking at Effects[7].Conditions[0].Conditions[0]; unsupported condition HasMagicEffect at Effects[7].Conditions[2].Conditions[0] | HasKeyword, HasMagicEffect, IsPowerAttacking |

