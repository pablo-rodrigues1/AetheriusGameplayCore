# D6 — Catálogo de records e leitura dinâmica

Estado: **decidida** pelo dono do projeto em 07/10/2026.

## Contexto

As definições de raças, pedras, perks e feitiços vêm dos plugins da load order (424 no perfil oficial). O record que vale é o vencedor: o conteúdo pode vir de um plugin diferente do que define a identidade. Os feitiços das pedras, por exemplo, são definidos em `Skyrim.esm` e vencidos por `Mundus.esp`; as dez raças jogáveis são de `Skyrim.esm` e vencidas por `AETHERIUS - BALANCE.esp`.

A proposta anterior bloqueava o catálogo inteiro quando a load order divergisse de um manifesto global. O dono do projeto determinou o contrário: a leitura precisa ser dinâmica e resistir a mudança de posição dos plugins, e os plugins relevantes para os sistemas do jogador são tratados como estáveis.

## Decisão

1. **Instância oficial:** `C:\Modding\MO2`. É dela que saem os exports.
2. **Identidade:** plugin de definição mais FormID local (`StableFormKey`). Nunca FormID de runtime, índice de plugin ou posição.
3. **Resolução dinâmica:** o FormID de runtime é obtido no boot, para a load order ativa, pelo nome do plugin (`mp.getIdFromDesc` no gamemode). Mudar um plugin de posição, ou um plugin leve de slot, não altera o resultado.
4. **Conteúdo:** o catálogo é gerado offline, a partir do export do houseCARL, com o conteúdo do vencedor de cada record.
5. **Conferência por plugin relevante:** cada feature declara os plugins de que depende. No boot, o catálogo confere a presença e a assinatura (tamanho e CRC32) só desses plugins. Plugin ausente ou diferente deixa a feature dependente em `UNSUPPORTED`; as outras seguem. A load order como um todo não é conferida.

## Grafias

Hoje convivem quatro grafias para o mesmo record:

| Onde | Grafia |
|---|---|
| Contratos do Core | `plugin|XXXXXX`, plugin em minúsculas |
| Export do houseCARL | `XXXXXX:Plugin.esp` |
| Damage em C++ e a configuração do spike S3 | `Plugin.esp:XXXXXX` |
| SkyMP (`getIdFromDesc`) | `hex:Plugin.esp` |

A canônica é a dos contratos. O catálogo oferece conversores testados nos dois sentidos para as outras três; nenhum outro código converte por conta própria.

## Consequências

- Saber se o plugin de definição é leve é necessário para validar a faixa do FormID local; esse dado vem do catálogo.
- O servidor não enumera armas e armaduras pela indexação atual (spike S3); o catálogo passa a ser a fonte dessas listas.
- Camadas de runtime do cliente (SkyPatcher, SPID, KID) não aparecem nos plugins. Se alterarem um record de que uma feature depende, isso precisa ser declarado caso a caso.
- Aceite da fundação B2: teste no servidor local com a load order reordenada, um plugin relevante movido de posição e um plugin leve trocando de slot, com todos os records resolvendo igual.

## Evidência

Ordem A2 (exports e reconciliação: os dois perfis oficiais e o MO2 local têm a mesma lista, tamanho e CRC32); auditoria A1, item 9; spike S2 (13 pedras resolvidas no host por nome de plugin); revisões da A5 e do spike S3.
