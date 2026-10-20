# Consistência visual — rodada 1 (design)

Data: 2026-10-20 · Branch: `feat/consistencia-visual-r1` (worktree `../infra-monitor-wt-cv1`, base `origin/main` a334337)

## Objetivo

Itens de maior ganho por esforço, com legibilidade (WCAG AA, 4,5:1 para texto) como prioridade.
Fora de escopo (rodada 2): padding de página, `max-width`, peso de `h1`, sobretítulo, padronização das
gerações A/B de tela.

Decisões do usuário (2026-10-20):

| Tema | Decisão |
|---|---|
| Hierarquia de texto | Manter os nomes e reordenar os valores: `text > soft > secondary > muted > faint > dim` |
| `aria-modal` | Implementar trap de foco real em `app-modal` e `app-confirm-dialog`; ambos ficam `aria-modal="true"`. Gavetas continuam `false` |
| Fundo escurecido | Token único `--im-overlay`: `rgba(0,0,0,.60)` escuro, `rgba(16,24,40,.40)` claro |
| Telegram › Histórico | `notificacao-list` perde o próprio header e o padding; só a casca tem `h1` |

## 1. Contraste

**Critério:** todo token de texto ≥ 4,5:1 sobre o fundo mais escuro (escuro) / mais escuro do claro em que
pode aparecer. Alvo de medição: `--im-bg`, `--im-surface`, `--im-surface-header`, `--im-surface-raised`,
`--im-surface-hover`, `--im-surface-active`. O pior caso é `--im-surface-active` (`#16202b` escuro,
`#e6ecf3` claro); calibrar contra ele garante os demais.

Medição atual (pior fundo) → valor novo proposto (contraste no pior fundo):

| Token | Escuro hoje | Escuro novo | Claro hoje | Claro novo |
|---|---|---|---|---|
| `--im-text-secondary` | `#7A8699` 4,47 | `#a7afbb` 7,44 | `#475467` 6,46 | mantém |
| `--im-text-muted` | `#63768a` 3,52 | `#94a1af` 6,25 | `#667085` 4,18 | `#51596a` 5,91 |
| `--im-text-faint` | `#7889a0` 4,61 | `#8894a1` 5,33 | `#667085` 4,18 | `#596174` 5,21 |
| `--im-text-dim` | `#4e5f72` 2,51 | `#7c8997` 4,61 | `#98a2b3` 2,17 | `#636974` 4,64 |
| `--im-primary` (texto) | `#3B6EFF` 3,81 | `#5a85ff` 4,89 | `#1a56db` 5,20 | mantém |
| `--im-on-primary` sobre primary | `#07111e` 4,39 | mantém `#07111e` → 5,63 sobre `#5a85ff` | branco 6,18 | mantém |
| `--im-danger` (texto em hover) | `#E5534B` 4,45 (active) | `#e65850` 4,61 | `#d92d20` 4,06 | `#c92a1e` 4,61 |
| `--lg-placeholder` (login) | `#4E5A6B` 2,74 | `#747d8b` 4,62 | `#98a2b3` 2,46 | `#6b727e` 4,63 |

Ordem resultante: escuro 14,0 > 11,0 > 7,4 > 6,3 > 5,3 > 4,6; claro 14,9 > … > 6,5 > 5,9 > 5,2 > 4,6.
A inversão (`faint` acima de `muted`/`secondary`) desaparece sem renomear; nenhum consumidor muda.
Comentário no `_tokens.scss` documenta a ordem e o critério.

Os valores acima são ponto de partida calculados; o implementador re-mede com o script de contraste e
pode ajustar o último dígito, nunca abaixo de 4,5 nem quebrando a ordem. `--im-danger-strong` (igual a
`--im-danger`) acompanha. `--im-primary` mais claro no escuro também afeta botões/bordas: aceitável
(mesma matiz) e conferido nas capturas.

