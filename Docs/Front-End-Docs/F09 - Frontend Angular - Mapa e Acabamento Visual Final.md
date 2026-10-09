1. Objetivo

Concluir o ciclo principal do frontend Angular do Infra Monitor com duas frentes:

implementar o Mapa de forma coerente com os dados realmente disponíveis;

realizar uma auditoria visual e de integração final em todas as features já implementadas.

Esta fase deve consolidar o frontend entregue nas fases F01–F08 sem introduzir funcionalidades novas sem contrato de backend.

O objetivo é encerrar o primeiro ciclo do frontend com:

rota /mapa funcional;

uso dos assets/cartografia existentes quando aplicável;

revisão visual contra o Claude Design;

revisão de responsividade;

revisão de navegação;

revisão de estados loading/empty/error;

revisão de consistência de componentes;

revisão de acessibilidade básica;

remoção de placeholders e mocks remanescentes;

validação final de build e testes.

2. Pré-condições

Já foram concluídas:

F01 — Fundação Angular;

F02 — Design System + Application Shell;

F03 — Dashboard;

F04 — Unidades e Tipos de Equipamento;

F05 — Inventário e Equipamentos;

F06 — Monitores;

F07 — Medições e Incidentes;

F08 — Notificações e Telegram.

Antes de alterar código:

revisar package.json;

revisar app.routes.ts;

revisar Application Shell;

revisar Design System;

revisar todas as features implementadas;

revisar componentes compartilhados;

revisar o Claude Design completo;

revisar Infra Monitor.dc.html;

revisar sergipe-map.html;

localizar assets de mapa/GeoJSON;

verificar git status;

verificar existência de placeholders/mocks no código de produção.

Não recriar infraestrutura existente.

3. Escopo principal da F09

A F09 possui três blocos:

A. Mapa

Implementar /mapa com base nos assets e dados realmente disponíveis.

B. Auditoria visual

Comparar o frontend Angular com o Claude Design e corrigir divergências perceptíveis dentro do escopo já implementado.

C. Auditoria técnica e UX

Revisar responsividade, navegação, estados, consistência, acessibilidade e resíduos de implementação temporária.

PARTE A — MAPA

4. Fonte visual do Mapa

Usar como referência principal:

sergipe-map.html

e demais arquivos relacionados ao mapa.

Também consultar a tela correspondente no:

Infra Monitor.dc.html

O mapa deve preservar, quando possível:

enquadramento;

hierarquia;

cards/legendas;

filtros;

estilo dark;

integração com Application Shell;

comportamento responsivo.

Não copiar código React/mock sem adaptação.

5. Assets cartográficos

Localizar e reutilizar assets existentes no material do Claude Design, como:

GeoJSON
JSON geográfico
polígonos
limites municipais

Não baixar cartografia diferente sem necessidade.

Não substituir Sergipe por mapa genérico se já existe asset aprovado.

6. Biblioteca de mapa

Antes de instalar qualquer biblioteca, verificar se já existe dependência adequada no projeto.

Se não houver, avaliar a opção mais simples e sustentável.

A biblioteca deve:

funcionar bem com Angular atual;

aceitar GeoJSON;

permitir estilização dark;

não depender de API paga para o caso atual;

não exigir secrets frontend.

Evitar bibliotecas excessivamente pesadas sem justificativa.

Toda nova dependência deve ser documentada no relatório.

7. Dados do backend disponíveis para o Mapa

O contrato atual fornece:

GET /api/v1/dashboard/unidades
GET /api/v1/dashboard/unidades/{id}
GET /api/v1/dashboard/unidades/{id}/equipamentos

O frontend deve utilizar apenas dados realmente retornados por esses endpoints.

Antes de codificar o mapa, confirmar se a Dashboard API retorna algum identificador geográfico suficiente para relacionar Unidade a município/localização no mapa.

Exemplos possíveis:

municipio
cidade
codigoIbge
latitude
longitude

Não assumir que esses campos existem.

8. Gap crítico possível

Se o backend NÃO fornecer informação geográfica suficiente para mapear uma Unidade ao GeoJSON, não inventar localização no Angular.

Não criar:

nome da Unidade -> coordenada hardcoded
ID da Unidade -> município hardcoded
IP -> localização geográfica

sem contrato real.

Neste caso, implementar:

o mapa cartográfico base;

estrutura visual;

legenda;

estados;

empty/gap state;

documentação clara do dado ausente.

Registrar no relatório:

tela: Mapa
dado necessário: ...
endpoint atual: ...
limitação: ...
proposta de backend: ...

Não criar workaround silencioso.

9. Status no Mapa

Se for possível relacionar Unidade ao mapa usando dados reais, usar o:

StatusOperacionalUnidade

retornado pelo backend.

Valores:

DISPONIVEL
INDISPONIVEL
DEGRADADA
SEM_DADOS
SEM_EQUIPAMENTOS

Não recalcular status.

10. Cores no Mapa

Reutilizar Design System.

Mapear status apenas visualmente.

Exemplo conceitual:

