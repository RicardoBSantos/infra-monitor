# Consistência visual — rodada 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Texto legível (≥4,5:1) nos dois temas, ConfirmDialog acessível por teclado com trap real, reduced-motion no esqueleto/spinner, um único `h1` no Telegram › Histórico, tokens de fundo translúcido por status e higiene de tokens/z-index.

**Architecture:** Mudança concentrada em `src/styles/_tokens.scss` (valores e tokens novos) consumida por SCSS de componente via `var()`. A mecânica de foco vira um helper funcional único (`shared/a11y/prender-foco.ts`) usado por `app-modal` e `app-confirm-dialog`. Verificação por script de contraste (Node, lê o `_tokens.scss`) + Vitest + Playwright com capturas antes/depois.

**Tech Stack:** Angular (signals, OnPush, `@angular/build:unit-test` = Vitest via `ng test`), SCSS, Playwright (`.cjs` em `infra-monitor-frontend/e2e/`), Node.

**Spec:** `Docs/superpowers/specs/2026-10-20-consistencia-visual-r1-design.md`

Todos os caminhos de código abaixo são relativos a `infra-monitor-frontend/` dentro do worktree
`C:\Users\rbfilho\Documents\infra-monitor-wt-cv1` (branch `feat/consistencia-visual-r1`). `node_modules` é
junção para o repo principal — **não** rodar `npm install`.

## Global Constraints

- Texto: todo token de texto ≥ 4,5:1 sobre `--im-bg`, `--im-surface`, `--im-surface-header`, `--im-surface-raised`, `--im-surface-hover`, `--im-surface-active`, nos dois temas.
- Ordem estrita de contraste sobre `--im-surface`: `text-secondary > text-muted > text-faint > text-dim`, nos dois temas.
- Nomes de token de texto **não mudam**; consumidores de texto não são editados no item 1.
- `--im-overlay`: `rgba(0,0,0,.60)` escuro, `rgba(16,24,40,.40)` claro.
- Gavetas continuam `aria-modal="false"`; `app-modal` e `app-confirm-dialog` ficam `aria-modal="true"` com trap real.
- Sem Lombok/sem classe base/sem abstração especulativa (CLAUDE.md): helper é uma função, não serviço nem diretiva.
- **Não mexer:** padding de página, `max-width`, peso de `h1`, sobretítulo (rodada 2) — exceto o padding duplicado do Telegram › Histórico, que é o bug do item 4.
- Fora: sombras `rgba(0,0,0,…)`, keyframes de pulso, `mapa.component.*`, tokens `--lg-*` exceto `--lg-placeholder`.
- Commits: só os próprios arquivos (`git commit <paths>`), mensagem em pt-BR, terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Testes: `npx ng test --watch=false` (a partir de `infra-monitor-frontend/`). Build: `npx ng build`.

## Review Focus

1. ConfirmDialog aberto **dentro** da gaveta de unidade (`unidade-form-drawer`, que faz `stopPropagation` do Escape no próprio painel): Escape tem de fechar só o diálogo, não disparar `tentarFechar()` da gaveta. → teste no Task 2.
2. ConfirmDialog com `busy()` true: Escape, clique no fundo e Cancelar não emitem `cancel`. → teste no Task 2.
3. Duas instâncias de ConfirmDialog na mesma página (fechadas/aberta): ids de título únicos e Escape de uma fechada não emite. → teste no Task 2.
4. `app-modal` com conteúdo projetado que muda com o diálogo aberto (campo habilitado depois da abertura): trap recalcula focáveis a cada Tab. → teste no Task 2.
5. Tema claro com fundos translúcidos novos: texto de status sobre `--im-*-bg` composto sobre `--im-surface` continua ≥4,5. → verificação no script do Task 0, executada no Task 5.

---

### Task 0: Ferramentas de verificação + capturas ANTES

**Files:**
- Create: `e2e/contraste-tokens.cjs`
- Create: `e2e/consistencia-visual-r1.cjs`
- Modify: `package.json` (scripts `contraste` e `e2e:cv1`)

**Interfaces:**
- Produces: `node e2e/contraste-tokens.cjs [saida.md]` → imprime tabela markdown, exit 1 se qualquer regra falhar. `node e2e/consistencia-visual-r1.cjs` com env `CV_SENHA`, `E2E_EMAIL`, `API_PORT`, `E2E_BASE`, `E2E_OUT`, `CV_FASE` (`antes`|`depois`).

- [ ] **Step 1: Escrever `e2e/contraste-tokens.cjs`**

