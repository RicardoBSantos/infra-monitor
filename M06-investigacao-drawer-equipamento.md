# M06 — Extração do drawer de equipamento para reuso em dois pais

Investigação (sem código). Hosts: lista de Equipamentos (atual) e Mapa (novo).
Data: 2026-09-14. Branch: `feat/unidade-hub`.

Objetivo: clicar num equipamento afetado no painel lateral do Mapa abre o mesmo
drawer por cima do mapa, sem navegar para `/equipamentos/:id` e perder o mapa.

---

## 1. Acoplamento atual

Drawer **já é autossuficiente para dados**. `equipamento-detalhe-drawer.component.ts:99-108`:

```ts
effect(() => {
  const id = this.equipamentoId();
  this.todosMonitores.set(false);
  this.carregarCadastro(id); this.carregarDisponibilidade(id); this.carregarLatencia(id);
  this.carregarMedicoes(id); this.carregarMonitores(id); this.carregarIncidentes(id);
});
```

6 chamadas próprias (`EquipamentoApi`, `RelatorioApi`, `MonitorApi`, `IncidenteApi`) +
`DashboardStateService.carregarResumoSeNecessario()`. Nenhuma vem do pai.
Extração é quase trivial.

**MAS há um buraco.** Input opcional `linha` (`:59`) é usado em 5 pontos:

| ponto | uso |
|---|---|
| html:8 | `linha()?.nome` — fallback `cadastro()?.nome` |
| html:12 | `linha()?.tipoNome` — fallback `cadastro()?.tipoEquipamento?.nome` |
| html:17 | `linha()?.unidadeNome` — fallback `cadastro().unidade.nome` |
| html:255 | `linha()?.ativo` — rótulo do botão |
| ts:274 | `statusAtual = linha()?.status ?? null` — **sem fallback** |

`EquipamentoResponse` (`core/models/equipamento.ts:4-19`) **não tem `status`**.
Sem `linha`, o KPI "Status" e o badge do cabeçalho ficam `—` para sempre, mesmo com
cadastro carregado. Mapa **precisa** passar `linha`.

Mapa tem `DashboardEquipamento` (`dashboard.ts:17`), não `DashboardEquipamentoLista`
(`:27`). Faltam `tipoNome` (tem `tipoEquipamento.nome`), `unidadeId`, `unidadeNome`
(mapa sabe: `unidadeSelecionada()`), `latenciaMs`/`numeroSerie` (drawer não usa).

→ Estreitar o input para tipo mínimo `{ nome; tipoNome; unidadeNome; status; ativo }`.
`DashboardEquipamentoLista` satisfaz estruturalmente; call site de `equipamento-list`
não muda. Mapa monta o objeto do que já tem.

**Segundo acoplamento: outputs.** `editar` e `alternarEquipamento` (`:62-63`) são ações
que só a lista implementa (formulário + `ConfirmDialog`,
`equipamento-list.component.ts:431,384`). Rodapé mostra os botões condicionado só a
`authState.canManageInventory()` (html:248,253), sem input que os desligue.
Mapa não tem esses fluxos → precisa de input tipo `[acoesDeGestao]="false"`.

## 2. Como o mapa abre — recomendação: (a) estado local

**Recomendo (a) — sinal no `mapa.component`, sem mudar a URL.**

- `/mapa` não tem `:id` nem filhos (`app.routes.ts:9`) — reaproveitar rota exigiria
  criar filhos ou query param.
- Deep-link "equipamento X" já existe e é `/equipamentos/:id` (comentário em
  `app.routes.ts:27-30`). Query param no mapa criaria segundo endereço pro mesmo conteúdo.
- Precedente de `relatorios.component.ts:164-169` é query param **de filtro**
  (`aba`, `equipamentoId` alimentam consulta), não de overlay. Caso diferente.
- Voltar do navegador: com (b), Escape/fechar teria de fazer `router.navigate` e o botão
  voltar entraria no ciclo. Com (a) o drawer fecha e o mapa nem repinta — importante,
  porque `montarMapa` é caro (chunk MapLibre de 1,1 MB, canvas WebGL).