DISPONIVEL      -> success
INDISPONIVEL    -> danger
DEGRADADA       -> warning
SEM_DADOS       -> neutral
SEM_EQUIPAMENTOS-> muted

Confirmar tokens reais no projeto.

Não depender apenas de cor: utilizar legenda textual e estado selecionado.

11. Interação com Unidade

Se houver correspondência real de Unidade no mapa, permitir interação coerente, por exemplo:

selecionar região/unidade
→ mostrar resumo
→ navegar para /unidades/:id ou dashboard operacional da unidade

Não inventar popup com campos inexistentes.

12. Mapa e Equipamentos

Não plotar Equipamentos individualmente se o backend não fornece coordenadas.

Não inferir coordenadas de Equipamento pela localizacao textual.

Se futuramente houver latitude/longitude, isso será nova evolução.

13. Loading, empty e error do Mapa

Tratar:

loading
success
empty
error
gap de dados geográficos

Não deixar mapa vazio sem explicação.

14. Responsividade do Mapa

Validar:

desktop;

tablet;

mobile.

O mapa deve:

ocupar área adequada;

não extrapolar o viewport;

ter controles acessíveis;

permitir leitura de legenda.

PARTE B — AUDITORIA VISUAL

15. Comparação geral com Claude Design

Revisar todas as telas implementadas:

/dashboard
/mapa
/unidades
/tipos-equipamento
/equipamentos
/equipamentos/:id
/monitores
/medicoes
/incidentes
/incidentes/:id
/notificacoes
/notificacoes/:id, se existir

Comparar com o Claude Design em:

layout;

tipografia;

cores;

spacing;

bordas;

radius;

sombras;

densidade;

tabelas;

cards;

badges;

filtros;

dialogs;

estados;

responsividade.

Corrigir divergências reais.

Não redesenhar por preferência pessoal.

16. Design tokens

Revisar tokens criados na F02.

Eliminar:

duplicações;

valores inline repetidos;

tokens mortos;

inconsistências entre features.

Não fazer refactor massivo sem ganho claro.

17. Tipografia

Validar uso consistente de:

IBM Plex Sans
IBM Plex Mono

quando essas forem as fontes adotadas.

Garantir consistência para:

títulos;

labels;

métricas;

IPs;

timestamps;

valores técnicos.

18. StatusBadge

Revisar todos os usos.

Garantir que:

labels estejam consistentes;

cores usem Design System;

enums reais sejam respeitados;

nenhum status seja recalculado;

não exista dependência apenas de cor.

19. Tabelas

Revisar tabelas de:

Equipamentos;

Monitores;

Medições;

Incidentes;

Notificações;

Unidades/Tipos quando aplicável.

Garantir consistência em:

header;

row height;

ações;

loading;

empty;

erro;

paginação;

overflow;

mobile.

20. Formulários

Revisar forms de:

Unidade;

Tipo de equipamento;

Equipamento;

Monitor.

Garantir:

labels;

mensagens;

validação;

campos obrigatórios;

saving;

disable;

focus;

espaçamento;

dialogs/drawers.

21. Confirmações

Revisar confirmação de:

delete;

fechamento de Incidente;

demais ações destrutivas.

Eliminar uso residual de:

window.confirm()
alert()

no código de produção.

PARTE C — AUDITORIA TÉCNICA E UX

22. Rotas

Revisar app.routes.ts.

Garantir:

/ redireciona corretamente;

rotas inexistentes têm fallback apropriado;

não existem placeholders órfãos;

não existem rotas de features futuras sem implementação;

breadcrumbs continuam coerentes.

23. Sidebar

Revisar:

item ativo;

labels;

agrupamentos;

rotas;

itens futuros;

responsividade.

Itens sem backend não devem parecer funcionais.

24. Topbar

Revisar elementos sem função real.

Não deixar:

usuário fake;

busca fake;

contador fake;

ação sem comportamento.

Elementos visuais sem função devem ser conscientemente removidos, desabilitados ou documentados.

25. Placeholders e mocks

Pesquisar código de produção por:

mock
fake
placeholder
TODO
FIXME
Lorem
example
demo
hardcoded

Analisar cada ocorrência.

Remover dados temporários que tenham ficado nas features implementadas.

Não remover TODOs válidos de documentação sem necessidade.

26. Dados fictícios

Garantir que não existam em produção:

Unidades fake;

Equipamentos fake;

Incidentes fake;

Monitores fake;

Notificações fake;

métricas fake;

usuário fake;

Telegram fake.

Mocks de testes são permitidos.

27. Segurança

Revalidar frontend por:

BOT_TOKEN
TELEGRAM_BOT_TOKEN
api.telegram.org
password
secret
token hardcoded

Também revisar environment*.

Somente configuração pública pode existir.

28. HTTP

Revisar services criados.

Garantir:

apiUrl centralizada;

nenhum host hardcoded;

nenhum service genérico desnecessário;

query params corretos;

paginação server-side preservada;

erros não engolidos.

29. Status operacional

Auditar o projeto inteiro por funções/condições que tentem calcular disponibilidade.