```js
/*
 * Mede contraste WCAG dos tokens de _tokens.scss, nos dois temas.
 *   node e2e/contraste-tokens.cjs [arquivo-saida.md]
 * Exit 1 se: texto < 4,5 sobre qualquer fundo; ordem secondary>muted>faint>dim quebrada;
 * on-primary < 4,5; placeholder do login < 4,5; texto de status < 4,5 sobre o -bg translúcido.
 */
const fs = require('fs'); const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles', '_tokens.scss'), 'utf8');

function bloco(seletor) {
  const i = src.indexOf(seletor + ' {');
  if (i < 0) throw new Error('bloco não encontrado: ' + seletor);
  const corpo = src.slice(src.indexOf('{', i) + 1, src.indexOf('\n}', i));
  const mapa = {};
  for (const m of corpo.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) mapa[m[1]] = m[2].trim();
  return mapa;
}
const escuro = bloco(':root');
const claro = { ...escuro, ...bloco(":root[data-theme='light']") };
const loginEscuro = bloco('.login-page');
const loginClaro = { ...loginEscuro, ...bloco(":root[data-theme='light'] .login-page") };

const parse = (v) => {
  if (!v) return null;
  let m = v.match(/^#([0-9a-f]{6})$/i);
  if (m) return { rgb: [0, 2, 4].map((i) => parseInt(m[1].substr(i, 2), 16)), a: 1 };
  m = v.match(/^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/);
  if (m) return { rgb: [+m[1], +m[2], +m[3]], a: +m[4] };
  return null;
};
const sobre = (frente, fundo) => frente.rgb.map((c, i) => c * frente.a + fundo.rgb[i] * (1 - frente.a));
const lum = (rgb) => { const c = rgb.map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const razao = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

const FUNDOS = ['bg', 'surface', 'surface-header', 'surface-raised', 'surface-hover', 'surface-active'];
const TEXTOS = ['text', 'text-strong', 'text-soft', 'text-secondary', 'text-muted', 'text-faint', 'text-dim',
  'link', 'primary', 'success', 'success-soft', 'warning', 'warning-soft', 'danger', 'danger-soft', 'danger-strong', 'danger-text', 'info-soft'];
const ORDEM = ['text-secondary', 'text-muted', 'text-faint', 'text-dim'];
const STATUS_SOBRE_BG = [['success', 'success-bg'], ['success', 'success-bg-strong'], ['warning', 'warning-bg'], ['warning', 'warning-bg-strong'],
  ['danger', 'danger-bg'], ['danger', 'danger-bg-strong'], ['text-secondary', 'neutral-bg'], ['text-secondary', 'neutral-bg-strong'], ['link', 'primary-soft']];

const linhas = []; const falhas = [];
const reg = (tema, frente, fundo, r, minimo = 4.5) => { const ok = r >= minimo; linhas.push(`| ${tema} | ${frente} | ${fundo} | ${r.toFixed(2)} | ${ok ? 'ok' : 'FALHA'} |`); if (!ok) falhas.push(`${tema}: ${frente} sobre ${fundo} = ${r.toFixed(2)}`); };

for (const [tema, t, lg] of [['escuro', escuro, loginEscuro], ['claro', claro, loginClaro]]) {
  for (const tx of TEXTOS) for (const f of FUNDOS) {
    const a = parse(t[tx]), b = parse(t[f]);
    if (!a || !b || a.a !== 1 || b.a !== 1) { linhas.push(`| ${tema} | ${tx} | ${f} | — | não medível (${t[tx]} / ${t[f]}) |`); continue; }
    reg(tema, tx, f, razao(a.rgb, b.rgb));
  }
  reg(tema, 'on-primary', 'primary', razao(parse(t['on-primary']).rgb, parse(t['primary']).rgb));
  reg(tema, 'lg-placeholder', 'lg-input', razao(parse(lg['lg-placeholder']).rgb, parse(lg['lg-input']).rgb));
  reg(tema, 'lg-muted', 'lg-card', razao(parse(lg['lg-muted']).rgb, parse(lg['lg-card']).rgb));
  for (const [tx, bgTok] of STATUS_SOBRE_BG) {
    const bg = parse(t[bgTok]);
    if (!bg) { linhas.push(`| ${tema} | ${tx} | ${bgTok} | — | token ausente |`); continue; }
    for (const base of ['surface', 'surface-raised']) reg(tema, tx, `${bgTok} sobre ${base}`, razao(parse(t[tx]).rgb, sobre(bg, parse(t[base]))));
  }
  const r = ORDEM.map((k) => razao(parse(t[k]).rgb, parse(t['surface']).rgb));
  const emOrdem = r.every((v, i) => i === 0 || v < r[i - 1]);
  linhas.push(`| ${tema} | ordem ${ORDEM.join(' > ')} | surface | ${r.map((v) => v.toFixed(2)).join(' > ')} | ${emOrdem ? 'ok' : 'FALHA'} |`);
  if (!emOrdem) falhas.push(`${tema}: ordem quebrada ${r.map((v) => v.toFixed(2)).join(', ')}`);
}

const saida = ['| tema | frente | fundo | razão | resultado |', '|---|---|---|---|---|', ...linhas].join('\n');
console.log(saida);
if (process.argv[2]) fs.writeFileSync(process.argv[2], saida + '\n');
if (falhas.length) { console.error('\nFALHAS (' + falhas.length + '):\n' + falhas.join('\n')); process.exit(1); }
console.log('\nOK: todas as combinações ≥ 4,5 e ordem respeitada.');
```

- [ ] **Step 2: Rodar e ver falhar (é o teste do Task 1)**

Run: `node e2e/contraste-tokens.cjs`
Expected: exit 1, FALHAS incluindo `escuro: text-dim sobre surface-active = 2.51`, `claro: text-dim sobre surface = 2.58`, `escuro: ordem quebrada`, `lg-placeholder`, e "token ausente" para `warning-bg`, `*-bg-strong`, `neutral-bg`.

- [ ] **Step 3: Escrever `e2e/consistencia-visual-r1.cjs`**

Siga o padrão de `e2e/mapa-legenda-painel.cjs` (cabeçalho de uso, `apontarApi`, `checar`, resultados em `finally`, sem `catch` em seletor, navegação **só por clique** depois do login). Estrutura obrigatória:

```js
/*
 * Rodada 1 de consistência visual — capturas antes/depois nos dois temas + verificações de a11y.
 *   CV_SENHA=<senha> E2E_OUT=<pasta> CV_FASE=antes|depois node e2e/consistencia-visual-r1.cjs
 * Variáveis: CV_SENHA (obrigatória), E2E_EMAIL (default admin@inframonitor.local), API_PORT (default 8080),
 *   E2E_BASE (default http://127.0.0.1:4200), E2E_OUT (obrigatória; evidência fora do repo), CV_FASE (obrigatória).
 * Na fase "antes" só captura; as verificações de a11y rodam e são registradas, mas falha não muda o exit code.
 */
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const { apontarApi } = require('./api-porta.cjs');

const BASE = process.env.E2E_BASE || 'http://127.0.0.1:4200';
const EMAIL = process.env.E2E_EMAIL || 'admin@inframonitor.local';
const SENHA = process.env.CV_SENHA; if (!SENHA) throw new Error('CV_SENHA é obrigatória');
const FASE = process.env.CV_FASE; if (!['antes', 'depois'].includes(FASE)) throw new Error('CV_FASE = antes|depois');
if (!process.env.E2E_OUT) throw new Error('E2E_OUT é obrigatória');
const OUT = path.resolve(process.env.E2E_OUT, FASE); fs.mkdirSync(OUT, { recursive: true });

const resultados = []; const errosPagina = []; const respostas5xx = [];
const checar = (caso, nome, ok, detalhe) => resultados.push({ caso, nome, ok: !!ok, detalhe: detalhe ?? '' });

const TELAS = [ // rótulo, href do link da sidebar
  ['painel', '/dashboard'], ['equipamentos', '/equipamentos'], ['unidades', '/unidades'],
  ['medicoes', '/medicoes'], ['telegram-historico', '/notificacoes'],
];
```

Funções e fluxo (escreva o corpo completo):

