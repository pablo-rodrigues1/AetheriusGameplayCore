# Integração histórica preparada

> [!WARNING]
> **Caminho histórico de integração.** Os passos abaixo documentam o overlay experimental original e não são a estratégia canônica atual. Novas integrações devem expor Host APIs públicas/versionadas conforme [a arquitetura canônica](../../../../docs/architecture/AETHERIUS_GAMEPLAY_CORE_ARCHITECTURE.md). Não aplicar este patch como substituto de uma Host API formal.

> [!IMPORTANT]
> Este arquivo descreve o caminho de integração preparado antes da arquitetura canônica de 05/10/2026. **Não use `integration/base-aetherius.patch` como plano atual de produção.** O caminho normativo é expor/consumir uma Host API pública, mínima e versionada conforme [a arquitetura canônica](../../../../docs/architecture/AETHERIUS_GAMEPLAY_CORE_ARCHITECTURE.md). Os passos abaixo permanecem somente como referência/reprodução da baseline histórica.

Todos os arquivos desta entrega permanecem no DamageSystem. Os patches não foram aplicados a uma Base externa. Só habilitar em ambiente de teste depois da build nativa e dos itens de IMPLEMENTATION_STATUS.md.

Base alvo: `e1c483346447c29972cabf28b17eb5febc91bd04`. ClassSystem alvo: `c9d811f10524c27648db552f6185433df917f67d`. Para HEADs posteriores, revisar/adaptar os patches, preservando alterações existentes.

Em um checkout dedicado **apenas para reproduzir a integração histórica**:

1. Aplicar `integration/base-aetherius.patch` na raiz da Base, após `git apply --check`. Para a implementação corrente, substituir este acoplamento por NativeCombatPort/ResourcePort/ActiveEffectsPort públicos e versionados.
2. Copiar a árvore `server/server/cpp/server_guest_lib/aetherius_combat/` para o mesmo caminho na Base. O GLOB_RECURSE já integra os arquivos C++; não acrescentar um target paralelo.
3. Copiar `server/server/gamemode/modules/aetherius-combat.js` e `integration-tests/LegacyDamageGoldenTest.cpp` para `server/server/gamemode/modules/` e `server/unit/` na Base.
4. Aplicar `integration/class-system.patch` na raiz do ClassSystem, após `git apply --check`.
5. Copiar `class-system/server/combatProfileAdapter.ts` para `server/`, `class-system/tests/combatProfile.test.ts` para `tests/` e `server/server/config/verified-perks.json` para `config/` do ClassSystem.
6. No **server-settings carregado antes do ScampServer**, carregar o objeto de `aetherius-combat.json` sob `aetheriusCombatSettings` e o objeto de `verified-perks.json` sob `aetheriusCombatCatalog`. Não passar paths nem inicializar a fórmula depois pelo gamemode. Configuração padrão desta entrega é `legacy` e `enabled=false`.
7. Compilar e executar a Base com seu toolchain/submódulos originais. Reutilizar Settings.loadOrder/manifestGen e a conexão Prometheus existente.

O catálogo é específico para o arquivo auditado e seus winners. Startup compara CRC32/size com o loader já existente e verifica plugin vencedor/EditorID. Nova load order ou plugin atualizado deve passar por nova auditoria. `npm run catalog` compila apenas os metadados de Housecarl salvos; não faz descoberta fictícia ou scan no hot path.

Para laboratório físico, configuração `mode=aetherius`, `enabled=true` exige profiles válidos para atacante e defensor e equipamento suportado. Spells, enchanted armor, fontes não equipadas, perks sem handler e NPCs sem profile falham claramente. Não ativar esse modo para uma sessão geral de jogo nesta entrega. O controle de lifecycle é `ENABLE_AETHERIUS_COMBAT=true`, consistente com os settings nativos.

Rollback: voltar a `mode=legacy` (ou `enabled=false`) nos settings e reiniciar. A cadeia original TES5 -> DamageMult -> SweetPieDamage -> SweetPieSpell -> DamageMultConditional permanece no ramo legacy; nenhuma dessas camadas é empilhada depois do Aetherius.

`npm run prepare-integration` sincroniza overlays e gera patches **somente nas cópias internas `.reference/`**, verificando os HEADs e a reversão dos diffs. Ele pressupõe que as mudanças dos patches já estejam nessas cópias; não é instalador para projetos externos.

O ClassSystem mantém a progressão. O adapter recomputa skills de configuração antes da fronteira nativa, resolve nomes de perks no catálogo verificado e publica revision acima tanto do valor persistido quanto do valor nativo. Reconnect não rebaixa revision. Incompatibilidade de perk após leitura de progressão propaga erro sem substituir a classe persistida por defaults de um personagem novo.

Providers futuros devem implementar as interfaces C++, registrar somente resultados de item/ator já autorizados e invalidar a revisão quando esses resultados mudarem. Para refino, primeiro implementar a identidade persistente de instância no inventário. Depois, o provider deve resolver o tier persistido da instância em cada snapshot e aplicar sua contribuição em **todo** hit físico/defesa elegível, sem consumo ou decremento do tier. "Uma única vez" significa uma única incidência de bônus **por cálculo**, não um único golpe na vida útil do item. Apenas sucesso ou falha total da tentativa de refino altera o tier; invalidar/revisionar o provider após essa transição. O engine não consulta profissão, XP, receita ou banco por hit.
