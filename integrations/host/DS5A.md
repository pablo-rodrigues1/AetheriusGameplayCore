# DS-5a — pacote do host e rollback

Fonte normativa: modules/damage-system/docs/FONTES_E_DONOS.md §14 e docs/operations/ATIVACAO_DOS_SISTEMAS.md §2/4/5/9.

Gerar/provar sem commits: node integrations/host/make-package.mjs --server <clone-host> --prove <pasta-vazia-fora-de-repo>.
O pacote é contra 6181abf1774c31a4e93206f71b784af5b13f10ae e contém também as alterações aprovadas anteriores da árvore local, classificadas separadamente em features.json. O instalador deve aplicar o patch sobre o estado mais recente do oficial e parar em conflitos; não copiar por cima arquivos inteiros do mantenedor. Nenhum binário/configuração do servidor local viaja no patch. Build/teste em máquina limpa e teste com servidor local não foram executados nesta ordem.

Compilar a integração com o toolchain existente. Nesta máquina, usar a junção C:/Code/AetheriusSkyMP/aetherius-server por causa do libpq/vcpkg e saída build/ds5a-server. O runner em _work/evidence/DS-5a/run-native.py registra OutDir/IntDir/targets isolados e desabilita eventos de pós-build para preservar build/dist.

DS-5a acrescenta os headers ds5a/{Physical,Bridge,Host}.h e CombatProfileBinding.h; liga somente os bindings e a fórmula em ScampServer/PropertyBindingFactory. O núcleo está espelhado no Core. Sem families/shadow, a cadeia atual é preservada. Com families em shadow, publicar o novo bundle do Core (o catálogo só é aceito uma vez por boot); getAetheriusCombatCapabilities deve registrar NATIVE_SERVER como owner aplicado e AETHERIUS_SERVER como candidato. active retorna UNSUPPORTED até DS-7. Desligar: families off/ausente em janela autorizada e reiniciar; não há migration para reverter.

Roteiro nativo com servidor local: runtime/tests/ds5a-host.mjs --help (não executado pelo implementador). Ele exige porta diferente de 7777, pasta vazia fora de build/dist, addon, data-dir e chaves estáveis de fonte NPC_, alvo NPC_ não AutoCalcStats e WEAP. Usa o host compilado e bot nativo, sem substituir fórmula ou resultado. Ele falha explicitamente se o perfil não fornecer os dados. A validação em jogo e com dois clientes continua pendente da DS-6/DS-7.
