1. Objetivo

Implementar no frontend Angular do Infra Monitor a feature administrativa de Notificações, com foco inicial no canal Telegram, consumindo exclusivamente o backend existente.

Esta fase deve entregar:

listagem paginada de Notificações;

filtros server-side;

detalhe de Notificação;

apresentação de evento, canal, status, tentativas, envio e erro;

integração visual com Incidentes;

tratamento de loading, empty, error e paginação;

aderência ao Claude Design;

preservação absoluta de secrets no backend.

O frontend NÃO deve chamar a API do Telegram diretamente.

2. Pré-condições

Já foram concluídas:

F01 — Fundação Angular;

F02 — Design System + Application Shell;

F03 — Dashboard;

F04 — Unidades e Tipos de Equipamento;

F05 — Inventário e Equipamentos;

F06 — Monitores;

F07 — Medições e Incidentes.

Antes de alterar código:

revisar package.json;

revisar PageResponse<T>;

revisar ApiError e interceptor;

revisar IncidenteApiService;

revisar componentes compartilhados;

analisar no Claude Design a área de Telegram/Notificações;

confirmar DTOs reais do backend;

verificar o estado do Git.

Não recriar infraestrutura existente.

3. Conceito de Notificação

Notificação representa o histórico de comunicação relacionada a um Incidente.

Conceitualmente:

Incidente
↓
Notificação
↓
Canal

Atualmente o canal público é:

TELEGRAM

Notificação e Incidente são entidades distintas.

Não tratar uma Notificação como se fosse o próprio Incidente.

4. Fonte de verdade funcional

Endpoints:

GET /api/v1/notificacoes
GET /api/v1/notificacoes/{id}

A listagem é paginada.

Filtros:

incidenteId
status
canal
tipoEvento
inicio
fim

Sort permitido:

id
canal
tipoEvento
status
tentativas
enviadoEm
createdAt
updatedAt

5. Enums públicos

CanalNotificacao

TELEGRAM

TipoEventoNotificacao

INCIDENTE_ABERTO
INCIDENTE_FECHADO

StatusNotificacao

PENDENTE
ENVIANDO
ENVIADA
FALHA

Usar tipagem explícita.

Não inventar novos valores.

6. Segurança

Regra crítica:

O Angular não pode conter nem receber secrets de integração.

Não adicionar:

TELEGRAM_BOT_TOKEN
BOT_TOKEN
chat_id secreto
token de API
credenciais

em:

environment.ts
localStorage
sessionStorage
código fonte
requests do frontend

O fluxo correto é:

Angular
↓
Backend
↓
Telegram

7. Sem chamada direta ao Telegram

É proibido implementar:

fetch('https://api.telegram.org/...')
HttpClient -> api.telegram.org
TelegramService frontend
Bot API client no Angular

O frontend apenas consulta o backend.

8. Rotas

Implementar/substituir placeholder para:

/notificacoes

Se o design atual usar o nome visual "Telegram", isso pode ser preservado no menu, mas a feature funcional deve refletir o domínio real de Notificações.

Opcionalmente, pode existir:

/notificacoes/:id

se o detalhe dedicado fizer sentido.

9. NotificacaoApiService

Criar service dedicado:

NotificacaoApiService

Responsabilidades:

list(query)
getById(id)

Não criar métodos de envio manual se o backend não fornece endpoint correspondente.

Não criar método sendTelegram().

10. Models

Criar interfaces explícitas, por exemplo:

NotificacaoResponse
NotificacaoListQuery

Campos conceituais podem incluir:

id
incidente
canal
tipoEvento
status
tentativas
enviadoEm
erro
createdAt
updatedAt

Confirmar DTO real no backend.

Respeitar nullability.

Exemplos:

enviadoEm = null
erro = null

quando aplicável.

Datas como string ISO.

11. Tela de Notificações

Implementar:

/notificacoes

com:

Page Header;

filtros;

tabela/listagem;

paginação;

loading;

empty;

error.

A tela é de consulta administrativa.

Não criar formulário de criação.

Não criar botão de "enviar Telegram" se não existe endpoint correspondente.

12. Filtros

Enviar ao backend:

incidenteId
status
canal
tipoEvento
inicio
fim

Tudo server-side.