Custo de (a): seleção não compartilhável por link. Aceito pela razão acima.

Sinal: `equipamentoSelecionado = signal<DashboardEquipamento | null>(null)`;
`goToEquipamento` (`mapa.component.ts:247`) deixa de navegar e passa a `.set(equipamento)`.

## 3. Conflito de UI

**Painel lateral fica visível atrás, drawer sobrepõe com backdrop.** Mesmo padrão de
lista+drawer usado em Unidades e Equipamentos.

Mecânica já pronta e compatível: `:host { display: contents }`,
`.gaveta__fundo { position: fixed; inset: 0; z-index: var(--im-z-gaveta-fundo) }`,
`.gaveta { position: fixed; ... z-index: var(--im-z-gaveta) }` (scss:6-23).
Tokens 40/41 (`_tokens.scss:68-69`); `mapa.component.scss` **não usa z-index nenhum** —
nada compete.

Não fechar a unidade selecionada: fechar o drawer devolve o usuário ao painel de onde
clicou, que é o ponto do M06.

Lado a lado: não. Painel do mapa fica à direita (`.map-panel`), a gaveta também
(`right: 0`, `min(660px, 100%)`) — sobreposição é o comportamento natural.

## 4. Acessibilidade

Tudo que o requisito pede já está **dentro** do drawer, não no host:

- `role="dialog" aria-modal="false" tabindex="-1"` (html:3-4)
- foco entra: `effect(() => this.painel()?.nativeElement.focus())` (ts:98)
- Escape: `aoTeclar` com `stopPropagation` (ts:345-347)
- foco volta: `gatilho = document.activeElement` capturado na construção (ts:89),
  devolvido em `pedirFechamento` (ts:349-352)

Como o gatilho é capturado no construtor e o drawer é montado por `@if`, o botão
`.afetados__item` do mapa (`mapa.component.html:44`) será o `activeElement` no momento
da criação → foco volta certo, sem código novo.

Mapa **não** registra listener global de keydown (`teclado: AbortController` só cobre
click/focus dos marcadores, ts:348-350) → sem conflito de Escape.

Falta cobrir: o backdrop cobre o canvas WebGL, mas o canvas continua focável por Tab
(ver memória N02: canvas é 1º tab-stop). Sem `inert` no container do mapa, Tab pode sair
da gaveta pro mapa. A lista resolve o inverso (`inert` na gaveta quando modal abre,
`equipamento-list.component.html:287`). É o único requisito de a11y que pode regredir
no host novo — o E2E precisa verificar a ordem de Tab.

## 5. Regressão em `/equipamentos/:id`

Extração é **aditiva**: dois inputs novos (`linha` estreitado por tipo, `acoesDeGestao`
com default `true`). Nada do call site atual muda.

Garantia:

- `equipamento-detalhe-drawer.spec.ts` (307 linhas, 17 casos) cobre o componente, roda igual.
- `equipamento-list.component.spec.ts` (303 linhas) cobre o host original.
- E2E: `e2e/n05-mapa-maplibre.cjs` é onde o comportamento do mapa é testado.
  `mapa.component.spec.ts` (73 linhas) é **só função pura** desde a migração MapLibre,
  porque jsdom não tem WebGL (comentário no spec:11-17). Testes do host novo vão pro E2E,
  não pro Karma. Novo roteiro `.cjs` seguindo a memória `e2e-sessao-navegacao-por-clique`
  (navegar por clique, nunca `page.goto`).
- Caso novo obrigatório no spec do drawer: `acoesDeGestao=false` esconde os dois botões e
  mantém "Abrir histórico".

## 6. Bundle

Verificado no `dist/` (build de produção existente):

```
grep -l "drawer-equipamento-titulo" *.js  → chunk-M4322O7L.js   (60.701 bytes)
```

Drawer hoje vive no chunk da rota de Equipamentos. Mapa é outro chunk; MapLibre é
`chunk-VBZCDZZM.js` (1.145.992 bytes).

