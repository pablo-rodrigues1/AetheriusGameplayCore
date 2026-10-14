# AetheriusDamageSystem

> [!IMPORTANT]
> O código e os patches deste módulo registram a implementação experimental anterior à arquitetura canônica. Para integração futura, use [AETHERIUS_GAMEPLAY_CORE_ARCHITECTURE.md](../../docs/architecture/AETHERIUS_GAMEPLAY_CORE_ARCHITECTURE.md): Damage continua owner do cálculo, mas Host Combat/Effects/Resource APIs devem ser públicas, mínimas e versionadas. Patches históricos não são o contrato final.

Motor de combate nativo experimental e patches de integração para a Base Aetherius e ClassSystem. **Legacy permanece padrão; ainda não é release de produção.**

O núcleo implementa profiles exatos/revisionados, identidade estável, curva de armadura, dano físico, seis Masteries verificadas por Housecarl, providers, cache, trace, componentes mágicos e efeitos por instância. A integração nativa e os limites estão detalhados em [IMPLEMENTATION_STATUS](docs/aetherius-combat/IMPLEMENTATION_STATUS.md).

Na entrega experimental original, as alterações foram mantidas inteiramente nesta pasta e integrações externas foram registradas em `integration/`. [INTEGRATION](docs/aetherius-combat/INTEGRATION.md) preserva esse caminho apenas como referência histórica; novas integrações devem seguir a Host API canônica. [HOUSECARL_RECORD_AUDIT](docs/aetherius-combat/HOUSECARL_RECORD_AUDIT.md) registra origem, winner, conditions e tradução; [VALIDATION](docs/aetherius-combat/VALIDATION.md) separa testes executados de verificações bloqueadas.

## Contrato conceitual com o RefinementSystem (tiers persistentes)

O [RefinementSystem](../refinement-system/README.md) define Tier 0/I/II/III por **instância de equipamento**, com bônus sobre a base autorizada de **0% / +25% / +50% / +75%**. Em cada golpe físico, a arma efetivamente usada contribui com sua base refinada; em cada dano físico recebido, armaduras e escudos efetivamente considerados contribuem com o Armor Rating base refinado de cada instância.

**Ler/aplicar o tier em cada cálculo não é consumir o tier.** Ele deve permanecer inalterado após qualquer número de golpes, defesas, bloqueios, mortes, trocas de equipamento ou eventos de manutenção. Na mecânica de refino, o tier apenas aumenta com sucesso de aprimoramento ou regride um nível na falha total da tentativa para o próximo tier. **Não criar contador de hits, charges, consumo por golpe ou mutação de tier no pipeline de combate.**

A regra "aplicar uma vez" significa **evitar multiplicação duplicada dentro de cada cálculo**, não limitar a aplicação a um único ataque. Para evitar double-dip, o DamageSystem deve resolver a instância autoritativa, receber tier/base refinada por provider confiável, preservar provenance e aplicar seu fator apenas uma vez à **base elegível**, sem reaplicá-lo se a base já chegou refinada. Alterações por sucesso/falha de refino exigem atualização/revisão do snapshot/cache; hits não consultam o banco nem persistem/decrementam o tier. Penalidades e cargas do DurabilitySystem são independentes.

**Estado real:** a integração experimental ainda possui provider de refino neutro e carece de identidade persistente de item no Host Inventory. Este texto é a **especificação desejada**, não uma alegação de funcionamento atual. Ver [estado da implementação](docs/aetherius-combat/IMPLEMENTATION_STATUS.md) e [fórmulas auditáveis](../../docs/mechanics/04_COMBATE_FORMULAS.md).

Teste local TypeScript: `npm ci` e `npm test`.

Teste local C++: disponibilizar nlohmann/json v3.11.3 em `JSON_INCLUDE` (ou `.deps/json/single_include`), depois executar `cmake -S . -B build`, `cmake --build build` e `ctest --test-dir build --output-on-failure`. Windows MinGW: selecionar `-G "MinGW Makefiles"`. O teste Prometheus é adicional e exige os headers da mesma versão da Base e suporte a `std::mutex`.

As pesquisas originais abaixo/na raiz permanecem como referências históricas; o audit dos plugins instalados prevalece sobre descrições públicas.
