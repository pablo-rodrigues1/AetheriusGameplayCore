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

## Extensão NPC_ (DS-2b, 24/10/2026)

Nota histórica: a representação e a pendência de CLAS abaixo são supersedidas
pela seção DS-2b-fix1 ao fim deste documento.

O domínio inclui todos os 11.583 NPC_ do export NPC_.jsonl de combat-20261024,
no mesmo epoch dos cinco tipos físicos. Não consulta nem altera o inventário de
atores: Items/CNTO e outfits são apenas referências da definição do NPC.

Em NPC_, data.fields conserva folhas locais do winner: Class (CLAS), Race,
Template (TPLT), Configuration.Flags/TemplateFlags, nível fixo ou multiplicador
PC-level com CalcMinLevel/CalcMaxLevel, offsets assinados de Health/Magicka/Stamina,
SpeedMultiplier, DispositionBase, BleedoutOverride e DNAM/PlayerSkills (os 18
SkillValues, 18 SkillOffsets, Health/Magicka/Stamina, GearedUpWeapons e distância).
Números negativos nos offsets permanecem assinados. Os nomes de skills são os do
export Mutagen (Archery e Speech), sem inferência por nome localizado.

Em data.npc ficam level (FIXED ou PC_LEVEL_MULT), autoCalcStats, templateFlags,
perks [{perk,rank}], spells (ActorEffect) e items [{item,count,referenceOnly:true}].
Todos os links usam StableFormKey. Listas ausentes/ilegíveis ficam null com motivo
UNSUPPORTED; somente marcador de lista completa permite afirmar conjunto vazio.
O depth 3 fornece CNTO.Item por note_ref explícito, mas não CNTO.Count: count=null
com motivo. Outfits/itens/spells/perks/CLAS são referências; esta extensão não
inclui os records de OTFT, CLAS, itens não físicos, SPEL ou PERK como novos roots.

npc.templateProviders resolve separadamente as categorias exportadas por
TemplateFlags. SUPPORTED aqui significa apenas que foi possível localizar o
provedor da categoria, com provider e chain de chaves estáveis; não certifica
os campos, scripts ou efeitos desse provedor. data.fields e os demais dados
npc continuam locais: para Q2, o consumidor precisa ler o winner indicado pelo
provedor de Stats (classe, nível, auto-cálculo e DNAM), Traits (raça), SpellList
(perks e spells) e Inventory (CNTO e outfits). Não se usa o último NPC de toda a
cadeia para todas as categorias. Flags brutas e decodificadas são conservadas.

A travessia segue a regra de EvaluateTemplate.h: TPLT explicitamente nulo ou flag
da categoria desmarcada encerra no próprio NPC; flag ativa segue TPLT. Ciclos,
winner deletado, flags/link ilegíveis e alvo ausente do export NPC_ ficam
UNSUPPORTED com chain e motivo. Um alvo LVLN exige a cadeia observada em runtime;
o catálogo não sorteia nem escolhe uma entrada (Q13). Não cria perfil, ator, spawn,
respawn ou estado de combate. Não há I/O no caminho de hit.

AutoCalcStats permanece UNSUPPORTED para números efetivos: DNAM é dado exportado,
não prova do valor calculado pelo motor. Falta export CLAS dos provedores de Stats,
com pesos de skills e atributos e os demais parâmetros usados pelo auto-cálculo,
no mesmo epoch, mais a semântica do cálculo. A lista das chaves necessárias está em
_work/evidence/DS-2b/required-clas.json no workspace. DS-4 ainda precisa consumir
as categorias e certificar esse cálculo.

**Item 2 da DS-2b parado:** não foi comprovada por fonte primária acessível a
regra completa de herança WEAP/ARMO. As páginas Weapons/Armor do Creation Kit
retornaram 403 e libespm/src/WEAP.cpp e ARMO.cpp do host atual não leem CNAM/TNAM.
Os valores desses dois tipos continuam locais com UNSUPPORTED para Template e
TemplateArmor; nenhuma descrição secundária foi transformada em semântica de
produção. A seção DS-2 acima sobre herança de equipamento/AttackRace segue vigente.
Esta nota supersede apenas a ausência de NPC_ na entrega histórica DS-2.

## NPC/CLAS compactos — DS-2b-fix1

