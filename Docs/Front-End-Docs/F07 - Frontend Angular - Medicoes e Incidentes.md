1. Objetivo

Implementar no frontend Angular do Infra Monitor as features operacionais de:

Medições;

Incidentes.

Esta fase deve entregar:

histórico paginado de Medições;

filtros reais por Monitor, status e período;

visualização somente leitura de Medições;

histórico paginado de Incidentes;

filtros reais por Monitor, Equipamento, Unidade, status e período;

detalhe de Incidente;

fechamento manual de Incidente quando permitido;

tratamento de loading, empty, error e paginação;

integração visual com o Design System existente;

aderência ao Claude Design;

preservação rigorosa da regra de negócio de que Medição e Incidente são conceitos diferentes.

Não implementar ainda Notificações/Telegram.

2. Pré-condições

Já foram concluídas:

F01 — Fundação Angular;

F02 — Design System + Application Shell;

F03 — Dashboard;

F04 — Unidades e Tipos de Equipamento;

F05 — Inventário e Equipamentos;

F06 — Monitores.

Antes de alterar código:

revisar package.json;

revisar PageResponse<T>;

revisar ApiError e interceptor;

revisar MonitorApiService;

revisar EquipamentoApiService;

revisar services de Unidades;

revisar componentes compartilhados;

analisar no Claude Design as telas de Medições, Incidentes e detalhe;

confirmar DTOs reais do backend;

verificar o estado do Git.

Não recriar infraestrutura existente.

3. Regra central: Medição ≠ Incidente

Esta é uma regra obrigatória.

Medição

Representa uma execução individual de Monitor.

Status público:

SUCESSO
FALHA

Incidente

Representa uma indisponibilidade consolidada pelo backend.

Status público:

ABERTO
FECHADO

Uma Medição FALHA não significa automaticamente que existe um Incidente ABERTO.

O Angular não deve implementar regra como:

medicao.status === FALHA
→ incidente aberto

nem qualquer inferência baseada em quantidade de falhas.

O Incident Engine no backend já aplica thresholds e regras de recovery.

4. Fonte de verdade funcional — Medições

Endpoints:

GET  /api/v1/medicoes
POST /api/v1/medicoes
GET  /api/v1/medicoes/{id}

Para o frontend desta fase, Medições devem ser tratadas principalmente como histórico de leitura.

A UI não deve oferecer edição.

A criação via POST /medicoes existe no contrato, mas não deve ser exposta como ação administrativa comum nesta fase, salvo requisito explícito e real do sistema.

Filtros:

monitorId
status
inicio
fim

Sort permitido:

id
status
latenciaMs
executadoEm
createdAt

Default conceitual:

executadoEm DESC

Paginação default de Medições:

size = 50

5. Fonte de verdade funcional — Incidentes

Endpoints:

GET   /api/v1/incidentes
POST  /api/v1/incidentes
GET   /api/v1/incidentes/{id}
PATCH /api/v1/incidentes/{id}/fechar

Para esta fase, a UI deve focar em:

listagem;

filtros;

detalhe;

fechamento manual.

Não criar fluxo visual de abertura manual de Incidente se isso não fizer parte do design/requisito real.

Filtros:

monitorId
equipamentoId
unidadeId
status
inicio
fim

Sort permitido:

id
status
iniciadoEm
encerradoEm
createdAt
updatedAt

6. Rotas

Implementar/substituir placeholders para:

/medicoes
/incidentes
/incidentes/:id

Opcionalmente, integrar histórico contextual em:

/equipamentos/:id

e/ou:

/monitores

somente se houver reaproveitamento limpo e aderência ao design.

Não duplicar telas inteiras.

7. Services

Criar services separados:

MedicaoApiService
IncidenteApiService

MedicaoApiService

Responsabilidades:

list(query)
getById(id)

Evitar expor create() na UI se não houver caso de uso real.

IncidenteApiService

Responsabilidades:

list(query)
getById(id)
close(id)

Não criar service genérico.

8. Models — Medição

Criar interfaces explícitas, por exemplo:

MedicaoResponse
MedicaoListQuery

Campos conceituais:

id
monitor
status
latenciaMs
mensagem
executadoEm
createdAt

Confirmar DTO real no backend antes de implementar.

Representar corretamente:

latenciaMs: number | null
mensagem: string | null

se o contrato permitir null.

Datas como string ISO.

9. Models — Incidente

Criar interfaces explícitas, por exemplo:

IncidenteResponse
IncidenteListQuery

Campos conceituais:

id
monitor
status
iniciadoEm
encerradoEm
motivo
observacao
createdAt
updatedAt

encerradoEm pode ser null quando Incidente estiver aberto.

Não substituir null por string vazia ou valor fictício.

10. Tela de Medições

Implementar:

/medicoes

com:

Page Header;

filtros;

tabela/listagem;

paginação;

loading;

empty;

error.

Medições são somente leitura.

Não incluir botões de editar/excluir.

11. Filtros de Medições

Utilizar backend real:

monitorId
status
inicio
fim

Todos os filtros devem disparar nova requisição server-side.

