1. Objetivo

Implementar no frontend Angular do Infra Monitor a feature de Monitores, conectada ao backend real e integrada ao detalhe de Equipamento.

Esta fase deve entregar:

listagem paginada server-side de Monitores;

filtros reais;

criação;

edição;

ativação;

desativação;

exclusão quando permitida;

integração com Equipamento;

configuração inicial de monitoramento ICMP;

estados de loading, empty, error e saving;

tratamento de validações e conflitos;

aderência ao Claude Design.

Não implementar ainda histórico de Medições ou tela completa de Incidentes.

2. Pré-condições

Já foram implementadas:

F01 — Fundação Angular;

F02 — Design System + Application Shell;

F03 — Dashboard;

F04 — Unidades e Tipos de Equipamento;

F05 — Inventário e Equipamentos.

Antes de alterar código:

revisar package.json;

revisar a arquitetura atual;

revisar EquipamentoApiService;

revisar detalhe de Equipamento;

revisar componentes compartilhados;

revisar PageResponse<T>, ApiError e interceptor;

analisar no Claude Design as áreas de Monitoramento e detalhe de Equipamento;

confirmar DTOs reais de Monitor no backend;

verificar o estado do Git.

Não recriar infraestrutura existente.

3. Conceito de Monitor

Monitor é configuração de monitoramento.

Não é resultado de monitoramento.

Conceitualmente:

Equipamento
↓
Monitor
↓
Medições
↓
Incidentes

Nesta fase, trabalhar apenas com a configuração do Monitor.

Não usar Monitor como sinônimo de Ping.

Mesmo que apenas ICMP exista atualmente, o frontend deve preservar o conceito de tipo.

4. Fonte de verdade funcional

Monitores

GET    /api/v1/monitores
POST   /api/v1/monitores
GET    /api/v1/monitores/{id}
PUT    /api/v1/monitores/{id}
PATCH  /api/v1/monitores/{id}/ativar
PATCH  /api/v1/monitores/{id}/desativar
DELETE /api/v1/monitores/{id}

A listagem é paginada.

Filtros:

equipamentoId
tipo
ativo

Sort permitido:

id
nome
tipo
intervaloSegundos
timeoutMs
ativo
createdAt
updatedAt

5. TipoMonitor

Enum público atual:

ICMP

Criar/usar tipagem explícita.

Não estruturar o frontend como se Monitor === ICMP.

Preparar a UI para futuramente suportar outros tipos sem overengineering.

6. Payload de criação

Contrato conceitual:

{
"equipamentoId": 10,
"tipo": "ICMP",
"nome": "ICMP principal",
"intervaloSegundos": 60,
"timeoutMs": 2000,
"falhasParaIncidente": 3,
"sucessosParaRecovery": 2
}

Confirmar DTOs reais no backend antes de codificar.

Não inventar campos.

7. Regra crítica: configuração x resultado

Campos como:

intervaloSegundos
timeoutMs
falhasParaIncidente
sucessosParaRecovery

são configuração.

Campos como:

status atual
latência atual
última medição
falhas consecutivas

não devem ser inventados no DTO administrativo se o backend não os retornar.

O frontend não calcula indisponibilidade.

8. Rotas

Implementar/substituir placeholder para:

/monitores

Também integrar Monitores à rota existente:

/equipamentos/:id

O detalhe de Equipamento deve permitir acessar/visualizar seus Monitores reais.

Pode usar aba, seção ou navegação conforme Claude Design.

9. MonitorApiService

Criar service dedicado, por exemplo:

MonitorApiService

Responsabilidades:

list(query)
getById(id)
create(request)
update(id, request)
activate(id)
deactivate(id)
delete(id)

Não misturar Medições ou Incidentes neste service.

10. Models

Criar contratos explícitos, por exemplo:

MonitorResponse
MonitorCreateRequest
MonitorUpdateRequest
MonitorListQuery

Reutilizar:

PageResponse<T>
TipoMonitor

Datas como string ISO.

Evitar any.

11. Listagem de Monitores

Implementar:

/monitores

com:

Page Header;

filtros;

tabela/listagem;

paginação;

ações;

loading;

empty;

error.

Filtros:

equipamentoId
tipo
ativo

Tudo server-side.

12. Paginação

Usar PageResponse<T>.

page zero-based.

Não paginar client-side.

Ao alterar filtro, voltar preferencialmente a page=0.

13. Filtro por Equipamento

Utilizar equipamentoId.

Se houver seleção de Equipamento, usar lookup real.

Pode reutilizar:

GET /api/v1/equipamentos?ativo=true

e filtros adicionais quando necessário.

Não hardcode equipamentos.

14. Filtro por Tipo

Tipo atual:

ICMP

A UI pode ter select.

Não hardcode lógica específica de Ping fora do formulário do tipo ICMP.

15. Filtro por ativo

Usar:

ativo=true
ativo=false

Não filtrar apenas localmente.

16. Formulário de criação

Reactive Forms.

Campos conceituais:

equipamentoId
tipo
nome
intervaloSegundos
timeoutMs
falhasParaIncidente
sucessosParaRecovery

O formulário deve:

validar campos obrigatórios;

impedir duplo submit;

mostrar saving;

mapear VALIDATION_ERROR.fields;

usar lookup real de Equipamentos;

enviar somente campos aceitos.

17. Formulário de edição

Usar:

GET /monitores/{id}
PUT /monitores/{id}

Permitir editar apenas campos aceitos.

Não editar:

ultimaMedicao
statusOperacional
latencia
incidenteAberto

se não fizerem parte do DTO administrativo.

18. Integração com detalhe de Equipamento

Na rota:

/equipamentos/:id

integrar uma seção/aba de Monitores.

Utilizar:

GET /api/v1/monitores?equipamentoId=<id>

com paginação.

Permitir, conforme design:

listar monitores do Equipamento;

criar novo Monitor já com equipamentoId conhecido;

editar;

ativar;

desativar;

excluir.

Não duplicar a tela inteira de /monitores.

Reutilizar componentes quando fizer sentido.

19. Equipamento inativo

O backend pode impedir criação/alteração de Monitor para Equipamento inativo.

Tratar BUSINESS_CONFLICT.

Não contornar regra no frontend.

Se o Equipamento estiver inativo, pode desabilitar ação de criação caso isso reflita claramente o contrato, mas o backend continua autoridade.

20. Ativar/desativar

Usar endpoints específicos:

PATCH /monitores/{id}/ativar
PATCH /monitores/{id}/desativar

Não alterar apenas localmente.

A UI deve refletir a resposta real.

21. Exclusão

Usar confirmação visual.

Fluxo:

confirmar
→ DELETE
→ 204
→ atualizar UI

Em 409:

manter item
→ mostrar mensagem real

Não fazer remoção otimista.

22. Validation errors

Mapear:

VALIDATION_ERROR.fields

para controles como:

nome
intervaloSegundos
timeoutMs
falhasParaIncidente
sucessosParaRecovery

e demais campos reais.

23. Outros erros

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

24. Estado administrativo x operacional

ativo de Monitor é administrativo.

Status operacional do Monitor pertence ao Dashboard:

DISPONIVEL
INDISPONIVEL
SEM_DADOS
DESABILITADO

Não converter:

ativo=true -> DISPONIVEL
ativo=false -> INDISPONIVEL

Se algum status operacional for exibido, deve vir de endpoint apropriado.

25. Thresholds

Os campos:

falhasParaIncidente
sucessosParaRecovery

são configurações.

O Angular pode permitir edição desses valores.

Mas não deve usar esses números para recalcular o estado operacional.

26. Design

Usar o Claude Design para:

lista de Monitoramento;

detalhe;

forms;

badges;

ações;

