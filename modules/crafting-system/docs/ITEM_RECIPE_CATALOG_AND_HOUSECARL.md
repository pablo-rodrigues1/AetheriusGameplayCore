# Catálogo de itens/receitas e Housecarl

## 1. Objetivo

Construir um catálogo profissional de itens e receitas da load order real, incluindo mods e patches, capaz de responder:

- o que é este item;
- a qual profissão pertence;
- em qual workstation aparece;
- qual rank exige;
- quais materiais consome;
- quais condições possui;
- se é conteúdo de guilda/cultura;
- se está habilitado;
- qual workflow artesanal deve usar.

## 2. Housecarl como authoring/auditoria

Housecarl deve extrair/auditar:

- plugin + masters;
- winning records;
- COBJ;
- output;
- output count;
- ingredient list;
- bench keyword;
- recipe conditions;
- output record type;
- output keywords;
- material keywords;
- armor type;
- weapon type;
- clothing/jewelry classification;
- source plugin;
- relevant faction/quest conditions;
- patches que alterem esses records.

Runtime não consulta Housecarl por craft.

## 3. Identidade

Persistir StableFormKey com pluginName + localFormId.

Proibido persistir mod index/runtime FormID.

## 4. Raw catalog

~~~ts
interface RawCraftRecord {
  recipeKey: StableFormKey;
  outputKey: StableFormKey;
  outputCount: number;
  benchKeywordKey: StableFormKey;
  inputs: Array<{ itemKey: StableFormKey; count: number }>;
  conditions: NormalizedCondition[];
  outputFacts: CatalogOutputFacts;
}
~~~

## 5. Professional classification

~~~text
COBJ + output facts
   |
   v
classification rules
   |
   +-- profession
   +-- rank
   +-- category
   +-- material
   +-- station
   +-- guild/membership
   +-- workflow
   |
   v
ProfessionCraftMapping
~~~

## 6. Modelo normalizado

~~~ts
interface CraftRecipeDefinition {
  definitionId: string;
  recipeKey: StableFormKey;
  outputKey: StableFormKey;

  profession:
    | "blacksmith"
    | "cook"
    | "tanner"
    | "tailor"
    | "artificer";

  requiredRank:
    | "novice"
    | "apprentice"
    | "adept"
    | "expert"
    | "master";

  stationTypes: string[];
  workflowProfileId: string;
  outputCount: number;
  inputs: CraftInputDefinition[];
  categoryTags: string[];
  materialProfileId?: string;
  membershipRequirements?: string[];
  normalizedConditions: NormalizedCondition[];
  globallyEnabled: boolean;
  classificationConfidence: "auto" | "override";
}
~~~

Alquimia/Encantamento usam catálogos próprios de seus sistemas externos.

## 7. Regras de classificação

Prioridade:

1. override explícito;
2. receita/COBJ + bench;
3. output keywords/type/material;
4. source/plugin rules;
5. conditions;
6. unresolved.

Nunca usar fallback genérico para Ferreiro ou Artífice.

## 8. Ferreiro

Candidates:

- armas;
- flechas;
- Heavy Armor;
- ferramentas/kits pertinentes;
- materiais definidos pela progressão.

O rank final obedece à progressão consolidada, não à cadeia vanilla automática.

~~~text
Iron -> Novice
guild Heavy Armor -> Apprentice + membership
Steel -> Adept
Steel Plate -> Expert
Nordic/Dwemer/Orcish -> Master gate
~~~

## 9. Curtidor

Candidates:

- light equipment;
- hide/leather categories;
- kits pertinentes;
- guild Light Armor;
- Elven;
- cultural Master mappings conforme design.

O plano específico do Curtidor é autoridade sobre workflow.

## 10. Cozinheiro

Classificar apenas recipes destinadas ao ofício integrado de cozinha e bebidas:

- simple/grilled;
- vegetable stews;
- meat stews;
- demais foods autorizados;
- bebidas fermentadas simples;
- mead/hidromel;
- wine;
- alcohol/destilados/bebidas fortes;
- bebidas premium/envelhecidas;
- receitas raras aprovadas;
- Skooma quando definida e marcada como conteúdo ilegal de Mestre.

A classificação precisa carregar `activityRank` coerente com a progressão do Cozinheiro para que autorização, XP, Vigor e visibilidade de recipe usem a mesma carreira.