Também medir e corrigir se < 4,5: cores de status como texto (`success`, `warning`, `danger-soft`,
`link`) sobre o pior fundo e sobre os novos `--im-*-bg`.

**Entrega:** tabela final de cada combinação token × fundo × tema no relatório, gerada pelo script
(`scratchpad/contraste.cjs`, versionado em `e2e/` como `contraste-tokens.cjs` se ficar útil — ver plano).

## 2. ConfirmDialog: Escape, foco, trap

Copiar a mecânica do `app-modal` (`shared/modal/modal.component.ts`):

- Escape no `document` (host listener) chama cancelar, respeitando `busy()` (ocupado não fecha, igual a
  `bloqueado()` do modal).
- Ao abrir: guarda `document.activeElement` como gatilho; foco vai para o botão **Cancelar** (ação segura
  num diálogo destrutivo).
- Ao fechar: foco volta ao gatilho se ainda conectado.
- Clique no fundo mantém comportamento atual, mas com a mesma guarda de "clique começou no fundo".
- Id do título único por instância (`confirm-titulo-N`), não `confirm-title` fixo.
- `role="alertdialog"` mantido; `aria-describedby` apontando para a mensagem.

**Trap de foco (novo, nos dois componentes):** `keydown.tab` no painel — Tab no último focável volta ao
primeiro; Shift+Tab no primeiro vai ao último; se o foco estiver no próprio painel, vai ao primeiro/último.
Focáveis = mesmo seletor-base do modal, incluindo o ×. Implementação local em cada componente (função
pequena); se ficar idêntica, extrair um único helper `shared/a11y/prender-foco.ts` — sem classe base.
`aria-modal="true"` permanece e passa a ser verdadeiro. Specs cobrem: Escape, foco inicial, retorno ao
gatilho, ciclo Tab/Shift+Tab, busy bloqueia Escape.

Os modais locais de Equipamentos/Tipos/Monitores (`aria-modal="true"` sem trap) ficam fora desta rodada —
registrados como pendência no relatório.

## 3. `prefers-reduced-motion`

- Esqueleto com brilho infinito (`animation: loading 1.2s infinite`) em `features/detalhe-generico.scss`,
  `features/medicoes/medicao-list.component.scss`, `features/unidades/admin-list.component.scss`: sob
  `reduce`, `animation: none` (fica o gradiente estático).
- Spinner da topbar (`topbar-girar`): sob `reduce`, sem rotação contínua — trocar por pulso de opacidade
  lento ou estático. Escolha: `animation: none` + opacidade reduzida; o estado de carregamento continua
  anunciado pelo texto/aria existente (conferir que existe).

## 4. Telegram › Histórico

`notificacao-list.component.html` remove o `<header>` (sobretítulo "GERENCIAMENTO · CANAL TELEGRAM", `h1`
"Notificações", descrição). O `aria-labelledby` da section perde o alvo → trocar por
`aria-label="Histórico de notificações"`.
`.operational-page` deixa de aplicar padding/max-width/margin próprios nessa tela (o componente só existe
dentro da casca `.telegram`). Specs que procuram o `h1` ajustados. Resultado: um `h1` por página, um
padding.

## 5. Tokens de fundo translúcido por status

Novos tokens nos dois temas (escuro = base translúcida da cor do tema escuro; claro = base da cor do
tema claro):

| Token | Escuro | Claro |
|---|---|---|
| `--im-success-bg` | `rgba(63,185,80,.10)` | `rgba(6,118,71,.08)` |
| `--im-warning-bg` | `rgba(210,153,34,.10)` | `rgba(181,71,8,.08)` |
| `--im-danger-bg` | `rgba(229,83,75,.10)` | `rgba(217,45,32,.07)` |
| `--im-neutral-bg` | `rgba(122,134,153,.10)` | `rgba(71,84,103,.07)` |
| `--im-info-bg` | `rgba(76,141,255,.10)` | `rgba(26,86,219,.08)` |
| `--im-*-bg-strong` (success, warning, danger) | `.16` | `.14` |
| `--im-overlay` | `rgba(0,0,0,.60)` | `rgba(16,24,40,.40)` |

