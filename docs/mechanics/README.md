# Manual de mecânicas e impacto multiplayer

> [!IMPORTANT]
> Este manual continua sendo referência para mecânicas, records e cobertura. Para decisões de arquitetura e implementação atuais, prevalece [a arquitetura canônica](../architecture/AETHERIUS_GAMEPLAY_CORE_ARCHITECTURE.md).

Complemento minucioso do [planejamento holístico](../../AETHERIUS_GAMEPLAY_CORE_PLANEJAMENTO_HOLISTICO.md), produzido em 02/10/2026. A primeira versão tinha inventários e arquitetura, mas não bastava para implementar cada perk: faltavam fichas navegáveis, ligação das classes aos records, decomposição de effects/conditions e casos multiplayer concretos. Este pacote preenche essas lacunas documentais e expõe as lacunas de implementação que continuam abertas.

**Não há ativação de gameplay nesta entrega.** Os fatos são da instância `D:\modOrganizer`, perfil `AETHERIUS - GRAFICO - QUALIDADE`, epoch `e2-ad3c01c2aa184e91`, das baselines de código identificadas na auditoria e das extrações complementares. Uma regra proposta não deve ser confundida com comportamento já executado pelo servidor.

## Feitiços das classes — revisão documental de 14/11/2026

A lista atualizada da planilha, com 164 registros por classe/tier, está em [Feitiços por classe](../classes/FEITICOS_POR_CLASSE.md). Ela registra separadamente o design sincronizado e as divergências dos campos do código; os inventários históricos de records deste manual não foram regenerados.

## Roteiro de leitura

|Documento|O que responde|
|---|---|
|[1. Perks](01_PERKS_FUNCIONAMENTO.md)|O que é concedido, como efeitos são selecionados e por que uma perk visível pode não funcionar remotamente|
|[2. Multiplayer](02_MULTIPLAYER_AUTORIDADE.md)|Quem decide, como um hit atravessa o sistema e como evitar resultados duplicados|
|[3. Conditions](03_CONDITIONS_CONTEXTO.md)|AND/OR, abas, RunOn, parâmetros, estado ausente e oráculos|
|[4. Fórmulas](04_COMBATE_FORMULAS.md)|Cálculo físico/mágico atual, exemplos numéricos, caps e limitações|
|[5. Magia e efeitos](05_MAGIA_EFEITOS.md)|SPEL/MGEF, duração, stacking, procs, enchantments e alchemy|
|[6. Classes e progressão](06_CLASSES_PROGRESSAO.md)|Grants, ranks, respec, skills, party XP, NPCs e durabilidade|
|[7. Persistência](07_PERSISTENCIA_RECOVERY.md)|Identidades, PostgreSQL, transações, reconexão, migração e rollback|
|[8. UI e observabilidade](08_UI_PROTOCOLO.md)|Read models, comandos, feedback, logs e limites operacionais|
|[9. Validação](09_TESTES_MULTIPLAYER.md)|Cenários reproduzíveis e critérios para liberar cada família de mecânicas|
|[10. Cobertura e decisões](10_COBERTURA_DECISOES.md)|O que foi comprovado, o que é proposta e o que ainda bloqueia a entrega funcional|
|[Entry points](ENTRY_POINTS.md)|Contrato e teste específico de cada um dos 71 entry points observados|
|[Índice de perks](PERK_INDEX.md)|1.493 PERKs instaladas, com efeitos, valores, condições e winners|
|[Cadeias mágicas](MAGIC_INDEX.md)|1.540 records mágicos alcançáveis por links extraídos das perks|
|[Classes por estágio](CLASS_STAGES.md)|18 classes e todas as 350 ocorrências de concessão nos estágios|
|[Identidade das concessões](CLASS_PERK_MAPPING.md)|162 nomes de configuração: seis no manifesto histórico, 146 com candidatos por nome e dez sem correspondência exata|
|[Funções CTDA das perks](PERK_CONDITIONS.md)|83 funções, occurrences e referências às fichas que as utilizam|

## Como distinguir evidência de decisão

- **Observado no record:** valor serializado do winner. Não comprova processamento pelo engine, SkyMP ou DLL.
- **Observado no código:** comportamento de uma função da baseline; depende de ela estar conectada ao fluxo real.
- **Proposto:** contrato de implementação, inclusive regras de PvP, stacking, ownership e persistência.
- **Pendente/bloqueado:** falta evidência, contexto ou port público necessário. Não substituir por estimativa silenciosa.

As fichas contêm paths Mutagen para rastreamento, mas não reproduzem descrições promocionais de mods. Campo ausente, null e zero são distintos. `Priority` é preservada sem inventar uma ordem universal de execução do engine. O catálogo de magia segue links disponíveis no recorte extraído; não promete descobrir dependências em PEX, DLL, strings dinâmicas, quests ou assets externos.

## Uso prático

Para analisar uma perk de classe, abra [CLASS_STAGES](CLASS_STAGES.md), siga a chave candidata, leia todos os effects e conditions da ficha e depois siga os links SPEL/MGEF. Confira a operação no [entry point](ENTRY_POINTS.md), seu contexto multiplayer e o cenário de teste. Se a identidade for candidata, a cadeia estiver incompleta ou o servidor não tiver o contexto necessário, registre a feature como indisponível. A descrição apresentada ao jogador só pode prometer o comportamento que passou por esse processo.

As extrações são fatos de uma instalação específica. Qualquer mudança de plugin, patch, SkyPatcher ou DLL relevante invalida a certificação correspondente e exige comparação com o novo manifesto. A [auditoria original](../audit/2026-10-02/README.md) preserva os inventários de todos os 424 plugins, pesquisa dos mods, overrides e testes de baseline.
