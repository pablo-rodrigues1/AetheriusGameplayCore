# AetheriusDurabilitySystem

Módulo de domínio responsável por manutenção/cobertura por cargas de combate para Aetherius/SkyMP.

> [!IMPORTANT]
> A integração de produção segue [a arquitetura canônica](../../docs/architecture/AETHERIUS_GAMEPLAY_CORE_ARCHITECTURE.md). O módulo é owner de saldo/ciclo/cobertura; inventário continua no Host e a aplicação final do modificador pertence ao Damage. Campos como `authority: "server"` são metadados legados e **não autenticam um evento**.

## Estado da entrega

Implementado no pacote:

- configuração única e validada em `config/maintenance-config.json`;
- reservas por personagem, categoria e material;
- ativação transacional de kits com limite, remoção do item e idempotência;
- persistência SQL legada do módulo; a produção deve migrar para o kernel PostgreSQL/UnitOfWork do GameplayCore sem criar segundo inventário;
- ciclos de combate sem consumo por equipamento equipado, tempo conectado ou exploração;
- última carga válida até o fim do ciclo;
- multiplicadores autoritativos de armas e contribuição de Armor Rating;
- bridge de custom packets SkyMP sem aceitar saldo, material ou multiplicador do cliente;
- painel `MANUTENÇÃO` e serviço TypeScript de cliente;
- migração SQL, testes funcionais/concurrency/security e benchmark sintético.

Pendente para ativação de produção:

- integrar o provider de manutenção ao Damage por snapshots em RAM;
- implementar/validar `InventoryTransactionPort` com item instance e prepare/commit/recover/cancel;
- receber atividade eficaz apenas de `NativeCombatPort`/contexto autorizado, nunca de indicação client;
- migrar saldo/reservas para o kernel PostgreSQL do GameplayCore;
- criar os registros MISC necessários e incluí-los no RecordCatalog;
- manter UI como projection/command route do AetheriusUI_Core.

Esses pontos permanecem explícitos porque o pedido restringe edições a esta pasta e os três repositórios remotos não puderam ser verificados integralmente. O cliente local disponível identifica hits, mas o servidor local os trata como evidência de cliente, não como autoridade de dano.

## Uso local

```text
npm run validate
npm test
npm run benchmark
```

O benchmark é uma medição de domínio em memória, não um teste de produção com 100/300/500 conexões de rede, MySQL e Skyrim carregado.

## Contrato autoritativo

O adapter de produção só pode registrar um evento depois de recebê-lo de uma capability nativa autorizada. O formato legado abaixo é apenas DTO interno; `authority` não é prova de origem:

```js
await bridge.recordEffectiveEvent({
  authority: 'server', // metadata legacy; nunca usado como autenticação
  characterId,
  actorId,
  eventId,
  type: 'weapon_hit',
  physicalWeapon: true,
  weaponMaterials: ['steel']
});
```

Tipos aceitos:

- `weapon_hit`: arma física efetivamente usada; suporta dual wield por lista de materiais;
- `physical_damage_received`: só materiais das peças cuja contribuição defensiva foi realmente usada;
- `shield_block`: somente o material do escudo quando o bloqueio foi efetivo.

Em produção, o consumo exige evento proveniente do NativeCombatPort, `eventId` idempotente e material classificado. O valor textual de `authority` sozinho nunca autoriza consumo. Eventos mágicos ou rejeitados não consomem cargas.

## Configuração

O administrador edita somente `config/maintenance-config.json` e executa o reload explícito do `configStore`. Penalidades são multiplicadores da contribuição de arma/Armor Rating; a curva final de redução não é alterada nem penalizada novamente.

Cada kit MISC (12 de armas e 18 de armaduras) concede **50 cargas** por ativação. O limite existente de 100 cargas por categoria/material, a lógica de consumo por ciclo e os visuais de cada kit permanecem inalterados. As receitas aprovadas e o vínculo com os identificadores de materiais existentes estão documentados em [KIT_RECIPES_AND_BALANCE.md](docs/KIT_RECIPES_AND_BALANCE.md); não foram criados COBJ/ingredientes executáveis neste ajuste.

Alterar `charges` afeta novas ativações. Reservas já adquiridas permanecem com o valor salvo. FormIDs `null` são intencionais até o patch Housecarl ser criado e lido de volta.

## Integração

Consulte:

- `IMPLEMENTATION_REPORT.md` — relatório técnico e limitações;
- `docs/KIT_RECIPES_AND_BALANCE.md` — receitas, cargas e integração futura ao CraftingSystem;
- `docs/INTEGRATION_CONTRACT.md` — pontos reais observados no servidor/cliente local;
- `database/001_aetherius_durability.sql` — migração no banco existente;
- `patching/housecarl-source-records.json` — fontes verificadas para os modelos MISC dos ícones;
- `ui/maintenance-panel.js` e `ui/maintenance-panel.css` — aba MANUTENÇÃO;
- `client/src/services/services/AetheriusDurabilityService.ts` — listener de custom packets.
