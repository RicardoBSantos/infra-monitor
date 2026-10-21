# Consistência visual — rodada 2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uma geração de página só (A), sem sobretítulo, mono com critério, e as implementações locais (paginação, tabela, abas, esqueleto, modal, chip ativo, botões) trocadas pelas compartilhadas.

**Architecture:** Task 1 acrescenta todas as primitivas novas em `_ui.scss` (aditivo: as antigas continuam até seus consumidores migrarem) e o helper `navegarAbas`. Tasks 2–11 migram uma tela/grupo cada, com dono de arquivo exclusivo, para rodar em paralelo. Task 12 remove o que ficou órfão, versiona sonda e dívida. Task 0 escreve o roteiro Playwright usado nas capturas antes/depois.

**Tech Stack:** Angular 21 (standalone, signals, OnPush), SCSS, Vitest via `ng test` (`@angular/build:unit-test`), Playwright `.cjs`.

**Spec:** `Docs/superpowers/specs/2026-10-21-consistencia-visual-r2-design.md` — leia a seção citada em cada task.

## Global Constraints

- Raiz do frontend: `C:\Users\rbfilho\Documents\infra-monitor-wt-cv2\infra-monitor-frontend` (worktree; `node_modules` é junção — **nunca** apagar).
- Casca: `.pagina` = padding 22px, `max-width:1500px`, `margin:0 auto`; móvel ≤760px padding 16px. h1 20px/700. Mapa **não** usa `.pagina`.
- Sobretítulo sai de todas as telas (inclusive Mapa). Subtítulo é `<p class="pagina__descricao">`.
- `--im-mono: 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace;` — nenhum literal `'IBM Plex Mono'` fora de `_tokens.scss` (exceto `--lg-mono`, login).
- Critério de mono (spec §3): identificador técnico (IP, hostname, série, sigla, códigos/ids, chat id), tempo e valor medido (data/hora, duração, latência, %, contagens/KPI), chips/badges. **Nomes** (equipamento, monitor, unidade, tipo), texto livre e cabeçalhos de tabela: sans.
- Consulta e navegação usam `.botao` puro; `--primario` só em criação/confirmação.
- Ativo/inativo usa `.chip-ativo`/`.chip-ativo--off`; **não** entra em `DisplayStatus`.
- Esqueleto: só `.esqueleto` (com `span`s), sempre `role="status"` + `aria-label="Carregando …"`.
- Não mexer em: escala tipográfica/espaçamento, `max-width` de pontos de quebra, topbar (DV18), tokens de cor (rodada 1), `--lg-*`.
- Comentários e textos em português, no estilo dos arquivos vizinhos (SCSS desta base mistura arquivos minificados de uma linha e arquivos formatados — mantenha o estilo do arquivo que editar).
- Testes: rode **só os specs do seu escopo** com `npx ng test --watch=false --include='src/app/features/<pasta>/**/*.spec.ts'` (o controlador roda a suíte inteira depois da onda). Outros agentes trabalham no mesmo worktree em paralelo: `git add` **só arquivos seus** (nunca `git add -A`/`.`); se o commit falhar por `index.lock`, espere 5s e repita.
- Nunca editar arquivo fora da lista **Files** da sua task. Se precisar, reporte como DONE_WITH_CONCERNS.

## Review Focus

1. **Escape logo após abrir o modal** (foco ainda no gatilho) em Equipamentos/Tipos/Monitoramento: deve fechar — hoje não fecha. Pinado nos specs das Tasks 7, 8, 9.
2. **Editar equipamento pela gaveta e fechar o modal** (gaveta `inert` atrás): foco tem de voltar ao botão da gaveta, não ao `body`. Pinado na Task 7 (spec) e no e2e (Task 0, caso `modal-gaveta`).
3. **Lista vazia ou 1 página** em Medições/Notificações/Monitoramento após trocar a paginação: sem "Página 1 de 0", sem botão Próxima habilitado. Pinado nas Tasks 2, 9.
4. **Viewport estreita (390–1180px)** em Unidades/Telegram/Painel: a tabela rola dentro do cartão, a página não estoura. Pinado pela sonda (Task 0) e pela regra `minmax(0,1fr)` nas Tasks 2, 5, 6.
5. **Teclado nas abas de Relatórios** (setas/Home/End) e regressão nas abas de Unidade/Telegram após extrair o helper. Pinado no spec do helper (Task 1) e nos specs das Tasks 2, 4, 6.

---

## Task 0: Roteiro Playwright r2 e sonda de overflow versionada

**Files:**
- Create: `infra-monitor-frontend/e2e/consistencia-visual-r2.cjs`
- Create: `infra-monitor-frontend/e2e/overflow-telas.cjs`
- Modify: `infra-monitor-frontend/package.json` (scripts `e2e:cv2`, `e2e:overflow`)

**Interfaces:**
- Consumes: `e2e/api-porta.cjs` (`apontarApi(ctx)`), modelo `e2e/consistencia-visual-r1.cjs` (leia-o inteiro antes: login, troca de tema, `aguardarCarga`, `irPara`, gravação em `finally`, `unrouteAll`).
- Produces: `CV_FASE=antes|depois CV_SENHA=… E2E_EMAIL=… E2E_BASE=… API_PORT=… E2E_OUT=… node e2e/consistencia-visual-r2.cjs` → PNGs `<tela>-<tema>.png` em `E2E_OUT/<fase>/` + `resultados.json`; exit 1 só em `depois` com falha. `SAIDA=… node e2e/overflow-telas.cjs` → JSON.

- [ ] **Step 1: Sonda.** Copie `C:\Users\rbfilho\AppData\Local\Temp\claude\C--Users-rbfilho-Documents-infra-monitor\95b758dc-e98f-435e-87d4-b93f231de922\scratchpad\r2\overflow.cjs` para `e2e/overflow-telas.cjs`. Ajustes: `require('./api-porta.cjs')` (não `E2E_DIR`), senha em `CV_SENHA`, `SAIDA` obrigatória, cabeçalho de comentário no estilo do r1 explicando env e que é somente leitura. Ao final imprime no console, por tela, as larguras com estouro **além da topbar** (`main > 0` ou `culpados` não vazio) e sai com código 1 se houver (critério da spec §6), 0 caso contrário.

- [ ] **Step 2: Roteiro r2.** Mesmo esqueleto do r1 (`checar`, `naoAplicavel`, `resultados`, `errosPagina`, `respostas5xx`, `finally` que grava `resultados.json` e chama `ctx.unrouteAll({behavior:'ignoreErrors'})`). Telas (rótulo → como chegar, **só clique** depois do login):

```js
const TELAS = [ // rótulo, href do .navigation__item
  ['painel', '/dashboard'], ['mapa', '/mapa'], ['unidades', '/unidades'], ['equipamentos', '/equipamentos'],
  ['tipos', '/tipos-equipamento'], ['monitoramento', '/monitores'], ['medicoes', '/medicoes'],
  ['incidentes', '/incidentes'], ['telegram', '/notificacoes'], ['relatorios', '/relatorios'], ['usuarios', '/usuarios'],
];
// + 'unidade-detalhe': em /unidades, clicar o primeiro a[href^="/unidades/"]
// + 'notificacao-detalhe': em /notificacoes (aba Histórico), clicar o primeiro a[href^="/notificacoes/detalhe/"]; se não houver, naoAplicavel
// + 'login' capturado antes de entrar, nos dois temas (como no r1)
```

