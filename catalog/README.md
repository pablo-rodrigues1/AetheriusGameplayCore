# Dados gerados — B2

`standing-stones.json`: 13 ativadores, 15 definições SPEL e seus MGEF.
Os grants saem de `records[].data.spells` dos ACTI. A definição de corrida do
Corcel (`mundus.esp|000818`) está em `unsupported`, sem vínculo inventado.

`races.json`: 10 raças jogáveis do export, com os atributos `Starting` e todas as
entradas `ActorEffect` dos winners, acompanhadas dos records SPEL/MGEF alcançados.

Cada arquivo é JSON canônico determinístico, com `schemaVersion`, `exportEpoch`,
`domain`, `signature`, `dependencies`, `roots`, `records` e `unsupported`.
Cada record declara `signature`, `stableFormKey`, `recordType`, `definingPlugin`, `pluginKind`,
`winnerPlugin` e dados do domínio. `FULL`/`LIGHT` descreve o plugin de definição.
Os fingerprints mantêm CRC32 com sinal. IDs de runtime não são persistidos aqui.

Desde B2-fix1, `signature` no topo continua sendo a assinatura do domínio e
protege o arquivo completo. `records[].signature` depende somente do conteúdo
daquele record e do tamanho/CRC32/kind do plugin de definição, sem domínio,
epoch, records vizinhos ou outros plugins. Essa assinatura por record é usada
em `DefinitionRef.catalogSignature`, `lookup` e `resolve`. As definições e
concessões das 13 pedras e 10 raças permanecem iguais ao catálogo B2.

Fonte e comandos de reprodução: `../tools/catalog/README.md`. Dados de semântica
esparsos refletem o depth dos exports; não certificam condições/scripts ou efeitos.

## Domínio combat (DS-2, 24/10/2026)

`combat.json` usa exclusivamente os exports `combat-20261024`, epoch
`e2-771486e30fc46d2a`. Inclui todos os WEAP, ARMO, AMMO e RACE dos exports,
inclusive itens não jogáveis, skins e raças de NPCs; não decide spawn (Q13).
KYWD entra apenas quando alcançado por Keywords desses records. Os três catálogos
anteriores mantêm seus arquivos, epochs e assinaturas.

Os dados são folhas vencedoras em `data.fields`, identificadas pelo caminho do
export: números finitos não negativos para dano/rating/velocidade/alcance/crítico,
enums e flags por sua grafia exportada (flags numéricas como números), links como
StableFormKey. `data.keywords` é a lista completa comprovada pelo marcador de
contagem, ou null quando a completude não é demonstrada. null em uma folha
acompanhado de `unsupported`/`exportNotes` significa indisponibilidade; um link
explicitamente `(null link)` é uma referência vazia conhecida. Nunca converter
indisponibilidade em zero ou em enum padrão.

WEAP conserva BasicStats.Damage, Data.AnimationType/Skill/Speed/Reach/RangeMin/
RangeMax/Stagger/Flags, Critical.Damage/PercentMult/Flags/Effect, ObjectEffect,
Template e EquipmentType. ARMO conserva ArmorRating, BodyTemplate.ArmorType/
FirstPersonFlags/Flags, ObjectEffect, TemplateArmor, Race e EquipmentType.
AMMO conserva Damage, Flags e Projectile. RACE conserva UnarmedDamage/Reach,
AimAngleTolerance, AngularTolerance, Flags, EquipmentFlags, Size, AttackRace,
UnarmedEquipSlot e os nomes dos eventos de ataque. IsDeleted e flags de record
são preservados; winner deletado é declarado UNSUPPORTED.

Encantamentos e efeitos críticos são só referências: não há ENCH/SPEL nesse
conjunto de exports. Herança Template/TemplateArmor/AttackRace não é calculada.
O depth 3 não contém as folhas de Attacks[].AttackData: cada ocorrência é
UNSUPPORTED, sem inferir bônus pelo nome do evento. PERK depth 12 é entrada da
DS-3; a DS-2 não interpreta perks. GMST e distribuições SPID (Q8) seguem pendentes;
não há valores substitutos neste domínio.

No boot, `damage.catalog.domain` passa a ser `combat`. A reconciliação do
catálogo pode ser SUPPORTED, mas o sistema damage continua UNSUPPORTED pelos
motivos DS-4 (perfil) e DS-5 (ponte nativa). Não há mudança de ownership ou fórmula.