spacing;

tipografia;

responsividade.

Não transformar em CRUD genérico.

27. Responsividade

Validar:

desktop;

tablet;

mobile.

Filtros e formulários devem reorganizar-se corretamente.

28. Acessibilidade

Garantir:

labels;

foco;

teclado;

dialogs acessíveis;

mensagens de erro;

campos numéricos com semântica adequada;

status com texto.

29. Estado Angular

Não introduzir NgRx.

Usar o padrão existente.

Evitar subscriptions sem cleanup.

30. Componentes compartilhados

Reutilizar:

PageHeader;

LoadingState;

EmptyState;

ErrorState;

ConfirmDialog;

paginação;

badges;

form controls existentes.

Criar compartilhados novos somente se houver repetição real.

31. Testes de service

Cobrir:

listagem default
page
size
sort
equipamentoId
tipo
ativo
combinação de filtros
GET por id
POST
PUT
PATCH ativar
PATCH desativar
DELETE

Validar URL, método, params e payload.

32. Testes de componentes

Cobrir:

loading;

success;

empty;

error;

filtro por Equipamento;

filtro por Tipo;

filtro ativo;

paginação;

criação;

edição;

lookup de Equipamento;

VALIDATION_ERROR.fields;

INVALID_ENUM;

409;

ativar;

desativar;

delete;

integração na tela de Equipamento.

33. Não implementar nesta fase

Não implementar:

histórico de Medições;

gráficos de latência;

falhas consecutivas em tempo real;

Incidentes completos;

Notificações;

Telegram direto;

relatórios;

autenticação;

usuários;

manutenção;

auditoria;

WebSocket;

SSE;

polling.

34. Validação final

Ao concluir:

executar testes;

executar build;

corrigir erros;

validar /monitores;

validar filtros;

validar paginação;

validar create;

validar edit;

validar lookup de Equipamentos;

validar integração no detalhe de Equipamento;

validar ativar/desativar;

validar delete;

validar 409;

validar erros por campo;

validar responsividade;

revisar git diff;

reler esta especificação.

Não concluir com build/testes quebrados.

35. Critérios de aceite

F06 está concluída quando:

/monitores usar backend real;

MonitorApiService existir;

paginação for server-side;

filtros equipamentoId, tipo e ativo forem enviados ao backend;

criação funcionar;

edição funcionar;

lookup de Equipamento for real;

integração com /equipamentos/:id existir;

ativação funcionar;

desativação funcionar;

delete funcionar quando permitido;

409 for tratado corretamente;

VALIDATION_ERROR.fields for mapeado;

INVALID_ENUM for tratado;

loading estiver tratado;

empty estiver tratado;

error estiver tratado;

ativo não for confundido com status operacional;

thresholds não forem usados para recalcular status;

Design System for reutilizado;

testes passarem;

build passar.

36. Entrega

O relatório final deve conter:

Resumo

O que foi implementado.

Endpoints integrados

Lista dos endpoints utilizados.

Models

DTOs/interfaces criados.

Services

Services criados.

Listagem

Paginação, filtros e sort.

Formulários

Campos, validações e erros.

Equipamentos

Como o lookup foi implementado.

Integração com detalhe de Equipamento

O que foi adicionado em /equipamentos/:id.

Ativar/desativar

Fluxo adotado.

Exclusão

Confirmação, 204 e 409.

Estado administrativo

Confirmar que ativo não foi usado para calcular disponibilidade.

Thresholds

Confirmar que falhasParaIncidente e sucessosParaRecovery são apenas configuração.

Testes

Comandos, quantidade e resultados.

Build

Comando e resultado.

Git diff

Resumo dos arquivos modificados.

Critérios de aceite

Marcar cada item como OK, NÃO ATENDIDO ou N/A.

Pendências

Somente problemas reais da F06.

Observações para F07

Descobertas relevantes para Medições e Incidentes, sem implementar a próxima fase.