`aguardarCarga`: espera sumir `.skeleton, .esqueleto, .kpi--carregando, .linha--carregando` (as duas classes, para servir antes e depois). No Mapa espere `.map-titulo` e 3000ms.

Para cada tela e tema (`escuro`, depois `claro` via `.theme-button`): `page.screenshot({ fullPage: true })` em `<rotulo>-<tema>.png`, e as verificações (todas por `page.evaluate`, sem `catch` em seletor):

```js
// V1 sem sobretítulo: nenhum destes existe na tela
['.eyebrow:not(.unidade-form-drawer .eyebrow)', '.telegram__secao', '.map-titulo__eyebrow', 'header > div > p:first-child:not(.pagina__descricao)']
// V2 h1: getComputedStyle(h1) fontSize '20px' e fontWeight '700' (mapa: '18px', não checa peso)
// V3 casca: a raiz section dentro de .shell__main tem classe 'pagina', padding-left '22px' (viewport 1440) e maxWidth '1500px'; mapa: NÃO tem 'pagina'
// V4 subtítulo: o elemento após o h1 no cabeçalho, se existir, é <p> (nenhum header small)
// V5 fonte: nenhum elemento visível com getComputedStyle(el).fontFamily começando por '"JetBrains Mono"' ou 'ui-monospace'
```

Casos extras (só tema escuro):
- `modal-equipamentos`: em Equipamentos, clicar `+ Novo equipamento`, **sem mover o foco**, `page.keyboard.press('Escape')`; checar que `section.modal` sumiu e `document.activeElement` é o botão `+ Novo equipamento`. Idem `modal-tipos` (`+ Novo tipo`) e `modal-monitoramento` (botão primário do cabeçalho de Monitoramento). Capturar `modal-equipamentos-escuro.png` com o modal aberto antes do Escape.
- `modal-gaveta`: em Equipamentos clicar a primeira linha (`Ver`) para abrir a gaveta, clicar o botão de editar dentro da gaveta, Escape; checar `document.activeElement` está dentro da gaveta e não é `body`.
- `abas-relatorios`: focar a primeira `.aba` de Relatórios, `ArrowRight`; checar que a segunda ficou `aria-selected="true"` e focada; `End` → última selecionada.
- `esqueleto`: com `page.route('**/api/v1/medicoes**', r => setTimeout(() => r.continue(), 1500))` instalado **antes** de clicar em Medições, checar `.esqueleto[role="status"]` visível; remover a rota depois.

Na fase `antes` as verificações rodam e gravam, mas não mudam o exit code. Na `depois`, `naoAplicavel` conta como falha (exceto `notificacao-detalhe` sem dados).

- [ ] **Step 3: Scripts npm.** Em `package.json`, depois de `"e2e:cv1"`: `"e2e:cv2": "node e2e/consistencia-visual-r2.cjs",` e `"e2e:overflow": "node e2e/overflow-telas.cjs",`.

- [ ] **Step 4: Verificar sintaxe.** `node --check e2e/consistencia-visual-r2.cjs && node --check e2e/overflow-telas.cjs` → sem saída. (O controlador roda contra o backend descartável.)

- [ ] **Step 5: Commit.** `git add e2e/consistencia-visual-r2.cjs e2e/overflow-telas.cjs package.json && git commit -m "test(e2e): roteiro da rodada 2 de consistencia visual e sonda de overflow"` (+ linha `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`).

---

## Task 1: Primitivas, pilha mono e helper de abas

**Files:**
- Modify: `src/styles/_ui.scss`, `src/styles/_tokens.scss`, `src/styles/_typography.scss`
- Create: `src/app/shared/a11y/navegar-abas.ts`, `src/app/shared/a11y/navegar-abas.spec.ts`
- Modify (literais mono de arquivos compartilhados, sem dono de tela): `src/app/shared/status-badge/status-badge.component.scss`, `src/app/shared/date-range/date-range.component.scss`, `src/app/layout/sidebar/sidebar.component.scss`, `src/app/features/incidentes/incidente-detalhe-drawer.component.scss`, `src/app/features/incidentes/ocorrencia-grafico.component.scss`, `src/app/features/incidentes/timeline/incidente-timeline.component.scss`

**Interfaces:**
- Produces (CSS global): `.pagina`, `.pagina__cabecalho`, `.pagina__descricao`; `.esqueleto` animado + `@keyframes im-esqueleto`; `.chip-ativo`, `.chip-ativo--off`; `.modal-form` (+ `label`, `input`, `textarea`, `.campo-select`, `.modal-form__linha`, `.modal-form__rodape`); `.tabela td small`, `.tabela .acoes`; `.abas--rolagem`.
- Produces (TS): `export function navegarAbas(evento: KeyboardEvent, indice: number, abas: readonly HTMLElement[]): void` em `shared/a11y/navegar-abas.ts`.

- [ ] **Step 1: Spec do helper (falha).** `navegar-abas.spec.ts`:

```ts
import { navegarAbas } from './navegar-abas';

function montar(n: number): HTMLElement[] {
  document.body.innerHTML = '';
  return Array.from({ length: n }, (_, i) => {
    const b = document.createElement('button');
    b.textContent = `aba ${i}`;
    b.addEventListener('click', () => b.setAttribute('data-clicada', 'sim'));
    document.body.appendChild(b);
    return b;
  });
}
const tecla = (key: string) => new KeyboardEvent('keydown', { key, cancelable: true });

describe('navegarAbas', () => {
  it('ArrowRight foca e ativa a próxima', () => {
    const abas = montar(3); const ev = tecla('ArrowRight');
    navegarAbas(ev, 0, abas);
    expect(document.activeElement).toBe(abas[1]);
    expect(abas[1].getAttribute('data-clicada')).toBe('sim');
    expect(ev.defaultPrevented).toBe(true);
  });
  it('ArrowLeft na primeira vai para a última (circular)', () => {
    const abas = montar(3); navegarAbas(tecla('ArrowLeft'), 0, abas);
    expect(document.activeElement).toBe(abas[2]);
  });
  it('ArrowRight na última volta à primeira', () => {
    const abas = montar(3); navegarAbas(tecla('ArrowRight'), 2, abas);
    expect(document.activeElement).toBe(abas[0]);
  });
  it('Home e End vão às pontas', () => {
    const abas = montar(4);
    navegarAbas(tecla('End'), 1, abas); expect(document.activeElement).toBe(abas[3]);
    navegarAbas(tecla('Home'), 3, abas); expect(document.activeElement).toBe(abas[0]);
  });
  it('outra tecla não faz nada nem cancela', () => {
    const abas = montar(2); abas[0].focus(); const ev = tecla('Enter');
    navegarAbas(ev, 0, abas);
    expect(document.activeElement).toBe(abas[0]);
    expect(ev.defaultPrevented).toBe(false);
  });
  it('lista vazia não lança', () => {
    expect(() => navegarAbas(tecla('ArrowRight'), 0, [])).not.toThrow();
  });
});
```

