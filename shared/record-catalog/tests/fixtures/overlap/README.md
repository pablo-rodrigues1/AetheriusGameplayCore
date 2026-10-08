# Fixture de sobreposição — B2-fix1

Derivada de `_work/exports/` (A2). Mantém o ativador do Guerreiro, seu SPEL e
seu MGEF com os campos exportados. Uma raça jogável mantém Flags e Starting,
mas seu ActorEffect é substituído **somente nesta fixture** pelo feitiço do
Guerreiro. MUNDUS é vazio para restringir o cenário ao record compartilhado.
Os manifests conservam o epoch e ajustam row_count às linhas selecionadas.

O builder gera os dois domínios já existentes, standing-stones e races. O
teste carrega cada um com uma resolução numérica diferente e compõe suas
referências no ActorState com origens STANDING_STONE e RACE. Esta fixture
não representa grants de raça instalados nem certifica resultado de efeitos.
