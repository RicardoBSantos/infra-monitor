F02 --- Design System + Application Shell --- Infra Monitor

1. Objetivo

Implementar a base visual oficial do frontend Angular do Infra
Monitor, traduzindo o protótipo aprovado no Claude Design para uma
estrutura Angular reutilizável.

Esta fase deve entregar:

tokens visuais globais;

tipografia;

cores;

espaçamentos e superfícies;

estilos básicos de controles;

Application Shell;

sidebar;

topbar;

breadcrumbs;

área principal de conteúdo;

comportamento responsivo;

componentes visuais fundamentais realmente necessários ao shell.

Esta fase não deve implementar as telas de negócio completas.

O Claude Design é a fonte de verdade visual. O backend continua sendo a
fonte de verdade funcional.

2. Pré-condição

A F01 --- Fundação Angular já foi implementada.

Antes de alterar código:

inspecionar integralmente o projeto Angular atual;

ler o package.json;

identificar a versão real do Angular;

revisar a configuração criada na F01;

localizar e analisar os arquivos do Claude Design;

preservar a arquitetura e os contratos compartilhados já
implementados;

verificar o estado atual do Git.

Não recriar o projeto Angular.

Não substituir a fundação da F01 sem necessidade comprovada.

3. Fonte de verdade visual

O material do Claude Design inclui principalmente:

Infra Monitor.dc.html;

sergipe-map.html;

github.md;

assets relacionados ao mapa/protótipo.

O protótipo deve ser analisado para extrair:

layout;

hierarquia;

proporções;

cores;

tipografia;

espaçamento;

bordas;

superfícies;

estados;

sidebar;

topbar;

breadcrumbs;

comportamento de navegação;

padrões de cards;

badges;

inputs;

tabelas;

dialogs;

responsividade.

Não copiar a lógica mock/React do protótipo.

Não transportar dados fictícios para Angular.

4. Direção visual identificada

Preservar a identidade dark e técnica do protótipo.

Referências visuais observadas incluem fundos na família:

#080C12;

#0A1017;

#0F161E.

Cores semânticas observadas incluem aproximadamente:

azul: #4C8DFF;

verde: #34C77B;

amarelo: #E8A33D;

vermelho: #E5484D.

Tipografia observada:

IBM Plex Sans;

IBM Plex Mono.

Esses valores são referências extraídas do design. Antes de
implementá-los como tokens definitivos, conferir diretamente o protótipo
e reutilizar os valores reais encontrados nele.

Não aproximar arbitrariamente valores que estejam explicitamente
definidos no design.

5. Design tokens

Criar uma camada organizada de tokens SCSS/CSS para os valores realmente
utilizados.

Pode contemplar, conforme o design real:

background principal;

superfícies;

superfícies elevadas;

bordas;

texto principal;

texto secundário;

texto discreto;

primary/accent;

success;

warning;

danger;

info;

radius;

spacing;

sombras;

tamanhos tipográficos;

pesos tipográficos;

alturas de controles;

largura da sidebar;

altura da topbar.

Evitar centenas de tokens sem uso.

Não criar um design system abstrato maior que o próprio produto.

6. Tipografia

Reproduzir a hierarquia tipográfica do Claude Design.

Preservar a separação conceitual entre:

tipografia de interface;

valores técnicos/monoespaçados;

títulos;

labels;

textos auxiliares;

dados como IP, timestamps e métricas.

Se IBM Plex Sans/Mono forem utilizadas, instalar ou carregar por uma
estratégia adequada ao projeto.

Não depender de uma URL externa em produção sem avaliar a estratégia.

Não misturar famílias tipográficas arbitrariamente.

7. Application Shell

Implementar o shell principal da aplicação.

Estrutura conceitual:

ApplicationShell
├── Sidebar
├── Topbar
└── Main
├── Breadcrumbs
└── RouterOutlet

Adaptar os nomes à convenção existente.

O shell deve envolver as futuras telas operacionais e administrativas.

8. Sidebar

Reproduzir a sidebar definida no Claude Design.

A navegação visual do protótipo contempla conceitualmente:

Operações

Mapa;

Painel;

Incidentes;

Relatórios.

Gerenciamento

Unidades;

Equipamentos;

Tipos de equipamento;

Monitoramento;

Janelas de manutenção;

Usuários;

Telegram;

Log de auditoria;

Configurações do sistema.

Entretanto, nem todas essas features possuem backend nesta versão.

A sidebar deve distinguir entre:

Rotas previstas para o ciclo atual

Dashboard/Painel;

Mapa;

Unidades;

Equipamentos;

Tipos de equipamento;

Monitores/Monitoramento;

Medições, quando fizer sentido na navegação;

Incidentes;

Notificações/Telegram conforme o contrato existente.

Features futuras