- [ ] **Step 2:** `npx ng test --watch=false --include='src/app/shared/a11y/**/*.spec.ts'` → FAIL (módulo inexistente).

- [ ] **Step 3: Helper.** `navegar-abas.ts`:

```ts
/**
 * Teclado de tablist (padrão WAI-ARIA, ativação automática): ←/→ circulares, Home/End nas pontas.
 * Foca e clica o destino — o clique é o que troca a aba, seja routerLink ou (click) local.
 * Extraído de unidade-detalhe e notificacao-telegram (eram cópias) e usado também em Relatórios.
 */
export function navegarAbas(evento: KeyboardEvent, indice: number, abas: readonly HTMLElement[]): void {
  const total = abas.length;
  if (total === 0) return;
  let destino: number;
  switch (evento.key) {
    case 'ArrowRight': destino = (indice + 1) % total; break;
    case 'ArrowLeft': destino = (indice - 1 + total) % total; break;
    case 'Home': destino = 0; break;
    case 'End': destino = total - 1; break;
    default: return;
  }
  evento.preventDefault();
  abas[destino].focus();
  abas[destino].click();
}
```

- [ ] **Step 4:** mesmo comando → PASS (6 testes).

- [ ] **Step 5: Tokens e tipografia.** Em `_tokens.scss` linha do `--im-mono` (só ele; tema claro herda): `--im-mono: 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace;` com comentário acima: `/* Plex primeiro: é a fonte do projeto e a única carregada (@fontsource). JetBrains saiu — nunca foi carregada e, instalada na máquina, trocava a fonte do mesmo dado conforme a tela. */`. Em `_typography.scss` remova a linha `.im-mono { … }` (0 usos — confirme com `grep -rn "im-mono" src` antes).

- [ ] **Step 6: Primitivas em `_ui.scss`.** Acrescente (sem remover nada existente):

Logo após o bloco de comentário dos botões (topo do arquivo), a casca:
```scss
/* Casca de página (rodada 2 de consistência visual): toda tela de conteúdo põe .pagina na raiz.
   O Mapa não usa — é cartografia presa à viewport, com folga própria de 12px (D20/D21). */
.pagina { box-sizing: border-box; max-width: 1500px; margin: 0 auto; padding: 22px; color: var(--im-text); }
.pagina__cabecalho { display: flex; align-items: end; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 16px; }
.pagina__cabecalho h1 { margin: 0; color: var(--im-text-strong); font-size: 20px; font-weight: 700; line-height: 1.25; }
.pagina__descricao { margin: 4px 0 0; color: var(--im-text-secondary); font-size: 12px; }
@media (max-width: 760px) { .pagina { padding: 16px; } }
```

Substitua as duas linhas do `.esqueleto` por:
```scss
/* Esqueleto de carregamento: a ÚNICA primitiva (o .skeleton local animado foi absorvido).
   Marcação: <div class="esqueleto" role="status" aria-label="Carregando …"> com <span>s. */
.esqueleto { display: grid; gap: 6px; padding: 0 14px 14px; }
.esqueleto span {
  display: block; height: 26px; border-radius: 4px;
  background: linear-gradient(90deg, var(--im-surface-hover), var(--im-border), var(--im-surface-hover));
  background-size: 200% 100%; animation: im-esqueleto 1.2s infinite;
}
@keyframes im-esqueleto { to { background-position: -200% 0; } }
@media (prefers-reduced-motion: reduce) { .esqueleto span { animation: none; } }
```

Acima do `.mono`, o critério:
```scss
/* Mono (rodada 2): para o que se compara caractere a caractere ou se alinha em coluna — IP, hostname,
   série, sigla, códigos e ids, data/hora, duração, latência, %, contagens e KPIs, chips e badges.
   Nomes (equipamento, monitor, unidade, tipo), texto livre e cabeçalhos de tabela ficam em sans. */
```

Depois do bloco `.tabela`:
```scss
.tabela td small { display: block; margin-top: 3px; color: var(--im-text-muted); }
.tabela .acoes { text-align: right; white-space: nowrap; }
```

Depois do bloco `.abas/.aba`:
```scss
/* Muitas abas de texto longo (Relatórios): rola na horizontal em vez de quebrar linha. */
.abas--rolagem { display: flex; flex-wrap: nowrap; max-width: 100%; overflow-x: auto; }
.abas--rolagem .aba { flex: 0 0 auto; }
```

Logo após `.chip-monitoramento--off` (mantenha o `.chip-monitoramento` por enquanto — a Task 12 remove):
```scss
/* Estado de cadastro ativo/inativo (booleano). Não é DisplayStatus: verde de "Ativo" no visual do badge
   de "Disponível" misturaria cadastro com operação. Rótulo é da tela (Ativo/Inativo, Ativado/Desativado). */
.chip-ativo {
  display: inline-flex; align-items: center; height: 18px; padding: 0 8px;
  border: 1px solid var(--im-success-border); border-radius: var(--im-radius-pill);
  color: var(--im-success); font: 10px var(--im-mono); white-space: nowrap;
}
.chip-ativo--off { border-color: var(--im-border-strong); color: var(--im-text-muted); }
```

Formulário de modal (conteúdo projetado no `app-modal` não recebe o CSS do modal). Antes de escrever, leia `src/app/features/unidades/admin-list.component.scss` (`.modal-form…`, `.dialog-actions`) e `src/app/features/equipamentos/equipamento-list.component.scss` (bloco `.equipamento-modal …` form/label/input/textarea/focus/`__linha`/`__rodape`) e copie os valores **exatos** da versão de Equipamentos para:
```scss
/* Formulário dentro de app-modal (rodada 2): era copiado em Usuários, Equipamentos, Tipos e Monitoramento. */
.modal-form { display: grid; gap: 10px; }
.modal-form label { /* = label do .equipamento-modal */ }
.modal-form input, .modal-form textarea { /* = input/textarea do .equipamento-modal, incl. :focus-visible */ }
.modal-form .campo-select { width: 100%; }
.modal-form__linha { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.modal-form__rodape { display: flex; align-items: center; justify-content: flex-end; gap: 8px; margin-top: 6px; }
.modal-form__rodape p { margin: 0 auto 0 0; color: var(--im-text-secondary); font-size: 11.5px; }
@media (max-width: 760px) { .modal-form__linha { grid-template-columns: 1fr; } }
```
(Os comentários `/* = … */` acima são instrução para você: substitua pelas declarações reais copiadas; nenhum comentário-instrução fica no arquivo.)

- [ ] **Step 7: Literais mono nos arquivos compartilhados.** Em cada arquivo da lista Files fora de `styles/`, troque `'IBM Plex Mono', monospace` (com ou sem aspas, com peso/tamanho no shorthand) por `var(--im-mono)`, preservando peso e tamanho. Ex.: `font: 600 9.5px 'IBM Plex Mono', monospace` → `font: 600 9.5px var(--im-mono)`; `font-family: 'IBM Plex Mono', monospace` → `font-family: var(--im-mono)`. Também `_ui.scss:5` (`.eyebrow`). Confirme: `grep -rn "IBM Plex Mono" src/styles src/app/shared src/app/layout src/app/features/incidentes/incidente-detalhe-drawer.component.scss src/app/features/incidentes/ocorrencia-grafico.component.scss src/app/features/incidentes/timeline` → só `_tokens.scss` (`--im-mono` e `--lg-mono`) e `_typography.scss` (`@use` do fontsource).