Fonte vigente: catalog/npcs.json, separado de combat.json, no mesmo epoch
combat-20261024. Contém os 11.583 NPC_ e os 220 CLAS exportados (CLAS.jsonl,
localizados por FormID). combat volta a conter somente os tipos físicos e seus
KYWD alcançados. Nenhuma herança de WEAP/ARMO foi acrescentada.

Cada record conserva StableFormKey, definingPlugin, pluginKind, winnerPlugin e
signature. A nova representação muda a assinatura dos NPC_, mas não a identidade;
assinaturas de records físicos inalterados continuam iguais. loadDomain aceita o
domínio npcs e resolve NPC_/CLAS pelo tipo real e pelo mesmo adapter de boot. O
runtime/build.mjs embute o domínio; o laço genérico existente em runtime/src/index.ts
já o registra sem criar sistema, opção, perfil ou writer novo.

NPC_: data.layout=1; data.fields é a linha cujas colunas fixas são NPC_FIELDS em
shared/record-catalog/src/npcs.ts. Use npcField(data, caminho) para leitura: as
posições são colunas de schema, nunca posições de plugins. Conserva IsDeleted,
flags ACBS, Class, Race, Template, offsets assinados dos três atributos, min/max,
os 18 SkillValues e 18 SkillOffsets, DNAM Health/Magicka/Stamina, GearedUpWeapons,
outfits, WornArmor e AttackRace. level contém FIXED/value ou
PC_LEVEL_MULT/multiplier/min/max; autoCalcStats é booleano ou null indisponível.
Configuration.Flags/TemplateFlags brutos ficam nas colunas; data.templateFlags
é a máscara das categorias decodificadas, ou null se a decodificação falhou.
Não inclui nomes, keywords, distância de modelo e outros campos sem uso no perfil.

perks são tuplas [StableFormKey, rank]; spells são referências SPLO;
items são [StableFormKey, count] e sempre referências CNTO, sem leitura de ator.
Count não exportado é null, que em coluna numérica significa indisponibilidade;
a limitação por ocorrência está no relatório externo. data.unavailable lista
campos/containers ausentes ou inválidos (exceto essas notas repetidas de Count).
Nas colunas de referência, null sem caminho em unavailable é link nulo conhecido;
com caminho em unavailable é dado indisponível. Arrays de skills mantêm null
individual e marcador de dicionário incompleto. Lista ausente continua null;
lista vazia só vem de marcador exportado com contagem zero.

providers contém grupos [máscaraDeCategorias, providerOuNull, chain, motivoOuNull].
As categorias e a tabela de motivos são NPC_TEMPLATE_CATEGORIES e
NPC_PROVIDER_REASONS do mesmo schema. npcTemplateProvider(data, categoria) retorna
status, provider/chain ou reason/chain. Categorias com resultado igual compartilham
uma tupla; a cadeia continua completa e cada categoria mantém o próprio provedor.
A semântica e as fontes de parada da DS-2b continuam vigentes. SUPPORTED certifica
somente a localização do provedor, nunca a efetividade dos valores. LVLN, alvo
externo, ciclo, winner deletado ou dado ilegível seguem UNSUPPORTED; Q13 preservada.

CLAS: data.skillWeights usa a ordem das 18 skills de NPC_FIELDS; statWeights usa
Health, Magicka, Stamina. Também conserva isDeleted, BleedoutDefault, VoicePoints,
Unknown (assinado) e Unknown2. unavailable identifica campos ilegíveis. Pesos são
dados do winner, não uma fórmula implementada. A pendência de export CLAS foi
resolvida; o resultado efetivo do auto-cálculo continua não certificado por esta
ordem. DS-4 precisa consumir o Stats/Traits/SpellList apropriado e comprovar sua
semântica antes de publicar números efetivos.

combat/npcs.unsupported agora agrega por campo/motivo, normalizando só índices de
listas para []. Cada grupo tem count e stableFormKey=null. Os nulls, marcadores
de indisponibilidade e provedores continuam nos records. A lista completa
{status,stableFormKey,reason} de cada ocorrência é escrita exclusivamente nos
relatórios combat-unsupported.json e npcs-unsupported.json do diretório explícito
de geração; não entra em BUILD_DOMAINS. Comandos em tools/catalog/README.md.
