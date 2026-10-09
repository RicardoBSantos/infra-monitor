1. Objetivo

Implementar no frontend Angular do Infra Monitor o módulo real de Inventário / Equipamentos, conectado ao backend existente e aderente ao Claude Design.

Esta fase deve entregar:

listagem paginada server-side;

filtros reais por Unidade, Tipo de equipamento e status administrativo;

criação;

edição;

ativação;

desativação;

exclusão quando permitida;

detalhe do Equipamento;

carregamento dos lookups reais de Unidade e Tipo;

tratamento de erros e validações;

estados de loading, empty, error e saving;

fidelidade visual ao design aprovado.

Não implementar ainda configuração completa de Monitores.

2. Pré-condições

Já foram concluídas:

F01 — Fundação Angular;

F02 — Design System + Application Shell;

F03 — Dashboard;

F04 — Unidades e Tipos de Equipamento.

Antes de alterar código:

ler package.json;

revisar a arquitetura atual;

revisar ApiError, interceptor e helpers compartilhados;

revisar os services de Unidades e Tipos criados na F04;

revisar os componentes visuais compartilhados;

analisar no Claude Design as telas de Inventário, Equipamentos e detalhe;

confirmar os DTOs reais do backend;

verificar o estado atual do Git.

Não recriar infraestrutura existente.

3. Relações de domínio

Todo Equipamento pertence obrigatoriamente a:

1 Unidade
+
1 TipoEquipamento

Conceitualmente:

Unidade
↓
Equipamento
↑
TipoEquipamento

A UI deve preservar essa relação.

Não criar Equipamento sem Unidade.

Não criar Equipamento sem Tipo de equipamento.

4. Fonte de verdade funcional

Equipamentos

GET    /api/v1/equipamentos
POST   /api/v1/equipamentos
GET    /api/v1/equipamentos/{id}
PUT    /api/v1/equipamentos/{id}
PATCH  /api/v1/equipamentos/{id}/ativar
PATCH  /api/v1/equipamentos/{id}/desativar
DELETE /api/v1/equipamentos/{id}

Filtros disponíveis:

unidadeId
tipoEquipamentoId
ativo

Sort permitido:

id
nome
ip
hostname
localizacao
ativo
createdAt
updatedAt

A listagem é paginada.

5. Paginação

Utilizar o contrato público:

{
"content": [],
"page": 0,
"size": 20,
"totalElements": 0,
"totalPages": 0,
"first": true,
"last": true
}

page é zero-based.

size máximo é 100.

Usar paginação server-side.

Não baixar todos os Equipamentos para paginar no navegador.

6. Payload de criação

Contrato conceitual confirmado:

{
"unidadeId": 1,
"tipoEquipamentoId": 2,
"nome": "SW-CORE-01",
"ip": "10.0.0.1",
"hostname": "sw-core-01",
"descricao": "Switch core",
"localizacao": "CPD"
}

Confirmar os DTOs exatos no backend antes de codificar.

Não inventar campos provenientes do Claude Design.

7. Campos que não devem ser inventados

O protótipo visual pode conter informações como:

MAC
serial
patrimônio
último ping
latência atual
online/offline
packet loss
manutenção

Esses campos não devem entrar no DTO de Equipamento sem suporte real do backend.

Equipamento representa inventário.

Status operacional é outra responsabilidade.

8. Status administrativo x operacional

Regra crítica:

ativo

é estado administrativo.

Não confundir com:

DISPONIVEL
INDISPONIVEL
SEM_DADOS
DESABILITADO
SEM_MONITORAMENTO

que são estados operacionais retornados pela Dashboard API.

A tela administrativa pode exibir Ativo/Inativo.

Se exibir status operacional, ele deve vir de endpoint Dashboard apropriado, nunca ser inferido localmente.

9. Rotas

Implementar/substituir placeholders para:

/equipamentos
/equipamentos/:id

A rota /equipamentos representa o Inventário.

A rota de detalhe deve permitir visualizar informações do Equipamento e preparar a evolução futura para Monitores.

Não implementar Monitores completos nesta fase.

10. EquipamentoApiService

Criar service dedicado:

EquipamentoApiService

ou nome coerente com o padrão atual.

Responsabilidades:

listagem paginada;

filtros;

sort;

GET por id;

POST;

PUT;

ativar;

desativar;

DELETE.

Não misturar operações de Dashboard no mesmo service.

11. Models e DTOs

Criar interfaces explícitas baseadas no contrato real, por exemplo:

EquipamentoResponse
EquipamentoCreateRequest
EquipamentoUpdateRequest
EquipamentoListQuery

Reutilizar PageResponse<T>.

Evitar any.

Representar corretamente campos nullable.

Datas de API permanecem string ISO.

12. Lookups de formulários

Reutilizar os endpoints administrativos já existentes:

GET /api/v1/unidades?ativo=true

GET /api/v1/tipos-equipamento?ativo=true

Os selects de criação/edição devem utilizar somente recursos ativos quando o contrato assim exige.

Não hardcode opções.

Não duplicar listas em constantes locais.

13. Unidade inativa / Tipo inativo

O backend pode retornar conflito ao tentar usar referências administrativamente inválidas.

Tratar erros como:

BUSINESS_CONFLICT

apresentando a mensagem real do backend.

Na edição de um Equipamento antigo vinculado a Unidade/Tipo atualmente inativo, preservar corretamente o valor existente caso o backend permita retorná-lo.

Não remover silenciosamente a referência atual do formulário.

14. Tela de Inventário

Implementar a listagem real em:

/equipamentos

Deve possuir:

Page Header;

filtros;

botão de novo Equipamento;

tabela/listagem;

paginação;

ações por registro;

loading;

empty;

error.

Seguir o Claude Design.

15. Filtros

Utilizar os query params do backend:

unidadeId
tipoEquipamentoId
ativo

Os filtros devem disparar nova consulta server-side.

Pode existir:

Unidade: Todas
Tipo: Todos
Status administrativo: Todos / Ativos / Inativos

Ao alterar filtros, voltar preferencialmente para page=0.

Não filtrar localmente a página já carregada.

16. Sort

Implementar somente sorts úteis ao design e aceitos pelo backend.

Campos permitidos:

id
nome
ip
hostname
localizacao
ativo
createdAt
updatedAt

Não enviar campos de sort arbitrários.

Sort inválido gera 400 INVALID_REQUEST.

Pode existir sort padrão coerente, por exemplo nome,asc, desde que compatível com o contrato e design.

17. Formulário de criação

Implementar criação de Equipamento com Reactive Forms.

Campos devem seguir o DTO real, incluindo conceitualmente:

unidadeId
tipoEquipamentoId
nome
ip
hostname
descricao
localizacao

Regras:

Unidade obrigatória;

Tipo obrigatório;

validações coerentes com backend;

lookup real;

saving state;

evitar submit duplicado;

mapear VALIDATION_ERROR.fields.

Após sucesso, atualizar a listagem ou navegar conforme UX aprovada.

18. Formulário de edição

Buscar o Equipamento real por id quando necessário.

Permitir editar apenas campos suportados pelo PUT.

Não editar campos operacionais.

Não incluir:

online
lastPing
latenciaAtual
statusOperacional

no request administrativo.

Preservar nullability corretamente.

19. Detalhe do Equipamento

Implementar:

/equipamentos/:id

A tela deve reproduzir o detalhe previsto no Claude Design dentro do que o backend atual suporta.

Pode apresentar:

dados cadastrais;

Unidade;

Tipo;

IP;

hostname;

descrição;

localização;

status administrativo;

timestamps;

ações administrativas.

Se o design contiver abas de Monitores, Histórico ou Incidentes, elas podem ser preservadas estruturalmente apenas se não criarem dados fake.

A implementação funcional dessas áreas pertence às fases seguintes.

20. Ativar/desativar

Usar:

PATCH /api/v1/equipamentos/{id}/ativar
PATCH /api/v1/equipamentos/{id}/desativar

Não atualizar apenas localmente.

A UI deve refletir a resposta real do backend.

21. Exclusão

Usar confirmação visual.

Fluxo:

confirmar
→ DELETE
→ 204
→ remover/atualizar via estado confirmado

Em:

409 BUSINESS_CONFLICT
409 DATA_INTEGRITY_VIOLATION

manter o Equipamento e apresentar a mensagem real.

Não fazer remoção otimista.

22. Erros de validação

Quando receber:

{
"code": "VALIDATION_ERROR",
"fields": {
"ip": "...",
"nome": "..."
}
}

mapear aos respectivos controles.

Preservar mensagem geral para erros sem correspondência de campo.

23. Outros erros

Tratar:

RESOURCE_NOT_FOUND
BUSINESS_CONFLICT
DATA_INTEGRITY_VIOLATION
INVALID_REQUEST
INTERNAL_ERROR

conforme infraestrutura existente.