Relatórios avançados;

Janelas de manutenção;

Usuários;

Auditoria;

Configurações globais.

Não criar implementação funcional fake dessas features.

Se itens futuros forem preservados visualmente para fidelidade ao
design, devem ficar claramente desabilitados ou marcados como
indisponíveis, sem rotas fictícias funcionais. Se isso prejudicar UX,
omiti-los temporariamente e documentar a decisão.

9. Rotas

Integrar o shell ao Angular Router.

Rotas planejadas do ciclo atual:

/dashboard
/mapa
/unidades
/unidades/:id
/equipamentos
/equipamentos/:id
/tipos-equipamento
/monitores
/medicoes
/incidentes
/incidentes/:id
/notificacoes

Nesta F02 não é necessário implementar as páginas finais.

É permitido criar somente páginas placeholder mínimas para validar
navegação do shell, desde que:

sejam claramente temporárias;

não simulem dados;

não contenham CRUD;

não criem contratos fictícios;

sejam fáceis de substituir nas fases seguintes.

A rota raiz deve ter comportamento explícito, preferencialmente
redirecionando para /dashboard.

10. Topbar

Implementar a topbar conforme o design.

Preservar:

proporções;

alinhamento;

separadores;

comportamento responsivo;

hierarquia visual.

Elementos do protótipo que dependam de funcionalidades ainda
inexistentes, como usuário autenticado ou busca global funcional, não
devem ganhar lógica fake.

É permitido reproduzir o elemento visual quando fizer sentido, desde que
fique não funcional ou seja omitido conscientemente.

Não implementar autenticação.

Não criar usuário hardcoded para simular sessão.

11. Breadcrumbs

Criar breadcrumbs reutilizáveis compatíveis com Angular Router.

Objetivo:

informar contexto de navegação;

funcionar com futuras rotas por feature;

não exigir configuração duplicada em cada componente.

Evitar overengineering.

Pode utilizar metadata de rota quando isso simplificar a solução.

O componente deve seguir o visual do Claude Design.

12. Componentes compartilhados fundamentais

Criar apenas componentes que já tenham reutilização concreta nesta fase
ou que sejam necessários imediatamente para as próximas.

Candidatos:

PageHeader;

StatusBadge;

LoadingState;

EmptyState;

ErrorState.

Não é obrigatório criar todos se ainda não houver uso real.

Não criar nesta fase:

tabela universal;

formulário universal;

modal universal complexo;

generic CRUD;

chart framework próprio.

13. StatusBadge

É recomendável criar a base visual do StatusBadge, pois status são
recorrentes no design.

Regra crítica:

o componente apenas apresenta o status recebido.

Nunca calcula status operacional.

Deve suportar progressivamente os contratos reais:

Monitor

DISPONIVEL;

INDISPONIVEL;

SEM_DADOS;

DESABILITADO.

Equipamento

DISPONIVEL;

INDISPONIVEL;

SEM_DADOS;

DESABILITADO;

SEM_MONITORAMENTO.

Unidade

DISPONIVEL;

INDISPONIVEL;

DEGRADADA;

SEM_DADOS;

SEM_EQUIPAMENTOS.

Não usar apenas cor. Combinar cor com texto e/ou ícone conforme o
design.

Não introduzir ONLINE, OFFLINE, MANUTENÇÃO ou outros estados do
mock como contrato de backend.

14. Ícones

Identificar qual estratégia de ícones melhor reproduz o protótipo.

Não instalar múltiplas bibliotecas.

Se o protótipo já indicar uma biblioteca consistente, preferi-la quando
compatível.

Se for necessário adicionar uma dependência de ícones, justificar no
relatório.

Não utilizar emojis como substitutos dos ícones finais da interface.

15. Responsividade

O shell não pode ser desktop-only.

Implementar comportamento coerente para:

desktop;

telas intermediárias;

mobile.

A sidebar deve possuir comportamento responsivo apropriado, por exemplo
colapso/drawer, seguindo o máximo possível a intenção visual do
protótipo.

Garantir que o conteúdo principal não fique inacessível ou coberto.

Não redesenhar arbitrariamente o mobile; inferir apenas o necessário
quando o protótipo não definir explicitamente.

16. Acessibilidade

Garantir no mínimo:

landmarks semânticos;

navegação por teclado;

foco visível;

botões reais para ações;

aria-label em controles somente com ícone;

contraste adequado;

estado ativo da navegação perceptível sem depender apenas de cor.

17. SCSS

Organizar estilos de forma previsível.

Pode haver, conforme necessidade real:

styles/
├── _tokens.scss
├── _typography.scss
├── _reset.scss
└── ...

ou estratégia equivalente.

Não fragmentar excessivamente.

Evitar estilos globais que vazem desnecessariamente para features.