1. `capturarLogin(page, tema)` — antes do login: `page.goto(BASE + '/login')`; se o tema da página (`document.documentElement.dataset.theme`, ausente = escuro) difere do pedido, clicar `.login-theme`; foco no campo de senha vazio para o placeholder aparecer; `screenshot` em `login-${tema}.png`.
2. `entrar(page)` — preencher `#login-email` (confira o id real em `src/app/features/auth/login.component.html`) e `#login-senha`, clicar submit, `waitForURL(/dashboard/)`.
3. `irPara(page, href)` — `page.click(\`.sidebar a[href="${href}"]\`)`, `waitForURL`, esperar sumir `.skeleton` (timeout 15s), `pausa(400)`.
4. `trocarTema(page)` — clicar `.theme-button`; conferir `dataset.theme` mudou.
5. Para cada tema (`escuro`, depois `claro`): `capturarLogin` (contexto novo por tema, sem sessão), `entrar`, ajustar tema via `.theme-button`, e para cada tela de `TELAS`: `irPara` + `screenshot({ fullPage: true })` em `${tela}-${tema}.png`.
6. Verificações (por tema, só registradas; contam para exit code só em `depois`):
   - `telegram.h1`: em `/notificacoes`, `document.querySelectorAll('h1').length === 1`.
   - `telegram.padding`: `getComputedStyle(document.querySelector('.operational-page')).paddingTop === '0px'`.
   - `contraste.th`: na tela Unidades, contraste entre `color` computado do primeiro `th` e o `background-color` efetivo (subir ancestrais até alfa 1) ≥ 4,5. Mesma medição em `.kpi` label do Painel (seletor real: inspecionar `dashboard.component.html` e usar o rótulo do primeiro KPI).
   - `confirm.*` (tela Unidades): abrir o action-menu da primeira linha e clicar na ação que abre o `app-confirm-dialog` (Inativar/Excluir; **nunca** clicar no botão de confirmar). Guardar o elemento gatilho (`document.activeElement` antes de abrir — o item do menu ou o botão do menu). Verificar: `confirm.foco-inicial` — `document.activeElement.textContent.trim() === 'Cancelar'`; `confirm.tab-cicla` — 3× `Tab` mantém o foco dentro de `.confirm-dialog`; `confirm.shift-tab` — `Shift+Tab` a partir de Cancelar vai ao último botão; captura `confirm-${tema}.png`; `confirm.escape` — `Escape` remove `.confirm-dialog` do DOM; `confirm.retorno` — foco voltou a um elemento fora do diálogo e conectado (registrar `outerHTML` curto).
   - `motion.*`: `page.emulateMedia({ reducedMotion: 'reduce' })`, recarregar a tela por clique em Medições, e durante o carregamento ler `getComputedStyle(el).animationName` de `.skeleton span` (se aparecer) e de `.refresh app-icon` com `aria-busy="true"` (clicar `.refresh` para forçar). Esperado `none`. Se o esqueleto não aparecer a tempo, registrar NÃO APLICÁVEL com motivo — não fingir sucesso.
7. `finally`: gravar `resultados.json` (resultados, errosPagina, respostas5xx) em `OUT`, imprimir tabela, `browser.close()`. Exit 1 em `depois` se algum `ok` false.

- [ ] **Step 4: Scripts no `package.json`**

```json
"contraste": "node e2e/contraste-tokens.cjs",
"e2e:cv1": "node e2e/consistencia-visual-r1.cjs",
```

- [ ] **Step 5: Subir ambiente de captura**

O orquestrador faz (não o subagente), pois envolve processos longos:
- Backend da carga em 8081: `. ~/.inframonitor-carga/env.sh` + `CORS_ALLOWED_ORIGINS=http://localhost:4300,http://127.0.0.1:4300` + `java -Xmx768m -jar <scratchpad-antigo>/backend-carga.jar` em background. Health em `localhost:8081/actuator/health`.
- Frontend do worktree: `npx ng serve --port 4300` em background a partir de `infra-monitor-frontend/` do worktree.
- Não tocar no 8080/4200 do usuário.

- [ ] **Step 6: Capturas ANTES**

Run: `API_PORT=8081 E2E_BASE=http://127.0.0.1:4300 E2E_EMAIL=$BOOTSTRAP_ADMIN_EMAIL CV_SENHA=$BOOTSTRAP_ADMIN_PASSWORD E2E_OUT=<scratchpad>/cv1 CV_FASE=antes node e2e/consistencia-visual-r1.cjs`
Expected: PNGs em `<scratchpad>/cv1/antes/`; verificações `telegram.h1`, `confirm.escape`, `motion.*`, `contraste.th` registradas como falha (estado atual).

- [ ] **Step 7: Commit**

```bash
git add e2e/contraste-tokens.cjs e2e/consistencia-visual-r1.cjs package.json
git commit -m "test(ui): script de contraste de tokens e roteiro de capturas da rodada 1"
```

---

### Task 1: Contraste e hierarquia de texto

**Files:**
- Modify: `src/styles/_tokens.scss` (blocos `:root`, `:root[data-theme='light']`, `.login-page`, `:root[data-theme='light'] .login-page`)

- [ ] **Step 1: Teste falhando** — `node e2e/contraste-tokens.cjs` já falha (Task 0, Step 2).

- [ ] **Step 2: Valores no `:root` (escuro)**

```scss
  --im-text-secondary: #a7afbb;
  --im-text-muted: #94a1af;
  --im-text-faint: #8894a1;
  --im-text-dim: #7c8997;
  --im-primary: #5a85ff;
  --im-danger: #e65850;
```

E, logo acima de `--im-text`, o comentário:

```scss
  /* Texto: ordem de contraste estrita text > text-strong/soft > secondary > muted > faint > dim, e
     todos >= 4,5:1 (WCAG AA) sobre o fundo mais escuro em que aparecem (--im-surface-active).
     Conferir com `npm run contraste` antes de mudar qualquer valor. */
```

`--im-danger-strong` (`#e05252`): se o script acusar < 4,5, clarear no mínimo necessário mantendo a matiz (mistura com branco), ex. `#e35a5a`; registrar o valor final.

- [ ] **Step 3: Valores no tema claro**

```scss
  --im-text-muted: #51596a;
  --im-text-faint: #596174;
  --im-text-dim: #636974;
  --im-danger: #c92a1e;
  --im-danger-strong: #c92a1e;
```

- [ ] **Step 4: Placeholder do login**

Em `.login-page`: `--lg-placeholder: #747d8b;`. Em `:root[data-theme='light'] .login-page`: `--lg-placeholder: #6b727e;`.

- [ ] **Step 5: Rodar o script**

Run: `node e2e/contraste-tokens.cjs`
Expected: nenhuma FALHA de texto/ordem/on-primary/placeholder. As únicas falhas restantes permitidas são "token ausente" de `warning-bg`, `*-bg-strong`, `neutral-bg` (Task 5) — linhas "token ausente" não contam como FALHA no script (não entram em `falhas`); confirme que o exit é 0. Se alguma combinação ficar entre 4,40 e 4,49, ajustar o valor do token no último dígito para cima (escuro: mais claro; claro: mais escuro) e rodar de novo.

- [ ] **Step 6: Testes e build**

Run: `npx ng test --watch=false` → PASS. (Nenhum spec deve depender de hex de token; se algum depender, ajustar o spec para o valor novo e citar no commit.)

- [ ] **Step 7: Commit**

```bash
git commit src/styles/_tokens.scss -m "fix(ui): tokens de texto com contraste AA e hierarquia na ordem dos nomes"
```

---

### Task 2: Trap de foco compartilhado + ConfirmDialog com Escape e foco

**Files:**
- Create: `src/app/shared/a11y/prender-foco.ts`
- Create: `src/app/shared/a11y/prender-foco.spec.ts`
- Modify: `src/app/shared/modal/modal.component.ts`
- Modify: `src/app/shared/modal/modal.component.spec.ts` (novos `it`)
- Modify: `src/app/shared/confirm-dialog/confirm-dialog.component.ts` (reescrita)
- Create: `src/app/shared/confirm-dialog/confirm-dialog.component.spec.ts`

