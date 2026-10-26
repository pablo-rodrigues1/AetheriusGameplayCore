# Kits de manutenção — receitas e balanceamento

Status: **baseline aprovada em 23/10/2026**. Este documento especifica as receitas a serem integradas ao CraftingSystem; a alteração de cargas já é feita no arquivo de configuração do DurabilitySystem.

## 1. Escopo e fonte de verdade

- O catálogo existente em `modules/durability-system/config/maintenance-config.json` continua sendo a fonte para as 30 definições de kits: 12 de armas (`weapons`) e 18 de armaduras (`armor`).
- Reutilizar exatamente as chaves `maintenance.kits[category][materialKey]` e `kit.stableId`; **não** criar uma segunda taxonomia de materiais, novos kits ou novos aliases para fins de receitas.
- O classificador em `server/material-catalog.js` continua identificando o material a partir de dados autoritativos do equipamento e das keywords. A categoria (arma ou armadura) é informada ao classificador, não inferida por ele.
- O CraftingSystem será o executor das receitas profissionais; o DurabilitySystem permanece owner de ativação, saldo e cobertura dos kits. O Host continua owner do inventário.

## 2. Cargas e comportamento preservado

- **Cada unidade de kit consumida acrescenta 50 cargas** ao saldo da sua combinação `category + materialKey`.
- O limite existente `maxChargesPerBalance = 100` continua em vigor. Ativar um kit requer espaço para **todas** as 50 cargas; não há preenchimento parcial e uma rejeição `CHARGE_LIMIT` não deve consumir o MISC.
- Exemplo: 0 -> 50 -> 100; uma terceira ativação é recusada. Um saldo de 60 também impede ativar um kit de 50.
- Alterar `charges` afeta novas ativações; saldos já existentes permanecem intactos.
- **Não alterar** a lógica atual de consumo por ciclo e combinação categoria/material, inclusive `maxDurationMs = 30000`, `inactivityToCloseMs = 10000`, proteção da última carga até o fim do ciclo e eventos eficazes aceitos pelo servidor.
- Manter a penalidade existente de 30%, as regras de cobertura, de idempotência, de persistência e de notificação.
- **Não alterar visuais**: kits de armas continuam referenciando o Hammer; kits de armaduras continuam referenciando Sylgja's Satchel. Os atuais `iconSource` e registros MISC são preservados.

## 3. Perfis de receita aprovados

Cada receita produz **1 kit MISC** da definição de saída correspondente. Os custos abaixo são defaults econômicos, sujeitos a configuração versionada no CraftingSystem, e não constantes do código de combate.

| Categoria | Critério | Entradas | Saída |
|---|---|---|---|
| Armas | `weapons.<materialKey>` com ingrediente do material validado | 2 × lingote correspondente ao material/tier do kit + 3 × Leather Strips | 1 kit (`50` cargas ao ativar) |
| Armaduras | `armor.<materialKey>` com ingrediente do material validado, exceto couro/pele | 2 × lingote correspondente ao material/tier do kit + 2 × Leather + 2 × Leather Strips | 1 kit (`50` cargas ao ativar) |
| Armaduras de couro/pele | `armor.leather` e `armor.hide` | 6 × Leather + 3 × Leather Strips | 1 kit (`50` cargas ao ativar) |

Neste documento, "tier do kit" designa o **material/categoria do kit**; não se refere aos tiers I/II/III de aprimoramento de itens do RefinementSystem, que permanecem inalterados. O custo aprovado exige um lingote correspondente nos dois primeiros perfis; a ausência desse ingrediente não autoriza substituição automática.

Exemplos:
- `weapon.iron`: 2 × Iron Ingot + 3 × Leather Strips.
- `armor.steel`: 2 × Steel Ingot + 2 × Leather + 2 × Leather Strips.
- `armor.leather` e `armor.hide`: 6 × Leather + 3 × Leather Strips.

As denominações acima são exemplos de apresentação: as referências reais aos ingredientes e aos kits devem ser resolvidas como records da release.

## 4. Resolução de material e ingrediente