Pesquisar por conceitos como:

calculateStatus
resolveStatus
offline
online
falhas consecutivas
threshold
ultimaMedicao

Não remover usos puramente visuais legítimos sem análise.

Garantir que o Angular não replique Incident Engine/Dashboard.

30. Datas

Revisar uso de ISO UTC e apresentação local.

Garantir consistência entre:

filtros de período;

tabelas;

detalhes;

cards.

Não alterar instante.

31. Paginação

Auditar:

Equipamentos;

Monitores;

Medições;

Incidentes;

Notificações;

Dashboard equipamentos por Unidade, quando aplicável.

Garantir que seja server-side.

32. Filtros

Auditar que filtros suportados sejam enviados ao backend, não aplicados apenas à página atual.

Não transformar essa fase em refactor arquitetural geral sem necessidade.

33. Responsividade global

Validar todas as principais rotas em:

mobile
tablet
desktop

Revisar:

sidebar;

topbar;

filtros;

tabelas;

dialogs;

detail pages;

cards;

mapa.

Corrigir overflow e elementos inacessíveis.

34. Acessibilidade global

Revisar:

foco visível;

aria-label;

labels;

landmarks;

botões;

links;

dialogs;

navegação por teclado;

mensagens de erro.

Não buscar conformidade formal completa WCAG nesta fase, mas corrigir problemas claros.

35. Performance básica

Não fazer otimização prematura.

Revisar apenas problemas evidentes:

requests duplicados;

subscriptions vazando;

loops de renderização;

carregamentos desnecessários;

assets excessivos.

Não introduzir cache complexo.

36. Build warnings

Executar build e analisar warnings.

Corrigir warnings relevantes.

Não esconder warnings legítimos com configuração sem necessidade.

37. Testes

Executar toda a suíte existente.

Adicionar testes apenas para:

Mapa;

correções importantes;

regressões encontradas durante auditoria.

Não reescrever toda a suíte.

38. Testes do Mapa

Se houver dados geográficos reais:

loading;

success;

empty;

error;

status recebido;

interação com Unidade;

navegação.

Se NÃO houver dado geográfico suficiente:

mapa base renderiza;

gap state é exibido;

nenhuma coordenada é inventada;

nenhum status é calculado.

39. Verificação de placeholders

Antes de concluir, registrar as ocorrências restantes de:

TODO
FIXME
placeholder
mock
fake

e classificar:

removido
teste
documentação
pendência válida

40. Não implementar nesta fase

Não implementar:

autenticação;

usuários;

janelas de manutenção;

auditoria;

relatórios avançados;

SLA;

WebSocket;

SSE;

polling;

configuração de Telegram;

envio manual;

novas regras de backend;

coordenadas inventadas.

41. Critérios de aceite

F09 está concluída quando:

/mapa estiver funcional no limite do contrato real;

GeoJSON/assets existentes forem reutilizados quando aplicável;

nenhuma localização for inventada;

gap de backend for documentado se necessário;

todas as features F03–F08 forem revisadas visualmente;

Design System estiver consistente;

placeholders de produção forem removidos ou justificados;

não existirem mocks operacionais em produção;

rotas estiverem coerentes;

sidebar/topbar estiverem coerentes;

responsividade global estiver validada;

acessibilidade básica estiver revisada;

paginação server-side continuar correta;

filtros server-side continuarem corretos;

nenhum status operacional for recalculado;

nenhum secret existir no frontend;

toda suíte de testes passar;

build passar.

42. Entrega

O relatório final deve conter:

F09 — Resultado

Status: CONCLUÍDO / CONCLUÍDO COM RESSALVAS / BLOQUEADO

Mapa

Descrever:

biblioteca utilizada;

assets;

dados da API;

status;

interações;

responsividade.

Dados geográficos

Informar explicitamente:

Há dados suficientes para relacionar Unidade ao mapa? SIM/NÃO

Se NÃO:

dado necessário:
endpoint atual:
limitação:
proposta de backend:

Auditoria visual

Listar principais correções por tela.

Design System

Descrever ajustes realizados.

Rotas

Listar correções.

Sidebar e Topbar

Descrever ajustes.

Placeholders/mocks

Informar o resultado da auditoria.

Segurança

Informar resultado de busca por secrets e integrações indevidas.

Status operacional

Confirmar:

Nenhum status operacional é recalculado no Angular.

Paginação e filtros

Confirmar que continuam server-side nas features aplicáveis.

Responsividade

Descrever validação de mobile/tablet/desktop.

Acessibilidade

Listar principais correções.

Testes

Informar:

comando:
quantidade:
resultado:

Build

Informar:

comando:
resultado:

Git diff

Resumir arquivos criados/alterados.

Critérios de aceite

Marcar cada item:

OK
NÃO ATENDIDO
N/A

Pendências

Listar somente pendências reais após a F09.

Próximos passos

Separar claramente possíveis novas fases, por exemplo:

Autenticação
Usuários
Manutenção
Relatórios
Auditoria
Deploy

Não implementar automaticamente nenhuma delas.