Skooma deve possuir flag/policy própria que desabilite benefícios de preservação de ingrediente e duplicação de output.

Não assumir que todo record de comida ou bebida pertence ao Cozinheiro sem recipe/mapping.

## 11. Alfaiate

Candidates:

- clothing;
- cloaks;
- fur accessories;
- hoods;
- guild clothes;
- noble clothing;
- explicitly mapped mod clothing.

## 12. Artífice

O Artífice exige classificação transversal.

Candidates podem incluir:

- hoes;
- lanterns;
- torches;
- masks/bandanas;
- satchels;
- backpacks;
- rings;
- necklaces;
- amulets;
- kitchen utensils;
- crests/insignia;
- tiaras;
- soul gems conforme progressão;
- outros objetos utilitários/decorativos aprovados.

Como essas categorias podem usar workstations diferentes, cada recipe declara stationTypes.

## 13. Workstation não define profissão sozinha

Uma recipe em Forge não é automaticamente Blacksmith.

Uma recipe em Tanning Rack não é automaticamente Tanner.

~~~text
bench = Forge
output = Lantern
profession mapping = Artificer
=> Artificer recipe at Forge
~~~

Esse princípio é essencial para o Artífice.

## 14. Conditions

Conditions vanilla/mods devem ser normalizadas.

Algumas podem ser:

- convertidas em requirement;
- avaliadas via condition engine;
- substituídas por regra profissional;
- marcadas unsupported.

Não ignorar silenciosamente conditions desconhecidas.

## 15. Membership

Mappings de guilda preservam a intenção, mas o catálogo não persiste boolean stale do personagem.

## 16. Material profiles

Material profile pode ser derivado por:

1. override;
2. output keyword;
3. known material mapping;
4. explicit source rule.

Se não puder ser determinado com segurança, a recipe fica unresolved.

### 16.1. Receitas de kits de manutenção (DurabilitySystem)

A fonte de verdade dos kits e seus materiais é `modules/durability-system/config/maintenance-config.json`: `maintenance.kits.weapons` e `maintenance.kits.armor`, indexados por `materialKey` e com `stableId` próprios. Não criar uma taxonomia paralela nem deduzir automaticamente um ingrediente pelo texto do nome do material.

**Balanceamento aprovado:**

- Kit de armas com lingote correspondente validado: **2 lingotes do material/tier do kit + 3 Leather Strips**.
- Kit de armaduras com lingote correspondente validado: **2 lingotes do material/tier do kit + 2 Leather + 2 Leather Strips**.
- Kit de armadura `armor.leather` ou `armor.hide`: **6 Leather + 3 Leather Strips**.
- Cada recipe produz **1 kit**. Ao ativar esse MISC, o DurabilitySystem concede **50 cargas**, segundo sua própria configuração; crafting não concede cargas diretamente.

O Housecarl/RecordCatalog deve resolver ingrediente por `StableFormKey` e validar winning record; material sem lingote correspondente confirmado permanece com **receita UNRESOLVED**, sem criar substitutos por suposição. O kit de manutenção continua existindo e com sua mecânica intacta.

O ProfessionCraftMapping, a workstation, o rank e demais gates existentes continuam determinando quem pode produzir cada kit; não classificar automaticamente toda armadura como Ferreiro. Custos devem pertencer à camada de definitions/overrides do CraftingSystem e não ao código de combate.

Especificação normativa: [KIT_RECIPES_AND_BALANCE.md](../../durability-system/docs/KIT_RECIPES_AND_BALANCE.md). **Esta seção é documentação para implementação futura das receitas**, não declaração de COBJ executáveis já criados.

## 17. Camada de balanceamento das receitas

Housecarl/COBJ é a fonte de descoberta estrutural da receita, mas **as quantidades vanilla/mod não são obrigatoriamente o balanceamento final do Aetherius**.

O catálogo normalizado deve suportar uma camada explícita de override econômico.

Exemplo conceitual:

~~~ts
interface MaterialConversionProfile {
  id: string;
  input: StableFormKey;
  output: StableFormKey;
  inputCount: number;
  outputCount: number;
}

interface SetCostProfile {
  id: string;
  materialProfileId: string;
  totalPrimaryMaterial: number;
  secondaryMaterials?: Array<{
    materialProfileId: string;
    total: number;
  }>;
}