**Interfaces:**
- Produces: `export const FOCAVEIS: string` e `export function prenderFoco(evento: KeyboardEvent, painel: HTMLElement): void` em `shared/a11y/prender-foco.ts`.
- ConfirmDialog mantém a API pública inalterada: inputs `open, title, message, confirmLabel, busyLabel, busy, erro`; outputs `confirm, cancel`. Nenhum consumidor muda.

- [ ] **Step 1: Spec do helper (falhando)**

`src/app/shared/a11y/prender-foco.spec.ts`:

```ts
import { prenderFoco } from './prender-foco';

describe('prenderFoco', () => {
  let painel: HTMLElement;
  const tab = (shiftKey = false) => new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true });

  beforeEach(() => {
    painel = document.createElement('section');
    painel.tabIndex = -1;
    painel.innerHTML = '<button id="a">a</button><input id="b"><button id="c" disabled>c</button><button id="d">d</button>';
    document.body.appendChild(painel);
  });
  afterEach(() => painel.remove());
  const $ = (id: string) => painel.querySelector<HTMLElement>('#' + id)!;

  it('Tab no último focável volta ao primeiro', () => {
    $('d').focus();
    const e = tab();
    prenderFoco(e, painel);
    expect(document.activeElement).toBe($('a'));
    expect(e.defaultPrevented).toBe(true);
  });

  it('Shift+Tab no primeiro vai ao último (ignora desabilitado)', () => {
    $('a').focus();
    const e = tab(true);
    prenderFoco(e, painel);
    expect(document.activeElement).toBe($('d'));
  });

  it('Tab no meio não interfere', () => {
    $('a').focus();
    const e = tab();
    prenderFoco(e, painel);
    expect(e.defaultPrevented).toBe(false);
  });

  it('foco no próprio painel: Tab vai ao primeiro, Shift+Tab ao último', () => {
    painel.focus();
    prenderFoco(tab(), painel);
    expect(document.activeElement).toBe($('a'));
    painel.focus();
    prenderFoco(tab(true), painel);
    expect(document.activeElement).toBe($('d'));
  });

  it('recalcula a cada tecla: focável que aparece depois entra no ciclo', () => {
    const novo = document.createElement('button'); novo.id = 'e'; painel.appendChild(novo);
    $('d').focus();
    const e = tab();
    prenderFoco(e, painel);
    expect(e.defaultPrevented).toBe(false); // d não é mais o último
  });

  it('sem focável: mantém o foco no painel', () => {
    painel.innerHTML = '<p>só texto</p>';
    painel.focus();
    const e = tab();
    prenderFoco(e, painel);
    expect(e.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(painel);
  });

  it('outra tecla é ignorada', () => {
    $('d').focus();
    const e = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
    prenderFoco(e, painel);
    expect(e.defaultPrevented).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx ng test --watch=false --include='src/app/shared/a11y/**'`
Expected: FAIL (módulo `./prender-foco` não existe).

- [ ] **Step 3: Implementar o helper**

`src/app/shared/a11y/prender-foco.ts`:

```ts
/** Elementos que entram no ciclo de Tab de um diálogo modal. */
export const FOCAVEIS = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Trap de foco de diálogo modal: Tab no último volta ao primeiro, Shift+Tab no primeiro vai ao último.
 * Os focáveis são lidos a cada tecla — conteúdo projetado pode habilitar ou criar campos com o
 * diálogo aberto. É o que torna verdadeiro o `aria-modal="true"`; gaveta não usa (fica `false`).
 */
export function prenderFoco(evento: KeyboardEvent, painel: HTMLElement): void {
  if (evento.key !== 'Tab') return;
  const focaveis = Array.from(painel.querySelectorAll<HTMLElement>(FOCAVEIS)).filter((el) => !el.closest('[hidden], [inert]'));
  if (focaveis.length === 0) {
    evento.preventDefault();
    painel.focus();
    return;
  }
  const primeiro = focaveis[0];
  const ultimo = focaveis[focaveis.length - 1];
  const ativo = document.activeElement;
  if (evento.shiftKey && (ativo === primeiro || ativo === painel)) {
    evento.preventDefault();
    ultimo.focus();
  } else if (!evento.shiftKey && (ativo === ultimo || ativo === painel)) {
    evento.preventDefault();
    primeiro.focus();
  }
}
```

- [ ] **Step 4: Rodar** — `npx ng test --watch=false --include='src/app/shared/a11y/**'` → PASS.

- [ ] **Step 5: Specs novos no `modal.component.spec.ts` (falhando)**

Acrescentar dentro do `describe` existente (usa `montar`, `abrir`, `el` já definidos no arquivo):

```ts
  it('Tab no último focável volta ao primeiro (trap real; aria-modal="true" é verdade)', () => {
    const fixture = montar();
    abrir(fixture);
    const painel = el(fixture).querySelector<HTMLElement>('.modal')!;
    const fechar = painel.querySelector<HTMLButtonElement>('.modal__fechar')!;
    const campo = painel.querySelector<HTMLInputElement>('#campo')!;
    campo.focus(); // último em ordem de DOM (o × vem antes, no topo)
    const e = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    campo.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(fechar);
  });

  it('Shift+Tab no primeiro focável vai ao último', () => {
    const fixture = montar();
    abrir(fixture);
    const painel = el(fixture).querySelector<HTMLElement>('.modal')!;
    const fechar = painel.querySelector<HTMLButtonElement>('.modal__fechar')!;
    fechar.focus();
    fechar.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(painel.querySelector('#campo'));
  });
```

Run: `npx ng test --watch=false --include='src/app/shared/modal/**'` → FAIL nos dois novos.

- [ ] **Step 6: Ligar o trap no `app-modal`**

Em `modal.component.ts`: importar `prenderFoco` de `'../a11y/prender-foco'`; na `<section #painel class="modal" …>` acrescentar `(keydown)="aoTeclar($event)"`; e na classe:

```ts
  protected aoTeclar(evento: KeyboardEvent): void {
    const painel = this.painel()?.nativeElement;
    if (painel) prenderFoco(evento, painel);
  }
```

Manter `FOCAVEIS` local do modal (foco inicial exclui o ×, de propósito — comentário existente). Run: `npx ng test --watch=false --include='src/app/shared/modal/**'` → PASS (todos, inclusive os antigos).

- [ ] **Step 7: Spec do ConfirmDialog (falhando)**

`src/app/shared/confirm-dialog/confirm-dialog.component.spec.ts`:

```ts
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ConfirmDialogComponent } from './confirm-dialog.component';

@Component({
  imports: [ConfirmDialogComponent],
  template: `
    <aside id="gaveta" tabindex="-1" (keydown)="aoTeclarGaveta($event)">
      <button id="gatilho" type="button" (click)="aberto.set(true)">abrir</button>
      <app-confirm-dialog [open]="aberto()" title="Excluir unidade?" message="Não dá para desfazer." [busy]="busy()"
        (cancel)="cancelamentos = cancelamentos + 1; aberto.set(false)" (confirm)="confirmacoes = confirmacoes + 1" />
    </aside>
    <app-confirm-dialog [open]="false" title="Outro" message="m" (cancel)="outros = outros + 1" />
  `,
})
class Hospedeiro {
  readonly aberto = signal(false);
  readonly busy = signal(false);
  cancelamentos = 0; confirmacoes = 0; outros = 0; gavetaFechou = 0;
  // Igual ao unidade-form-drawer: Escape no painel da gaveta faz stopPropagation e tenta fechar.
  aoTeclarGaveta(e: KeyboardEvent): void { if (e.key === 'Escape') { e.stopPropagation(); this.gavetaFechou++; } }
}

describe('ConfirmDialogComponent', () => {
  const montar = () => {
    TestBed.configureTestingModule({ imports: [Hospedeiro] });
    const fixture = TestBed.createComponent(Hospedeiro);
    fixture.detectChanges();
    return fixture;
  };
  const el = (f: { nativeElement: HTMLElement }) => f.nativeElement;
  const abrir = (f: ReturnType<typeof montar>) => {
    const g = el(f).querySelector<HTMLButtonElement>('#gatilho')!;
    g.focus(); g.click(); f.detectChanges();
    return g;
  };
  const tecla = (alvo: EventTarget, key: string, shiftKey = false) => {
    const e = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true });
    alvo.dispatchEvent(e);
    return e;
  };
  const painel = (f: ReturnType<typeof montar>) => el(f).querySelector<HTMLElement>('.confirm-dialog')!;
  const botoes = (f: ReturnType<typeof montar>) => Array.from(painel(f).querySelectorAll<HTMLButtonElement>('button'));

  it('aberto: alertdialog modal, título e mensagem ligados por id único', () => {
    const f = montar();
    abrir(f);
    const p = painel(f);
    expect(p.getAttribute('role')).toBe('alertdialog');
    expect(p.getAttribute('aria-modal')).toBe('true');
    const titulo = p.querySelector('h2')!; const msg = p.querySelector('p')!;
    expect(p.getAttribute('aria-labelledby')).toBe(titulo.id);
    expect(p.getAttribute('aria-describedby')).toBe(msg.id);
    expect(titulo.id).not.toBe('confirm-title');
  });

  it('foco vai para Cancelar ao abrir e volta ao gatilho ao fechar', () => {
    const f = montar();
    const g = abrir(f);
    expect(document.activeElement!.textContent!.trim()).toBe('Cancelar');
    tecla(document.activeElement!, 'Escape');
    f.detectChanges();
    expect(painel(f)).toBeNull();
    expect(document.activeElement).toBe(g);
  });

  it('Escape no document (foco fora do painel) cancela; o fechado não emite', () => {
    const f = montar();
    abrir(f);
    (document.activeElement as HTMLElement).blur();
    tecla(document, 'Escape');
    expect(f.componentInstance.cancelamentos).toBe(1);
    expect(f.componentInstance.outros).toBe(0);
  });

  it('Escape dentro do diálogo aninhado na gaveta não chega à gaveta', () => {
    const f = montar();
    abrir(f);
    tecla(document.activeElement!, 'Escape');
    expect(f.componentInstance.cancelamentos).toBe(1);
    expect(f.componentInstance.gavetaFechou).toBe(0);
  });

  it('Tab cicla entre Cancelar e Confirmar; Shift+Tab também', () => {
    const f = montar();
    abrir(f);
    const [cancelar, confirmar] = botoes(f);
    confirmar.focus();
    tecla(confirmar, 'Tab');
    expect(document.activeElement).toBe(cancelar);
    tecla(cancelar, 'Tab', true);
    expect(document.activeElement).toBe(confirmar);
  });

  it('busy: Escape, fundo e Cancelar não cancelam', () => {
    const f = montar();
    abrir(f);
    f.componentInstance.busy.set(true); f.detectChanges();
    tecla(document, 'Escape');
    const fundo = el(f).querySelector<HTMLElement>('.dialog-backdrop')!;
    fundo.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    fundo.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    botoes(f)[0].click();
    expect(f.componentInstance.cancelamentos).toBe(0);
  });

  it('clique que começa e termina no fundo cancela; clique no painel não', () => {
    const f = montar();
    abrir(f);
    painel(f).dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    painel(f).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(f.componentInstance.cancelamentos).toBe(0);
    const fundo = el(f).querySelector<HTMLElement>('.dialog-backdrop')!;
    fundo.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    fundo.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(f.componentInstance.cancelamentos).toBe(1);
  });

  it('Confirmar emite confirm', () => {
    const f = montar();
    abrir(f);
    botoes(f)[1].click();
    expect(f.componentInstance.confirmacoes).toBe(1);
  });
});
```

Run: `npx ng test --watch=false --include='src/app/shared/confirm-dialog/**'` → FAIL.

- [ ] **Step 8: Reescrever `confirm-dialog.component.ts`**

