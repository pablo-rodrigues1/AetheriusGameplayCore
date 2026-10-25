# Dados gerados — B2

> Atualização DS-2d: Template WEAP/ARMO e efeitos ENCH/ALCH/MGEF têm contrato vigente na seção DS-2d ao fim deste arquivo; as notas antigas sobre essas pendências são históricas.

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

## DS-2d — Template efetivo e efeitos físicos (Q15a/Q15/Q16)

Esta seção supersede as pendências de Template/TemplateArmor e ENCH nas seções
DS-2/DS-2b acima. AttackRace e RACE.Attacks continuam nas condições anteriores.
Fonte normativa da herança: decisão Q15a do dono, PLANO_DAMAGE_SYSTEM.md §6 e
REQUISITO_ENCANTAMENTOS_E_POCOES.md §5; não é alegação sobre engenharia reversa
do executável. Valores vêm exclusivamente dos winners do export combat-20261024,
mesmo epoch e2-771486e30fc46d2a. Os hashes constam de MANIFESTO.txt.

Em combat, data.fields passa a conter os valores efetivos das colunas
WEAPON_COMBAT_FIELDS / ARMOR_COMBAT_FIELDS, publicadas em
shared/record-catalog/src/combat.ts. São os stats físicos expostos pelo domínio:
dano/rating, velocidade/alcance/ranges/stagger, crítico (inclusive Effect),
tipo/skill/flags da arma, tipo/slots/flags da armadura e EquipmentType. Toda a
unidade vem do primeiro WEAP/ARMO da cadeia sem template. Identidade, IsDeleted,
MajorFlags, Keywords, Race e ObjectEffect permanecem locais; ObjectEffect nunca
é copiado do template. Campos de apresentação/economia não são incorporados.

Equipamento com template tem data.template={status,provider,chain,reason,localValues}.
chain inclui o próprio item e o provedor terminal; localValues é uma linha nas
colunas correspondentes do schema. Os valores herdados estão em data.fields,
sem duplicá-los em outro objeto. Ciclo, alvo ausente ou de outro tipo, winner
apagado/ilegível e link ilegível resultam em UNSUPPORTED: as colunas herdáveis
ficam null, com motivo, sem usar o valor local como substituto. Folha ausente no
provedor continua null/exportNotes, mesmo quando a travessia tem status SUPPORTED.
Esse status certifica a travessia, não a disponibilidade de todas as folhas.
Assinaturas são recalculadas sobre os valores efetivos e a evidência da cadeia.

Na geração desta ordem: 6.456 WEAP com template, 2.327 danos diferentes do local;
7.809 ARMO com template, 461 ratings diferentes do local. Alteração em pelo menos
uma coluna: 4.256 WEAP e 786 ARMO. Zero cadeias do export ficaram sem provedor.
Os casos adversariais são cobertos em testes por mutação de fixtures do export.

O domínio effects contém apenas a cadeia MGEF ← ENCH/ALCH do filtro Q15:
37 MGEF, 111 ENCH e 44 ALCH, 167 efeitos selecionados nos carriers. Outros 44
efeitos dentro desses carriers são contados, sem carregar dados mágicos/utilitários.
Também são contadas as definições fora da seleção: 5.464 MGEF, 1.383 ENCH e 480 ALCH.
Nenhum record de PERK novo entra no domínio: as entradas dos controladores Q8
são evidência referenciada, lida do PERK vencedor. Registro não concede a perk.

A seleção é reproduzível em tools/catalog/effects.ts: vínculo Effects[i].BaseEffect
em ENCH/ALCH; MGEF sem flags Hostile/Detrimental; tabela de Archetype.ActorValue
para família. Archetype.Type/SecondActorValue/flags/scripts/condições são conservados
e limitam definitionStatus. Exceção explícita: Script + PerkToApply com entry point
ModSneakAttackMult é registrado como PERK_CONSTANT, inativo/UNSUPPORTED, pois a
magnitude do carrier não é o multiplicador constante dessa perk. Name, EditorID
e Description nunca participam da decisão. Damage Armor/Weapon hostis ficam fora
da seleção (função 22 futura); magia, elementos e utilitários ficam contados fora.

MGEF usa data.layout=1 e data.fields nas colunas EFFECT_FIELDS em
shared/record-catalog/src/effects.ts: IsDeleted, Archetype.Type/ActorValue,
SecondActorValue/Weight, Flags, CastType, TargetType, MagicSkill e PerkToApply.
Valores escalares conservam a grafia do export; referências são StableFormKey.
data.family/unit/entryPoint descrevem a operação. data.controller contém a chave
da perk, entrada, coeficiente/Modification e árvore de condições do winner.
As duplicatas numéricas FormLinkOrIndex.Index são omitidas; links ficam estáveis.
UnarmedDamage e DamageResist usam ADD; os AVs modificadores usam PERCENT conforme
MultiplyOnePlusAVMult do controlador. Famílias de bloqueio/forte/bash exigem a
confirmação correspondente no futuro consumidor; as condições não são avaliadas
aqui. Furtivo tem enabled=false pela Q9. Scripts, condições não certificadas,
flags desconhecidas e campos ausentes mantêm definitionStatus=UNSUPPORTED.

ENCH/ALCH usa data.effects com tuplas CARRIER_EFFECT_COLUMNS:
[MGEF, magnitude, duração em segundos, área, índice original do efeito, semCondições].
O índice é uma coluna do record, nunca posição de plugin. Os números são as folhas
Effects[i].Data.* do winner, não descrições. Dados ausentes/ilegíveis ficam null e
unavailable, com motivo; lista incompleta e condições desconhecidas não ganham
default. totalEffects/excludedEffects permitem conferir o recorte do carrier.
ENCH fora de ConstantEffect/Self não certifica ativação de equipamento vestido.

Q16: magnitudeSource=PREMADE_RECORD_ONLY nos carriers. Itens/poções criados por
jogador continuam UNSUPPORTED até o domínio responsável persistir magnitude
por instância no inventário autoritativo. activation=UNSUPPORTED em todos esses
records: são definições offline; não há efeito ativo, consumo, duração em runtime,
store novo, mudança de ownership, concessão, fórmula ou instalação nesta ordem.
O consumidor da DS-4/DS-5 deverá respeitar as limitações e o requisito Q16.
Q13 permanece: não há seleção, criação, troca de base ou respawn de inimigo.