- [ ] **Step 8:** `npx ng build` → sem erro novo (o aviso de budget de `mapa.component.scss` é pré-existente). `npm run contraste` → OK.

- [ ] **Step 9: Commit.** `git add` dos arquivos desta task; mensagem `feat(ui): primitivas da rodada 2 (pagina, esqueleto, chip-ativo, modal-form) e pilha mono`.

---

## Task 2: Operacional — Medições, Incidentes (lista), Notificações (lista), Telegram (casca e configuração)

Leia a spec §1, §2, §3, §4.1, §4.2, §4.4.

**Files:**
- Modify: `src/app/features/medicoes/medicao-list.component.{html,scss,ts}`
- Modify: `src/app/features/incidentes/incidente-unificado-list.component.{html,scss,ts,spec.ts}`
- Modify: `src/app/features/notificacoes/notificacao-list.component.{html,scss,ts,spec.ts}`
- Modify: `src/app/features/notificacoes/notificacao-telegram.component.{html,scss,ts,spec.ts}`
- Modify: `src/app/features/notificacoes/configuracao-tab.component.{html,scss,spec.ts}`

**Interfaces:**
- Consumes: Task 1 (`.pagina*`, `.esqueleto`, `.tabela td small`, `.tabela .acoes`, `navegarAbas`); `PaginacaoComponent` (`src/app/shared/paginacao/paginacao.component.ts`: inputs `paginaAtual` 1-based, `totalPaginas`, `contagem`, `rotulo`; output `mudarPagina` 1-based).

Hoje `incidente-unificado-list`, `notificacao-list` e `configuracao-tab` fazem `@use '../medicoes/medicao-list.component.scss'` e herdam tudo (filtros, tabela, paginação, esqueleto, feedback). Ordem de trabalho: primeiro torne cada uma das 4 telas independente, depois troque as peças.

- [ ] **Step 1: Specs que falham.** 
  - `notificacao-list.component.spec.ts`: novo teste — com resposta `{content:[1 item], page:0, totalPages:2, totalElements:21, size:20}` renderiza `app-paginacao` contendo "Página 1 de 2"; clicar "Próxima ›" dispara requisição com `page=1`. Outro: resposta vazia (`content:[]`, `totalPages:0`) não renderiza `app-paginacao`. E: estado de carregamento renderiza `.esqueleto[role="status"]`.
  - `incidente-unificado-list.component.spec.ts`: a tabela tem `class="tabela"`, a coluna DURAÇÃO tem `td.numerico`, e não existe `header small` nem `header p:not(.pagina__descricao)`.
  - `notificacao-telegram.component.spec.ts`: ArrowRight na primeira aba foca a segunda; `End` foca a última (helper).
  Rode `npx ng test --watch=false --include='src/app/features/{notificacoes,incidentes}/**/*.spec.ts'` → os novos FALHAM.

- [ ] **Step 2: Casca.** Raízes:
  - Medições: `<section class="operational-page pagina" …>`; Incidentes idem; Telegram `<section class="telegram pagina" …>`.
  - Cabeçalho das três: `<header class="pagina__cabecalho"><div><h1 id="…">…</h1><p class="pagina__descricao">…texto do antigo small…</p></div></header>` — **remover** o `<p>` de sobretítulo ("MONITORAMENTO · HISTÓRICO", "OPERAÇÕES · INDISPONIBILIDADE E LATÊNCIA") e `.telegram__secao`.
  - `notificacao-list` não ganha `.pagina` (vive dentro da casca); apague o neutralizador `.operational-page{max-width:none;margin:0;padding:0}` e a media 620px dele se a raiz deixar de ter padding próprio.
  - Telegram: `.telegram { display:grid; gap:14px; grid-template-columns:minmax(0,1fr); }` (sem padding — vem da `.pagina`). Remova h1/small/secao locais do SCSS.
  - SCSS de Medições: tire `max-width`, `margin`, `padding`, `color`, `h1`, `header p`, `header small` e o `@media(max-width:620px){.operational-page{padding:16px}}`.

- [ ] **Step 3: Desfazer o `@use`.** Em `incidente-unificado-list.component.scss`, `notificacao-list.component.scss` e `configuracao-tab.component.scss` remova `@use '../medicoes/medicao-list.component.scss'` e copie para cada um **só** as regras que o template dele usa (filtros `.filters`, `.feedback`, etc. — verifique classe por classe no HTML). Tabela, paginação, `.skeleton` e `.mono` **não** são copiados (vêm das primitivas).

- [ ] **Step 4: Tabelas.** Nas 3 listas, destino:
```html
<div class="cartao">
  <div class="X__rolagem"><table class="tabela">…</table></div>
  @if (totalPages() > 0) {
    <app-paginacao [paginaAtual]="pageNumber() + 1" [totalPaginas]="totalPages()"
      [contagem]="plural(totalElements(), 'medição', 'medições')" rotulo="Paginação de medições"
      (mudarPagina)="goToPage($event - 1)" />
  }
</div>
```
(`X__rolagem` = `medicoes__rolagem`, `incidentes__rolagem`, `notificacoes__rolagem`; SCSS local: `.X__rolagem { overflow-x: auto; } .X__rolagem .tabela { min-width: <o min-width atual da table> ; }`.) Incidentes já usa `app-paginacao` — só mova para dentro do `.cartao`. Use o nome real dos sinais/métodos de cada componente (Medições/Notificações: `pageNumber`, `totalPages`, `totalElements`, `goToPage(n)` 0-based). Importe `PaginacaoComponent` no `imports` de Medições e Notificações.
  - `.right` → `numerico` (th e td); `td.actions` → `td.acoes`, `th.right` de ações → `th.acoes`.
  - Medições LATÊNCIA: `<th class="numerico">` e `<td class="mono numerico">`.
  - Incidentes `td.evento{display:flex}`: mova o flex para um `<span class="evento">` dentro do `td`.
  - Mono pelo critério: nome do monitor (Medições `strong`) e equipamento ficam sans; datas, ids, duração, latência, tentativas com `mono`.
  - Remova do SCSS: `.table-wrap`, `table`, `th`, `td`, `.right`, `.pagination`, `.mono` locais.

- [ ] **Step 5: Esqueleto.** Todo `<div class="skeleton" aria-label="Carregando X">` (Medições, Notificações, Incidentes, configuração) vira `<div class="esqueleto" role="status" aria-label="Carregando X">` com os mesmos `span`s. Remova `.skeleton`, `@keyframes loading` e o `@media (prefers-reduced-motion)` local de `medicao-list.component.scss`.

- [ ] **Step 6: Abas do Telegram.** Em `notificacao-telegram.component.ts` troque o método `navegarPorTeclado` por chamada ao helper: `protected aoTeclarAba(evento: KeyboardEvent, indice: number): void { navegarAbas(evento, indice, this.gatilhosDeAba().map((r) => r.nativeElement)); }` (use o nome real do `viewChildren` existente) e atualize o `(keydown)` do template.

