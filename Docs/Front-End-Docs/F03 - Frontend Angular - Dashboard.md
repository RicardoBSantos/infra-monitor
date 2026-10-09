1. Objetivo

Implementar o Dashboard operacional real do frontend Angular do Infra Monitor, utilizando o Application Shell e o Design System entregues na F02 e consumindo exclusivamente os endpoints reais da Dashboard API.

Esta fase deve transformar a tela de Dashboard do Claude Design em uma implementação Angular conectada ao backend.

A responsabilidade do Angular é apresentar os dados recebidos.

O Angular não deve recalcular status operacional.

2. Pré-condições

As fases anteriores já foram implementadas:

F01 — Fundação Angular;

F02 — Design System + Application Shell.

Antes de alterar código:

inspecionar o projeto Angular atual;

ler o package.json;

revisar os componentes e tokens visuais da F02;

revisar os contratos/models criados na F01;

localizar e analisar novamente a tela de Dashboard no Claude Design;

revisar a configuração de API e interceptor existentes;

verificar o estado do Git.

Não recriar estruturas já existentes.

Não substituir o Design System da F02 por outro.

3. Fonte de verdade

Visual

O Claude Design continua sendo a fonte de verdade para:

layout;

cards;

hierarquia;

espaçamento;

tipografia;

badges;

agrupamento por Unidade;

estados visuais;

responsividade.

Funcional

O backend Spring Boot é a fonte de verdade para:

métricas;

estados operacionais;

incidentes;

disponibilidade;

contagens;

paginação.

Não transportar lógica mock do protótipo.

4. Endpoints desta fase

Consumir principalmente:

GET /api/v1/dashboard/resumo

GET /api/v1/dashboard/unidades

GET /api/v1/dashboard/unidades/{id}

GET /api/v1/dashboard/unidades/{id}/equipamentos

A implementação deve utilizar a apiUrl centralizada na F01.

Não hardcode host/porta em componentes ou services.

5. DashboardApiService

Criar service dedicado, por exemplo:

DashboardApiService

ou nomenclatura equivalente coerente com o projeto.

Responsabilidades:

buscar resumo global;

listar status de unidades;

buscar detalhe operacional de uma unidade;

listar equipamentos operacionais de uma unidade.

Não colocar chamadas de Unidade CRUD ou Equipamento CRUD nesse service.

Não criar ApiService genérico gigante.

6. Contratos TypeScript

Criar interfaces estritamente baseadas no payload real do backend.

Não inventar campos do Claude Design.

Resumo

O contrato conceitual pode conter dados equivalentes a:

{
"unidades": {
"total": 10
},
"equipamentos": {
"total": 250,
"ativos": 240,
"disponiveis": 220,
"indisponiveis": 8,
"semDados": 7,
"semMonitoramento": 5
},
"monitores": {
"total": 300,
"ativos": 280,
"disponiveis": 260,
"indisponiveis": 10,
"semDados": 10
},
"incidentes": {
"abertos": 10
}
}

Os nomes exatos devem ser confirmados no código/documentação existente antes da implementação.

Se o payload real divergir do exemplo conceitual, seguir o payload real.

7. Status operacional

Monitor

DISPONIVEL
INDISPONIVEL
SEM_DADOS
DESABILITADO

Equipamento

DISPONIVEL
INDISPONIVEL
SEM_DADOS
DESABILITADO
SEM_MONITORAMENTO

Unidade

DISPONIVEL
INDISPONIVEL
DEGRADADA
SEM_DADOS
SEM_EQUIPAMENTOS

O frontend pode mapear esses valores para:

label;

cor;

badge;

ícone.

Não pode inferir o estado.

8. Regra crítica

É proibido implementar no Angular lógica equivalente a:

última medição
+
latência
+
falhas consecutivas
+
threshold
=
status

Também não implementar:

FALHA -> indisponível

Uma medição FALHA isolada não determina indisponibilidade.

O backend já aplica a regra correta através da Dashboard API.

9. Tela principal do Dashboard

Implementar a rota:

/dashboard

Substituir o placeholder da F02.

A tela deve reproduzir a estrutura do Dashboard aprovado no Claude Design, adaptada aos dados realmente disponíveis.

A tela deve incluir, conforme o design e o contrato:

título/contexto;

cards de resumo;

indicadores de equipamentos;

indicadores de monitores;

incidentes abertos;

visão das unidades;

status operacional por unidade;

navegação para detalhe de unidade.

Não inventar métricas inexistentes.

10. Cards de resumo

Implementar os cards utilizando os dados de:

GET /dashboard/resumo

Exemplos possíveis:

total de unidades;

total de equipamentos;

equipamentos disponíveis;

equipamentos indisponíveis;

monitores ativos;

monitores indisponíveis;

incidentes abertos.

A seleção final deve respeitar:

os dados reais disponíveis;

o desenho aprovado;

clareza operacional.

Não calcular percentuais ou SLA se o backend não retornar os dados necessários.

11. Lista/visão de Unidades

Consumir:

GET /dashboard/unidades

Apresentar as unidades conforme o padrão visual do Claude Design.

Cada unidade deve exibir somente dados realmente retornados pela API.

O status deve vir diretamente do backend.

A unidade deve permitir navegação para:

/unidades/:id

ou rota equivalente já adotada.

Se a tela detalhada completa de Unidade pertencer a fase posterior, a navegação pode apontar para um detalhe operacional mínimo ou placeholder existente, sem criar CRUD nesta fase.

12. Dashboard por Unidade

Utilizar, quando necessário:

GET /dashboard/unidades/{id}

GET /dashboard/unidades/{id}/equipamentos

A implementação pode incluir detalhe operacional básico da unidade nesta fase caso seja necessário para reproduzir o fluxo principal do Dashboard.

