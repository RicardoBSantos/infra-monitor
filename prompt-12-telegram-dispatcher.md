# Prompt 12 — Telegram Dispatcher

## 1. Contexto

Com base no contexto permanente definido em:

`codexcontex.md`

e considerando o estado atual do repositório após a implementação de:

```text
Unidade
TipoEquipamento
Equipamento
Monitor
Medição
Incidente
Monitoring Engine ICMP
Incident Engine
Notificação
```

implemente agora o primeiro canal real de entrega de Notificações:

# TELEGRAM

A arquitetura conceitual atual é:

```text
Monitor
   ↓
Monitoring Engine
   ↓
Medição
   ↓
Incident Engine
   ↓
Incidente
   ↓
Notificação PENDENTE
```

Esta etapa deverá completar o fluxo:

```text
Notificação PENDENTE
        ↓
Notification Dispatcher
        ↓
Telegram Notification Sender
        ↓
Telegram Client
        ↓
Telegram Bot API
        ↓
sucesso / falha
        ↓
Notificação ENVIADA / FALHA
```

IMPORTANTE:

Telegram deve continuar sendo apenas um:

```text
CanalNotificacao
```

Não acople Incidente diretamente à API do Telegram.

---

# 2. Objetivo

Implementar infraestrutura capaz de:

1. buscar Notificações TELEGRAM pendentes;
2. reservar/controlar processamento;
3. enviar a mensagem para Telegram;
4. respeitar timeout;
5. registrar tentativas;
6. marcar sucesso;
7. registrar falhas;
8. aplicar retry controlado;
9. evitar duas execuções simultâneas da mesma Notificação;
10. manter tokens e chat IDs fora do código-fonte;
11. permitir desligar completamente o dispatcher;
12. não derrubar o backend caso Telegram esteja indisponível.

---

# 3. Separação de responsabilidades

Não implemente tudo em uma classe.

Prefira separação semelhante a:

```text
NotificationDispatcher
        ↓
NotificationSender
        ↓
TelegramNotificationSender
        ↓
TelegramClient
```

Responsabilidades:

```text
NotificationDispatcher
- encontra trabalho pendente
- controla concorrência
- controla retries
- atualiza fluxo geral
```

```text
NotificationSender
- contrato de envio por canal
```

```text
TelegramNotificationSender
- implementa CanalNotificacao.TELEGRAM
- usa TelegramClient
```

```text
TelegramClient
- comunicação HTTP com Telegram Bot API
```

Adapte nomes conforme arquitetura real do projeto.

---

# 4. Extensibilidade por canal

A arquitetura deve permitir futuramente:

```text
NotificationSender
    ├── TelegramNotificationSender
    ├── EmailNotificationSender
    └── WebhookNotificationSender
```

Não implemente Email ou Webhook nesta etapa.

Uma abstração pequena de sender é justificável.

Não crie framework genérico complexo.

---

# 5. Configuração Telegram

Configure Telegram através de propriedades.

Exemplo conceitual:

```yaml
notification:
  telegram:
    enabled: false
    bot-token: ${TELEGRAM_BOT_TOKEN:}
    chat-id: ${TELEGRAM_CHAT_ID:}
    connect-timeout-ms: 3000
    read-timeout-ms: 5000
```

Adapte nomes ao padrão existente.

Nunca hardcode:

```text
token
chatId
```

no código.

---

# 6. Token

O token do Bot Telegram deve vir de variável de ambiente.

Exemplo:

```text
TELEGRAM_BOT_TOKEN
```

Nunca persistir token no PostgreSQL.

Nunca retornar token em API.

Nunca escrever token em logs.

Nunca colocar token em mensagens de exception.

---

# 7. Chat ID

Nesta primeira versão utilize um destino global configurável:

```text
TELEGRAM_CHAT_ID
```

Não modele ainda:

```text
chat por Unidade
chat por Monitor
chat por usuário
múltiplos destinatários
```

Isso será evolução futura.

O objetivo atual é validar o fluxo completo com um destino central.

---

# 8. Dispatcher habilitável

Crie configuração:

```text
notification.dispatcher.enabled
```