- [ ] **Step 7: Mono literais restantes** nos arquivos desta task → `var(--im-mono)` (inclui `.filters label`, `.filters__rotulo`, `.link` do código INC/LAT em Incidentes). `grep -rn "IBM Plex Mono" src/app/features/{medicoes,incidentes/incidente-unificado-list*,notificacoes}` → vazio.

- [ ] **Step 8:** `npx ng test --watch=false --include='src/app/features/{medicoes,incidentes,notificacoes}/**/*.spec.ts'` → PASS. `npx ng build` → OK.

- [ ] **Step 9: Commit** (só os arquivos da task): `refactor(operacional): medicoes, incidentes e telegram na casca .pagina com tabela, paginacao e esqueleto compartilhados`.

---

## Task 3: Usuários

Spec §1, §2, §3, §4.2, §4.4, §4.5 (só estilos), §4.6.

**Files:**
- Modify: `src/app/features/usuarios/usuario-list.component.{html,ts,spec.ts}`
- Modify: `src/app/features/unidades/admin-list.component.scss` (usado **só** por Usuários: confirme com `grep -rn "admin-list.component.scss" src`; se for só Usuários, mova para `src/app/features/usuarios/usuario-list.component.scss`, aponte o `styleUrl` e apague o antigo)

- [ ] **Step 1: Spec (falha).** Em `usuario-list.component.spec.ts`: status do usuário usa `span.chip-ativo` (inativo com `chip-ativo--off`, texto "Inativo"); tabela tem `class="tabela"`; carregando mostra `.esqueleto[role="status"]`; o cabeçalho não tem `p` de sobretítulo e a descrição é `p.pagina__descricao`. Ajuste a asserção existente `form.modal-form > label` só se a estrutura mudar (não deve). Rode `npx ng test --watch=false --include='src/app/features/usuarios/**/*.spec.ts'` → FALHA.
- [ ] **Step 2:** Raiz `class="admin-page pagina"`; cabeçalho `pagina__cabecalho` com h1 + `p.pagina__descricao` ("Controle de acesso e perfis da plataforma."), sem "ADMINISTRAÇÃO", botão primário à direita.
- [ ] **Step 3:** Tabela → `.cartao` + `.usuarios__rolagem` (`overflow-x:auto`, `.tabela{min-width:700px}`) + `table.tabela`; `th.right`/`td.actions` → `acoes`. `.admin-badge` → `<span class="chip-ativo" [class.chip-ativo--off]="!item.ativo">`.
- [ ] **Step 4:** Esqueleto → `.esqueleto` com `role="status"`.
- [ ] **Step 5:** SCSS: remova casca, h1, `header p/small`, `.filter span` (sem uso — confirme), `th/td/table/.table-wrap`, `.mono` (sem uso), `.admin-badge`, `.skeleton` + keyframes + reduced-motion, e os estilos `.modal-form…`/`.dialog-actions` que agora são globais (se `.dialog-actions` não estiver na primitiva, troque o markup para `.modal-form__rodape`). Nenhum `'IBM Plex Mono'` sobra.
- [ ] **Step 6:** testes do escopo PASS; `npx ng build` OK.
- [ ] **Step 7: Commit:** `refactor(usuarios): casca .pagina, tabela, esqueleto e chip-ativo compartilhados`.

---

## Task 4: Relatórios

Spec §1, §3, §4.2, §4.3, §4.4 (`.widget-carregando`), §5.

**Files:**
- Modify: `src/app/features/relatorios/relatorios.component.{html,scss,ts,spec.ts}`

- [ ] **Step 1: Spec (falha).** Em `relatorios.component.spec.ts`:
  - substitua as asserções que leem `.tabs` no CSS compilado (linhas ~22-26) por: o template tem `.abas.abas--rolagem[role="tablist"]` e 7 `.aba[role="tab"]`;
  - ArrowRight na primeira `.aba` seleciona a segunda (`aria-selected="true"`) e a foca; End seleciona a última;
  - `.kpi-card .widget-carregando` conta 3 (era `.skeleton`);
  - nenhum `button[type=submit].botao--primario` no template (Consultar/Aplicar período são `.botao`);
  - `h1` está dentro de `header.pagina__cabecalho`.
  Rode o escopo → FALHA.
- [ ] **Step 2:** Raiz `class="reports pagina"`; cabeçalho `pagina__cabecalho` (h1 + `p.pagina__descricao`, botão Atualizar à direita). SCSS: remova `.reports{max-width…padding…}`, `.reports h1{…22px}`.
- [ ] **Step 3: Abas.** `<div class="abas abas--rolagem" role="tablist" aria-label="Áreas de relatórios">` + `<button type="button" class="aba" role="tab" [class.aba--ativa]="activeTab()===…" [attr.aria-selected]="…" [attr.tabindex]="activeTab()===… ? 0 : -1" (click)="selectTab(…)" (keydown)="aoTeclarAba($event, i)" #aba>`; no `.ts`: `private readonly abas = viewChildren<ElementRef<HTMLButtonElement>>('aba');` e `protected aoTeclarAba(e: KeyboardEvent, i: number) { navegarAbas(e, i, this.abas().map((r) => r.nativeElement)); }` (índice `i` = posição do botão; se os botões forem estáticos, passe 0..6 literais). Mantenha a margem que `.tabs` dava (`margin:20px 0 12px`) numa regra local `.reports .abas{margin:20px 0 12px}`. Remova `.tabs*` do SCSS.
- [ ] **Step 4: Tabelas.** Cada `.table-wrap > table` → `<div class="cartao"><div class="reports__rolagem"><table class="tabela">` (com o `<caption class="visualmente-oculto">` atual). `.compact-table` → mesmo padrão com `.tabela`. `min-width` 1100/680 vão para `.reports__rolagem .tabela{min-width:1100px}` e `.compact-table .tabela{min-width:680px}`. Células numéricas e datas: `class="numerico mono"` / `class="mono"`. Remova do SCSS `table`, `th,td`, `th{…}`, `th.numerico,td.numerico`, `.table-wrap` (fora do agrupamento com `.filters,input,.kpi-card…` — reescreva o seletor agrupado sem `.table-wrap`). A paginação continua dentro do wrapper `.pagination` (spec usa `.pagination select`), agora dentro do `.cartao`.
- [ ] **Step 5:** `.skeleton` (texto) → `.widget-carregando` no HTML e no SCSS.
- [ ] **Step 6:** Botões: remova `botao--primario` dos 5 "Consultar" e de "Aplicar período".
- [ ] **Step 7:** Mono: `'IBM Plex Mono'` → `var(--im-mono)` (`.reports__eyebrow, th, .bar-chart strong` vira `.reports__eyebrow, .bar-chart strong` — `th` sai porque vem da `.tabela`; `.kpi-card__source`, `.kpi-card__value`).
- [ ] **Step 8:** escopo PASS; `npx ng build` sem aviso **novo** de budget para `relatorios.component.scss`.
- [ ] **Step 9: Commit:** `refactor(relatorios): casca, abas, tabelas e botoes no padrao compartilhado`.

---

## Task 5: Painel

