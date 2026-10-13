# Publicação de perks por ciclo

A reconciliação de SpellProjection no pronto e a recomposição de ClassSystem são solicitantes independentes. Serializar só a leitura/composição ou só o envio não cobre o intervalo entre envio, frame do cliente, ACK e COMMIT.

PerkDelivery mantém uma entrega válida por personagem/ciclo/challenge. Pedidos iguais compartilham essa entrega, também com a varredura desligada. Uma revisão mais nova fica em memória como o último conjunto solicitado; não cria outro id enquanto o ACK da entrega vigente está pendente ou gravando. Após COMMIT, o adapter relê a autoria durável antes de preparar o novo ensure/remove. Pedidos intermediários são substituídos pelo conjunto mais recente. A resposta à publicação continua sendo um recibo de envio/estado, sem esperar um frame do cliente.

O prazo do protocolo continua sendo PERK_ACK_TIMEOUT_MS (10 segundos). Uma entrega expirada permanece SENT_UNCONFIRMED; a reconciliação pode tentar novamente após o prazo. Se há um conjunto aguardando, a expiração permite essa tentativa. Nenhum timeout vira CONFIRMED. Se o COMMIT do ACK falha, a autoria não é publicada, e o prazo continua valendo. Reset do ciclo, unbind e shutdown descartam os pedidos transitórios; uma publicação enfileirada também confere o challenge capturado antes de qualquer I/O. A fila não é persistida nem constitui outro store de grants.

A varredura ainda restaura a classe pelo seu dono. Seu evento de pronto pode primeiro reconciliar o conjunto transitório e depois solicitar a classe restaurada; a entrega desta última aguarda o ACK durável da primeira. AttributeSystem publica máximos nativos e não solicita perks; classes.set e Leveling solicitam refresh depois de seus commits/publicações.

Regressões: runtime/tests/perk-concurrency.test.mjs cobre pronto + refresh, classes.set, XP real de Leveling, publicação de atributos, espera explícita pelo COMMIT e reset de ciclo com ACK antigo. runtime/tests/class-sweep.test.mjs segura o primeiro frame do respawn até o pronto de classes completar, sem afrouxar a asserção de uma entrega em voo. runtime/tests/perks.test.mjs prova que uma entrega não confirmada é compartilhada antes do prazo, que o retry funciona depois dele e que ACKs inválidos não gravam autoria.

A autoria continua source-aware e a evidência do ACK é somente de entrega; efeitos dos perks no motor não são certificados por estes testes. O protocolo aetherius.gameplay.grants, o schema e os contratos compartilhados não mudam.