Ao alterar filtro:

page=0

preferencialmente.

Não filtrar localmente a página carregada.

13. Filtro por Incidente

Pode utilizar incidenteId diretamente.

Se houver lookup visual, reutilizar IncidenteApiService.

Como Incidentes são paginados, não assumir que uma única página representa todos.

Se não houver endpoint de lookup dedicado, utilizar estratégia compatível com size <= 100 e documentar limitações de escala.

Não inventar endpoint.

14. Filtro por Canal

Atualmente:

TELEGRAM

Pode existir select com um único valor real.

Não remover o conceito de canal do model só porque hoje existe apenas Telegram.

15. Filtro por Evento

Usar:

INCIDENTE_ABERTO
INCIDENTE_FECHADO

Apresentação pode mapear para labels amigáveis:

Incidente aberto
Incidente fechado

Sem alterar o valor de domínio.

16. Filtro por Status

Usar:

PENDENTE
ENVIANDO
ENVIADA
FALHA

Não inventar:

CANCELADA
REJEITADA
LIDA

se não existem no contrato.

17. Filtro por período

Usar:

inicio
fim

como Instant.

Se a UI usar datetime-local, converter corretamente para ISO-8601 UTC.

Validar UX para evitar:

inicio > fim

e também tratar eventual:

400 INVALID_REQUEST

do backend.

18. Paginação

Utilizar PageResponse<T>.

Paginação server-side.

Não baixar todo o histórico.

19. Sort

Enviar somente campos permitidos:

id
canal
tipoEvento
status
tentativas
enviadoEm
createdAt
updatedAt

Um sort default coerente pode ser:

createdAt,desc

ou id,desc, conforme backend/design.

20. Apresentação da Notificação

Exibir dados reais como:

Incidente;

Canal;

Evento;

Status;

Tentativas;

Enviado em;

Erro;

Criado em;

Atualizado em.

Não inventar campos.

21. Status visual

Pode mapear:

PENDENTE -> neutro/aguardando
ENVIANDO -> informativo
ENVIADA -> sucesso
FALHA -> erro

Isso é apenas apresentação.

Não alterar o status localmente.

22. Tentativas

tentativas representa dado de backend.

Não incrementar no Angular.

Não simular retry.

Não implementar scheduler.

23. Erro de envio

Se houver campo erro, exibir de forma segura e legível.

Não assumir que o erro contém secret.

Mesmo assim, não renderizar HTML bruto.

Tratar como texto.

24. Detalhe

Se houver rota:

/notificacoes/:id

mostrar apenas dados reais.

Pode incluir link para:

/incidentes/{incidenteId}

quando o DTO fornecer a referência.

25. Integração com Incidente

Na tela:

/incidentes/:id

pode existir seção de histórico de Notificações do Incidente usando:

GET /notificacoes?incidenteId=<id>

com paginação.

Não duplicar toda a página de Notificações.

Reutilizar componentes quando houver ganho concreto.

26. Telegram no menu

Se o Claude Design usa "Telegram" como item de navegação, avaliar uma das opções:

Opção A

Manter label visual:

Telegram

apontando para:

/notificacoes

com subtítulo/contexto claro de histórico de notificações.

Opção B

Renomear visualmente para:

Notificações

se isso aderir melhor ao domínio real.

Documentar a decisão.

Não criar uma página de configuração de Bot Token sem backend correspondente.

27. Configuração de Telegram

Se o protótipo mostrar:

Bot Token
Chat ID
Testar conexão
Eventos

não implementar esses controles nesta fase se não existem endpoints backend correspondentes.

Não criar config fake.

Se necessário, manter apenas referência visual indisponível ou omitir.

28. Erros

Tratar via ApiError.code.

Principais:

INVALID_ENUM
INVALID_PARAMETER
INVALID_REQUEST
RESOURCE_NOT_FOUND
BUSINESS_CONFLICT
INTERNAL_ERROR

Não comparar message para identificar tipo.

29. 404

Se detalhe de Notificação existir, tratar:

RESOURCE_NOT_FOUND

com estado visual apropriado.

30. Estado da UI

Tratar:

loading
success
empty
error

Não usar alert().

31. Design

Reutilizar Design System existente.

Preservar Claude Design em:

filtros;