ou equivalente.

Exemplo:

```yaml
notification:
  dispatcher:
    enabled: true
```

Quando:

```text
enabled = false
```

nenhuma Notificação deve ser enviada.

---

# 9. Telegram habilitável

Também permita:

```text
notification.telegram.enabled=false
```

Nesse caso o sender Telegram não deve realizar chamada externa.

Defina comportamento claro para Notificações TELEGRAM existentes.

Preferência:

```text
permanecem PENDENTE
```

e não são transformadas em FALHA apenas porque o canal foi administrativamente desabilitado.

---

# 10. Ambiente de testes

Nos testes, por padrão:

```text
notification.dispatcher.enabled=false
notification.telegram.enabled=false
```

Nenhum teste deve chamar a Telegram Bot API real.

---

# 11. HTTP Client

Use cliente HTTP apropriado ao stack atual do Spring.

Considere, conforme versão disponível:

```text
RestClient
```

ou solução oficial equivalente já presente no projeto.

Não introduza WebFlux apenas para usar WebClient.

Não adicione biblioteca externa desnecessária.

---

# 12. Telegram Bot API

Para envio, utilize o método Telegram:

```text
sendMessage
```

Fluxo conceitual:

```text
POST
https://api.telegram.org/bot<TOKEN>/sendMessage
```

IMPORTANTE:

não exponha a URL completa com token em logs.

Construa o client de maneira segura.

---

# 13. Payload

O payload deverá conter, no mínimo:

```json
{
  "chat_id": "...",
  "text": "..."
}
```

Use o formato esperado pela API do Telegram.

Se o projeto optar por JSON ou form encoding, documente.

Prefira solução simples.

---

# 14. parse_mode

Nesta primeira versão, não dependa obrigatoriamente de Markdown/HTML.

Mensagens em texto simples são suficientes.

Isso evita falhas de escape em:

```text
nomes
IPs
descrições
caracteres especiais
```

Se utilizar `parse_mode`, implemente escape correto e testes.

A preferência inicial é:

```text
texto simples
```

---

# 15. Mensagem persistida

Utilize:

```text
Notificacao.mensagem
```

como conteúdo a enviar.

Não reconstrua a mensagem do Incidente no momento do envio.

A mensagem já representa snapshot histórico.

Fluxo:

```text
Incidente
   ↓
Notificação.mensagem
   ↓
Telegram
```

Isso mantém consistência mesmo que nomes mudem posteriormente.

---

# 16. Status da Notificação

Utilize os estados existentes.

Idealmente:

```text
PENDENTE
    ↓
ENVIANDO
    ↓
ENVIADA
```

ou:

```text
PENDENTE
    ↓
ENVIANDO
    ↓
FALHA
```

Se `ENVIANDO` ainda não existir, avalie adicionar através de migration somente se necessário.

Não altere enum/migration histórica.

---

# 17. Estado ENVIANDO

`ENVIANDO` ajuda a impedir que duas execuções processem a mesma Notificação.

Porém, nesta primeira versão de instância única, também é aceitável controle local em memória.

Se o domínio já possui `ENVIANDO`, utilize.

Se não possui, avalie a necessidade.

A preferência é possuir estado persistente claro se isso puder ser implementado sem complexidade excessiva.

---

# 18. Fluxo de sucesso

Quando envio for aceito pelo Telegram:

```text
status = ENVIADA
tentativas += 1
enviadoEm = Instant.now()
erro = null
```

Use timestamp consistente.

---

# 19. Fluxo de falha

Quando envio falhar:

```text
tentativas += 1
erro = mensagem curta
```

O status dependerá das tentativas restantes.

Se ainda houver retry:

```text
PENDENTE
```

ou estado equivalente.

Se número máximo de tentativas for atingido:

```text
FALHA
```

Defina claramente essa máquina de estados.

---

# 20. Número máximo de tentativas

Configure:

```text
notification.dispatcher.max-attempts
```

Sugestão:

```text
3
```

Não hardcode em múltiplas classes.

---

# 21. Backoff

Implemente retry com backoff simples.

Exemplo conceitual:

```text
tentativa 1
↓
aguarda período
↓
tentativa 2
↓
aguarda período maior
↓
tentativa 3
```

Não utilize loop bloqueante com `Thread.sleep()` dentro do worker para esperar retry.

O dispatcher deve simplesmente reprocessar posteriormente.

---

# 22. Próxima tentativa

Para backoff consistente, avalie adicionar em Notificação:

```text
proximaTentativaEm
```

Esse campo é recomendável.

Ele permite:

```text
PENDENTE
+
proximaTentativaEm <= agora
```

ser selecionada pelo dispatcher.

Se o modelo atual não possui esse campo, crie nova migration.

Não altere migration histórica.

---

# 23. Campo proximaTentativaEm

Sem falha anterior:

```text
proximaTentativaEm = createdAt
```

ou `null` tratado como imediatamente executável.

Após falha:

```text
proximaTentativaEm = agora + backoff
```

Quando:

```text
status = ENVIADA
```

pode ficar null.

Quando:

```text
status = FALHA final
```

pode ficar null.

---

# 24. Estratégia de backoff

Use estratégia simples configurável.

Exemplo:

```text
base-delay-seconds = 30
```

Backoff:

```text
tentativa 1 -> 30s
tentativa 2 -> 60s
tentativa 3 -> final
```

Ou exponencial simples equivalente.

Não introduza Resilience4j/Spring Retry apenas para isso sem avaliar necessidade.

Uma implementação explícita simples é suficiente.

---

# 25. Scheduler do Dispatcher

Implemente um scheduler central.

Exemplo:

```text
NotificationDispatcherScheduler
```

Executa periodicamente para encontrar notificações prontas.

Não crie um scheduler por Notificação.

---

# 26. Frequência do dispatcher

Configure:

```text
notification.dispatcher.poll-delay-ms
```

Exemplo:

```text
1000
```

ou valor razoável.

O polling frequente não deve gerar query cara.

---

# 27. Buscar somente trabalho elegível

O repository deve consultar apenas notificações que podem ser processadas.

Conceitualmente:

```text
canal = TELEGRAM
status = PENDENTE
tentativas < maxAttempts
proximaTentativaEm <= now
```

Não carregue todas as notificações e filtre em memória.

---

# 28. Ordenação da fila

Processe preferencialmente:

```text
createdAt ASC
```

ou:

```text
proximaTentativaEm ASC
```

para notificações pendentes.

Notificações mais antigas não devem ficar eternamente atrás das novas.

---

# 29. Batch de busca

Não carregue milhares de Notificações por tick.

Configure tamanho de lote.

Exemplo:

```text
notification.dispatcher.batch-size = 50
```

Use paginação/LIMIT.

---

# 30. Concorrência

Utilize pool controlado se enviar várias notificações em paralelo.

Não crie threads ilimitadas.

Configuração possível:

```text
notification.dispatcher.worker-threads
```

Exemplo default:

```text
5
```

---

# 31. Evitar envio duplicado local

Na primeira versão, assuma uma única instância da aplicação.

Mesmo assim, não envie a mesma Notificação simultaneamente em duas threads.

Utilize:

```text
Set<NotificationId>
```

thread-safe ou mecanismo equivalente.

Sempre liberar em `finally`.

---

# 32. Estado persistente e corrida

Se utilizar estado:

```text
PENDENTE -> ENVIANDO
```

faça a transição de forma segura.

Idealmente reserve a Notificação antes da chamada externa.

Não mantenha transaction aberta durante chamada HTTP ao Telegram.

Fluxo desejado:

```text
transação curta
PENDENTE -> ENVIANDO
commit

↓

HTTP Telegram fora de transação

↓

transação curta
ENVIANDO -> ENVIADA/FALHA/PENDENTE
```

---

# 33. Não manter conexão de banco durante HTTP

Não deixe transaction aberta enquanto espera Telegram.

Timeout HTTP pode durar segundos.

Evite segurar conexão PostgreSQL durante operação externa.

---

# 34. Instância única

Nesta versão, assuma:

```text
uma única instância do backend
```

responsável pelo dispatcher.

Não implemente agora:

```text
distributed lock
ShedLock
Redis
Kafka
leader election
```

Documente a limitação.

---

# 35. Futuro multi-instance

Organize o código para permitir futuramente reserva atômica de notificações via banco.

Não implemente agora se isso aumentar muito a complexidade.

---

# 36. Telegram Client Response

Modele apenas o necessário.

Telegram geralmente retorna uma resposta contendo:

```text
ok
result
description
error_code
```

Você não precisa persistir a resposta completa.

Só precisa determinar:

```text
sucesso
falha
mensagem de erro
```

---

# 37. Telegram message ID

Avalie persistir:

```text
externalMessageId
```

ou:

```text
telegramMessageId
```

Não recomendo campo específico de Telegram dentro de Notificacao genérica nesta etapa.

Se houver necessidade futura, prefira campo genérico:

```text
externalId
```

Mas não adicione sem necessidade real.

Nesta primeira versão não é obrigatório persistir message_id.

---

# 38. HTTP 2xx

Não trate simplesmente qualquer HTTP 200 como sucesso sem olhar a semântica da resposta Telegram quando necessário.

Valide o campo:

```text
ok
```

conforme API.

---

# 39. HTTP 4xx

Erros como:

```text
401
403
400
```

podem indicar configuração inválida ou payload inválido.

Nesta primeira versão, eles podem contar como tentativa.

Evite retry infinito.

Ao atingir maxAttempts:

```text
FALHA
```

---

# 40. HTTP 429

Telegram pode retornar:

```text
429 Too Many Requests
```

Se a resposta fornecer:

```text
retry_after
```

e for simples extraí-lo, utilize-o para `proximaTentativaEm`.

Caso contrário aplique backoff configurado.

Não implemente um sistema complexo de rate limiting nesta etapa.

---

# 41. HTTP 5xx

Considere falha temporária.

Volte para:

```text
PENDENTE
```

se ainda houver tentativas.

Defina próxima tentativa com backoff.

---

# 42. Timeout

Timeout de conexão ou leitura:

```text
conta como tentativa
```

e deve gerar retry se ainda houver tentativas disponíveis.

Não bloqueie indefinidamente.

---

# 43. Falha de DNS/conectividade

Trate como falha temporária.

Não derrube dispatcher.

Não derrube aplicação.

---

# 44. Falha de configuração

Se:

```text
TELEGRAM_BOT_TOKEN
```

ou:

```text
TELEGRAM_CHAT_ID
```

estiver ausente enquanto Telegram estiver habilitado:

não execute chamadas inválidas.

Escolha comportamento fail-fast ou disable seguro.

Preferência:

```text
se telegram.enabled=true
e configuração obrigatória ausente
→ falhar inicialização com mensagem clara
```

sem imprimir valores secretos.

Isso evita aplicação aparentemente funcionando sem enviar alertas.

---

# 45. Quando Telegram está disabled

Se:

```text
telegram.enabled=false
```

a ausência de token/chatId não deve impedir startup.

---

# 46. Logs

Use logs com cuidado.

INFO apropriado:

```text
notificação enviada com sucesso
notificação marcada como FALHA final
```

DEBUG:

```text
notificação selecionada
retry agendado
```

WARN:

```text
timeout Telegram
HTTP temporário
fila saturada
```

ERROR:

```text
erro interno inesperado
configuração inválida em startup, quando aplicável
```

---

# 47. Não logar token

Nunca logar:

```text
TELEGRAM_BOT_TOKEN
URL completa contendo /bot<TOKEN>/
Authorization
```

Mesmo em DEBUG.

---

# 48. Não logar mensagem excessivamente

Pode haver informações internas na mensagem.

Evite registrar texto completo de todas as notificações em INFO.

Prefira:

```text
notificationId
incidentId
tipoEvento
```

---

# 49. Sanitização de erro

Campo:

```text
Notificacao.erro
```

deve armazenar mensagem curta e sanitizada.

Não armazene:

```text
stack trace
token
URL com token
payload completo
```

Defina tamanho máximo coerente.

---

# 50. Atualização da Notificação

Crie métodos de domínio/service equivalentes a:

```text
markSending(...)
markSent(...)
scheduleRetry(...)
markFailed(...)
```

Não espalhe alterações de status manualmente em várias classes.

Centralize transições.

---

# 51. Máquina de estados

Garanta transições coerentes.

Exemplo:

```text
PENDENTE -> ENVIANDO

ENVIANDO -> ENVIADA

ENVIANDO -> PENDENTE
  quando retry será realizado

ENVIANDO -> FALHA
  quando tentativas acabaram
```

Evite:

```text
ENVIADA -> PENDENTE
```

automaticamente.

---

# 52. Notificação já ENVIADA

Não reenviar automaticamente.

Mesmo que dispatcher encontre por erro, service deve impedir transição indevida.

---

# 53. Notificação FALHA final

Não reprocessar automaticamente.

Posteriormente poderá existir endpoint administrativo de retry manual.

Não implemente agora, salvo requisito já existente.

---

# 54. Endpoint de retry manual

NÃO implemente nesta etapa:

```text
POST /notificacoes/{id}/retry
```

Apenas retry automático.

Pode ser evolução posterior.

---

# 55. Sender abstraction

Crie contrato pequeno, por exemplo:

```java
interface NotificationSender {
    CanalNotificacao canal();
    SendResult send(Notificacao notificacao);
}
```

ou equivalente.

Não faça sender depender de Controller.

---

# 56. SendResult

Crie resultado interno simples:

```text
success
errorMessage
retryAfter
```

ou estrutura equivalente.

Não retorne Entity.

---

# 57. TelegramNotificationSender

Deve:

1. verificar canal;
2. obter mensagem persistida;
3. chamar TelegramClient;
4. traduzir resposta para resultado interno.

Não deve atualizar banco diretamente se dispatcher/service já é responsável pelas transições.

---

# 58. TelegramClient

Responsável somente pela comunicação HTTP.

Não deve conhecer:

```text
IncidenteRepository
NotificacaoRepository
IncidentProcessor
Monitoring Engine
```

---

# 59. Testabilidade

Estruture para permitir:

```text
mock TelegramClient
```

nos testes.

Nenhum teste unitário deve fazer HTTP real.

---

# 60. Testes do TelegramClient

Utilize mock HTTP server ou mecanismo apropriado já disponível no stack para validar:

```text
request correto
sucesso
400
401
429
500
timeout
```

Sem acessar api.telegram.org.

Evite adicionar dependência pesada se não for necessária.

---

# 61. Testes do Sender

Cubra:

```text
mensagem válida -> sucesso
client falha -> SendResult falha
```

---

# 62. Testes do Dispatcher

Cubra no mínimo:

```text
PENDENTE elegível -> processa

ENVIADA -> ignora

FALHA final -> ignora

retry ainda não vencido -> ignora

tentativas abaixo do máximo + falha -> volta PENDENTE

última tentativa + falha -> FALHA

sucesso -> ENVIADA

sucesso define enviadoEm

sucesso limpa erro

falha incrementa tentativas

mesma Notificação não envia simultaneamente duas vezes

dispatcher disabled -> não processa

telegram disabled -> não envia
```

---

# 63. Teste de retry

Exemplo:

```text
maxAttempts = 3
```

Primeira falha:

```text
tentativas = 1
status = PENDENTE
proximaTentativaEm > now
```

Segunda:

```text
tentativas = 2
status = PENDENTE
```

Terceira:

```text
tentativas = 3
status = FALHA
```

---

# 64. Teste de sucesso

Envio bem-sucedido:

```text
status = ENVIADA
tentativas incrementada
enviadoEm != null
erro = null
```

---

# 65. Teste de 429

Se implementar `retry_after`, teste que:

```text
proximaTentativaEm
```

respeita a recomendação do Telegram.

Caso não implemente, teste backoff padrão.

---

# 66. Teste de timeout

Timeout não deve lançar exception não tratada para scheduler.

A Notificação deve entrar no fluxo de retry/falha.

---

# 67. Teste de configuração

Cubra:

```text
telegram disabled + token ausente -> contexto inicia
```