Não comparar mensagens textuais para determinar o tipo.

24. Estado da UI

Tratar explicitamente:

loading
success
empty
error
saving
deleting
activating
deactivating

Não mostrar tabela vazia durante loading como se fosse resultado real.

Não usar alert().

25. Componentes compartilhados

Reutilizar:

PageHeader;

LoadingState;

EmptyState;

ErrorState;

ConfirmDialog;

badge administrativo;

paginação;

controles existentes.

Criar novos componentes somente diante de repetição concreta.

Não criar UniversalTable.

26. Design

Preservar o Claude Design para:

layout;

filtros;

tabela;

badges;

ações;

forms;

detail view;

spacing;

tipografia;

responsividade.

Não transformar Inventário em uma tela genérica de Bootstrap/Material.

27. Responsividade

Validar:

desktop;

tablet;

mobile.

Filtros devem reorganizar-se sem quebrar layout.

Tabela deve ter estratégia coerente em tela menor.

Ações principais devem permanecer acessíveis.

28. Acessibilidade

Garantir:

labels;

foco visível;

controles semânticos;

mensagens de erro acessíveis;

dialogs acessíveis;

paginação navegável;

estados comunicados por texto.

29. Estado Angular

Não introduzir NgRx.

Usar a abordagem atual do projeto.

Evitar subscriptions sem cleanup.

Manter filtros, paginação e loading de forma previsível.

30. URL e estado de filtros

Se a arquitetura atual já favorecer query params do Angular Router, considerar refletir filtros/página na URL.

Exemplo conceitual:

/equipamentos?unidadeId=1&ativo=true&page=0

Não é obrigatório se isso gerar complexidade desnecessária, mas deve ser avaliado.

Não confundir query params da rota frontend com os params enviados à API.

31. Testes de service

Cobrir:

listagem default;

paginação;

size;

sort;

unidadeId;

tipoEquipamentoId;

ativo;

combinação de filtros;

GET por id;

POST;

PUT;

ativar;

desativar;

DELETE.

Validar método HTTP, URL, params e payload.

32. Testes de componente

Cobrir:

loading;

success;

empty;

error;

filtros server-side;

troca de página;

criação;

edição;

lookup de Unidades;

lookup de Tipos;

validação por campo;

409;

ativar/desativar;

delete;

detalhe por id;

404 no detalhe.

33. Não implementar nesta fase

Não implementar:

configuração funcional de Monitores;

Medições;

histórico operacional completo;

Incidentes completos;

Notificações;

Telegram direto;

autenticação;

usuários;

manutenção;

auditoria;

configurações;

relatórios;

WebSocket;

SSE;

polling.

34. Validação final

Ao concluir:

executar testes;

executar build;

corrigir todos os erros;

validar listagem;

validar paginação;

validar filtros;

validar sort;

validar create;

validar edit;

validar lookups;

validar ativar/desativar;

validar delete;

validar 409;

validar errors por campo;

validar detalhe;

validar 404;

validar responsividade;

revisar git diff;

reler esta especificação.

Não concluir com build/testes quebrados.

35. Critérios de aceite

F05 está concluída quando:

/equipamentos utilizar backend real;

/equipamentos/:id estiver implementado;

EquipamentoApiService existir;

paginação for server-side;

filtros unidadeId, tipoEquipamentoId e ativo usarem backend;

sort enviado for válido;

criação funcionar;

edição funcionar;

selects usarem lookups reais ativos;

ativar funcionar;

desativar funcionar;

delete funcionar quando permitido;

409 for exibido corretamente;

VALIDATION_ERROR.fields for mapeado;

loading estiver tratado;

empty estiver tratado;

error estiver tratado;

nenhum campo operacional fictício entrar no CRUD;

ativo não for confundido com status operacional;

Design System for reutilizado;

testes relevantes passarem;

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

Campos, lookups, validações e mapeamento de erros.

Detalhe

Informações e estrutura implementadas.

Ativação/desativação

Fluxo adotado.

Exclusão

Confirmação, 204 e 409.

Estados de UI

Loading, empty, error e saving.

Status administrativo

Confirmar explicitamente que ativo não foi tratado como status operacional.

Testes

Comandos, quantidade e resultados.

Build

Comando e resultado.

Git diff

Resumo dos arquivos modificados.

Critérios de aceite

Marcar cada item como OK, NÃO ATENDIDO ou N/A.

Pendências

Somente problemas reais da F05.

Observações para F06

Descobertas relevantes para Monitores, sem implementar a próxima fase.