# Consistência visual — rodada 2 (design)

Data: 2026-10-21 · Branch: `feat/consistencia-visual-r2` (worktree `../infra-monitor-wt-cv2`, base
`feat/consistencia-visual-r1` dc8de3b — PR #12 ainda aberto; os tokens da rodada 1 são pré-requisito).

## Objetivo

Padronização estrutural das telas: uma geração de página só, sem sobretítulo, mono com critério, e as
implementações locais trocadas pelas compartilhadas. Fora de escopo: escala tipográfica (19 tamanhos) e de
espaçamento (31 valores) — projeto de design, rodada própria; os 17 `max-width` de ponto de quebra viram
dívida registrada, não correção.

## Decisões

| Tema | Decisão | Origem |
|---|---|---|
| Padrão de página | Geração A: padding 22px, `max-width:1500px` centralizado, h1 20px/700 | usuário |
| Sobretítulo | Sai de todas as telas, **inclusive o Mapa** (visto em captura com/sem) | usuário |
| Onde mora a casca | Primitiva global `.pagina` em `_ui.scss`, opt-in na raiz de cada tela; Mapa não usa; shell intocado | usuário (recomendado) |
| Ativo/inativo | Primitiva `.chip-ativo` / `.chip-ativo--off`; **não** entra em `DisplayStatus` | usuário (recomendado) |
| Esqueleto | Uma primitiva `.esqueleto` com brilho animado, desligado sob `prefers-reduced-motion` | usuário (recomendado) |
| Subtítulo | `<p class="pagina__descricao">`, 12px, `--im-text-secondary`, sans | implementador (justificado em §2) |
| Pilha mono | `'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace` | implementador (§3) |
| Detalhe de notificação | 1100px → 1500px: nenhum motivo encontrado para o teto menor | implementador |

## 1. Casca de página: `.pagina`

**Por que primitiva e não padding no shell.** `.shell__main` não tem padding nem largura; cada tela declara
os seus. Pôr no shell exigiria exceção para o Mapa via `data` da rota lida pelo shell (acoplamento novo) e o
`height: calc(100dvh - topbar)` do Mapa passaria a depender dela. A primitiva centraliza o valor num lugar
só e o Mapa simplesmente não a usa — o comentário D21 ("a folga é do componente, não do shell") continua
verdadeiro.

Em `src/styles/_ui.scss`:

```scss
/* Casca de página (rodada 2). Toda tela de conteúdo usa na raiz; o Mapa não (D20/D21). */
.pagina { box-sizing: border-box; max-width: 1500px; margin: 0 auto; padding: 22px; color: var(--im-text); }
.pagina__cabecalho { display: flex; align-items: end; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 16px; }
.pagina__cabecalho h1 { margin: 0; color: var(--im-text-strong); font-size: 20px; font-weight: 700; line-height: 1.25; }
.pagina__descricao { margin: 4px 0 0; color: var(--im-text-secondary); font-size: 12px; }
@media (max-width: 760px) { .pagina { padding: 16px; } }
```

- Raízes que passam a `class="pagina …"` (mantêm a classe própria para o que é local): Painel `.painel`,
  Unidades `.unidades`, Detalhe da unidade `.unidade-detalhe`, Equipamentos `.equipamentos`, Tipos `.tipos`,
  Monitoramento `.monitor-page` (**só quando não embutido**: `[class.pagina]="!equipamentoContextId()"`),
  Medições e Incidentes `.operational-page`, Telegram `.telegram`, Relatórios `.reports`, Usuários
  `.admin-page`, Detalhe de notificação `.detail`.
- Sai de cada SCSS local: `max-width`, `margin: 0 auto`, `padding`, `color` da raiz e o `@media` de padding
  móvel (hoje 620/700/760px divergentes → 760px único). O h1 local e o estilo local de subtítulo também saem.
- `notificacao-list` (dentro da casca do Telegram) **não** usa `.pagina` — só a casca usa; o neutralizador
  `.operational-page{max-width:none;margin:0;padding:0}` da rodada 1 deixa de ser necessário quando o
  `.operational-page` parar de ter padding próprio (remover se ficar morto).
- **Estouro horizontal (achado da sonda):** Unidades (390–1180px, até +636px), Telegram (390–1024px, até
  +474px) e Painel (900/1024/1280px, até +144px) estouram porque a raiz é `display:grid` sem coluna
  `minmax(0,1fr)` e a tabela larga empurra a página. Raiz que continua grid recebe
  `grid-template-columns: minmax(0, 1fr)`. Critério: depois da rodada, nenhuma dessas 3 telas estoura além
  da topbar em nenhuma das 8 larguras.
- Cabeçalho: `<header class="pagina__cabecalho">` com `<div><h1 …>…</h1><p class="pagina__descricao">…</p></div>`
  e ações à direita. Ids `aria-labelledby` dos h1 não mudam. Detalhe da unidade mantém o link "← Voltar"
  acima do cabeçalho e o badge ao lado do h1. Painel mantém `.painel__meta` (é meta dinâmica, não
  descrição) com a mesma aparência de `.pagina__descricao` + mono (é dado).
- h1 de Relatórios e do detalhe de notificação: 22px → 20px (via `.pagina__cabecalho h1`). O detalhe de
  notificação tem o cabeçalho dentro de um cartão (`header{border…}` em `detalhe-generico.scss`): mantém o
  cartão, só alinha tamanho/peso do h1.

## 2. Sobretítulo e subtítulo

**Sai:** Monitoramento (`.eyebrow` azul, nas duas variantes, inclusive embutida "CONFIGURAÇÃO DE
MONITORAMENTO"), Medições, Incidentes e Usuários (`header p` mono), Telegram (`.telegram__secao`), detalhe
de notificação (`header p` "ADMINISTRAÇÃO · NOTIFICAÇÃO #id" — o `#id` passa para a meta/subtítulo se não
aparecer em outro lugar da tela), Mapa (`.map-titulo__eyebrow`). CSS dessas classes removido; `.eyebrow`
global continua (usado no drawer de unidade e nas telas de auth — fora de escopo).

**Fica:** rótulos de seção dentro da tela (`.panel-label` do Mapa, `.reports__eyebrow` "RESUMO OPERACIONAL"
nas seções de Relatórios, `.eyebrow` do drawer de unidade) — são títulos de bloco, não sobretítulo de página.

**Mapa:** decisão nova registrada em `Docs/mapa-architecture/mapa-decisoes.md` (D23) e
`mapa-contexto-atual.md` no mesmo commit. A placa `.map-titulo` encolhe ~13px; o enquadramento é por encaixe
calculado (D22), então a câmera não é recalibrada — só conferida em captura.

**Subtítulo = `<p>`.** `<small>` é semanticamente nota lateral/letra miúda; a linha sob o h1 é a descrição
da página, um parágrafo. Já é `<p>` em 5 telas (Painel, Unidades, Equipamentos, Tipos, Relatórios). As
`<small>` de Monitoramento, Medições, Incidentes, Usuários e Telegram viram `<p class="pagina__descricao">`
(sans 12px secondary, não mais mono 11px muted).

## 3. Mono

**Pilha** (`--im-mono` em `_tokens.scss`): `'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace`.
Plex é a fonte do projeto e é a única carregada (`@fontsource/ibm-plex-mono` 400/500/600); JetBrains Mono
nunca foi carregada (só valia se instalada na máquina) e `ui-monospace` primeiro virava SF Mono no
Safari/macOS — por isso o mesmo dado mudava de fonte conforme a tela. JetBrains sai da pilha.

**Literais:** os 39 `'IBM Plex Mono', monospace` viram `var(--im-mono)` (lista no inventário do plano).
`--lg-mono` (login) fica — paleta própria deliberada.

**`.im-mono`:** 0 usos → removida de `_typography.scss`. A classe utilitária é o `.mono` global
(`_ui.scss`). As 6 redefinições locais de `.mono` (drawer de incidente, gráfico de ocorrência, timeline,
medicao-list, admin-list, detalhe-generico) passam a `font-family: var(--im-mono)` ou somem quando o `.mono`
global serve.

**Critério (documentado em comentário junto do `.mono` em `_ui.scss`):** mono é para o que a pessoa
**compara caractere a caractere ou alinha em coluna**:
- identificadores técnicos: IP, hostname, número de série, sigla/código interno da unidade, códigos e ids
  (`INC-12`, `#id`), chat id, prévia de mensagem;
- valores medidos e tempo: data/hora, duração, latência, percentual, contagens e números de KPI;
- chips e badges (status, ativo, tipo de monitor, contadores).

Sans para o resto: **nomes** (equipamento, monitor, unidade, tipo), texto livre (fabricante, modelo,
descrição, endereço, cidade, mensagem de erro), rótulos, cabeçalhos de tabela (`.tabela th` já é sans).

Divergências que o critério corrige (conferidas no código, não na auditoria — 3 itens da auditoria estavam
errados): nome do equipamento em mono no Painel, lista de Equipamentos, aba Equipamentos e Visão geral da
unidade, título do drawer de equipamento, aba Incidentes → sans; nome do monitor em Monitoramento → sans;
tipo em mono no Mapa (`.afetados__meta` "tipo · IP") → só o IP em mono; `configuracoes-tab` (todo `dd`
mono) → só sigla em mono; `th` mono das tabelas locais → somem com a migração para `.tabela` (§4);
`td` numéricos e datas de Relatórios → mono via `.numerico`/`.mono`.

## 4. Componentes locais → compartilhados

### 4.1 Paginação → `app-paginacao`
Medições, Notificações e Monitoramento. Modelo do backend é 0-based (`PageResponse.page`), o componente é
1-based: `[paginaAtual]="pageNumber()+1"`, `(mudarPagina)="goToPage($event-1)"`, `[contagem]` com o plural
atual. Renderiza só no estado com conteúdo (sem "Página 1 de 0"). Fica dentro do `.cartao` da tabela, como
em Equipamentos (o `border-top` do componente pressupõe isso). CSS `.pagination`/`.monitor-page__paginacao`
removido. Relatórios mantém o wrapper próprio por causa do seletor "Itens por página" (já usa o componente).

### 4.2 Tabelas → `.cartao` + rolagem + `.tabela` + `.numerico`
Medições, Notificações, Usuários, Incidentes, Relatórios e a tabela interna do Painel. Padrão de destino
(o de Equipamentos): `<div class="cartao"><div class="X__rolagem"><table class="tabela">…</table></div>
<app-paginacao/></div>`, `min-width` da tabela no SCSS local, rolagem `overflow-x:auto` local.
- Acréscimos à primitiva global `.tabela` (porque as locais precisam e é genérico):
  `.tabela td small { display:block; margin-top:3px; color:var(--im-text-muted); }` (linha secundária) e
  `.tabela .acoes { text-align:right; white-space:nowrap; }` (coluna de ações).
- `.right` → `.numerico` (Notificações TENTATIVAS, Incidentes, Usuários); Medições LATÊNCIA ganha
  `numerico` no `th` e no `td`; colunas numéricas de Relatórios mantêm `numerico` e ganham `mono`.
- Painel: o `.tabela` local (grade de `div`s) é renomeado para `.painel-grade` (colisão de nome com a
  primitiva) e `table.equipamentos` passa a `class="tabela"`, removendo a cópia literal do SCSS.
- Incidentes: `td.evento{display:flex}` quebra o table-cell → flex num `span` interno.
- `@use '../medicoes/medicao-list.component.scss'` em Incidentes, Notificações e configuração do Telegram
  sai: cada tela leva só o que usa (o `@use` emitia o CSS inteiro de Medições em cada componente). O que for
  realmente compartilhado entre elas (filtros) vira primitiva ou fica local — decidido no plano por inspeção.

### 4.3 Abas de Relatórios → `.abas/.aba`
`.tabs/.active` locais saem. Como são 7 abas de texto longo, a primitiva ganha o modificador
`.abas--rolagem { display:flex; flex-wrap:nowrap; overflow-x:auto; max-width:100%; }` + `.abas--rolagem .aba
{ flex:0 0 auto; }` (o spec de Relatórios que exige rolagem passa a verificar o modificador).
**Teclado:** a navegação por setas hoje duplicada em `unidade-detalhe.component.ts` e
`notificacao-telegram.component.ts` vira helper `shared/a11y/navegar-abas.ts`
(`navegarAbas(evento: KeyboardEvent, indice: number, abas: HTMLElement[])`: ←/→ circular, Home/End, foca e
ativa), usado pelas duas e por Relatórios. Sem classe base, sem componente de abas.

### 4.4 Esqueleto → `.esqueleto` único
Em `_ui.scss`:
```scss
.esqueleto { display:grid; gap:6px; padding:0 14px 14px; }
.esqueleto span { display:block; height:26px; border-radius:4px;
  background: linear-gradient(90deg, var(--im-surface-hover), var(--im-border), var(--im-surface-hover));
  background-size: 200% 100%; animation: im-esqueleto 1.2s infinite; }
@keyframes im-esqueleto { to { background-position: -200% 0; } }
@media (prefers-reduced-motion: reduce) { .esqueleto span { animation: none; } }
```
- `.skeleton` local (medicao-list, admin-list, detalhe-generico) e seus keyframes saem; os templates
  (Medições, Notificações, Incidentes, Usuários, configuração do Telegram, detalhe de notificação) passam a
  `.esqueleto` com `span`s. Detalhe de notificação (bloco único de 240px) usa `.esqueleto` com spans.
  Variante `.esqueleto--grafico` (132px) continua.
- Contrato de marcação: `<div class="esqueleto" role="status" aria-label="Carregando …">`. Hoje o
  `aria-label` em `div` sem role não é anunciado; `role="status"` entra em todos os usos.
- Relatórios: o `<p class="skeleton">` (texto "Carregando indicador…") é outra coisa → renomeado
  `.widget-carregando` (mesma família de `.widget-empty/.widget-error`); spec ajustado.
- Seletores que roteiros e2e usam para "terminou de carregar" (`.skeleton`) passam a `.esqueleto`.

### 4.5 Modais locais → `app-modal`
Equipamentos, Tipos e Monitoramento. `[aberto]`, `[titulo]`, `[subtitulo]`, `[largura]="'640px'"`
(Equipamentos, Monitoramento; Tipos usa o padrão 520), `[bloqueado]="salvando()/saving()"`, `(fechar)`.
Formulário projetado. Ganho: Escape no `document`, foco entra no primeiro campo, trap, retorno ao gatilho,
× desabilitado durante gravação, clique no fundo (Monitoramento passa a ter).
- Estilos de formulário: as 4 cópias (Usuários `.modal-form`, e as três locais) viram uma primitiva global
  `.modal-form` em `_ui.scss` (grid gap 10px, `label` 9.5px/600/.1em, `input/textarea` 8px·13px, foco,
  `.campo-select` 100%, `__linha` 2 colunas → 1 abaixo de 760px, rodapé `.modal-form__rodape` com `p` à
  esquerda e botões à direita). Erro de campo: `.field-error` global (Equipamentos e Tipos usavam
  `.campo-erro`; specs ajustados). Dica de IP (`.equipamento-modal__dica`) fica local.
- **Risco Equipamentos:** a gaveta atrás fica `inert` e tem `devolverFocoAGaveta()`. O `app-modal` devolve o
  foco ao gatilho (botão "Editar" dentro da gaveta). A ordem tem de garantir que o `inert` sai antes do
  foco voltar; critério de aceite: abrir edição pela gaveta, Escape, foco volta ao "Editar" da gaveta
  (e2e + spec). Ver memória `inert-quebra-retorno-de-foco-da-gaveta`.
- Monitoramento perde o `autofocus` (o modal já foca o primeiro campo).

### 4.6 Ativo/inativo → `.chip-ativo`
Primitiva única (geometria do atual `.chip-monitoramento`):
```scss
.chip-ativo { display:inline-flex; align-items:center; height:18px; padding:0 8px; border:1px solid var(--im-success-border);
  border-radius:var(--im-radius-pill); color:var(--im-success); font:10px var(--im-mono); white-space:nowrap; }
.chip-ativo--off { border-color:var(--im-border-strong); color:var(--im-text-muted); }
```
(valores exatos copiados do `.chip-monitoramento` atual no plano.) Substitui `.chip-monitoramento` (lista e
drawer de Equipamentos, Monitoramento + a redefinição local duplicada), `.chip-status` (Tipos),
`.admin-badge` (Usuários) e o uso de `.chip-manutencao` para "Inativa" em Unidades. Rótulos por tela não
mudam (Ativado/Desativado no monitoramento do equipamento; Ativo/Inativo; Inativa). **Por que fora do
`DisplayStatus`:** vem de booleano, não de enum do backend; e "Ativo" verde no mesmo visual de
"Disponível" misturaria estado de cadastro com estado operacional. `.badge` do `detalhe-generico.scss` é
código morto (nenhum template usa) → removido.

## 5. Botões

Critério do projeto (`_ui.scss`): consulta e navegação usam `.botao` puro.
- Relatórios: tira `botao--primario` dos 5 "Consultar" e de "Aplicar período".
- Mapa: tira `botao--primario` de "Ver unidade".
- Detalhe de notificação: "Tentar novamente" (o texto real; "Tentar de novo" não existe) ganha `class="botao"`;
  a regra `.feedback button` / `.actions button` de `detalhe-generico.scss` que a estilizava sai.
- Fica: `<a class="botao botao--primario">+ Novo equipamento` (criação, mesmo sendo link).

## 6. Responsividade

Sonda `scratchpad/r2/overflow.cjs` (somente leitura; 13 telas × 1366/1280/1180/1024/900/768/600/390px;
lista o elemento-raiz de cada estouro fora de contêiner com rolagem). Resultado de antes (base dc8de3b):
- Topbar (DV18): estoura em todas as telas em 390, 1024, 1180, 1280px (10–201px); em 1366 em Detalhe da
  unidade, Tipos e Telegram (14–23px). Já registrada; fora desta rodada.
- Além da topbar: Unidades, Telegram, Painel (§1) — corrigidos nesta rodada.
- Demais telas: nada além da topbar.

Dívida registrada (sem correção) em `Docs/Front-End-Docs/consistencia-visual-dividas.md`: 17 `max-width`
distintos de ponto de quebra sem escala; escala tipográfica; escala de espaçamento; DV18 (referência).
A sonda é versionada como `e2e/overflow-telas.cjs` (`npm run e2e:overflow`) e roda de novo no fim.

## Verificação

- `ng test` e `ng build` verdes; `npm run contraste` (rodada 1) continua verde.
- Specs novos/ajustados: helper `navegarAbas`; modais migrados (Escape com foco no gatilho, foco inicial,
  retorno, Equipamentos com gaveta); paginação 0/1-based nas 3 telas; `.esqueleto` com `role=status`.
- Playwright `e2e/consistencia-visual-r2.cjs`: login por formulário, navegação **só por clique**, API via
  `api-porta.cjs` (backend descartável). Capturas das 13 telas (Login, Painel, Mapa, Unidades, Detalhe da
  unidade, Equipamentos, Tipos, Monitoramento, Medições, Incidentes, Telegram, Relatórios, Usuários) +
  detalhe de notificação, nos dois temas, **antes** (base dc8de3b, ng serve 4301) e **depois** (4300).
  Verificações automáticas por tela: nenhum sobretítulo; `getComputedStyle(h1)` = 20px/700 (Mapa: 18px);
  raiz `.pagina` com padding 22px e max-width 1500px (Mapa sem); subtítulo é `p`; nenhum elemento com
  `font-family` começando por JetBrains; modais de Equipamentos/Tipos/Monitoramento fecham com Escape logo
  após abrir e devolvem o foco; Relatórios: setas mudam de aba.
- Sonda de overflow depois: nenhum estouro além da topbar.
- Capturas conferidas visualmente pelo orquestrador (todas as telas, dois temas).

## Riscos

- Tabelas locais migradas mudam de aparência (cabeçalho sans 9,5px `text-dim`, linhas mais justas, hover):
  é o objetivo, mas é a mudança mais visível da rodada.
- Equipamentos: modal sobre gaveta `inert` (§4.5).
- Relatórios está perto do orçamento de 6 kB de SCSS do componente; a rodada remove mais do que acrescenta.
- `@use` de Medições removido de 3 telas: regra que só existia por herança some — conferir em captura.
- Painel: renomear `.tabela` local afeta seletores de spec/e2e (`.tabela`, `.linha`).
