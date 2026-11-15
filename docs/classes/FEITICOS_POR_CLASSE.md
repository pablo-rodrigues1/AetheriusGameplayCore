# Feitiços por classe — referência da planilha

Atualizado em 14/11/2026. Ver também [Acervo: GameplayCore](https://github.com/pablo-rodrigues1/AETHERIUS-ACERVO-DE-INFORMACOES/blob/main/02-sistemas/gameplay-core/feiticos-por-classe.md) e o [módulo de classes](../../modules/class-system/README.md).

## Resumo
Catálogo documental dos 164 registros classe/feitiço presentes na aba **Classes**, distribuídos entre 12 das 18 classes. A seção de feitiços de **Classes - Progressão** foi sincronizada em 14/11/2026, preservando nomes, escolas e tiers de origem; as seis classes sem feitiços continuam sem entradas.

## Fonte e limite desta atualização
- Planilha: [AETHERIUS - Classes, efeitos, encantamentos](https://docs.google.com/spreadsheets/d/1O69M5KsGNmpX_s7zzav_5iMxZyacYLFRs9a4SuSVgxg/edit).
- Origem: aba Classes, colunas A (classe), C (escola), E (tier), F (feitiço) e G (descrição); conteúdo utilizado até a linha 358.
- Destino atualizado: Classes - Progressão, B23:F40; B/C/D/E/F correspondem a Novato/Aprendiz/Adepto/Especialista/Mestre. A classe permanece em A23:A40.
- Células mescladas foram resolvidas pelo intervalo real da mesclagem, sem inferir tier de records do jogo. Assim, Windwalker e Magelight de Criomante/Eletromante/Piromante aparecem como Adepto, conforme a origem.
- Somente espaços nas extremidades dos nomes foram removidos. Firebolt, Trickster, Circle of Vitality e Font of Vitality mantêm a grafia da aba Classes.
- **Escopo documental/design:** esta sincronização não modifica classes-config.json, seus espelhos de UI, catálogos assinados, concessões de perks ou o runtime. A lista não comprova liberação, entrega, aprendizado ou funcionamento em jogo. Onde divergir, o comportamento implementado continua sendo o do código, conforme o ADR-0003 do Acervo.
- O quadro permanece **independente de nível de classe**. Novato até Mestre são tiers de feitiço; não são marcos de nível 1/5/10/etc. O aprendizado continua descrito como roleplay no Colégio, com professores e livros; não há concessão automática nesta atualização.

## Totais por classe

| Classe | Registros na origem | authorizedSpells no código | allSpellsList no código |
|---|---:|---:|---:|
| ELEMENTALISTA | 17 | 9 | 17 |
| CRIOMANTE | 17 | 10 | 17 |
| ELETROMANTE | 18 | 10 | 18 |
| PIROMANTE | 18 | 10 | 18 |
| INVOCADOR | 21 | 13 | 21 |
| GUARDIÃO | 0 | 0 | 0 |
| BERSERKER | 0 | 0 | 0 |
| CAVALEIRO NEGRO | 2 | 2 | 2 |
| PALADINO | 8 | 8 | 8 |
| MESTRE ESPADACHIM | 0 | 0 | 0 |
| ARQUEIRO (SNIPER) | 0 | 0 | 0 |
| RANGER (CURTA DISTÂNCIA) | 0 | 0 | 0 |
| VIPER (VENENO) | 0 | 0 | 0 |
| ASSASSINO | 1 | 1 | 1 |
| ANTI-MAGO | 6 | 6 | 6 |
| DRUÍDA | 17 | 18 | 17 |
| CURANDEIRO | 18 | 20 | 18 |
| TRAPACEIRO | 21 | 21 | 21 |
| **Total** | **164** | **128** | **164** |

## Feitiços por classe e tier

### ELEMENTALISTA

| Tier | Feitiços (nome original) | Linhas da aba Classes |
|---|---|---|
| Novato | Flames; Frostbite; Sparks; Oakflesh | 2, 3, 4, 11 |
| Aprendiz | Ice Spike; Lightning Bolt; Burning Touch; Stoneflesh; Windwalker; Magelight; Steadfast Ward | 5, 6, 7, 12, 14, 15, 17 |
| Adepto | Fireball; Frost Cloak; Chain Lightning; Ironflesh; Shock Shell; Greater Ward | 8, 9, 10, 13, 16, 18 |

### CRIOMANTE

| Tier | Feitiços (nome original) | Linhas da aba Classes |
|---|---|---|
| Novato | Frostbite; Oakflesh | 22, 32 |
| Aprendiz | Ice Spike; Chilling Touch; Frost Rune; Steadfast Ward | 23, 24, 25, 37 |
| Adepto | Greater Frostbite; Frost Cloak; Ice Storm; Ironflesh; Windwalker; Magelight; Frost Shell; Greater Ward | 26, 27, 28, 33, 34, 35, 36, 38 |
| Especialista | Wall of Frost; Icy Spear | 29, 30 |
| Mestre | Blizzard | 31 |

### ELETROMANTE

| Tier | Feitiços (nome original) | Linhas da aba Classes |
|---|---|---|
| Novato | Sparks; Oakflesh | 41, 51 |
| Aprendiz | Lightning Bolt; Shocking Touch; Lightning Rune; Steadfast Ward | 42, 43, 44, 57 |
| Adepto | Greater Sparks; Lightning Cloak; Chain Lightning; Stoneflesh; Windwalker; Magelight; Shock Shell; Ironflesh; Greater Ward | 45, 46, 47, 52, 53, 54, 55, 56, 58 |
| Especialista | Wall of Storms; Thunderbolt | 48, 49 |
| Mestre | Lightning Storm | 50 |

### PIROMANTE

| Tier | Feitiços (nome original) | Linhas da aba Classes |
|---|---|---|
| Novato | Flames; Oakflesh | 61, 71 |
| Aprendiz | Firebolt; Burning Touch; Fire Rune; Steadfast Ward | 62, 63, 64, 77 |
| Adepto | Greater Flames; Flame Cloak; Fireball; Stoneflesh; Windwalker; Magelight; Flame Shell; Ironflesh; Greater Ward | 65, 66, 67, 72, 73, 74, 75, 76, 78 |
| Especialista | Wall of Flames; Incinerate | 68, 69 |
| Mestre | Firestorm | 70 |

### INVOCADOR

| Tier | Feitiços (nome original) | Linhas da aba Classes |
|---|---|---|
| Novato | Conjure Spectral Wolf; Bound Dagger; Flames; Frostbite; Sparks; Oakflesh | 81, 82, 91, 92, 93, 94 |
| Aprendiz | Conjure Flame Atronach; Stoneflesh; Steadfast Ward | 83, 95, 100 |
| Adepto | Conjure Frost Atronach; Daedric Cure; Windwalker; Magelight; Flame Shell; Ironflesh; Greater Ward | 84, 85, 96, 97, 98, 99, 101 |
| Especialista | Conjure Storm Atronach | 86 |
| Mestre | Conjure Flame Monarch; Conjure Frost Monarch; Conjure Storm Monarch; Expel Daedra | 87, 88, 89, 90 |

### GUARDIÃO

Nenhum feitiço listado na aba Classes.

### BERSERKER

Nenhum feitiço listado na aba Classes.

### CAVALEIRO NEGRO

| Tier | Feitiços (nome original) | Linhas da aba Classes |
|---|---|---|
| Especialista | Vampiric Bolt | 154 |
| Mestre | Scion's Embrace | 155 |

### PALADINO

| Tier | Feitiços (nome original) | Linhas da aba Classes |
|---|---|---|
| Novato | Healing | 167 |
| Aprendiz | Turn Undead | 168 |
| Adepto | Circle of Vitality; Turn Greater Undead; Stendarr's Aura; Greater Ward; Vampire’s Bane | 169, 170, 171, 172, 173 |
| Mestre | Sun Shard | 174 |

### MESTRE ESPADACHIM

Nenhum feitiço listado na aba Classes.

### ARQUEIRO (SNIPER)

Nenhum feitiço listado na aba Classes.

### RANGER (CURTA DISTÂNCIA)

Nenhum feitiço listado na aba Classes.

### VIPER (VENENO)

Nenhum feitiço listado na aba Classes.

### ASSASSINO

| Tier | Feitiços (nome original) | Linhas da aba Classes |
|---|---|---|
| Especialista | Invisibility | 258 |

### ANTI-MAGO

| Tier | Feitiços (nome original) | Linhas da aba Classes |
|---|---|---|
| Novato | Bound Dagger | 268 |
| Aprendiz | Bound Shield | 269 |
| Adepto | Shadow Dance; Magic Barrier; Nightblade | 282, 283, 285 |
| Mestre | Trickster | 281 |

### DRUÍDA

| Tier | Feitiços (nome original) | Linhas da aba Classes |
|---|---|---|
| Novato | Create Water Totem; Trickster | 286, 287 |
| Aprendiz | Conjure Spectral Wolf; Stoneflesh; Magelight; Fast Healing; Steadfast Ward | 288, 292, 293, 298, 299 |
| Adepto | Conjure Spectral Sabre Cat; Detect Life; Equilibrium; Burden; Whirlwind Cloak; Circle of Strength; Circle of Wisdom | 289, 294, 295, 296, 297, 300, 301 |
| Especialista | Conjure Spectral Bear | 290 |
| Mestre | Conjure Spectral Manbeast; Font of Strength | 291, 302 |

### CURANDEIRO

| Tier | Feitiços (nome original) | Linhas da aba Classes |
|---|---|---|
| Novato | Healing; Sunbeam; Flames | 305, 306, 317 |
| Aprendiz | Fast Healing; Heal Other; Steadfast Ward; Stoneflesh; Magelight | 307, 308, 309, 318, 319 |
| Adepto | Greater Healing; Detect Life; Dispel; Ironflesh; Shock Shell | 310, 320, 321, 322, 323 |
| Especialista | Aura of Thorns | 311 |
| Mestre | Grand Ward; Circle of Protection; Mutagen; Font of Vitality | 312, 313, 314, 316 |

### TRAPACEIRO

| Tier | Feitiços (nome original) | Linhas da aba Classes |
|---|---|---|
| Novato | Unbound Atronach | 327 |
| Aprendiz | Bestow Gift; Switcheroo; Featherlight | 332, 333, 334 |
| Adepto | Windwalker; Teleportation; Burden; Disintegrate Weapon; Corrode Armor; Whirlwind Cloak | 335, 336, 337, 338, 339, 340 |
| Especialista | Weakness to Frost; Weakness to Shock; Weakness to Poison; Ash Cloud | 342, 343, 344, 345 |
| Mestre | Invisibility; Fade; Mayhem; Weakness to Fire; Armoreater; Cinder Storm; Weight of the World | 328, 329, 330, 341, 346, 347, 348 |

## Escolas de magia
A associação com a escola é a da aba Classes. Consultar as linhas indicadas acima para a descrição original do efeito; esta atualização não altera magnitudes, duração, alcance nem custo de Magicka.

| Classe | Escola | Feitiços |
|---|---|---|
| ELEMENTALISTA | Destruição | Flames; Frostbite; Sparks; Ice Spike; Lightning Bolt; Burning Touch; Fireball; Frost Cloak; Chain Lightning |
| ELEMENTALISTA | Alteração | Oakflesh; Stoneflesh; Ironflesh; Windwalker; Magelight; Shock Shell |
| ELEMENTALISTA | Restauração | Steadfast Ward; Greater Ward |
| CRIOMANTE | Destruição | Frostbite; Ice Spike; Chilling Touch; Frost Rune; Greater Frostbite; Frost Cloak; Ice Storm; Wall of Frost; Icy Spear; Blizzard |
| CRIOMANTE | Alteração | Oakflesh; Ironflesh; Windwalker; Magelight; Frost Shell |
| CRIOMANTE | Restauração | Steadfast Ward; Greater Ward |
| ELETROMANTE | Destruição | Sparks; Lightning Bolt; Shocking Touch; Lightning Rune; Greater Sparks; Lightning Cloak; Chain Lightning; Wall of Storms; Thunderbolt; Lightning Storm |
| ELETROMANTE | Alteração | Oakflesh; Stoneflesh; Windwalker; Magelight; Shock Shell; Ironflesh |
| ELETROMANTE | Restauração | Steadfast Ward; Greater Ward |
| PIROMANTE | Destruição | Flames; Firebolt; Burning Touch; Fire Rune; Greater Flames; Flame Cloak; Fireball; Wall of Flames; Incinerate; Firestorm |
| PIROMANTE | Alteração | Oakflesh; Stoneflesh; Windwalker; Magelight; Flame Shell; Ironflesh |
| PIROMANTE | Restauração | Steadfast Ward; Greater Ward |
| INVOCADOR | Conjuração | Conjure Spectral Wolf; Bound Dagger; Conjure Flame Atronach; Conjure Frost Atronach; Daedric Cure; Conjure Storm Atronach; Conjure Flame Monarch; Conjure Frost Monarch; Conjure Storm Monarch; Expel Daedra |
| INVOCADOR | Destruição | Flames; Frostbite; Sparks |
| INVOCADOR | Alteração | Oakflesh; Stoneflesh; Windwalker; Magelight; Flame Shell; Ironflesh |
| INVOCADOR | Restauração | Steadfast Ward; Greater Ward |
| CAVALEIRO NEGRO | Destruição | Vampiric Bolt; Scion's Embrace |
| PALADINO | Restauração | Healing; Turn Undead; Circle of Vitality; Turn Greater Undead; Stendarr's Aura; Greater Ward; Vampire’s Bane; Sun Shard |
| ASSASSINO | Ilusão | Invisibility |
| ANTI-MAGO | Conjuração | Bound Dagger; Bound Shield |
| ANTI-MAGO | Ilusão | Trickster |
| ANTI-MAGO | Alteração | Shadow Dance; Magic Barrier |
| ANTI-MAGO | Destruição | Nightblade |
| DRUÍDA | Conjuração | Create Water Totem; Trickster; Conjure Spectral Wolf; Conjure Spectral Sabre Cat; Conjure Spectral Bear; Conjure Spectral Manbeast |
| DRUÍDA | Alteração | Stoneflesh; Magelight; Detect Life; Equilibrium; Burden; Whirlwind Cloak |
| DRUÍDA | Restauração | Fast Healing; Steadfast Ward; Circle of Strength; Circle of Wisdom; Font of Strength |
| CURANDEIRO | Restauração | Healing; Sunbeam; Fast Healing; Heal Other; Steadfast Ward; Greater Healing; Aura of Thorns; Grand Ward; Circle of Protection; Mutagen; Font of Vitality |
| CURANDEIRO | Destruição | Flames |
| CURANDEIRO | Alteração | Stoneflesh; Magelight; Detect Life; Dispel; Ironflesh; Shock Shell |
| TRAPACEIRO | Conjuração | Unbound Atronach |
| TRAPACEIRO | Ilusão | Invisibility; Fade; Mayhem |
| TRAPACEIRO | Alteração | Bestow Gift; Switcheroo; Featherlight; Windwalker; Teleportation; Burden; Disintegrate Weapon; Corrode Armor; Whirlwind Cloak; Weakness to Fire; Weakness to Frost; Weakness to Shock; Weakness to Poison; Ash Cloud; Armoreater; Cinder Storm; Weight of the World |

## Divergências verificadas com o GameplayCore
Comparação com modules/class-system/config/classes-config.json, revisão 521a38974bac9d5d8b5a0deeab59ed61d8bd91a0. O resumo authorizedSpells tem 128 entradas (127 associações únicas; Aura of Thorns está repetida no Curandeiro) e coincide com a antiga seção da progressão. A lista detalhada allSpellsList já contém os mesmos 164 nomes por classe da aba Classes, considerando apenas espaços e apóstrofos tipográficos equivalentes; porém seis tiers diferem.

### authorizedSpells: nomes e ausências

| Classe | Presentes em Classes e ausentes no resumo do código | Presentes no resumo e ausentes em Classes |
|---|---|---|
| ELEMENTALISTA | Oakflesh; Stoneflesh; Ironflesh; Windwalker; Magelight; Shock Shell; Steadfast Ward; Greater Ward | — |
| CRIOMANTE | Oakflesh; Ironflesh; Windwalker; Magelight; Frost Shell; Steadfast Ward; Greater Ward | — |
| ELETROMANTE | Oakflesh; Stoneflesh; Windwalker; Magelight; Shock Shell; Ironflesh; Steadfast Ward; Greater Ward | — |
| PIROMANTE | Firebolt; Oakflesh; Stoneflesh; Windwalker; Magelight; Flame Shell; Ironflesh; Steadfast Ward; Greater Ward | Fire Bolt |
| INVOCADOR | Oakflesh; Stoneflesh; Windwalker; Magelight; Flame Shell; Ironflesh; Steadfast Ward; Greater Ward | — |
| PALADINO | Circle of Vitality | Circle of Life |
| ANTI-MAGO | Trickster | Shadow Clone |
| DRUÍDA | Trickster | Conjure Spectral Dire Wolf; Ebonyflesh |
| CURANDEIRO | Font of Vitality | Close Greater Wounds; Font of Life |

Fire Bolt/Firebolt e Scion’s Embrace/Scion's Embrace têm diferenças de grafia; não se presume identidade de record a partir do nome. Circle of Life, Shadow Clone e Font of Life foram substituídos na planilha de destino pelos nomes que constam na origem. Conjure Spectral Dire Wolf, Ebonyflesh e Close Greater Wounds deixaram o destino porque não constam em Classes. A antiga duplicação de Aura of Thorns no resumo do Curandeiro foi eliminada na planilha.

### authorizedSpells: tiers diferentes

| Classe | Feitiço | Tier em Classes / progressão atualizada | Tier no resumo do código |
|---|---|---|---|
| CAVALEIRO NEGRO | Vampiric Bolt | Especialista | Adepto |
| ANTI-MAGO | Bound Shield | Aprendiz | Novato |
| DRUÍDA | Conjure Spectral Wolf | Aprendiz | Novato |
| DRUÍDA | Detect Life | Adepto | Aprendiz |
| CURANDEIRO | Aura of Thorns | Especialista | Adepto |
| CURANDEIRO | Grand Ward | Mestre | Especialista |
| CURANDEIRO | Circle of Protection | Mestre | Especialista |
| CURANDEIRO | Mutagen | Mestre | Especialista |
| CURANDEIRO | Detect Life | Adepto | Aprendiz |
| CURANDEIRO | Dispel | Adepto | Aprendiz |
| TRAPACEIRO | Invisibility | Mestre | Especialista |
| TRAPACEIRO | Fade | Mestre | Especialista |
| TRAPACEIRO | Windwalker | Adepto | Aprendiz |
| TRAPACEIRO | Weakness to Fire | Mestre | Especialista |

### allSpellsList: tiers diferentes

| Classes | Feitiços | Tier em Classes / progressão atualizada | Tier na lista detalhada do código |
|---|---|---|---|
| CRIOMANTE, ELETROMANTE, PIROMANTE | Windwalker; Magelight (2 por classe) | Adepto | Aprendiz |

### Pendência de implementação
Alinhar authorizedSpells e allSpellsList entre si, com os espelhos de UI e com a política aprovada, exige uma alteração de código separada. Não atribuir a esta entrega mudança de permissões, de catálogo de tomos, de invocação, de facções ou de grants; nenhum teste em jogo foi executado.

## Verificação e manutenção
- Os 164 registros foram reconstruídos da leitura ao vivo e comparados com a releitura de B23:F40 após a escrita; sem duplicação de feitiços por classe.
- Os valores de A23:A40 e G23:J40 e os formatos de A23:J40 foram preservados. As tabelas de perks e skills e as demais abas não foram alteradas.
- A conferência da planilha foi feita por valores e metadados nativos; a revisão visual pelo navegador não respondeu e não foi concluída.
- Em futuras revisões, reler a aba Classes e suas mesclagens antes de atualizar; registrar explicitamente qualquer diferença para os JSONs e o runtime.
