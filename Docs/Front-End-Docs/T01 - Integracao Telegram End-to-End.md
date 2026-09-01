1. Objetivo

Concluir e validar a integração real do Infra Monitor com o Telegram, garantindo o fluxo:

Incident Engine
↓
Incidente
↓
Notificação
↓
Telegram Dispatcher
↓
Telegram Bot API
↓
Grupo/Chat configurado

Esta fase deve confirmar que incidentes reais geram notificações persistidas e que o dispatcher efetivamente envia mensagens ao grupo Telegram configurado.

O frontend já possui a F08 de histórico de Notificações e não deve chamar o Telegram diretamente.

2. Premissas

Já existem no projeto:

bot criado no Telegram;

BOT_TOKEN/token equivalente disponível fora do código-fonte;

chat_id do grupo disponível;

domínio Notificacao;

canal TELEGRAM;

eventos INCIDENTE_ABERTO e INCIDENTE_FECHADO;

estados PENDENTE, ENVIANDO, ENVIADA, FALHA;

Incident Engine;

Telegram Dispatcher;

frontend de histórico de notificações.

Antes de alterar código, confirmar o estado real da implementação.

Não assumir que o dispatcher está incompleto sem inspecioná-lo.

3. Segurança

Secrets nunca devem ser commitados.

Configurar por variável de ambiente ou mecanismo equivalente do Spring Boot.

Exemplo conceitual:

TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID

Não registrar token em logs.

Não retornar token em endpoint REST.

Não incluir token no Angular.

Não colocar token em application.yml versionado com valor real.

4. Configuração Spring

Centralizar configuração em propriedades tipadas, por exemplo:

telegram.enabled
telegram.bot-token
telegram.chat-id

com valores vindos de environment/config externa.

A nomenclatura deve seguir o padrão já existente no projeto.

Não duplicar configurações se já houver estrutura implementada.

5. Habilitação

É recomendável existir uma flag:

telegram.enabled=true|false

Objetivos:

permitir execução local sem Telegram;

evitar falhas de startup quando integração estiver desabilitada;

controlar ambientes.

Quando habilitado, token e chat id devem ser validados.

Quando desabilitado, o dispatcher não deve tentar enviar.

Não marcar notificações como ENVIADA se nada foi enviado.

6. Telegram Bot API

O envio deve ocorrer exclusivamente no backend.

Endpoint funcional esperado da Bot API:

sendMessage

A implementação deve utilizar cliente HTTP adequado ao projeto Spring existente.

Não adicionar biblioteca pesada se RestClient, WebClient ou solução equivalente já resolver.

7. Request ao Telegram

O request deve enviar pelo menos:

chat_id
text

Pode utilizar parse_mode somente se a formatação estiver controlada e escapada corretamente.

Evitar HTML/Markdown quebrado por valores de usuário.

Se não houver necessidade forte de rich text, texto simples é aceitável e mais seguro.

8. Mensagem de Incidente Aberto

Criar mensagem clara e operacional.

Deve utilizar apenas dados reais disponíveis.

Exemplo conceitual:

🔴 INCIDENTE ABERTO

Unidade: Matriz
Equipamento: SW-CORE-01
Monitor: ICMP principal
Início: 20/08/2026 09:15
Motivo: ...

Não inventar campos ausentes.

Não recalcular status.

9. Mensagem de Incidente Fechado

Exemplo conceitual:

🟢 INCIDENTE ENCERRADO

Unidade: Matriz
Equipamento: SW-CORE-01
Monitor: ICMP principal
Início: ...
Fim: ...
Duração: ...

A duração só deve ser exibida se puder ser calculada com segurança a partir de timestamps reais do incidente.

Não alterar regras de recovery.

10. Persistência da Notificação

O envio deve respeitar o domínio existente.

Fluxo esperado:

evento de incidente
↓
criação de Notificacao PENDENTE
↓
dispatcher seleciona pendentes
↓
ENVIANDO
↓
Telegram
↓
ENVIADA ou FALHA

Confirmar a implementação real e adequar apenas se necessário.

11. Status

Estados públicos:

PENDENTE
ENVIANDO
ENVIADA
FALHA

Sucesso

Após resposta válida do Telegram:

status = ENVIADA
enviadoEm = instante atual
erro = null

Falha

Em erro:

status = FALHA
erro = mensagem sanitizada

Não armazenar token, URL contendo token ou stacktrace completo no campo público de erro.

12. Tentativas

O campo:

tentativas

deve refletir tentativas reais do backend.

Incrementar apenas no backend.

O Angular permanece somente leitura.

13. Retry

Antes de implementar retry automático, inspecionar comportamento atual.

Se já houver política de retry, preservá-la.

Se não houver, nesta fase preferir mecanismo simples e previsível.

Evitar loop infinito.

Qualquer retry deve possuir limite explícito.

Não reenviar notificações já ENVIADA.

14. Idempotência

Garantir que o mesmo processamento não envie duplicadamente uma Notificação já marcada como ENVIADA.

Se o dispatcher for agendado:

selecionar apenas estados elegíveis

e proteger concorrência conforme arquitetura existente.

Não redesenhar a persistência inteira se já houver solução suficiente.

15. Resposta do Telegram

Validar resposta HTTP e payload da Bot API.

Não considerar somente HTTP 200 se o corpo indicar falha.

Em falha, armazenar informação útil e sanitizada.

16. Timeout

Configurar timeout HTTP razoável.

Não permitir que chamada Telegram bloqueie indefinidamente workers/scheduler.