interface RecipeBalanceOverride {
  recipeDefinitionId: string;
  inputs?: CraftInputDefinition[];
  outputCount?: number;
}
~~~

Baseline atual:

~~~text
ore-to-ingot:
  3 ore -> 1 ingot

animal-hide-to-leather:
  3 hides -> 1 leather

metal full set:
  30 ingots

leather full set:
  30 leather

pure-hide full set:
  15 leather + 5 hides
~~~

A composição econômica do set completo é armadura, peito, bota, luva e escudo.

O orçamento total é distribuído entre as recipes individuais por configuração.

### 17.1. Regra de prioridade

Para custos econômicos:

1. override explícito de recipe/set da release;
2. profile de balanceamento Aetherius;
3. COBJ descoberto via Housecarl como baseline estrutural;
4. unresolved se a receita não puder ser normalizada com segurança.

O sistema não deve voltar silenciosamente a custos vanilla quando existir um profile Aetherius aplicável.

### 17.2. Ajustes sem recompilação

Deve ser possível alterar posteriormente:

- taxa de conversão;
- custo total de set;
- custo por peça;
- ingrediente secundário;
- output count;
- recipe enable/disable;

sem alterar código do domínio.

## 18. Mods e patches

Usar winning record.

Se patch altera ingredients, bench, keyword ou output facts, o catálogo precisa refletir o vencedor da release.

## 19. Overrides

Overrides usam StableFormKey/EditorID, nunca posição de plugin.

## 20. Unresolved report

Toda geração deve listar:

- recipe sem profissão;
- output sem material;
- station desconhecida;
- condition unsupported;
- duplicate classification;
- missing form;
- missing master;
- disabled by gate.

Unresolved não entra silenciosamente na UI.

### Auditoria completa de armas/armaduras sem material identificado

Na futura implementação do mapeamento da load order, gerar e **comunicar ao responsável pelo projeto a lista completa**, sem amostragem ou truncamento, de **todos os registros `WEAP` e `ARMO` elegíveis cujo material não foi identificado de modo confiável**, incluindo conteúdo vanilla, DLCs, mods e winning records de patches.

Cada item não classificado deve constar individualmente com `StableFormKey`, tipo de record, `EditorID`/nome quando disponíveis, plugin vencedor, dados/keywords examinados e motivo da impossibilidade de classificação. Entregar também os totais analisados, classificados e não classificados por categoria, a identificação da load order/catálogo auditado e uma declaração explícita de zero pendências caso a lista esteja vazia. O relatório **deve ser apresentado integralmente ao responsável**, e não apenas armazenado em logs ou resumido em contagens.

**Separar estes equipamentos sem `materialKey` reconhecido** das recipes cujo ingrediente correspondente não foi validado: são duas situações diferentes. Preservar `UNRESOLVED`/estado equivalente, sem atribuir material por suposição. Ver também [KIT_RECIPES_AND_BALANCE.md](../../durability-system/docs/KIT_RECIPES_AND_BALANCE.md).

## 21. Assinatura

~~~text
CraftingCatalogSignature =
 hash(
   COBJ winners
   + relevant output winners
   + professional mappings
   + workstation mappings
   + overrides
 )
~~~

## 22. Golden tests

Manter fixtures para provar:

- item de mod continua na mesma profissão após reorder;
- ESL resolve;
- patch de COBJ altera inputs;
- Artífice recipe em Forge não vaza para Ferreiro;
- Blacksmith recipe não vaza para Artífice;
- guild recipe mantém membership;
- Master gate desabilita execução;
- missing plugin remove recipe com reason;
- 3 Iron Ore resolvem para 1 Iron Ingot no profile padrão;
- set metálico completo soma 30 ingots;
- set de Couro completo soma 30 leather;
- set de pele pura soma 15 leather + 5 hides;
- alteração de balanceamento muda custos sem alterar código;
- recipes de kits de manutenção usam os `materialKey` e `stableId` existentes do DurabilitySystem;
- recipes com lingote validado exigem os insumos aprovados, e as de `armor.leather`/`armor.hide` exigem 6 Leather + 3 Leather Strips;
- recipe sem ingrediente correspondente validado permanece UNRESOLVED, sem criar COBJ ou substituto fictício.

## 23. Resultado

O catálogo deve permitir atualizar a load order sem espalhar IDs e categorias manuais pelo código, mantendo revisão explícita sobre ambiguidades.