```ts
import { ChangeDetectionStrategy, Component, ElementRef, effect, input, output, viewChild } from '@angular/core';
import { prenderFoco } from '../a11y/prender-foco';

let proximoId = 0;

/**
 * Confirmação destrutiva. Mesma mecânica do app-modal: Escape no document, foco entra ao abrir
 * (em Cancelar — a ação segura) e volta ao gatilho ao fechar, trap de Tab.
 *
 * O Escape também é tratado no próprio painel com stopPropagation: o diálogo pode estar aninhado
 * numa gaveta que fecha com Escape no próprio painel (unidade-form-drawer) — sem isso a gaveta
 * receberia a tecla antes do document.
 */
@Component({
  selector: 'app-confirm-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'pedirCancelar()' },
  template: `@if (open()) {
    <div class="dialog-backdrop" (mousedown)="aoPressionarFundo($event)" (click)="aoClicarNoFundo($event)">
      <section #painel class="confirm-dialog" role="alertdialog" aria-modal="true" tabindex="-1"
        [attr.aria-labelledby]="idTitulo" [attr.aria-describedby]="idMensagem" (keydown)="aoTeclar($event)">
        <h2 [id]="idTitulo">{{ title() }}</h2>
        <p [id]="idMensagem">{{ message() }}</p>
        @if (erro()) { <p class="confirm-dialog__erro" role="alert">{{ erro() }}</p> }
        <div>
          <button #cancelar class="botao" type="button" (click)="pedirCancelar()" [disabled]="busy()">Cancelar</button>
          <button class="botao botao--perigo" type="button" (click)="confirm.emit()" [disabled]="busy()">{{ busy() ? busyLabel() : confirmLabel() }}</button>
        </div>
      </section>
    </div>
  }`,
  styleUrl: './confirm-dialog.component.scss',
})
export class ConfirmDialogComponent {
  readonly open = input(false);
  readonly title = input.required<string>();
  readonly message = input.required<string>();
  readonly confirmLabel = input('Excluir');
  readonly busyLabel = input('Processando…');
  readonly busy = input(false);
  readonly erro = input<string | null>(null);
  readonly confirm = output<void>();
  readonly cancel = output<void>();

  protected readonly idTitulo = `confirm-titulo-${++proximoId}`;
  protected readonly idMensagem = `confirm-mensagem-${proximoId}`;
  private readonly painel = viewChild<ElementRef<HTMLElement>>('painel');
  private readonly botaoCancelar = viewChild<ElementRef<HTMLButtonElement>>('cancelar');
  private cliqueComecouNoFundo = false;
  private gatilho: HTMLElement | null = null;
  private estavaAberto = false;

  constructor() {
    // Roda antes do template: ao abrir o foco ainda está no gatilho; ao fechar, o painel ainda existe.
    effect(() => {
      const aberto = this.open();
      if (aberto && !this.estavaAberto) {
        this.gatilho = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      } else if (!aberto && this.estavaAberto) {
        const gatilho = this.gatilho;
        this.gatilho = null;
        if (gatilho?.isConnected) gatilho.focus();
      }
      this.estavaAberto = aberto;
    });
    // O painel só existe depois que o @if renderiza.
    effect(() => {
      const painel = this.painel()?.nativeElement;
      if (!painel) return;
      const cancelar = this.botaoCancelar()?.nativeElement;
      (cancelar && !cancelar.disabled ? cancelar : painel).focus();
    });
  }

  protected pedirCancelar(): void {
    if (this.open() && !this.busy()) this.cancel.emit();
  }

  protected aoTeclar(evento: KeyboardEvent): void {
    if (evento.key === 'Escape') {
      evento.stopPropagation();
      this.pedirCancelar();
      return;
    }
    const painel = this.painel()?.nativeElement;
    if (painel) prenderFoco(evento, painel);
  }

  /** Método, não atribuição no template — ver app-modal (handler que devolve false cancela o evento). */
  protected aoPressionarFundo(evento: MouseEvent): void {
    this.cliqueComecouNoFundo = evento.target === evento.currentTarget;
  }

  protected aoClicarNoFundo(evento: MouseEvent): void {
    const comecouNoFundo = this.cliqueComecouNoFundo;
    this.cliqueComecouNoFundo = false;
    if (comecouNoFundo && evento.target === evento.currentTarget) this.pedirCancelar();
  }
}
```

Atenção: o effect do foco roda a cada mudança de `painel()`/`botaoCancelar()` — não a cada `busy`. Conferir no spec "busy" que o foco não pula. Atenção 2: na gaveta de incidente (`incidente-detalhe-drawer.component.ts:388`), o próprio drawer já ignora Escape com a confirmação aberta — continua correto.

- [ ] **Step 9: Rodar** — `npx ng test --watch=false --include='src/app/shared/**'` → PASS. Depois a suíte inteira `npx ng test --watch=false` → PASS (specs de telas que usam o diálogo e procuravam `#confirm-title` ou clicavam no fundo devem ser ajustados para o novo id/`mousedown`+`click`; cite cada ajuste no commit).

- [ ] **Step 10: Commit**

```bash
git add src/app/shared/a11y src/app/shared/modal src/app/shared/confirm-dialog
git commit -m "feat(a11y): trap de foco real no app-modal e Escape/foco/trap no ConfirmDialog"
```

(Inclua no `git add` qualquer spec de tela ajustado no Step 9.)

---

### Task 3: `prefers-reduced-motion` no esqueleto e no spinner

**Files:**
- Modify: `src/app/features/detalhe-generico.scss`
- Modify: `src/app/features/medicoes/medicao-list.component.scss`
- Modify: `src/app/features/unidades/admin-list.component.scss`
- Modify: `src/app/layout/topbar/topbar.component.scss`

- [ ] **Step 1: Esqueleto** — ao final de cada um dos 3 arquivos (estão minificados em uma linha; acrescentar no fim, mesmo estilo):

`detalhe-generico.scss`: `@media(prefers-reduced-motion:reduce){.skeleton{animation:none}}`
`medicao-list.component.scss` e `admin-list.component.scss`: `@media(prefers-reduced-motion:reduce){.skeleton span{animation:none}}`

- [ ] **Step 2: Spinner** — em `topbar.component.scss`, logo após `@keyframes topbar-girar …`:

```scss
/* Sem giro contínuo para quem pede menos movimento: o aria-busy do botão já anuncia a atualização. */
@media (prefers-reduced-motion: reduce) { .refresh[aria-busy='true'] app-icon { animation: none; opacity: .55; } }
```

Confirmar no `topbar.component.html` que o `.refresh` tem `[attr.aria-busy]` (o seletor já depende disso). Se não tiver texto/rótulo acessível de carregamento além do `aria-busy`, não criar — está fora de escopo; registrar.

- [ ] **Step 3: Conferir outros brilhos** — `grep -rn "infinite" src --include=*.scss`. Qualquer animação infinita que não seja do mapa, do login (já tem reduce em `_login-graph.scss`) ou da sidebar (já tem) entra com o mesmo tratamento; listar no commit.

- [ ] **Step 4: Build** — `npx ng build` → sucesso (budgets de SCSS por componente não estourados).

- [ ] **Step 5: Commit**

```bash
git commit src/app/features/detalhe-generico.scss src/app/features/medicoes/medicao-list.component.scss src/app/features/unidades/admin-list.component.scss src/app/layout/topbar/topbar.component.scss -m "fix(a11y): esqueleto e spinner respeitam prefers-reduced-motion"
```

---

### Task 4: Telegram › Histórico sem cabeçalho e padding duplicados

**Files:**
- Modify: `src/app/features/notificacoes/notificacao-list.component.html`
- Modify: `src/app/features/notificacoes/notificacao-list.component.scss`
- Modify: `src/app/features/notificacoes/notificacao-list.component.spec.ts`

- [ ] **Step 1: Spec falhando** — no `notificacao-list.component.spec.ts`, acrescentar (adapte `montar`/fixture ao padrão já usado no arquivo):

```ts
  it('não tem h1 nem cabeçalho próprio: vive dentro da casca do Telegram, que já tem o h1', () => {
    // fixture conforme o padrão do arquivo, depois de detectChanges
    const raiz = fixture.nativeElement as HTMLElement;
    expect(raiz.querySelector('h1')).toBeNull();
    expect(raiz.querySelector('section.operational-page > header')).toBeNull();
    expect(raiz.querySelector('section.operational-page')!.getAttribute('aria-label')).toBe('Histórico de notificações');
  });
```

Run: `npx ng test --watch=false --include='src/app/features/notificacoes/**'` → FAIL.

- [ ] **Step 2: HTML** — trocar o início do template:

de `<section class="operational-page" aria-labelledby="notifications-title"><header><div><p>GERENCIAMENTO · CANAL TELEGRAM</p><h1 id="notifications-title">Notificações</h1><small>Histórico de comunicações relacionadas a incidentes, produzido e enviado pelo backend.</small></div></header>`
para `<section class="operational-page" aria-label="Histórico de notificações">`

(Conferir que nada mais referencia `notifications-title`: `grep -rn notifications-title src`.)

- [ ] **Step 3: SCSS** — no `notificacao-list.component.scss`, após o `@use`:

```scss
/* Só existe dentro da casca .telegram, que já dá padding e largura: o .operational-page herdado
   de Medições duplicava os dois. */
.operational-page{max-width:none;margin:0;padding:0}
```

E no `@media(max-width:620px)` herdado não há override necessário (o herdado põe `padding:16px` em `.operational-page` sob 620px) — acrescentar `@media(max-width:620px){.operational-page{padding:0}}`.

- [ ] **Step 4: Rodar** — `npx ng test --watch=false --include='src/app/features/notificacoes/**'` → PASS. Ajustar specs antigos que procuravam o `h1` "Notificações".

- [ ] **Step 5: Commit**

```bash
git commit src/app/features/notificacoes/notificacao-list.component.html src/app/features/notificacoes/notificacao-list.component.scss src/app/features/notificacoes/notificacao-list.component.spec.ts -m "fix(telegram): historico sem h1 e padding duplicados dentro da casca"
```

---

### Task 5: Tokens de fundo translúcido por status e overlay único

Depende do Task 1 (mesmo arquivo de tokens). Roda depois dele.

**Files:**
- Modify: `src/styles/_tokens.scss`
- Modify: `src/styles/_ui.scss`
- Modify: `src/app/shared/status-badge/status-badge.component.scss`
- Modify: `src/app/shared/confirm-dialog/confirm-dialog.component.scss`
- Modify: `src/app/shared/modal/modal.component.scss`
- Modify: `src/app/shared/action-menu/action-menu.component.scss`
- Modify: `src/app/features/dashboard/dashboard.component.scss`
- Modify: `src/app/features/equipamentos/equipamento-detalhe-drawer.component.scss`
- Modify: `src/app/features/equipamentos/equipamento-list.component.scss`
- Modify: `src/app/features/incidentes/incidente-detalhe-drawer.component.scss`
- Modify: `src/app/features/monitores/monitor-management.component.scss`
- Modify: `src/app/features/tipos-equipamento/tipo-equipamento-list.component.scss`
- Modify: `src/app/features/unidades/admin-list.component.scss`
- Modify: `src/app/features/unidades/detalhe/configuracoes-tab.component.scss`
- Modify: `src/app/features/unidades/unidade-form-drawer.component.scss`
- Modify: `src/app/layout/application-shell/application-shell.component.scss`
- Modify: `src/app/layout/sidebar/sidebar.component.scss`
- Modify: `src/app/features/auth/auth-form.component.scss`

- [ ] **Step 1: Teste falhando** — `node e2e/contraste-tokens.cjs` lista "token ausente" para `warning-bg`, `*-bg-strong`, `neutral-bg`. Tornar ausência uma falha: no script, trocar a linha `if (!bg) { linhas.push(...token ausente...); continue; }` para também `falhas.push(\`${tema}: token ausente ${bgTok}\`)`. Rodar → exit 1.

- [ ] **Step 2: Tokens no `:root` (escuro)** — substituir `--im-success-bg` e `--im-danger-bg` e acrescentar, agrupados após `--im-danger-text`:

```scss
  /* Fundos translúcidos por status: tom da cor do PRÓPRIO tema. Antes cada tela usava rgba() da
     paleta escura, e no claro o fundo saía com a cor do escuro. -bg = faixa/aviso/badge,
     -bg-strong = hover/realce. Bordas: --im-*-border. */
  --im-success-bg: rgba(63, 185, 80, .10);
  --im-success-bg-strong: rgba(63, 185, 80, .16);
  --im-warning-bg: rgba(210, 153, 34, .10);
  --im-warning-bg-strong: rgba(210, 153, 34, .16);
  --im-danger-bg: rgba(229, 83, 75, .10);
  --im-danger-bg-strong: rgba(229, 83, 75, .16);
  --im-neutral-bg: rgba(122, 134, 153, .10);
  --im-neutral-bg-strong: rgba(122, 134, 153, .16);
  /* Fundo escurecido único de modal, diálogo, gaveta e sidebar móvel. */
  --im-overlay: rgba(0, 0, 0, .60);
```

Remover a linha antiga `--im-success-hover: rgba(63, 185, 80, .20);` **somente** se `grep -rn "success-hover" src` der 0 usos fora de `_tokens.scss`; senão manter.

- [ ] **Step 3: Tokens no claro** — em `:root[data-theme='light']`, substituir `--im-success-bg` e `--im-danger-bg` e acrescentar:

```scss
  --im-success-bg: rgba(6, 118, 71, .08);
  --im-success-bg-strong: rgba(6, 118, 71, .14);
  --im-warning-bg: rgba(181, 71, 8, .08);
  --im-warning-bg-strong: rgba(181, 71, 8, .14);
  --im-danger-bg: rgba(217, 45, 32, .07);
  --im-danger-bg-strong: rgba(217, 45, 32, .14);
  --im-neutral-bg: rgba(71, 84, 103, .07);
  --im-neutral-bg-strong: rgba(71, 84, 103, .14);
  --im-overlay: rgba(16, 24, 40, .40);
```

- [ ] **Step 4: Substituir literais** — mapeamento obrigatório (aplicar em cada arquivo da lista; conferir o contexto de cada ocorrência: fundo, borda ou sombra):

| Literal | Uso | Token |
|---|---|---|
| `rgba(229,83,75,≤.10)`, `rgba(229,72,77,.08)` | fundo | `var(--im-danger-bg)` |
| `rgba(229,83,75,.12–.16)`, `rgba(229,72,77,.14)` | fundo | `var(--im-danger-bg-strong)` |
| `rgba(229,83,75,.25–.38)` | borda | `var(--im-danger-border)` |
| `rgba(52,199,123,.08)` | fundo | `var(--im-success-bg)` |
| `rgba(52,199,123,.12)` | fundo | `var(--im-success-bg-strong)` |
| `rgba(63,185,80,.4)` | borda | `var(--im-success-border)` |
| `rgba(232,163,61,.08)` | fundo | `var(--im-warning-bg)` |
| `rgba(232,163,61,.14)` | fundo | `var(--im-warning-bg-strong)` |
| `rgba(99,118,138,.08)` | fundo | `var(--im-neutral-bg)` |
| `rgba(99,118,138,.12)` | fundo | `var(--im-neutral-bg-strong)` |
| `rgba(76,141,255,.10/.12)` | fundo | `var(--im-primary-soft)` |
| `rgba(76,141,255,.2)` | fundo | `var(--im-primary-hover)` |
| `rgba(76,141,255,.28)` em box-shadow de foco | anel | `var(--im-focus-ring)` (shadow inteira) |
| `rgba(0,0,0,.65)` / `.38` em fundo fixo de modal/gaveta / `rgba(4,7,11,.74)` | overlay | `var(--im-overlay)` |