E, se usar fail-fast:

```text
telegram enabled + token ausente -> erro de configuração claro
```

---

# 68. Clock

Use:

```java
Clock
```

onde for útil para:

```text
enviadoEm
proximaTentativaEm
backoff
```

Isso facilita testes determinísticos.

Reutilize Clock existente se houver.

---

# 69. Repository

Prepare consulta eficiente para Notificações prontas.

Exemplo conceitual:

```text
findReadyForDispatch(...)
```

Critérios:

```text
status PENDENTE
canal TELEGRAM
proximaTentativaEm <= now
tentativas < maxAttempts
```

com:

```text
LIMIT batchSize
```

e ordenação adequada.

---

# 70. Índices

Com `proximaTentativaEm`, avalie índice para fila.

Exemplo conceitual:

```text
(status, canal, proxima_tentativa_em)
```

Isso pode ser útil para polling frequente.

Crie somente se justificado.

Nova migration pode incluir:

```text
proxima_tentativa_em
+
índice
```

---

# 71. Migration

Se forem necessárias alterações como:

```text
ENVIANDO
proxima_tentativa_em
```

crie nova migration Flyway.

Antes:

1. liste migrations;
2. descubra próxima versão;
3. confirme schema atual;
4. nunca edite migration histórica.

---

# 72. Compatibilidade de dados existentes

Notificações PENDENTES já existentes devem continuar elegíveis.

Ao adicionar `proximaTentativaEm`, a migration deve tratar registros existentes.

Exemplo:

```text
proxima_tentativa_em = created_at
```

para PENDENTES existentes.

Planeje migração sem quebrar `ddl-auto=validate`.

---

# 73. Configuração no README

Documente:

```text
TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID
```

e propriedades:

```text
notification.telegram.enabled
notification.dispatcher.enabled
max-attempts
poll-delay
batch-size
timeouts
backoff
```

Não coloque token real em exemplos.

---

# 74. Arquivo `.env`

Não versionar `.env` com secrets.

Se já existir:

```text
.env.example
```

pode adicionar:

```text
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
```

sem valores.

---

# 75. Gitignore

Confirme que arquivos locais de secrets estão ignorados.

Não altere indiscriminadamente `.gitignore`.

---

# 76. Docker futuro

Se houver compose dev, pode apenas permitir passagem das env vars.

Não é obrigatório.

Não implemente deploy de produção nesta etapa.

---

# 77. Sem dependência do Incident Engine

O Dispatcher não deve consultar Medições ou decidir se há Incidente.

Seu único input é:

```text
Notificação
```

Fluxo correto:

```text
Incident Engine
    ↓
Incidente
    ↓
Notificação
    ↓
Dispatcher
```

---

# 78. Sem reconstrução de evento

Dispatcher não deve chamar:

```text
IncidenteService
```

para decidir mensagem.

A mensagem já está persistida.

---

# 79. Nenhum impacto no Monitoring Engine

Não altere:

```text
scheduler ICMP
IcmpMonitorExecutor
IncidentProcessor
```

salvo pequenas integrações indispensáveis já ausentes.

Essa feature deve ficar desacoplada.

---

# 80. Startup e scheduling

Certifique-se de que testes não ativem:

```text
Monitoring Engine
Telegram Dispatcher
```

acidentalmente.

Profiles de teste devem ser determinísticos.

---

# 81. Resiliência

Se Telegram ficar fora do ar durante 30 minutos:

```text
backend continua funcionando
Medições continuam sendo gravadas
Incidentes continuam sendo processados
Notificações ficam em retry/FALHA conforme política
```

Comunicação externa não pode derrubar monitoramento.

---

# 82. Ordem de prioridade

O monitoramento é mais crítico que o envio de alertas.

Não utilize o mesmo pool de threads do Monitoring Engine para Telegram se isso puder causar contenção.

Prefira executor separado para notificações.

---

# 83. Pool separado

Se houver concorrência de envio, crie pool próprio:

```text
notification-worker-
```

Não reutilize `monitor-worker-`.

---

# 84. Saturação da fila

Se pool do dispatcher estiver saturado:

não perca a Notificação.

