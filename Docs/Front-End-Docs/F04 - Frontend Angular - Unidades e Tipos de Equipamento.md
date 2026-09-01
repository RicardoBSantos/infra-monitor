F04 — Administração de Unidades e Tipos de Equipamento — Infra Monitor

1. Objetivo

Implementar no frontend Angular do Infra Monitor as áreas administrativas de Unidades e Tipos de equipamento, usando a fundação da F01, o Design System/Application Shell da F02 e os padrões de integração real com backend consolidados na F03.

Esta fase deve entregar CRUD administrativo real com listagem, criação, edição, ativação, desativação, exclusão quando permitida, validação, tratamento de erro, estados de loading/empty/error e fidelidade visual ao Claude Design.

Não implementar ainda o CRUD completo de Equipamentos.

2. Pré-condições

Já foram implementadas:

F01 — Fundação Angular;

F02 — Design System + Application Shell;

F03 — Dashboard.

Antes de alterar código:

ler package.json;

revisar a arquitetura atual;

revisar componentes compartilhados;

revisar interceptor e ApiError;

revisar os padrões de services usados na F03;

analisar no Claude Design as telas de Unidades e Tipos de equipamento;

verificar o estado atual do Git.

Não recriar infraestrutura existente nem duplicar componentes que já atendam à necessidade.

3. Fonte de verdade visual

O Claude Design continua sendo a referência para tabelas, cabeçalhos, botões, dialogs/drawers, formulários, badges, spacing, hierarquia e responsividade.

Não copiar dados mockados nem lógica React do protótipo.

4. Fonte de verdade funcional

Unidades

GET    /api/v1/unidades
POST   /api/v1/unidades
GET    /api/v1/unidades/{id}
PUT    /api/v1/unidades/{id}
PATCH  /api/v1/unidades/{id}/ativar
PATCH  /api/v1/unidades/{id}/desativar
DELETE /api/v1/unidades/{id}

Filtro:

ativo

Tipos de equipamento

GET    /api/v1/tipos-equipamento
POST   /api/v1/tipos-equipamento
GET    /api/v1/tipos-equipamento/{id}
PUT    /api/v1/tipos-equipamento/{id}
PATCH  /api/v1/tipos-equipamento/{id}/ativar
PATCH  /api/v1/tipos-equipamento/{id}/desativar
DELETE /api/v1/tipos-equipamento/{id}

Filtro:

ativo

5. Status administrativo x operacional

ativo é estado administrativo do cadastro.

Não confundir com os status operacionais retornados pela Dashboard API. O Angular não deve inferir que Unidade ou Tipo está operacionalmente indisponível por estar inativo administrativamente.

6. Rotas

Implementar/substituir placeholders para:

/unidades
/tipos-equipamento

Rotas de detalhe separadas só devem existir se o design/arquitetura atual realmente justificar. Caso create/edit funcionem melhor em dialog/drawer conforme o Claude Design, preferir esse padrão.

7. Services

Criar services separados por domínio, por exemplo:

UnidadeApiService
TipoEquipamentoApiService

Cada service deve suportar listar, buscar por id, criar, atualizar, ativar, desativar e excluir.

Não criar GenericCrudApiService<T>.

8. Models e DTOs

Criar models/interfaces estritamente conforme o contrato real, separando request/response quando fizer sentido:

UnidadeResponse
UnidadeCreateRequest
UnidadeUpdateRequest

TipoEquipamentoResponse
TipoEquipamentoCreateRequest
TipoEquipamentoUpdateRequest

Os campos exatos devem ser confirmados no backend/documentação antes de codificar. Não inventar campos a partir do protótipo.

9. Tela de Unidades

Deve suportar:

loading;

listagem;

filtro por ativo;

criação;

edição;

ativação;

desativação;

exclusão;

feedback de sucesso;

feedback de erro;

empty state.

10. Tela de Tipos de equipamento

Implementar os mesmos fluxos administrativos:

loading;

listagem;

filtro por ativo;

criação;

edição;

ativação;

desativação;

exclusão;

feedback de sucesso;

feedback de erro;

empty state.

11. Listagem e filtros

Os endpoints de Unidade e Tipo de equipamento não estão documentados como paginados. Não inventar paginação.

Utilizar o filtro real:

?ativo=true
?ativo=false

Uma opção visual Todos / Ativos / Inativos pode mapear para ausência ou presença do query param.

Não baixar tudo e filtrar localmente quando a API já fornece o filtro.

12. Formulários

Preferir Reactive Forms.

Os formulários devem:

refletir o contrato real;

aplicar validações úteis de UX;

preservar mensagens do backend;

enviar somente campos aceitos;

impedir duplo submit;

mostrar estado de saving.

O backend continua sendo a autoridade final de validação.

13. Validation fields

Quando houver:

{
"code": "VALIDATION_ERROR",
"fields": {
"nome": "must not be blank"
}
}