tabela;

badges;

detalhe;

spacing;

tipografia;

estados;

responsividade.

Não criar painel Telegram genérico desconectado do sistema.

32. Responsividade

Validar:

desktop;

tablet;

mobile.

Filtros devem reorganizar-se.

Erro de envio longo deve quebrar linha de forma segura.

33. Acessibilidade

Garantir:

labels;

foco visível;

navegação por teclado;

status textual;

links semânticos;

conteúdo de erro legível.

34. Estado Angular

Não introduzir NgRx.

Usar padrão atual.

Evitar subscriptions sem cleanup.

35. Testes — NotificacaoApiService

Cobrir:

list default
page
size
sort
incidenteId
status
canal
tipoEvento
inicio
fim
combinação de filtros
GET por id

Validar:

URL
method
query params

36. Testes — Tela

Cobrir:

loading;

success;

empty;

error;

filtro por Incidente;

filtro por Status;

filtro por Canal;

filtro por Evento;

período;

paginação;

sort;

enviadoEm = null;

erro = null;

status PENDENTE;

ENVIANDO;

ENVIADA;

FALHA.

37. Testes de segurança conceitual

Garantir que:

nenhum token Telegram esteja hardcoded;

nenhum request seja feito para api.telegram.org;

nenhum botão fake de envio direto seja criado;

tentativas não seja alterado localmente.

38. Não implementar nesta fase

Não implementar:

envio manual direto;

retry manual se não houver endpoint;

Bot Token no Angular;

Chat ID secreto no Angular;

configuração completa do bot;

autenticação;

usuários;

manutenção;

auditoria;

relatórios;

WebSocket;

SSE;

polling.

39. Validação final

Ao concluir:

executar testes;

executar build;

corrigir erros;

validar /notificacoes;

validar paginação;

validar filtros;

validar período;

validar statuses;

validar detalhe, se implementado;

validar integração com Incidente, se implementada;

buscar no código por api.telegram.org;

buscar por BOT_TOKEN e TELEGRAM_BOT_TOKEN;

confirmar ausência de secrets;

validar responsividade;

revisar git diff;

reler esta especificação.

Não concluir com build/testes quebrados.

40. Critérios de aceite

F08 está concluída quando:

/notificacoes usar backend real;

NotificacaoApiService existir;

paginação for server-side;

filtros incidenteId, status, canal, tipoEvento, inicio, fim forem enviados ao backend;

detalhe existir se fizer sentido no design;

status forem apresentados sem alteração local;

tentativas não forem incrementadas no Angular;

erro de envio for apresentado com segurança;

nenhum secret estiver no frontend;

nenhuma chamada direta ao Telegram existir;

nenhuma configuração fake do bot for criada;

integração com Incidente for feita apenas via backend real;

loading estiver tratado;

empty estiver tratado;

error estiver tratado;

Design System for reutilizado;

testes passarem;

build passar.

41. Entrega

O relatório final deve conter:

Resumo

O que foi implementado.

Endpoints integrados

Lista de endpoints utilizados.

Models

DTOs/interfaces criados.

Services

Services criados.

Notificações

Descrever listagem, paginação, filtros, sort e detalhe.

Telegram

Confirmar explicitamente:

O Angular não chama a Telegram Bot API diretamente.

Confirmar também:

Nenhum Bot Token ou secret foi adicionado ao frontend.

Status

Descrever apresentação de:

PENDENTE
ENVIANDO
ENVIADA
FALHA

Eventos

Descrever:

INCIDENTE_ABERTO
INCIDENTE_FECHADO

Tentativas

Confirmar:

tentativas é apenas exibido; não é incrementado pelo Angular.

Integração com Incidente

Descrever eventual seção adicionada em /incidentes/:id.

Segurança

Informar resultado das buscas por:

api.telegram.org
BOT_TOKEN
TELEGRAM_BOT_TOKEN

Testes

Comandos, quantidade e resultados.

Build

Comando e resultado.

Git diff

Resumo dos arquivos modificados.

Critérios de aceite

Marcar cada item como OK, NÃO ATENDIDO ou N/A.

Pendências

Somente problemas reais da F08.

Observações para F09

Descobertas relevantes para integração visual final e mapa, sem implementar a próxima fase.