Ela permanece persistida como PENDENTE/ENVIANDO conforme controle apropriado e deve poder ser processada depois.

Não marque como FALHA apenas por saturação interna temporária.

---

# 85. Rejeição de task

Se tarefa for rejeitada antes de envio:

libere qualquer lock local.

Se status tiver sido alterado para ENVIANDO antes da submissão, reverta de forma segura para PENDENTE.

Evite Notificação presa eternamente em ENVIANDO.

---

# 86. Recuperação de ENVIANDO órfão

Se utilizar `ENVIANDO`, uma queda do backend após marcar ENVIANDO e antes de concluir pode deixar registro preso.

Nesta primeira versão, avalie uma estratégia simples.

Opções:

```text
não persistir ENVIANDO
```

ou:

```text
adicionar timeout de processamento
```

A preferência é evitar estado persistente que possa ficar órfão sem mecanismo de recuperação.

Se utilizar apenas lock local + PENDENTE, documente limitação de instância única.

Escolha a solução mais simples e segura para o estado atual.

---

# 87. Não criar exatamente-once falso

Não prometa exactly-once delivery.

Existe uma janela inevitável:

```text
Telegram recebe
↓
backend cai antes de marcar ENVIADA
```

Na reinicialização, um retry pode enviar mensagem duplicada.

Documente como:

```text
at-least-once delivery
```

na primeira versão.

Não crie infraestrutura complexa apenas para tentar eliminar isso.

---

# 88. Idempotência externa

Telegram `sendMessage` não fornece chave idempotente nativa simples para esse uso.

Aceite a limitação.

A unicidade interna impede criação duplicada de Notificação, mas não elimina 100% duplicidade em crash entre envio e commit.

Documente.

---

# 89. Inspeção inicial

Antes de modificar:

```bash
pwd
git status
```

Analise principalmente:

```text
pom.xml
application.yml
application-*.yml
Notificacao
NotificacaoService
NotificacaoRepository
CanalNotificacao
TipoEventoNotificacao
StatusNotificacao
IncidenteService
migrations
test profiles
configuração HTTP atual
Clock, se existir
```

---

# 90. Sequência sugerida

```text
1. analisar Notificação atual
2. decidir máquina de estados
3. decidir necessidade de migration
4. criar propriedades Telegram
5. criar propriedades Dispatcher
6. configurar HTTP client
7. criar NotificationSender
8. criar TelegramClient
9. criar TelegramNotificationSender
10. criar consulta de pendentes
11. criar dispatcher
12. criar executor/pool próprio
13. implementar retry/backoff
14. implementar transições de status
15. garantir tests disabled
16. criar testes
17. atualizar README
18. executar test
19. executar verify
20. revisar git diff
```

---

# 91. Testes obrigatórios

Cubra pelo menos:

```text
Telegram client sucesso

Telegram client HTTP 400

Telegram client HTTP 429

Telegram client HTTP 500

Telegram client timeout

Dispatcher busca PENDENTE

Dispatcher ignora ENVIADA

Dispatcher ignora FALHA final

Dispatcher respeita proximaTentativaEm

sucesso marca ENVIADA

sucesso define enviadoEm

falha incrementa tentativas

falha temporária agenda retry

maxAttempts marca FALHA

dispatcher disabled não envia

telegram disabled não envia

mesma Notificação não envia simultaneamente duas vezes

rejeição de executor não perde Notificação
```

Nenhum teste chama Telegram real.

---

# 92. Teste end-to-end interno

Crie teste integrado sem rede real:

```text
Incident Engine abre Incidente
        ↓
Notificação PENDENTE
        ↓
Dispatcher
        ↓
TelegramClient fake/mock retorna sucesso
        ↓
Notificação ENVIADA
```

E fluxo de fechamento:

```text
Incidente FECHADO
        ↓
Notificação recovery
        ↓
Telegram sender
        ↓
ENVIADA
```

---

# 93. Build e testes

Se houver Maven Wrapper:

```bash
./mvnw test
./mvnw verify
```

Caso contrário:

```bash
mvn test
mvn verify
```

Corrija falhas relacionadas à implementação.