Não implementar ainda edição administrativa da Unidade.

Não confundir:

dashboard operacional da unidade

com:

CRUD administrativo da unidade

13. Equipamentos dentro da Unidade

A listagem operacional deve usar:

GET /dashboard/unidades/{id}/equipamentos

Esse endpoint é paginado.

Filtros disponíveis:

tipoEquipamentoId
ativo

Sort permitido:

id
nome
ip
localizacao
ativo

Utilizar paginação server-side.

Não baixar todos os equipamentos para paginar ou filtrar localmente.

14. Estados de tela

Toda área dependente de API deve tratar explicitamente:

loading
success
empty
error

Utilizar componentes compartilhados da F02 quando existirem.

Não deixar cards zerados durante loading como se fossem dados reais.

Não usar alert().

15. Erros

Utilizar o interceptor/contrato ApiError da F01.

Tratar adequadamente:

erro de carregamento do resumo;

erro de carregamento das unidades;

erro de detalhe;

404 de unidade inexistente;

500 genérico.

Não comparar texto de message para identificar erros.

Preferir code.

16. Atualização de dados

Nesta fase, não implementar polling automático agressivo.

Carregar os dados na entrada da tela.

Pode existir uma ação explícita de atualizar se isso estiver alinhado ao design.

Se implementada, deve reutilizar os mesmos métodos de carregamento.

Não implementar:

WebSocket;

SSE;

auto-refresh periódico sem requisito.

17. Estado Angular

Não introduzir NgRx.

Utilizar uma abordagem simples e coerente com a versão Angular existente:

signals;

RxJS;

ou combinação moderada.

Evitar subscriptions sem cleanup.

Não criar store global genérica.

18. Formatação de datas

Se o Dashboard retornar timestamps:

manter o valor de API como string ISO;

converter somente para apresentação;

usar localidade apropriada na UI;

não alterar o instante original.

19. StatusBadge

Reutilizar o componente da F02, se existente.

Se ele ainda não existir, criar agora de forma reutilizável.

O componente deve apenas mapear:

status recebido
→ label
→ aparência

Não pode calcular status.

20. Ícones e cores

Reutilizar o Design System da F02.

Não instalar uma segunda biblioteca de ícones.

Não criar cores inline repetidas.

Usar tokens existentes.

21. Responsividade

A tela deve funcionar dentro do shell já implementado.

Validar:

desktop;

largura intermediária;

mobile.

Cards devem reorganizar-se sem overflow horizontal desnecessário.

Listagens devem possuir tratamento coerente para telas menores.

22. Acessibilidade

Preservar:

headings semânticos;

labels;

foco visível;

links/botões reais;

status comunicado com texto e não apenas cor;

aria-label em botões somente com ícone.

23. Não usar dados mockados

Remover qualquer dado mock que esteja sendo utilizado no placeholder de Dashboard.

Não transportar os dados fictícios do Claude Design.

A tela final desta fase deve usar a API real.

Se o backend estiver indisponível durante desenvolvimento, utilizar testes/mock HTTP apenas no ambiente de teste, não como fonte permanente da UI.

24. Não implementar nesta fase

Não implementar:

CRUD de Unidade;

CRUD de TipoEquipamento;

CRUD de Equipamento;

formulários administrativos;

configuração de Monitor;

histórico completo de Medições;

fluxo completo de Incidentes;

Notificações;

Telegram direto;

mapa funcional completo;

relatórios;

autenticação;

usuários;

manutenção;

auditoria;

configurações globais;

WebSocket;

SSE;

polling automático.

25. Testes

Criar testes relevantes para:

DashboardApiService

URL correta de /dashboard/resumo;

URL correta de /dashboard/unidades;

detalhe de unidade;

equipamentos de unidade;

paginação/filtros quando aplicável.

Dashboard

loading;

sucesso;

empty quando aplicável;

erro;

renderização dos principais cards;

renderização de status retornado;

ausência de lógica de cálculo de status.

Navegação

clique em Unidade;

rota esperada.

Não testar detalhes cosméticos sem valor.

26. Build e validação

Ao terminar:

executar testes;

executar build;

corrigir todos os erros;

revisar warnings;

testar /dashboard;

validar cenário de sucesso;

validar loading;

validar erro;

validar empty state;

validar responsividade;

revisar git diff;

reler esta especificação.

Não concluir com testes/build quebrados.

27. Critérios de aceite

F03 está concluída quando:

rota /dashboard usar dados reais;

DashboardApiService existir;

/dashboard/resumo estiver integrado;

/dashboard/unidades estiver integrado;

detalhe operacional de unidade estiver preparado ou integrado conforme necessidade;

equipamentos por unidade utilizarem o endpoint Dashboard quando exibidos;

paginação de equipamentos for server-side;

cards não dependerem de mocks;

estados operacionais vierem exclusivamente do backend;

loading estiver implementado;

empty estiver implementado;

error estiver implementado;

ApiError da F01 estiver sendo respeitado;

Design System da F02 estiver sendo reutilizado;

responsividade estiver preservada;

nenhuma regra de threshold/status tiver sido duplicada;

testes relevantes passarem;

build passar.

28. Entrega

O relatório final deve conter:

Resumo

O que foi implementado.

Endpoints integrados

Lista dos endpoints reais utilizados.

Models

Interfaces/DTOs criados.

Services

Services criados ou alterados.

Componentes

Componentes criados/alterados.

Estados de tela

Como loading, empty e error foram tratados.

Status operacional

Confirmação explícita de que nenhum status é recalculado no Angular.

Paginação

Como a paginação server-side foi implementada.

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

Somente problemas reais da F03.

Observações para F04

Descobertas relevantes para a próxima fase administrativa, sem implementá-la.