Fluxo de authoring/compilação de receitas, **fora** do hot path de combate:

1. Ler os kits atuais de `maintenance.kits.weapons` e `maintenance.kits.armor`. Manter suas categorias, materiais e `stableId`.
2. Obter do catálogo Housecarl/RecordCatalog os winning records dos ingredientes e das saídas `MISC`; identificar cada record por `StableFormKey` (plugin de definição + FormID local), nunca por índice da load order ou Runtime FormID persistido.
3. Resolver uma associação explícita, versionada e auditável `materialKey -> ingredientStableFormKey` para o lingote correspondente quando houver. `Leather` e `Leather Strips` também exigem referências verificadas, sem usar nomes de exibição como IDs.
4. Selecionar `leather/hide` somente quando `category=armor` e `materialKey` for `leather` ou `hide`. Para os demais, aplicar o perfil com lingote **apenas se o ingrediente correspondente estiver validado**.
5. Cruzar `output kit.stableId` com o MISC real (`kit.formId`/RecordCatalog), sem inventar FormIDs. Os `formId: null` atuais não tornam receitas executáveis.
6. Passar a definição ao CraftingSystem para gates de profissão, rank, workstation e condições, mantendo `InventoryTransactionPort`/ledger e a política de balanceamento configurável.

### Materiais sem lingote correspondente verificado

A lista atual inclui casos como `weapon.wood` e kits de armadura de `scaled`, `chitin`, `bonemold`, `falmer` ou `dragonscale`, além de materiais especiais que podem usar recursos diferentes de um lingote convencional (por exemplo, `dragonbone` e `stalhrim`).

**Não inventar lingotes, FormIDs, conversões ou substitutos.** Enquanto não existir associação explícita, validada para o requisito de lingote aprovado, a **receita** respectiva fica `UNRESOLVED`/desabilitada e registrada em relatório. Isso **não remove o kit do DurabilitySystem**, não altera sua classificação de combate, nem muda as 50 cargas quando um kit válido for ativado.

A presença de keywords de material basta para classificar um equipamento no DurabilitySystem, mas **não** comprova qual ingrediente deve ser consumido para fabricar o kit.

### Relatório obrigatório de equipamentos com material não identificado (implementação futura)

Quando o mapeamento de equipamentos for ampliado e integrado ao catálogo de records, **toda execução de varredura deverá gerar e comunicar ao responsável pelo projeto a lista COMPLETA de armas e armaduras cujo material pertinente não pôde ser identificado**. A obrigação inclui equipamentos vanilla, DLCs, mods e patches presentes na load order efetivamente auditada; não se limita aos 30 kits nem aos itens com receitas pendentes.

- Percorrer todos os registros elegíveis `WEAP` e `ARMO` da release, usando os *winning records*. Distinguir a categoria do item e aplicar a classificação de material do DurabilitySystem com os identificadores `materialKey` já existentes.
- Incluir no relatório **cada equipamento sem material confiável**, inclusive quando não houver keyword reconhecida, houver material desconhecido, dados insuficientes ou identificação ambígua. **Não filtrar, amostrar, truncar ou omitir resultados** para apresentar uma lista aparentemente completa.
- Para cada entrada, informar no mínimo: `StableFormKey` (plugin de definição + FormID local), tipo de record (`WEAP`/`ARMO`), `EditorID` e nome (quando disponíveis), plugin vencedor, keywords/dados de material consultados e **motivo específico da falha**. Omitir somente campos comprovadamente indisponíveis, com indicação dessa ausência.
- Produzir contagens auditáveis: total de armas/armaduras analisadas, quantidade classificada, quantidade não classificada e lista detalhada dos não classificados, separados por categoria. Registrar quais plugins/perfil e versão/assinatura do catálogo foram usados. Se não houver falhas, comunicar explicitamente **zero equipamentos com material não identificado**.
- **Entregar a lista integral de forma acessível ao responsável pelo projeto para revisão**, além de persistir o relatório de auditoria. Não considerar apenas logs internos, avisos genéricos ou uma contagem agregada como comunicação suficiente.
- Enquanto não houver material validado, marcar o equipamento como `UNRESOLVED_MATERIAL` (ou estado equivalente) e **não presumir material nem aplicar fallback silencioso**. A eventual decisão de acrescentar mappings será explícita e auditável.