**Não duplica.** Prova empírica no mesmo build: `ConfirmDialogComponent` é importado por
~9 chunks, mas a definição (`aria-labelledby="confirm-title"`) existe em **um só** —
`chunk-L3E2ZSWY.js`. esbuild extrai módulo compartilhado entre chunks lazy para chunk próprio.

Consequência real: ao importar o drawer no Mapa, ele sai de `chunk-M4322O7L` para um chunk
compartilhado, e `/mapa` passa a baixar esse chunk **junto com a rota** (import estático),
não sob demanda. Somando `MonitorManagementComponent` (também arrastado,
`monitor-management.component.ts:18-24`). Sobre 1,1 MB de MapLibre é ruído, mas é custo
real — medir nos chunks depois da mudança.

## Plano de arquivos

**Modificar:**

| arquivo | mudança |
|---|---|
| `equipamento-detalhe-drawer.component.ts` | exportar interface estreita p/ `linha`; novo input `acoesDeGestao = input(true)` |
| `equipamento-detalhe-drawer.component.html` | `@if (acoesDeGestao() && authState.canManageInventory())` nos dois botões do rodapé |
| `mapa.component.ts` | importar o drawer; `equipamentoSelecionado` signal; `goToEquipamento` → `.set()`; computed que monta a `linha` a partir de `DashboardEquipamento` + `unidadeSelecionada()` |
| `mapa.component.html` | montar `<app-equipamento-detalhe-drawer>` sob `@if`; `inert` no container do mapa enquanto aberto |
| `equipamento-detalhe-drawer.spec.ts` | +1 caso: `acoesDeGestao=false` |

**Criar:** `e2e/m06-drawer-no-mapa.cjs` — abrir por clique em afetado, Escape fecha,
foco volta ao gatilho, Tab não escapa pro canvas, painel da unidade permanece atrás.

**Não mexer:** `app.routes.ts`, `equipamento-list.component.*`.

## Decisões pendentes

1. **`acoesDeGestao` no mapa: `false` mesmo?** Alternativa: manter "Editar" e navegar pra
   `/equipamentos/:id` — mas aí sai do mapa, que é o que M06 combate. Recomendo `false`,
   com "Abrir histórico" (link, não output) mantido.
2. **`inert` no mapa enquanto o drawer está aberto** — resolve o canvas como tab-stop, mas
   nunca foi aplicado num container WebGL aqui. Risco de o MapLibre reagir mal. Verificar
   no E2E antes de fixar.
3. **Dívida de rota de `/equipamentos`** (`equipamento-list.component.ts:94-99`, rotas irmãs
   destroem a lista) permanece intocada — fora de escopo, e M06 não a agrava.
4. **Deep-link** fica só em `/equipamentos/:id`. Se depois quiserem compartilhar "visto do
   mapa", vira query param — retrabalho pequeno, o drawer já estará extraído.

---

**Status:** investigação concluída, aguardando aprovação. Nenhum código escrito.

---

# Resultado da implementação (2026-09-15)

Plano executado como aprovado. As duas exigências de verificação estão fechadas com número.

## Achado durante a implementação: `inert` quebrou o retorno de foco

O `inert` na página do mapa resolveu o vazamento de Tab, mas quebrou outro requisito de
acessibilidade — e só o e2e pegou. O gatilho (`.afetados__item`) fica **dentro** da região
inerte, e a gaveta devolvia o foco de forma síncrona, antes de o host reagir ao `fechar`:
elemento sob ancestral `inert` não aceita `focus()`, então o foco caía no `<body>` e o Tab
recomeçava do topo da página.

Primeira execução do roteiro: 18/19, com o caso 10 (`foco volta ao gatilho`) em
`{"tag":"BODY", ...}`.

Correção em `pedirFechamento()`: segunda tentativa de foco por `setTimeout`, depois de o pai
reagir e o `inert` sair. A guarda `document.activeElement !== gatilho` impede qualquer
temporizador onde a primeira tentativa já funcionou — a lista de Equipamentos segue síncrona,
e o teste que cobre isso (`fecha no Escape e devolve o foco...`) continua passando sem mudança.

## 1. `inert` — os dois lados provados

`npm run e2e:m06` → **19/19**. Casos diretamente exigidos:

| caso | o que prova | evidência |
|---|---|---|
| 5 | inert ligado com a gaveta aberta | `inert=true` |
| **6 (a)** | 5× Tab do último focável da gaveta não alcança o mapa | partida `"Abrir histórico"`; trajeto `body > A > A > A > A` |
| **7 (a)** | nem por Shift+Tab, nem por `focus()` programático | `0/75 marcadores aceitaram foco` |
| 10 | foco volta ao gatilho | `BUTTON.afetados__item "SWI-05-U3…"` |
| **11 (b)** | inert removido ao fechar | `inert=false` |
| **12 (b)** | nenhum marcador preso | `75/75 marcadores focáveis` |
| **13 (b)** | ordem de Tab do mapa intacta | `CANVAS/Map > "Amparo de São Francisco…"` |
| 18 | ciclo abre/fecha repetível | reabrir religa o inert; `×` desliga |

## 2. MapLibre reagiu mal ao `inert`? Não.

Era a preocupação que motivou a exigência. Quatro verificações, todas verdes — **nenhum
contorno foi necessário**, `aria-hidden` + `tabindex=-1` manual não chegou a ser preciso:

| caso | resultado |
|---|---|
| 14 — seleção preservada | `antes=2800308 depois=2800308` |
| 15 — lib não recria os Markers | `75/75 nós com a marca posta antes do ciclo` |
| 16 — câmera continua viva | alvos reposicionados após scroll = `true` |
| 17 — contexto WebGL | `{existe:true, largura:944, altura:1434, perdido:false}` |
| 19 — console | nenhum erro de página no roteiro inteiro |

## 3. Bundle — medido, não estimado

Método: build de produção dos dois lados (baseline em worktree separado no commit `f6b5eb6`),
fecho transitivo de chunks a partir do entry de cada rota, gzip nível 9.

**Drawer não duplica** — confirmado: definição (`drawer-equipamento-titulo`) em **um único**
chunk, importado por lista e mapa.

| | antes | depois | delta |
|---|---|---|---|
| `/mapa` (fecho transitivo) | 1.422.568 B · **385.743 B gz** | 1.536.434 B · **417.680 B gz** | **+113.866 B · +31.937 B gz (+8,3%)** |
| `/mapa` — nº de chunks | 9 | 20 | +11 |
| `/equipamentos` | 429.939 B · 131.733 B gz | 430.705 B · 133.098 B gz | +766 B · +1.365 B gz |
| initial (main+polyfills) | 28.627 B · 7.798 B gz | 28.594 B · 7.788 B gz | ~0 |

**É perceptível?** +31,9 kB gz sobre uma rota que já baixa 385,7 kB gz — 8,3%. O peso do
`/mapa` continua sendo o MapLibre (297,9 kB gz num único chunk, 71% do total). Em banda larga
os 31,9 kB somam dezenas de milissegundos; em 3G lento, algo perto de meio segundo. Os 11
chunks extras são pequenos e buscados em paralelo por HTTP/2, então o custo é banda e parse,
não round-trip. **Não bloqueia**, mas também não é ruído.

Se incomodar, o contorno é barato e não muda arquitetura: envolver a gaveta num bloco
`@defer (when equipamentoSelecionado())` no template do Mapa devolve os 31,9 kB ao
carregamento sob demanda — a gaveta só é baixada quando alguém abre a primeira. Não foi feito
porque está fora do plano aprovado.

## 4. Testes

- `npx ng test --watch=false` → **348 passed / 47 files** (era 347; +1 é o caso
  `acoesDeGestao=false`).
- `npm run e2e:m06` → **19/19**. Evidência em `e2e/m06-evidence/`.
- `npm run e2e:n05` não foi reexecutado nesta rodada.

## 5. Pendências que continuam abertas

Das quatro decisões listadas na investigação, as duas primeiras fecharam (`acoesDeGestao=false`
confirmado na prática; `inert` validado). Seguem abertas, como antes e fora de escopo:

3. dívida de rota de `/equipamentos` (rotas irmãs destroem a lista);
4. deep-link do equipamento continua só em `/equipamentos/:id`.
