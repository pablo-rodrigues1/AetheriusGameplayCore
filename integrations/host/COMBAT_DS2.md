# Catálogo combat: integração pendente com o host (DS-2)

A DS-2 entrega definições no Core; a substituição no consumidor C++ pertence à
DS-5. O host e seus settings não foram alterados nesta ordem.

## Mapa de physicalRecords

| Local | Uso atual |
|---|---|
| aetherius-server/server/cpp/addon/ScampServer.cpp e cópia histórica em files/ | Lê aetheriusCombat.physicalRecords ao criar a fórmula de shadow; exige array de até 4096 chaves Plugin:FormID local |
| aetherius_combat/AetheriusDamageFormula.h/.cpp e cópias em files/ | Recebe a lista no construtor e prepara WEAP/ARMO pelo browser; o caminho de hit consulta essa tabela |
| files/server/cpp/server_guest_lib/aetherius_combat/README.md | Exemplo de dois itens de laboratório e limitações do spike A6-S3 |
| LEIA-ME.md e changes.patch | Documentam/transportam a mesma integração histórica |
| runtime/src e tools/catalog do Core | Não consumiam physicalRecords; o runtime agora resolve combat por createFileHost no boot |

As cópias em files/, changes.patch e manifest.json continuam como o pacote
histórico, sem divergência de hashes causada por esta documentação. Seu conteúdo
não inclui a ponte do catálogo. Não regerar o pacote a partir do host atual como
parte da DS-2.

## Substituição que cabe à DS-5

1. Receber do RecordCatalog reconciliado no boot um snapshot imutável do domínio
   combat: assinatura do domínio e de cada record, StableFormKey, winner, tipo,
   dados e resolução runtime-local. Manter identidade persistente por plugin de
   definição e FormID local. A API nativa dessa entrega ainda não existe; não
   inventar propriedade mp.set que o host não implementa.
2. Preparar as tabelas C++ de WEAP/ARMO/AMMO/RACE e keywords antes do hit, recusando
   lacuna, tipo inesperado e assinatura incompatível com motivo específico.
   Os números exportados não certificam herança, ENCH nem AttackData ausente.
3. Substituir a seleção manual do construtor/ScampServer pela tabela reconciliada
   e retirar physicalRecords da configuração em uma ordem que possa mudar o host.
   O domínio completo ultrapassa o limite do spike: despejar as chaves em
   physicalRecords não é integração válida. Dimensionar/medir a tabela na DS-5.
4. Usar o perfil único do ActorState (DS-4), sem segundo ActorCombatState/store,
   sem I/O/callback JS no hit. Ausência de perfil/capacidade/semântica continua
   UNSUPPORTED; ownership e modos de aplicação dependem das DS-5/DS-7.

Não há regra de spawn aqui: escolha, geração, respawn e substituição são do
EnemySystem (Q13). O catálogo apenas descreve records.

## Boot do Core depois da DS-2

runtime/build.mjs embute combat.json em BUILD_DOMAINS; runtime/src/index.ts liga
damage ao domínio combat pelo mesmo adapter de arquivos dos outros domínios.
damage.catalog.status informa a reconciliação do catálogo. damage.status continua
UNSUPPORTED, com COMBAT_PROFILE_PROJECTION_NOT_DELIVERED (DS-4) e
NATIVE_COMBAT_CATALOG_BRIDGE_NOT_DELIVERED (DS-5), além de dependências realmente
indisponíveis no ambiente. Nenhum bônus passa a ser aplicado só por carregar combat.