---

# 94. Git

Não execute:

```text
git commit
git push
git reset --hard
git clean -fd
git checkout .
```

Ao final:

```bash
git status
git diff
```

---

# 95. Revisão final

Revise explicitamente:

```text
token nunca hardcoded
token nunca logado
chatId configurável
HTTP timeout
nenhuma transação durante chamada HTTP
retry não usa sleep bloqueante
pool separado
fila/batch limitados
dispatcher desabilitável
Telegram desabilitável
nenhum teste com rede real
Notificação ENVIADA não é reenviada
FALHA final não é reenviada
backoff funcionando
```

---

# 96. Critérios de aceite

A etapa estará concluída quando:

* Telegram possuir configuração via env;
* token não estiver persistido;
* chat ID não estiver hardcoded;
* Telegram puder ser desabilitado;
* Dispatcher puder ser desabilitado;
* Notificações PENDENTES forem selecionadas eficientemente;
* batch for limitado;
* envio usar HTTP client com timeout;
* mensagem persistida for utilizada;
* sucesso marcar ENVIADA;
* `enviadoEm` for preenchido;
* tentativa for contabilizada;
* falha temporária gerar retry;
* backoff funcionar;
* maxAttempts gerar FALHA;
* mesma Notificação não executar simultaneamente;
* nenhum HTTP ocorrer dentro de transação longa;
* Telegram indisponível não parar Monitoring Engine;
* testes não usarem rede externa;
* build passar.

---

# 97. Resposta final

Ao concluir, apresente:

```text
RESUMO

...


CONTEXTO UTILIZADO

- codexcontex.md
- Notificação
- Incident Engine
- Incidente
- configuração atual
- migrations existentes


ARQUITETURA TELEGRAM

NotificationDispatcher:
...

NotificationSender:
...

TelegramNotificationSender:
...

TelegramClient:
...


CONFIGURAÇÕES

Variáveis de ambiente:
...

Properties:
...


SEGURANÇA

Tratamento do token:
...

Tratamento do chatId:
...

Logs:
...


FLUXO

Notificação PENDENTE
 -> ...
 -> Telegram
 -> ENVIADA/FALHA


MÁQUINA DE ESTADOS

...


RETRY / BACKOFF

...


CONCORRÊNCIA

...


MODELO DE ENTREGA

at-least-once:
...

Limitação de duplicidade em crash:
...


MIGRATION

Nenhuma.

ou:

Arquivo:
...

Alterações:
...


ÍNDICES

...


ARQUIVOS CRIADOS

...


ARQUIVOS ALTERADOS

...


ALTERAÇÕES EM NOTIFICAÇÃO

...


DEPENDÊNCIAS ADICIONADAS

Nenhuma.

ou:
...


README / CONFIGURAÇÃO

...


TESTES CRIADOS

...


RESULTADO DOS TESTES

Comando:
...

Resultado:
...


RESULTADO DO BUILD

Comando:
...

Resultado:
...


GIT STATUS

...


GIT DIFF

...


LIMITAÇÕES ATUAIS

- um chat Telegram global;
- uma única instância responsável pelo dispatcher;
- entrega at-least-once;
- somente TELEGRAM implementado.


DIVERGÊNCIAS DA ESPECIFICAÇÃO

Nenhuma.

ou:
...


PENDÊNCIAS

...


PRÓXIMO PASSO RECOMENDADO

Revisão end-to-end do backend e preparação da API para integração com o frontend.

Não implemente nova feature automaticamente.
```

---

# 98. Princípio principal

Preserve esta cadeia:

```text
Monitoring Engine
      ↓
Medição
      ↓
Incident Engine
      ↓
Incidente
      ↓
Notificação
      ↓
Dispatcher
      ↓
Telegram
```

Cada camada deve possuir responsabilidade clara.

Uma indisponibilidade do Telegram nunca deve impedir:

```text
monitoramento
persistência de Medições
abertura de Incidentes
```

A comunicação é uma consequência do evento operacional, não parte da execução do monitor.

Agora analise o estado real do repositório e implemente integralmente o Telegram Dispatcher.