`--im-success-bg` e `--im-danger-bg` já existem: os valores mudam para os da tabela (o claro hoje é sólido
`#ecfdf3`/`#fef3f2` — verificar visualmente os 2 consumidores atuais). Bordas: nenhum token novo; literais de
borda translúcida (.25–.40) usam os existentes `--im-success-border` / `--im-danger-border`.

Substituir os literais de status (~25) — paleta antiga `52,199,123` / `232,163,61` / `229,72,77` /
`99,118,138` e as variações de `229,83,75` / `63,185,80` / `76,141,255` usadas como fundo/borda — pelos
tokens mais próximos. Mapeamento por opacidade: ≤.10 → `-bg`, .12–.16 → `-bg-strong`, .25–.40 → `-border`.
Overlays `.65` (modal, confirm, equipamento, tipos, monitores), `.38` (3 gavetas, mapa) e `.74` (shell
mobile) → `var(--im-overlay)`.

Fora: sombras (`rgba(0,0,0,.18/.25/.34/.42/.45)`), keyframes de pulso (`rgba(63,185,80,0)` etc.),
`mapa.component.ts`, tokens `--lg-*` do login (só o placeholder entra).

## 6. Higiene

- Remover 10 tokens órfãos: `--im-map-active`, `--im-map-land`, `--im-map-land-alt`, `--im-map-stroke`,
  `--im-map-water`, `--im-space-1`, `--im-space-2`, `--im-space-5`, `--im-text-on-accent`,
  `--im-warning-strong` (verificado: 0 usos em `src/` e `e2e/`; recontar antes de apagar).
- Os 3 restantes órfãos passam a ser usados: `z-index: 15` (action-menu) → `--im-z-menu`; `20` (sidebar) →
  `--im-z-sidebar`; `30` (topbar user-menu) → `--im-z-topbar-menu`.
- `z-index` internos de componente (1, 2, 5, 6, 10 do shell) ficam — não são da escala global. O `10` do
  backdrop do shell mobile: avaliar se precisa de token (sidebar 20 está acima dele, ordem já correta) —
  manter literal.

## Verificação

- `npm test` (suíte do frontend) e `npm run build` verdes.
- Script de contraste: tabela final, todos ≥ 4,5.
- Playwright (`e2e/consistencia-visual-r1.cjs`): login por formulário, navegação por clique, API via
  `api-porta.cjs` (carga, 8081), capturas **antes** (main) e **depois** (branch) nos dois temas de:
  Painel, Equipamentos (lista + ConfirmDialog aberto), Unidades admin, Medições, Telegram › Histórico,
  Login. Verificações automáticas: um único `h1` no Telegram › Histórico; Escape fecha ConfirmDialog e
  foco volta ao gatilho; Tab cicla dentro do diálogo; `emulateMedia({reducedMotion:'reduce'})` ⇒
  `animation-name` do esqueleto/spinner = `none`; contraste computado (`getComputedStyle`) de cabeçalho
  de tabela e rótulo de KPI ≥ 4,5.
- Capturas conferidas visualmente pelo implementador e pelo orquestrador.
- Evidência de carga fora do repo (scratchpad); no repo só o roteiro.

## Riscos

- `--im-primary` mais claro muda todos os botões primários no escuro (mesma matiz, +luminância).
- Texto `dim`/`faint` mais claro reduz o contraste visual entre níveis; hierarquia passa a depender mais
  de tamanho/peso — esperado, é o custo da legibilidade.
- Trap de foco: projeção de conteúdo no `app-modal` com elementos que aparecem depois da abertura — a
  lista de focáveis é recalculada a cada Tab, não cacheada.