Não tocar: `rgba(63,185,80,.55)` e `rgba(63,185,80,0)` (keyframes de pulso da sidebar), `rgba(0,0,0,.18/.25/.34/.42/.45/.6)` (sombras), tudo em `mapa.component.*`, `rgba(232,240,248,…)`, `rgba(124,150,180,…)`. Se a borda de `.4` do success for `border` e a de `.4` em `monitor-management`/`tipo-equipamento-list` for outra coisa (ex. sombra), aplicar a regra pelo uso, não pelo número.

- [ ] **Step 5: Conferir zero sobras**

Run: `grep -rnE "rgba\((52, ?199, ?123|232, ?163, ?61|229, ?72, ?77|99, ?118, ?138)" src`
Expected: nenhuma saída.
Run: `grep -rnE "rgba\(229, ?83, ?75|rgba\(4, ?7, ?11|rgba\(0, ?0, ?0, ?\.(65|38|74)\)" src/app src/styles --include=*.scss | grep -v _tokens.scss | grep -v mapa.component`
Expected: nenhuma saída (o `.38` de `mapa.component.scss` é sombra interna e fica).

- [ ] **Step 6: Contraste** — `node e2e/contraste-tokens.cjs` → exit 0. Se algum texto de status sobre `-bg` composto ficar < 4,5, reduzir a opacidade do `-bg` daquele tema (nunca mexer na cor do texto aqui) e registrar.

- [ ] **Step 7: Testes e build** — `npx ng test --watch=false` → PASS; `npx ng build` → sucesso.

- [ ] **Step 8: Commit**

```bash
git add src/styles src/app   # só os arquivos da lista acima + o script
git add e2e/contraste-tokens.cjs
git commit -m "feat(ui): tokens de fundo translucido por status e overlay unico nos dois temas"
```

Antes do commit, `git status` — nada fora da lista.

---

### Task 6: Higiene — tokens órfãos e z-index

Depende do Task 5 (mesmo arquivo de tokens).

**Files:**
- Modify: `src/styles/_tokens.scss`
- Modify: `src/app/shared/action-menu/action-menu.component.scss:41`
- Modify: `src/app/layout/sidebar/sidebar.component.scss:3`
- Modify: `src/app/layout/topbar/topbar.component.scss:36`

- [ ] **Step 1: Recontar órfãos**

Run (bash, em `infra-monitor-frontend/`):
```bash
for t in $(grep -oE -- '--im-[a-z0-9-]+' src/styles/_tokens.scss | sort -u); do n=$(grep -rnE "var\($t\b" src e2e | grep -v _tokens.scss | wc -l); [ "$n" = 0 ] && echo "$t"; done
```
Expected (antes do Step 2): `--im-map-active --im-map-land --im-map-land-alt --im-map-stroke --im-map-water --im-space-1 --im-space-2 --im-space-5 --im-text-on-accent --im-warning-strong --im-z-menu --im-z-sidebar --im-z-topbar-menu` (mais eventual `--im-success-hover` se não foi removido no Task 5). Conferir também uso em TS: `grep -rnE "im-(map-|space-|text-on-accent|warning-strong)" src --include=*.ts` → vazio.

- [ ] **Step 2: z-index** — `action-menu.component.scss`: `z-index: 15;` → `z-index: var(--im-z-menu);`. `sidebar.component.scss` `.sidebar`: `z-index: 20;` → `z-index: var(--im-z-sidebar);`. `topbar.component.scss` `.user-menu__panel`: `z-index: 30;` → `z-index: var(--im-z-topbar-menu);`.

- [ ] **Step 3: Remover os 10 órfãos** de `_tokens.scss` (nos dois blocos onde aparecerem): `--im-map-active`, `--im-map-land`, `--im-map-land-alt`, `--im-map-stroke`, `--im-map-water`, `--im-space-1`, `--im-space-2`, `--im-space-5`, `--im-text-on-accent`, `--im-warning-strong`. Manter `--im-map-glow` (usado) e `--im-space-3/4` (usados).

- [ ] **Step 4: Rodar o loop do Step 1** → saída vazia. `node e2e/contraste-tokens.cjs` → exit 0 (o script não lê os removidos). `npx ng test --watch=false` → PASS. `npx ng build` → sucesso.

- [ ] **Step 5: Commit**

```bash
git commit src/styles/_tokens.scss src/app/shared/action-menu/action-menu.component.scss src/app/layout/sidebar/sidebar.component.scss src/app/layout/topbar/topbar.component.scss -m "chore(ui): remove tokens orfaos e usa a escala de z-index"
```

---

### Task 7: Verificação final e capturas DEPOIS

Feito pelo orquestrador.

- [ ] **Step 1:** `npx ng test --watch=false` → PASS (anotar contagem). `npx ng build` → sucesso. `node e2e/contraste-tokens.cjs <scratchpad>/cv1/contraste-final.md` → exit 0.
- [ ] **Step 2:** `ng serve` do worktree em 4300 recarregado; rodar o roteiro com `CV_FASE=depois` → exit 0.
- [ ] **Step 3:** Abrir e conferir pessoalmente cada par antes/depois (escuro e claro): Login, Painel, Equipamentos, Unidades (+ ConfirmDialog), Medições, Telegram › Histórico. Procurar: texto ilegível, fundo translúcido com cor errada no claro, overlay estranho, botão primário com contraste ruim, regressão de layout.
- [ ] **Step 4:** Revisão final do branch (superpowers:requesting-code-review).
- [ ] **Step 5:** Derrubar 8081 e 4300 por PID (`Get-CimInstance Win32_Process`), provar portas livres; não tocar 8080/4200.
- [ ] **Step 6:** Relatório ao usuário: tabela de contraste final, decisões, capturas (caminhos absolutos), pendências (modais locais de Equipamentos/Tipos/Monitores sem trap; demais itens da rodada 2).

## Paralelismo

- Onda 1 (paralelo, mesmo worktree): Task 1 (`_tokens.scss`), Task 2 (`shared/a11y`, `shared/modal/*.ts|spec`, `shared/confirm-dialog/*.ts|spec`), Task 3 (3 SCSS de esqueleto + topbar), Task 4 (`features/notificacoes/*`). Arquivos disjuntos; cada agente commita só os próprios caminhos e roda specs com `--include` do próprio escopo (a suíte inteira roda no fim da onda).
- Onda 2: Task 5 (sozinho — toca `_tokens.scss`, `admin-list`, `confirm-dialog.scss`, `modal.scss` já mexidos na onda 1).
- Onda 3: Task 6 (depende do 5).
- Task 0 antes de tudo; Task 7 por último.