Tokens globais podem ser expostos como CSS custom properties quando isso
facilitar o uso nos componentes.

18. Biblioteca visual

Não adicionar Angular Material, PrimeNG, Tailwind ou Bootstrap
automaticamente.

Primeiro tente reproduzir o shell com Angular + SCSS e dependências
pequenas justificáveis.

Se uma biblioteca completa for realmente necessária, não a introduza
silenciosamente nesta fase: documente a necessidade para decisão
posterior.

19. Backend

F02 é majoritariamente visual.

Não alterar backend.

Não implementar chamadas HTTP de negócio apenas para preencher o shell.

Não criar mocks permanentes.

A configuração HTTP e os contratos criados na F01 devem ser preservados.

20. Autenticação

Continua fora do escopo.

Não implementar:

JWT;

AuthService fake;

guards de autenticação;

localStorage de token;

usuário fictício;

refresh token;

login funcional.

Elementos visuais relacionados ao usuário no protótipo não autorizam a
criação de autenticação fictícia.

21. Busca global

Se o protótipo possuir busca global, reproduzir somente a estrutura
visual se ela for importante para fidelidade do shell.

Não implementar pesquisa fake.

Não filtrar arrays mockados.

Não criar endpoint inexistente.

22. Tema

O design atual é dark.

Não implementar light mode apenas por generalização.

Não criar sistema completo de temas se o requisito atual não exigir.

23. Estados visuais

Preparar padrões coerentes para:

hover;

active;

focus;

disabled;

loading;

empty;

error.

Eles devem derivar do design.

Não usar alert().

24. Dados mockados

Não transportar para o projeto dados fictícios do protótipo, como
unidades, equipamentos, incidentes ou usuários.

Placeholders de layout devem usar conteúdo mínimo e explicitamente
temporário.

O objetivo desta fase é shell/design system, não demonstração com dados
falsos.

25. Qualidade

Manter:

Angular moderno;

standalone;

TypeScript strict;

SCSS organizado;

componentes pequenos;

sem any desnecessário;

sem APIs deprecated;

sem subscriptions soltas;

sem lógica operacional no frontend;

sem abstrações prematuras.

26. Testes

Adicionar testes úteis para os componentes centrais implementados.

Priorizar:

renderização do shell;

navegação/estado ativo da sidebar;

comportamento básico de breadcrumbs;

StatusBadge, se implementado;

interação de abertura/fechamento da navegação responsiva, se
aplicável.

Não testar detalhes puramente cosméticos sem valor.

27. Build e validação

Ao terminar:

executar testes;

executar build;

corrigir erros;

verificar warnings relevantes;

revisar responsividade;

revisar navegação por teclado;

comparar visualmente o shell com o Claude Design;

revisar git diff.

Não concluir com build ou testes quebrados.

28. Fora do escopo

Não implementar nesta fase:

Dashboard conectado à API;

cards com métricas reais;

mapa funcional;

CRUD de Unidade;

CRUD de TipoEquipamento;

CRUD de Equipamento;

configuração de Monitor;

histórico de Medições;

fluxo completo de Incidentes;

Notificações;

Telegram direto;

Relatórios;

autenticação;

usuários;

manutenção;

auditoria;

configurações globais;

WebSocket;

SSE;

polling operacional.

29. Critérios de aceite

F02 está concluída quando:

identidade visual do Claude Design estiver traduzida para tokens
reutilizáveis;

tipografia estiver configurada;

Application Shell estiver implementado;

sidebar estiver implementada;

topbar estiver implementada;

breadcrumbs estiverem implementados;

router-outlet estiver integrado ao shell;

rota raiz tiver comportamento definido;

navegação principal estiver preparada;

responsividade básica estiver funcional;

acessibilidade básica estiver preservada;

nenhum dado operacional mock tiver sido introduzido como solução
permanente;

nenhuma autenticação fake tiver sido criada;

nenhum status operacional estiver sendo calculado;

não houver biblioteca visual pesada adicionada sem decisão
explícita;

testes relevantes passarem;

build passar.

30. Entrega

O relatório final da implementação deve conter:

Resumo

O que foi implementado.

Design traduzido

Tokens, tipografia e decisões extraídas do Claude Design.

Componentes

Componentes criados e responsabilidade de cada um.

Rotas

Rotas criadas/preparadas.

Responsividade

Comportamento implementado.

Dependências

Toda dependência nova e justificativa.

Testes

Comandos, quantidade e resultado.

Build

Comando e resultado.

Critérios de aceite

OK, NÃO ATENDIDO ou N/A para cada critério.

Git diff

Arquivos relevantes criados/alterados.

Pendências

Somente problemas reais da F02.

Observações para F03

Descobertas relevantes para a implementação do Dashboard, sem avançar
para ela.