Spec §1, §3, §4.2.

**Files:**
- Modify: `src/app/features/dashboard/dashboard.component.{html,scss,spec.ts}`
- Modify: `infra-monitor-frontend/e2e/painel-status-tipos.cjs` **somente** se usar o seletor `.tabela` do Painel (renomeado) — confira com grep.

- [ ] **Step 1: Spec (falha).** Em `dashboard.component.spec.ts`: a raiz `section` tem classe `pagina`; o h1 está em `header.pagina__cabecalho`; a tabela de equipamentos expandida é `table.tabela`; o nome do equipamento na linha **não** tem classe `mono` e o IP tem. Ajuste seletores existentes `.tabela`/`.tabela__cabecalho` para `.painel-grade`/`.painel-grade__cabecalho`. Escopo → FALHA.
- [ ] **Step 2:** Raiz `class="painel pagina"`; `.painel { display:grid; gap:14px; grid-template-columns:minmax(0,1fr); }` (sem padding). Cabeçalho: `header.painel__header` ganha também `pagina__cabecalho`; `.painel__meta` fica (meta dinâmica em mono), mas com `margin:4px 0 0` igual à descrição. Remova h1 local do SCSS.
- [ ] **Step 3:** Renomeie a grade de `div`s `.tabela`/`.tabela__cabecalho` → `.painel-grade`/`.painel-grade__cabecalho` (HTML, SCSS, spec). A `table.equipamentos` passa a `class="tabela equipamentos"` e o SCSS dela (cópia literal da primitiva) sai, ficando só o que é próprio (o `display:block; overflow-x:auto` abaixo de 860px).
- [ ] **Step 4: Mono:** nome do equipamento (`dashboard.html` ~132) sem `mono`; tipo sans; IP, latência, disponibilidade, última verificação com `mono numerico`. Sigla · município (`.linha__nome small`) fica mono.
- [ ] **Step 5:** escopo PASS; build OK.
- [ ] **Step 6: Commit:** `refactor(painel): casca .pagina, grade renomeada e tabela compartilhada`.

---

## Task 6: Unidades (lista, detalhe e abas)

Spec §1, §3, §4.3 (helper), §4.6.

**Files:**
- Modify: `src/app/features/unidades/unidade-list.component.{html,scss,spec.ts}`
- Modify: `src/app/features/unidades/unidade-detalhe.component.{html,scss,ts,spec.ts}`
- Modify: `src/app/features/unidades/detalhe/{equipamentos-tab,visao-geral,incidentes-tab,configuracoes-tab}.component.{html,scss}` (só o necessário)

- [ ] **Step 1: Spec (falha).** `unidade-list.component.spec.ts`: raiz `.pagina`; unidade inativa mostra `span.chip-ativo.chip-ativo--off` "Inativa" (não `.chip-manutencao`). `unidade-detalhe.component.spec.ts`: ArrowRight na primeira `[role=tab]` foca a segunda; End foca a última; raiz `.pagina`. Escopo `src/app/features/unidades/**/*.spec.ts` → FALHA.
- [ ] **Step 2:** Lista: raiz `class="unidades pagina"`; `.unidades { display:grid; gap:14px; grid-template-columns:minmax(0,1fr); }`; `header.unidades__topo` + `pagina__cabecalho`; `<p>` → `p.pagina__descricao`; remova h1/p locais e padding. "Inativa": `<span class="chip-ativo chip-ativo--off">Inativa</span>`.
- [ ] **Step 3:** Detalhe: raiz `class="unidade-detalhe pagina"`, mesma regra de grid `minmax(0,1fr)`; h1 vem de `.pagina__cabecalho h1` (adicione `pagina__cabecalho` ao `header.unidade-detalhe__header`; o link Voltar fica acima, badge ao lado do h1). Remova padding/h1 locais. Abas: `navegarPorTeclado` → `navegarAbas(evento, indice, this.gatilhosDeAba().map((r) => r.nativeElement))` (método `aoTeclarAba`, template atualizado).
- [ ] **Step 4: Mono nas abas:** nome do equipamento sans em `equipamentos-tab.html` (~61-62), `visao-geral.html` (~24) e `incidentes-tab.html` (~27); `configuracoes-tab.html` (~11): só o `dd` da sigla/código interno em mono (os demais `dd` sans).
- [ ] **Step 5:** escopo PASS; build OK.
- [ ] **Step 6: Commit:** `refactor(unidades): casca .pagina, chip-ativo, helper de abas e mono por criterio`.

---

## Task 7: Equipamentos (lista, modal e gaveta)

Spec §1, §3, §4.5, §4.6. **Maior risco da rodada** — leia a memória `inert-quebra-retorno-de-foco-da-gaveta` resumida aqui: com a gaveta `inert`, o gatilho do modal fica na região inerte e `focus()` nele falha em silêncio; o foco tem de voltar **depois** que o `inert` sai.

**Files:**
- Modify: `src/app/features/equipamentos/equipamento-list.component.{html,scss,ts,spec.ts}`
- Modify: `src/app/features/equipamentos/equipamento-detalhe-drawer.component.{html,scss}`, `equipamento-detalhe-drawer.spec.ts`

**Interfaces:** `ModalComponent` (`src/app/shared/modal/modal.component.ts`): inputs `aberto`, `titulo` (required), `subtitulo`, `largura` (default `'520px'`), `bloqueado`; output `fechar`; um `<ng-content/>`.

- [ ] **Step 1: Specs (falha).** Em `equipamento-list.component.spec.ts`:
  - abrir criação → existe `app-modal section.modal` com o form; `document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))` **sem focar nada antes** fecha;
  - durante `salvando()` o Escape não fecha e o × está `disabled`;
  - troque `.equipamento-modal form` → `app-modal form.modal-form`; `small.campo-erro` → `small.field-error`;
  - status de monitoramento na linha usa `.chip-ativo` (não `.chip-monitoramento`); nome do equipamento sem `mono`, IP e hostname com.
  - fluxo gaveta: abrir gaveta, acionar editar, fechar o modal → depois de `await fixture.whenStable()` + um `setTimeout` 0, `document.activeElement` está dentro da gaveta (não `body`).
  Em `equipamento-detalhe-drawer.spec.ts` (~134-147): `.chip-monitoramento` → `.chip-ativo`, `--off` → `chip-ativo--off`, texto 'Ativado' mantido. Escopo `src/app/features/equipamentos/**/*.spec.ts` → FALHA.
