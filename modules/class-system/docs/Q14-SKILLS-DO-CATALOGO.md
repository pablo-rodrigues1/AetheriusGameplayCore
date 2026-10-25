# Skills cumulativas das classes (Q14)

A fonte oficial das skills é o campo textual skills em modules/class-system/config/classes-config.json. A decisão Q14 do dono, de 24/10/2026, define o acúmulo: cada etapa atualiza somente as skills citadas; as omitidas conservam o valor da etapa anterior. Uma etapa vazia conserva todos os valores.

O gerador tools/catalog/classes.ts transforma essa fonte em stages[].skills numérico em catalog/classes.json. Cada marco contém o valor final de todas as 18 skills, usando os nomes estáveis de ActorValue listados abaixo. “Todas N” define N para as 18 skills. Um nome que não esteja na tabela causa erro de geração; nenhuma entrada é descartada.

| Texto da configuração | ActorValue |
| --- | --- |
| Uma-Mão | OneHanded |
| Duas-Mãos | TwoHanded |
| Arquearia | Marksman |
| Bloqueio | Block |
| Armadura Pesada | HeavyArmor |
| Armadura Leve | LightArmor |
| Furtividade | Sneak |
| Alteração | Alteration |
| Conjuração | Conjuration |
| Destruição | Destruction |
| Ilusão | Illusion |
| Restauração | Restoration |

O catálogo também inclui as outras skills em cada estágio, iniciadas em zero e atualizadas por “Todas N” quando aplicável: Smithing, Pickpocket, Lockpicking, Alchemy, Speechcraft e Enchanting.

A assinatura do domínio classes cobre o conteúdo completo do catálogo e muda quando as skills numéricas são adicionadas. As assinaturas dos records continuam sendo calculadas pelo conteúdo do record e fingerprint do plugin; classGrants persiste essa assinatura de record em DefinitionRef.catalogSignature. As skills de classe não alteram records nem a assinatura usada nos grants.