Este relatório trata de **material não identificado do próprio equipamento** e é **distinto** do relatório de receita sem ingrediente/lingote correspondente, que pode ocorrer mesmo quando o material do equipamento já é conhecido. A implementação da varredura e do envio do relatório é futura; esta revisão apenas estabelece o requisito documental.

## 5. Profissões e workstations

- Reaproveitar o `ProfessionCraftMapping` e os gates atuais documentados pelo CraftingSystem.
- Kits de armas devem seguir o mapeamento profissional de fabricação de armas (Ferreiro, quando aplicável); `armor.leather` e `armor.hide` seguem Curtidor. As demais armaduras respeitam sua classificação e os mapeamentos existentes (inclusive tipo de armadura), **sem presumir** Ferreiro apenas pelo uso de lingote ou pela workstation.
- O fato de uma receita usar Forge ou Tanning Rack não concede profissão, rank, acesso à bancada nem outras receitas.
- O servidor revalida materiais, custos, condições, saída e autorização profissional antes da transação. Uma receita unresolved nunca aparece como executável na UI.

## 6. Modelo conceitual de definition (não implementado)

~~~json
{
  "kitStableId": "armor.steel",
  "category": "armor",
  "materialKey": "steel",
  "recipeProfileId": "durability-armor-ingot",
  "outputCount": 1,
  "inputs": [
    { "ingredientRole": "matching-ingot", "count": 2 },
    { "ingredientRole": "leather", "count": 2 },
    { "ingredientRole": "leather-strips", "count": 2 }
  ],
  "resolution": "UNRESOLVED_UNTIL_HOUSECARL_MAPPING"
}
~~~

O `ingredientRole` é uma referência semântica temporária para a compilação. Uma receita só poderá ser habilitada com as respectivas `StableFormKey` de entrada, saída e condições/workstation efetivamente verificadas. Os custos serão dados de configuração, não condicionais hardcoded no DurabilitySystem.

## 7. Validação e testes necessários

**Cobertura da mudança já aplicável ao DurabilitySystem:**
- Existem 12 kits de armas e 18 de armaduras; **todos** declaram `charges = 50`.
- Dois kits ativados em saldo zero totalizam 100; uma terceira ativação é recusada, sem consumir o kit.
- Um saldo preexistente de 60 rejeita mais 50 sem apagar saldo nem item.
- Testes preexistentes de dual wield, consumo por ciclo, magia, último ciclo, reconexão, idempotência, segurança, limites e ícones permanecem com a mesma lógica.

**Aceite futuro da integração de crafting (fora do escopo deste commit):**
- `weapon.iron`: 2 ingots correspondentes + 3 strips; `armor.steel`: 2 ingots + 2 leather + 2 strips; `armor.leather`/`armor.hide`: 6 leather + 3 strips.
- Todas as definições de receita devem apontar para um `kit.stableId` existente na categoria/material correto.
- Ingrediente/kit sem record validado, material ambíguo, falta de rank/profissão ou workstation incompatível impedem execução e geram motivo explícito.
- Reorder de plugins e mods não altera a associação semântica; somente resolução de `StableFormKey` na release.
- Alterar custo em configuração versionada muda a receita efetiva sem alterar a lógica de manutenção.

## 8. Limites desta entrega

Este commit documenta os perfis de receita e atualiza o saldo concedido pelos kits **na configuração existente**. **Não cria registros COBJ ou MISC, não publica novos FormIDs, não implementa crafting runtime e não modifica modelos/ícones, hooks de combate, classificação de equipamentos nem lógica de ciclos.**

Referências: `../README.md`; `../server/material-catalog.js`; `../../crafting-system/docs/ITEM_RECIPE_CATALOG_AND_HOUSECARL.md`; `../../crafting-system/docs/MATERIAL_CONVERSION_AND_RECIPE_BALANCE.md`.