- [ ] **Step 2: Modal.** Substitua `div.dialog-backdrop > section.equipamento-modal` por:
```html
<app-modal [aberto]="formularioAberto()" [titulo]="…título atual…" [subtitulo]="…subtítulo atual…"
  largura="640px" [bloqueado]="salvando()" (fechar)="fecharFormulario()">
  <form class="modal-form" [formGroup]="…" (ngSubmit)="…"> …campos atuais…
    <div class="modal-form__linha">…</div>
    <footer class="modal-form__rodape"><p>…texto atual…</p> …botões atuais… </footer>
  </form>
</app-modal>
```
(use os nomes reais dos sinais/métodos; mantenha `<p role="status">` de carregando edição e `.equipamento-modal__dica` dentro do form.) Importe `ModalComponent`. Erros de campo: `small.field-error`. SCSS: apague `.dialog-backdrop` e todo o bloco `.equipamento-modal*` exceto `__dica`.
- [ ] **Step 3: Foco com a gaveta.** Mantenha `devolverFocoAGaveta()` mas garanta a ordem: quando o modal fecha, o `inert` da gaveta é removido **antes** do foco ser devolvido. Se o retorno do `app-modal` (no fechamento) acontecer enquanto a gaveta ainda está inerte, o `devolverFocoAGaveta()` (em `setTimeout`) é quem conserta — confirme pelo spec do Step 1 que o foco termina dentro da gaveta. Não altere `modal.component.ts`.
- [ ] **Step 4: Casca.** Raiz `class="equipamentos pagina"`; `equipamentos__topo` + `pagina__cabecalho`; `p` → `p.pagina__descricao`; SCSS sem `max-width/margin/padding/color` da raiz nem h1/p locais.
- [ ] **Step 5: Chip e mono.** `.chip-monitoramento` → `.chip-ativo` (lista ~153, gaveta ~190). Nome do equipamento sem `mono` (lista ~135, título da gaveta ~8).
- [ ] **Step 6:** escopo PASS; build OK.
- [ ] **Step 7: Commit:** `refactor(equipamentos): modal compartilhado, casca .pagina e chip-ativo`.

---

## Task 8: Tipos de equipamento

Spec §1, §4.5, §4.6.

**Files:**
- Modify: `src/app/features/tipos-equipamento/tipo-equipamento-list.component.{html,scss,ts,spec.ts}`

- [ ] **Step 1: Spec (falha):** Escape no `document` logo após abrir `+ Novo tipo` fecha o `app-modal`; foco volta ao botão; `.tipo-modal` (~221) → `app-modal form.modal-form`; `.campo-erro` → `.field-error`; tipo inativo mostra `.chip-ativo.chip-ativo--off`; raiz `.pagina`. Escopo → FALHA.
- [ ] **Step 2:** Modal → `app-modal` (largura padrão 520px; `[bloqueado]="salvando()"`), form `.modal-form`, rodapé `.modal-form__rodape`. SCSS: apague `.dialog-backdrop`, `.tipo-modal*`.
- [ ] **Step 3:** `.chip-status`/`--off` → `.chip-ativo`/`--off`; apague `.chip-status` do SCSS.
- [ ] **Step 4:** Casca `.tipos pagina` + `pagina__cabecalho` + `p.pagina__descricao`; remova casca/h1/p locais. (O filtro `.tipos__abas` em pílula fica — é filtro, não aba; fora do escopo.)
- [ ] **Step 5:** escopo PASS; build OK. **Commit:** `refactor(tipos): modal compartilhado, casca .pagina e chip-ativo`.

---

## Task 9: Monitoramento

Spec §1, §2, §3, §4.1, §4.5, §4.6.

**Files:**
- Modify: `src/app/features/monitores/monitor-management.component.{html,scss,ts,spec.ts}`

- [ ] **Step 1: Spec (falha):** sem `.eyebrow` nas duas variantes (página e `equipamentoContextId` setado); página tem `.pagina` e embutido **não**; descrição é `p.pagina__descricao` (página) / `p` (embutido, sem `small`); paginação é `app-paginacao` com `p.contagem` '1 monitor'/'2 monitores' (asserção existente continua) e resposta vazia não renderiza `app-paginacao`; Escape no `document` logo após abrir o formulário fecha o `app-modal`; status do monitor `.chip-ativo`; nome do monitor sem `mono`. Escopo `src/app/features/monitores/**/*.spec.ts` → FALHA.
- [ ] **Step 2: Casca:** `<section class="monitor-page" [class.pagina]="!equipamentoContextId()" [class.monitor-page--embedded]="equipamentoContextId()" …>`; cabeçalho `monitor-page__topo pagina__cabecalho`; remove `<p class="eyebrow">`; `<small>` → `<p class="pagina__descricao">`. SCSS: tira `max-width/margin/padding/color` de `.monitor-page`, h1/small locais (mantém `h2` 16px do embutido). `.monitor-page--embedded` mantém `margin-top:22px`.
- [ ] **Step 3: Paginação:** `.monitor-page__paginacao` → `<app-paginacao [paginaAtual]="pageNumber()+1" [totalPaginas]="totalPages()" [contagem]="plural(totalElements(),'monitor','monitores')" rotulo="Paginação de monitores" (mudarPagina)="goToPage($event-1)" />` dentro de `@if (totalPages() > 0)` (use os nomes reais); apague `.monitor-page__paginacao` e o `@media` correspondente.
- [ ] **Step 4: Modal:** → `app-modal` `largura="640px"` `[bloqueado]="saving()"` `(fechar)="closeForm()"`; remove `autofocus`; form `.modal-form`, `.monitor-modal__linha` → `.modal-form__linha`, rodapé `.modal-form__rodape`. Apague `.dialog-backdrop`, `.monitor-modal*`.
- [ ] **Step 5:** Chip: `.chip-monitoramento` → `.chip-ativo`; apague a redefinição local de `.chip-monitoramento` (~100-114). `.chip-tipo` fica. Nome do monitor (~102) sem `mono`.
- [ ] **Step 6:** escopo PASS e `src/app/features/equipamentos/equipamento-detalhe-drawer.spec.ts` (embute este componente) PASS; build OK. **Commit:** `refactor(monitoramento): casca, paginacao, modal e chip compartilhados`.

---

## Task 10: Detalhe de notificação e `detalhe-generico.scss`

Spec §1, §2, §4.4, §4.6 (`.badge` morto), §5.

**Files:**
- Modify: `src/app/features/notificacoes/notificacao-detail.component.{html,scss,ts,spec.ts}`
- Modify: `src/app/features/detalhe-generico.scss` (confirme com grep que só `notificacao-detail` usa; se for, mova as regras para `notificacao-detail.component.scss` e apague o arquivo genérico)

- [ ] **Step 1: Spec (falha):** raiz `.pagina`; sem `header p` de sobretítulo; carregando `.esqueleto[role="status"]`; erro mostra `button.botao` "Tentar novamente" que chama `load()`. Escopo → FALHA. (Não conflita com a Task 2: arquivos `notificacao-detail.*` são só desta task.)
- [ ] **Step 2:** Raiz `class="detail pagina"`; remove `.detail{max-width:1100px…padding…}`. O `header` em cartão fica; h1 20px/700 (remova `h1{…22px}` local; o h1 não está em `.pagina__cabecalho`, então declare local `font-size:20px; font-weight:700`). O "ADMINISTRAÇÃO · NOTIFICAÇÃO #id" sai; se o `#id` não aparecer em outro lugar da tela, vira `<p class="pagina__descricao mono">Notificação #{{id}}</p>` abaixo do h1.
- [ ] **Step 3:** `.skeleton` (bloco único) → `<div class="esqueleto" role="status" aria-label="Carregando notificação"><span></span><span></span><span></span><span></span></div>`; remove `.skeleton`/keyframes/reduced-motion locais.
- [ ] **Step 4:** "Tentar novamente": `class="botao"`; remova `.feedback button` e `.actions a,.actions button` se ficarem sem uso. Remova `.badge`/`.badge.inactive` (mortos) e qualquer outra regra sem uso no template (confira cada seletor). `'IBM Plex Mono'` → `var(--im-mono)`.
- [ ] **Step 5:** escopo PASS; build OK. **Commit:** `refactor(notificacao-detalhe): casca .pagina, esqueleto e botao compartilhados`.