Usar padrão de configuração do projeto.

17. Logs

Logs devem permitir diagnosticar:

notificationId;

incidentId;

evento;

status final;

tentativa.

Não registrar:

bot token
URL completa contendo token
credenciais

18. Startup

A aplicação não deve fazer envio arbitrário durante startup.

Se houver notificações PENDENTE persistidas e o dispatcher processá-las normalmente após inicialização, isso é aceitável conforme política existente.

19. Incident Engine

Confirmar integração para:

Incidente ABERTO
→ Notificacao INCIDENTE_ABERTO

e:

Incidente FECHADO
→ Notificacao INCIDENTE_FECHADO

Não enviar diretamente do Incident Engine ao Telegram ignorando Notificacao.

A entidade Notificação deve continuar sendo o ponto de rastreabilidade.

20. Fechamento manual e automático

Tanto fechamento automático quanto fechamento manual de Incidente devem resultar no mesmo conceito:

INCIDENTE_FECHADO

se essa for a regra atual do backend.

Evitar código duplicado de Telegram em cada caminho.

21. Frontend

Não modificar a F08 para enviar mensagens.

O frontend deve continuar apenas consultando:

GET /api/v1/notificacoes
GET /api/v1/notificacoes/{id}

Depois do envio real, a UI deverá naturalmente refletir:

status
tentativas
enviadoEm
erro

retornados pelo backend.

22. Teste manual de integração

Além dos testes automatizados, realizar um teste real controlado com o grupo Telegram configurado.

O teste deve validar:

Abertura

gerar/usar um incidente de teste de forma segura;

confirmar criação de Notificação;

confirmar envio ao Telegram;

confirmar ENVIADA;

confirmar tentativas;

confirmar enviadoEm.

Fechamento

fechar/recover o mesmo incidente;

confirmar Notificação INCIDENTE_FECHADO;

confirmar mensagem no Telegram;

confirmar persistência final.

Não criar incidente falso persistente em produção apenas para teste sem estratégia de limpeza.

23. Teste de falha

Executar em ambiente de teste uma falha controlada, por exemplo configuração inválida temporária ou mock HTTP.

Validar:

status = FALHA
tentativas incrementadas
erro sanitizado

Não expor token nos logs nem no banco.

24. Testes automatizados

Cobrir pelo menos:

Cliente Telegram

request correto;

chat id correto;

texto correto;

sucesso;

erro HTTP;

erro lógico da API;

timeout, quando testável.

Dispatcher

processa PENDENTE;

marca ENVIANDO;

sucesso → ENVIADA;

falha → FALHA;

incrementa tentativas;

não reenvia ENVIADA;

respeita telegram.enabled=false.

Integração com incidentes

abertura gera Notificação de abertura;

fechamento gera Notificação de fechamento;

manual e automático usam fluxo consistente.

25. Health/observabilidade

Não é obrigatório criar endpoint novo.

Se já houver Actuator/Micrometer, pode registrar logs/métricas sem ampliar escopo.

Não expor secrets em health/info.

26. README

Atualizar documentação com:

TELEGRAM_ENABLED
TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID

ou os nomes reais adotados.

Documentar:

como configurar;

como habilitar;

como desabilitar;

como validar;

cuidados de segurança.

Nunca colocar valores reais no README.

27. Docker/Deploy futuro

Preparar configuração para ser injetada por ambiente.

Não criar arquivo .env contendo secrets reais e versioná-lo.

Se houver .env.example, usar valores fictícios/placeholders.

28. Fora do escopo

Não implementar nesta fase:

configuração de Bot Token pelo Angular;

painel de edição de chat id;

múltiplos bots;

múltiplos canais;

Slack;

e-mail;

WhatsApp;

webhook genérico;

autenticação;

georreferenciamento;

deploy.

29. Critérios de aceite

A integração está concluída quando:

token e chat id vêm de configuração externa;

nenhum secret está commitado;

Telegram pode ser habilitado/desabilitado;

abertura de incidente cria Notificação adequada;

fechamento cria Notificação adequada;

dispatcher envia pelo backend;

mensagem chega ao grupo real;

sucesso marca ENVIADA;

enviadoEm é preenchido;

tentativas reflete execução real;

falha marca FALHA;

erro é sanitizado;

notificações ENVIADA não são reenviadas;

frontend F08 exibe o resultado sem alteração;

testes automatizados passam;

build passa;

teste real de abertura e fechamento é documentado.

30. Relatório final

T01 — Resultado

Status: CONCLUÍDO / CONCLUÍDO COM RESSALVAS / BLOQUEADO

Configuração

Informar nomes das propriedades/env vars, sem valores.

Fluxo

Descrever:

Incidente
→ Notificação
→ Dispatcher
→ Telegram

Mensagens

Mostrar exemplos sanitizados de abertura/fechamento.

Dispatcher

Descrever seleção, status e tentativas.

Retry

Descrever política real.

Segurança

Confirmar:

token não está no código
token não está em logs
token não é enviado ao Angular

Testes automatizados

Informar comando, quantidade e resultado.

Teste real Telegram

Informar:

INCIDENTE_ABERTO: recebido SIM/NÃO
INCIDENTE_FECHADO: recebido SIM/NÃO

Sem expor token/chat id.

Banco

Informar resultado persistido de Notificação:

status
tentativas
enviadoEm
erro

Build

Informar comando e resultado.

Git diff

Resumir arquivos alterados.

Pendências

Somente problemas reais da integração.