Ao alterar filtros:

page = 0

preferencialmente.

Não filtrar localmente a página carregada.

12. Filtro por Monitor

Reutilizar MonitorApiService para lookup quando necessário.

Como Monitores são paginados, não assumir que uma única página representa todos os registros.

Se não houver endpoint de lookup otimizado, usar estratégia coerente com limite size <= 100 e documentar eventual limitação de escalabilidade.

Não inventar endpoint.

13. Filtro por StatusMedicao

Usar enum público:

SUCESSO
FALHA

Não inventar estados como timeout/offline.

Se o backend retorna detalhes adicionais em mensagem, exibi-los sem transformar em novo enum.

14. Filtro por período

Usar:

inicio
fim

como instantes compatíveis com backend.

Não alterar semanticamente o instante.

Se a UI usar datetime-local, converter cuidadosamente para ISO-8601 UTC antes de enviar.

Validar UX para evitar:

inicio > fim

O backend também valida e pode retornar:

400 INVALID_REQUEST

Preservar tratamento do erro.

15. Sort de Medições

Enviar apenas campos aceitos:

id
status
latenciaMs
executadoEm
createdAt

Preferir:

executadoEm,desc

para histórico, se compatível com design.

16. Apresentação de Medição

Exibir conforme dados reais:

Monitor;

status;

latência;

mensagem;

horário de execução.

Para FALHA com latenciaMs = null, apresentar ausência de valor corretamente.

Não mostrar 0 ms se o backend retornar null.

17. Tela de Incidentes

Implementar:

/incidentes

com:

Page Header;

filtros;

tabela/listagem;

paginação;

ações;

loading;

empty;

error.

A página deve refletir o Claude Design, sem inventar severidades ou estados não existentes no backend.

18. Filtros de Incidentes

Utilizar:

monitorId
equipamentoId
unidadeId
status
inicio
fim

Tudo server-side.

Ao alterar filtro, voltar preferencialmente a:

page=0

Não cruzar arrays localmente.

19. Lookups de filtros de Incidentes

Reutilizar services existentes:

UnidadeApiService
EquipamentoApiService
MonitorApiService

Não duplicar services.

Quando necessário, encadear UX de filtros:

Unidade
↓
Equipamentos daquela Unidade
↓
Monitores daquele Equipamento

somente se isso melhorar a usabilidade e sem inventar regras.

Os endpoints já suportam filtros úteis.

20. StatusIncidente

Enum público:

ABERTO
FECHADO

Não adicionar:

ACKNOWLEDGED
CRITICAL
RESOLVED

se não existirem no contrato.

21. Detalhe do Incidente

Implementar:

/incidentes/:id

Mostrar dados reais:

id;

Monitor;

Equipamento/Unidade se presentes ou deriváveis legitimamente do DTO;

status;

iniciadoEm;

encerradoEm;

motivo;

observação;

createdAt;

updatedAt.

Não inventar campos ausentes.

22. Fechamento manual

Implementar:

PATCH /api/v1/incidentes/{id}/fechar

A ação deve estar disponível apenas quando fizer sentido visualmente, por exemplo para Incidente ABERTO.

Fluxo:

usuário solicita fechamento
→ confirmação, se apropriado
→ PATCH
→ recurso atualizado
→ UI atualizada

Não alterar status localmente sem resposta do backend.

23. Fechamento automático

O backend também pode fechar Incidentes automaticamente.

A UI deve aceitar o status retornado.

Não assumir que todo Incidente só fecha por ação humana.

24. Concorrência de fechamento

Um Incidente pode ter sido fechado automaticamente entre carregamento e clique.

Tratar eventual conflito/estado atualizado do backend.

Não forçar FECHADO localmente.

Após operação, utilizar a resposta real ou recarregar o recurso conforme padrão existente.

25. Erros

Tratar por ApiError.code.

Principais:

VALIDATION_ERROR
INVALID_ENUM
INVALID_PARAMETER
INVALID_REQUEST
RESOURCE_NOT_FOUND
BUSINESS_CONFLICT
DATA_INTEGRITY_VIOLATION
INTERNAL_ERROR

Não comparar message para identificar tipo.

26. 404

Em:

/incidentes/:id

tratar RESOURCE_NOT_FOUND com estado visual apropriado.

Não deixar loading infinito.

27. Estado de UI

Tratar explicitamente:

loading
success
empty
error
closing

Na listagem de Medições:

loading
success
empty
error

Não usar alert().

28. Integração com detalhe de Equipamento

Se o Claude Design já possui abas/áreas de:

Incidentes
Histórico

em /equipamentos/:id, integrar de forma limpa quando possível.

Incidentes do Equipamento

Usar:

GET /incidentes?equipamentoId=<id>

Medições

Como Medições filtram por monitorId, não inventar filtro equipamentoId para /medicoes.

Se quiser exibir histórico de Medições por Equipamento, será necessário:

Equipamento
→ Monitores
→ Medições de um Monitor

Não faça dezenas de chamadas automaticamente apenas para montar uma tela agregada.

Se o design exigir visão agregada que o backend não fornece, documentar gap em vez de inventar lógica pesada no frontend.