mapear fields aos controles correspondentes sempre que possível.

Não perder fields no interceptor.

Se algum campo não tiver controle correspondente, apresentar a mensagem de forma geral.

14. Conflitos 409

O backend pode retornar BUSINESS_CONFLICT ou DATA_INTEGRITY_VIOLATION.

Exibir a mensagem de negócio retornada.

Não transformar todo 409 numa mensagem fixa.

Casos típicos incluem nome duplicado, recurso referenciado e delete impedido por integridade referencial.

15. Exclusão

Usar confirmação visual coerente com o Design System.

Não usar window.confirm() como solução final se o projeto já possuir ou justificar um dialog próprio.

Fluxo:

confirmação
→ DELETE
→ 204
→ atualizar UI

Em 409:

manter item
→ exibir mensagem do backend

Não remover otimisticamente antes da confirmação real.

16. Ativar/desativar

Usar os endpoints específicos:

PATCH /{id}/ativar
PATCH /{id}/desativar

Não simular alteração local.

A UI deve refletir o recurso atualizado retornado pelo backend.

17. Feedback visual

Tratar explicitamente:

loading
success
empty
error
saving
deleting
activating
deactivating

Não usar alert().

Desabilitar ações concorrentes quando necessário para evitar requests duplicados.

18. Componentes compartilhados

Reutilizar PageHeader, EmptyState, LoadingState, ErrorState, dialogs, badges e botões já existentes.

Criar compartilhados novos somente diante de repetição concreta.

Não criar tabela universal, formulário universal ou CRUD genérico.

19. Design e responsividade

Preservar o Claude Design em header, filtros, ações, tabela/lista, forms/dialogs e status ativo/inativo.

Validar desktop, telas intermediárias e mobile.

Evitar overflow horizontal desnecessário.

20. Acessibilidade

Garantir labels, foco visível, navegação por teclado, botões semânticos, foco adequado em dialogs, descrição textual de status e mensagens de erro acessíveis.

21. Estado Angular

Não introduzir NgRx.

Usar o padrão já adotado no projeto e evitar subscriptions sem cleanup.

Após operações CRUD, atualizar o estado de forma previsível.

22. Fora do escopo

Não implementar:

Equipamentos completos;

Monitores;

Medições;

Incidentes;

Notificações;

Telegram direto;

autenticação;

usuários;

relatórios;

manutenção;

auditoria;

configurações;

mapa funcional;

WebSocket;

SSE;

polling.

23. Testes

Services de Unidades

Cobrir:

listagem;

filtro ativo;

GET por id;

POST;

PUT;

ativar;

desativar;

DELETE.

Services de Tipos

Cobrir os mesmos cenários.

Componentes

Cobrir:

loading;

listagem;

empty;

erro;

filtro;

abertura de create/edit;

submit;

VALIDATION_ERROR.fields;

409;

ativar/desativar;

delete com confirmação.

Não testar detalhes puramente cosméticos.

24. Validação final

Ao concluir:

executar testes;

executar build;

corrigir erros;

validar /unidades;

validar /tipos-equipamento;

validar create;

validar edit;

validar ativar/desativar;

validar delete;

validar 409;

validar erros por campo;

validar loading/empty/error;

validar responsividade;

revisar git diff;

reler esta especificação.

Não concluir com build ou testes quebrados.

25. Critérios de aceite

F04 está concluída quando:

/unidades funcionar com backend real;

/tipos-equipamento funcionar com backend real;

services separados existirem;

filtro ativo usar o backend;

criação funcionar;

edição funcionar;

ativação funcionar;

desativação funcionar;

delete funcionar quando permitido;

409 for apresentado corretamente;

VALIDATION_ERROR.fields for mapeado quando possível;

loading estiver tratado;

empty estiver tratado;

error estiver tratado;

estado administrativo não for confundido com operacional;

nenhum CRUD genérico prematuro tiver sido criado;

Design System da F02 estiver reutilizado;

testes relevantes passarem;

build passar.

26. Entrega

O relatório final deve conter:

Resumo

O que foi implementado.

Endpoints integrados

Lista de endpoints utilizados.

Models

DTOs/interfaces criados.

Services

Services criados.

Componentes

Telas e componentes criados/alterados.

Formulários

Validações e mapeamento de erros.

Ativação

Como ativar/desativar foi implementado.

Exclusão

Como confirmação e 409 foram tratados.

Estados de UI

Loading, empty, error e saving.

Rotas

Rotas criadas/alteradas.

Testes

Comandos, quantidade e resultados.

Build

Comando e resultado.

Git diff

Resumo dos arquivos modificados.

Critérios de aceite

Marcar cada item como OK, NÃO ATENDIDO ou N/A.

Pendências

Somente problemas reais da F04.

Observações para F05

Descobertas relevantes para Inventário/Equipamentos, sem implementar a próxima fase.