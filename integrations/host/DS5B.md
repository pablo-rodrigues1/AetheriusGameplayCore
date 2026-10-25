# DS-5b — entrega parcial em shadow

Base do pacote: 6181abf1774c31a4e93206f71b784af5b13f10ae.

Perks CLASS compiladas, nove condições, RNG crítico e confirmação limitada de forte/NPC.
Sem nova opção: families continuam off por omissão; active exige DS-7.
Bash tem confirmação, mas fórmula UNSUPPORTED. Operações não comutativas em grupo
ficam UNSUPPORTED até prova da prioridade do motor. Q16 zero declarado; furtivo Q9 inativo.

Não instalar sobre arquivos inteiros: aplicar changes.patch contra a base limpa e conferir
manifest/hash. make-package.mjs gera as cópias e a prova; clone limpo conferido na evidência.
Saídas isoladas em aetherius-server/build/ds5b-server, pelo caminho sem espaços.
Nenhum addon/bundle instalado, servidor iniciado/parado ou opção local alterada.

Leia modules/damage-system/docs/FONTES_E_DONOS.md §15 e o relatório DS-5b para a cobertura,
os dez dourados PENDING e o que precisa do revisor/dono. LEIA-ME.md foi preservado para
a ordem paralela DS-5a-fix1. Não há validação em jogo nesta entrega.