29. Relação com Dashboard

Não usar a listagem de Medições para recalcular o status mostrado no Dashboard.

Não usar Incidentes históricos para recalcular disponibilidade.

Dashboard continua fonte do estado operacional consolidado.

30. Componentes compartilhados

Reutilizar:

PageHeader;

LoadingState;

EmptyState;

ErrorState;

Pagination;

ConfirmDialog;

StatusBadge;

date formatting helpers existentes.

Criar novos compartilhados somente se houver repetição real.

31. Design

Preservar o Claude Design em:

filtros;

timeline/tabela quando aplicável;

badges;

detalhe;

spacing;

tipografia;

estados;

responsividade.

Não inventar visual genérico.

32. Datas

Todas as datas vêm em ISO-8601 UTC.

Exibir em timezone/localidade da UI sem alterar o instante.

Para filtros enviados:

inicio
fim

gerar timestamps ISO coerentes.

Não truncar timezone silenciosamente.

33. Responsividade

Validar:

desktop;

tablet;

mobile.

Filtros de período e selects devem reorganizar-se.

Tabelas/listagens devem permanecer utilizáveis.

34. Acessibilidade

Garantir:

labels;

foco visível;

navegação por teclado;

status textual;

botões semânticos;

dialog acessível;

datas e mensagens legíveis.

35. Estado Angular

Não introduzir NgRx.

Usar padrão atual.

Evitar subscriptions sem cleanup.

36. Testes — MedicaoApiService

Cobrir:

listagem default
page
size
sort
monitorId
status
inicio
fim
combinação de filtros
GET por id

Validar URL, método e params.

37. Testes — IncidenteApiService

Cobrir:

listagem default
page
size
sort
monitorId
equipamentoId
unidadeId
status
inicio
fim
GET por id
PATCH fechar

Validar URL, método, params e payload quando aplicável.

38. Testes — Medições

Cobrir:

loading;

success;

empty;

error;

filtro por Monitor;

filtro por status;

período;

paginação;

ordenação;

latenciaMs = null;

distinção visual entre SUCESSO e FALHA.

39. Testes — Incidentes

Cobrir:

loading;

success;

empty;

error;

filtros server-side;

paginação;

detalhe;

404;

fechamento de ABERTO;

resposta atualizada;

erro/conflito no fechamento.

Incluir teste conceitual que garanta que uma Medição FALHA não cria status de Incidente localmente.

40. Não implementar nesta fase

Não implementar:

Notificações;

Telegram direto;

reconhecimento de Incidente;

severidade fictícia;

SLA;

gráficos avançados;

relatórios;

autenticação;

usuários;

manutenção;

auditoria;

WebSocket;

SSE;

polling.

41. Validação final

Ao concluir:

executar testes;

executar build;

corrigir erros;

validar /medicoes;

validar filtros de Medições;

validar paginação;

validar período;

validar /incidentes;

validar filtros de Incidentes;

validar paginação;

validar /incidentes/:id;

validar fechamento manual;

validar 404;

validar erro/conflito no fechamento;

validar responsividade;

revisar git diff;

reler esta especificação.

Não concluir com build/testes quebrados.

42. Critérios de aceite

F07 está concluída quando:

/medicoes usar backend real;

MedicaoApiService existir;

paginação de Medições for server-side;

filtros monitorId, status, inicio, fim forem enviados ao backend;

Medições forem somente leitura na UI;

/incidentes usar backend real;

IncidenteApiService existir;

paginação de Incidentes for server-side;

filtros monitorId, equipamentoId, unidadeId, status, inicio, fim forem enviados ao backend;

/incidentes/:id estiver implementado;

fechamento manual funcionar via PATCH;

UI refletir resposta real do backend;

404 for tratado;

loading estiver tratado;

empty estiver tratado;

error estiver tratado;

Medição FALHA não for convertida em Incidente no frontend;

status operacional não for recalculado;

Design System for reutilizado;

testes passarem;

build passar.

43. Entrega

O relatório final deve conter:

Resumo

O que foi implementado.

Endpoints integrados

Separar Medições e Incidentes.

Models

DTOs/interfaces criados.

Services

Services criados.

Medições

Descrever filtros, paginação, sort e apresentação.

Incidentes

Descrever filtros, paginação, detalhe e fechamento.

Regra Medição x Incidente

Confirmar explicitamente:

Uma Medição FALHA não é convertida em Incidente pelo Angular.

Status operacional

Confirmar:

Nenhum status operacional é recalculado a partir de Medições ou Incidentes históricos.

Datas

Descrever tratamento de ISO UTC e filtros inicio/fim.

Fechamento manual

Descrever fluxo PATCH e tratamento de concorrência/conflito.

Testes

Comandos, quantidade e resultados.

Build

Comando e resultado.

Git diff

Resumo dos arquivos modificados.

Critérios de aceite

Marcar cada item como OK, NÃO ATENDIDO ou N/A.

Pendências

Somente problemas reais da F07.

Observações para F08

Descobertas relevantes para Notificações/Telegram, sem implementar a próxima fase.