---

## Task 11: Mapa

Spec §2 (Mapa), §3, §5.

**Files:**
- Modify: `src/app/features/mapa/mapa.component.{html,scss,spec.ts}`
- Modify: `Docs/mapa-architecture/mapa-decisoes.md` (nova `## D23`), `Docs/mapa-architecture/mapa-contexto-atual.md` (linha da tabela de cabeçalho ~644 e onde citar a placa)

- [ ] **Step 1: Spec (falha):** `.map-titulo` não contém `.map-titulo__eyebrow`; "Ver unidade" é `button.botao` sem `botao--primario`. Escopo `src/app/features/mapa/**/*.spec.ts` → FALHA.
- [ ] **Step 2:** Remova `<p class="map-titulo__eyebrow">OPERAÇÕES · SERGIPE</p>` e a regra `.map-titulo__eyebrow`. "Ver unidade": tire `botao--primario`.
- [ ] **Step 3: Mono:** todos os `'IBM Plex Mono'` do SCSS → `var(--im-mono)` (preservando peso/tamanho). `.afetados__meta` ("tipo · IP"): tipo em sans, IP em mono — separe em `<span class="mono">` só no IP se hoje é um texto único.
- [ ] **Step 4: Docs.** `mapa-decisoes.md`, após D22, no formato das anteriores:
```markdown
## D23 — Placa do título sem sobretítulo (rodada 2 de consistência visual)

Data: 2026-10-21. O sobretítulo "OPERAÇÕES · SERGIPE" sai da placa `.map-titulo` (D20), junto com todos os
sobretítulos do sistema. Decisão do usuário após captura com/sem: "Sergipe" já está na descrição e
"Operações" é o grupo da barra lateral. A placa encolhe ~13px; o enquadramento é por encaixe calculado (D22),
sem recalibração. Ficam os rótulos de seção do painel (`.panel-label`): são títulos de bloco, não de página.
```
  E em `mapa-contexto-atual.md` atualize a descrição da placa (sem eyebrow).
- [ ] **Step 5:** escopo PASS; build OK. **Commit:** `refactor(mapa): placa sem sobretitulo (D23), botao de navegacao e mono por token`.

---

## Task 12: Limpeza, dívida e verificação de órfãos

Roda **depois** das Tasks 2–11.

**Files:**
- Modify: `src/styles/_ui.scss`
- Create: `Docs/Front-End-Docs/consistencia-visual-dividas.md`
- Modify: qualquer `.spec.ts`/e2e que ainda cite classe removida (só se o grep achar); templates com `.esqueleto` sem `role="status"` (Step 3b)

- [ ] **Step 1: Órfãos.** Para cada classe, `grep -rn` em `src/app` (html/ts) e `e2e/`: `chip-monitoramento`, `chip-status`, `admin-badge`, `skeleton` (classe), `dialog-backdrop` (atenção: o `confirm-dialog` usa — fica), `table-wrap`, `pagination` (Relatórios usa wrapper — fica), `eyebrow` (drawer de unidade e auth usam — fica), `operational-page`, `admin-page`. Remova de `_ui.scss` o `.chip-monitoramento*` se 0 usos. Registre no relatório o que ficou e por quê.
- [ ] **Step 2: Literais.** `grep -rn "IBM Plex Mono" src --include=*.scss --include=*.ts --include=*.html` → só `_tokens.scss` (2) e `_typography.scss` (`@use`). `grep -rn "JetBrains" src` → vazio. `grep -rn "im-mono\b" src --include=*.html` → vazio. Corrija o que sobrar (se estiver em arquivo de outra task já concluída, corrija aqui mesmo).
- [ ] **Step 3: h1 e casca.** `grep -rn "font-size: *22px" src/app --include=*.scss` em seletor de `h1` → vazio; `grep -rln "max-width: *1500px" src/app` → só comentário do Mapa.
- [ ] **Step 3b: `role="status"` em todo esqueleto.** `grep -rn 'class="esqueleto' src/app --include=*.html --include=*.ts` e acrescente `role="status"` onde faltar (dashboard, equipamento-list, drawers de equipamento e incidente, ocorrencia-grafico, monitor-management, tipo-equipamento-list, unidade-list, abas da unidade). Se algum não tiver `aria-label`, acrescente `aria-label="Carregando <o quê>"`. Ajuste spec que conte atributos, se houver.
- [ ] **Step 4: Dívida.** Crie `Docs/Front-End-Docs/consistencia-visual-dividas.md`:
```markdown
# Consistência visual — dívidas registradas

Registro das rodadas 1 (2026-10-20) e 2 (2026-10-21). Itens conscientemente fora de escopo.

| # | Dívida | Onde | Por que ficou |
|---|---|---|---|
| CV1 | 17 valores distintos de `max-width` em media query (400…1280), sem escala de pontos de quebra | SCSS das telas | Projeto de layout; medir com `npm run e2e:overflow` antes de mexer |
| CV2 | Escala tipográfica: 19 tamanhos (9–48px), nenhum por token | SCSS em geral | Projeto de design, rodada própria |
| CV3 | Escala de espaçamento: 31 valores, muitos fora da grade de 4px; `--im-space-*` quase sem uso | SCSS em geral | Idem |
| CV4 | Topbar estoura em ≤1366px | ver DV18 em `Docs/mapa-architecture/mapa-dividas.md` | Já registrada |
| CV5 | `.tipos__abas` (filtro em pílula) e abas-filtro do Painel/Incidentes sem semântica de tab | Tipos, Painel, Incidentes | São filtros, não abas; decidir padrão de "segmento" |
| CV6 | `<a class="botao botao--primario">+ Novo equipamento` é link de criação | detalhe da unidade, aba Equipamentos | Criação mantém primário mesmo navegando |
```
  Acrescente uma linha por achado novo da sonda depois (o controlador preenche).
- [ ] **Step 5:** `npx ng test --watch=false` (suíte inteira) PASS; `npx ng build` OK; `npm run contraste` OK.
- [ ] **Step 6: Commit:** `chore(ui): remove primitivas orfas e registra dividas de consistencia visual`.

---

## Ondas de execução (para o controlador)

| Onda | Tasks | Observação |
|---|---|---|
| 0 | Task 0 ∥ Task 1 | arquivos disjuntos; depois: controlador roda `antes` (4301) e sonda |
| 1 | Tasks 2, 3, 4, 5, 6 | disjuntas; Task 2 dona de `notificacoes/` exceto `notificacao-detail.*` |
| 2 | Tasks 7, 8, 9, 10, 11 | disjuntas; Task 9 roda o spec do drawer de equipamentos (só leitura) |
| 3 | Task 12 | sequencial |
| 4 | controlador | suíte, build, contraste, `e2e:cv2` depois nos dois temas, `e2e:overflow`, revisão das capturas, revisão final |
