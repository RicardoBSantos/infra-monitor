# D19 — Marcador sem aro, pulso geral e anel de seleção por status

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tirar o aro claro do marcador de unidade, fazer todos os marcadores pulsarem e trocar o anel de seleção lilás por um anel na própria cor do status — sem regredir contraste nem a geometria de foco.

**Architecture:** Três mudanças localizadas em `mapa.component.ts` (tabela de cores, remoção do filtro de pulso) e `mapa.component.scss` (borda do marcador, regra de `aria-pressed`), mais a legenda em `mapa.component.html`. O aro claro existia para salvar dois status escuros demais contra o fundo neutro do município; como ele sai, esses dois status são clareados até passarem 3:1 sozinhos — o contraste migra da borda para o próprio miolo. O anel de seleção passa a ser `color-mix` sobre `--cor-unidade`, a mesma variável que já pinta o miolo, e ganha uma segunda dimensão de diferença (tamanho) para continuar legível quando vários marcadores do mesmo status estão na tela.

**Tech Stack:** Angular 20 standalone, MapLibre GL, SCSS com `meta.load-css`, Karma/Jasmine (`ng test`), Playwright em CommonJS (`e2e/*.cjs`).

**Spec:** Caminho *bounded* — o design foi aprovado em chat nesta rodada e está transcrito na seção "Design aprovado" abaixo. Não há arquivo de spec separado.

## Global Constraints

- Fundo do município é constante: `COR_MUNICIPIO = '#16283a'`. Todo cálculo de contraste do mapa é contra este valor.
- Cores do canvas são hex literais em `mapa.component.ts`. WebGL não lê variável CSS — não trocar por token.
- `transform` no elemento do `Marker` pertence à biblioteca (DV13). Crescimento de marcador é por `width`/`height`; animação é no `::after`.
- `--cor-unidade` (marcador) e `--cor-ping` (ping) são custom properties inline e são o contrato lido pelo e2e. Não trocar por `background-color` nem por classe de status.
- `prefers-reduced-motion: reduce` mantém o anel de pulso **estático e visível**, nunca ausente.
- Sem Lombok/abstração especulativa não se aplica aqui, mas vale a regra irmã do frontend: nenhuma segunda fonte de cor. `corDoStatus()` é a única.
- Nenhuma migration, nenhuma mudança de backend nesta rodada.
- Mensagens de commit em português, Conventional Commits, terminando com:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`

## Design aprovado

| Item | Decisão |
|---|---|
| 1 | `.map__unidade` perde `border: 2px solid rgba(232, 240, 248, .92)`. O disco de 13px passa a ser inteiro de cor de status (antes o miolo era 9px). |
| 1b | `sem-dados` `#435464` → `#8797a6` (1,92:1 → **5,01:1**). `sem-equipamentos` `#263744` → `#667b8b` (1,22:1 → **3,41:1**). Legenda acompanha. |
| 2 | `STATUS_QUE_PULSA` é removido. Todos os marcadores recebem `map__unidade--pulsa`. |
| 3 | `.map__unidade[aria-pressed='true']` deixa o lilás `#f2d6ff` e passa a `box-shadow: 0 0 0 3px color-mix(in srgb, var(--cor-unidade) 78%, transparent)`, com o marcador crescendo de 13px para 19px. |
| 4 | `Docs/mapa-architecture/` registra D19 com as duas reversões e o motivo; e2e n07 inverte a asserção de pulso e ganha cobertura do anel nos 6 status. |

**Geometria conferida (não alterar sem refazer a conta):**

- Selecionado: caixa 19px → raio do miolo 9,5px. Anel de 3px → raio externo **12,5px**.
- `:focus-visible` usa `outline-offset: 3px` → o anel de foco começa a 9,5 + 3 = **12,5px**. Tangente ao anel de seleção, nunca sobreposto. É a mesma relação que o lilás de 3px já tinha com o marcador de 13px.
- Pulso `inset: -6px` → nasce a 9,5 + 6 = **15,5px**, fora do anel de foco (que termina em 14,5px).
- Hover continua 17px, para que hover e selecionado não fiquem idênticos em tamanho.

---

### Task 1: Clarear os dois status escuros e remover o aro claro do marcador

Os dois andam juntos de propósito: separados, existe um commit no meio em que `sem-equipamentos` fica a 1,22:1 contra o fundo — um estado de regressão de acessibilidade que não deve existir no histórico.

**Files:**
- Modify: `infra-monitor-frontend/src/app/features/mapa/mapa.component.ts` (constante `COR_DO_STATUS`, ~linha 92, e o comentário de `STATUS_QUE_PULSA` que cita os números antigos, ~linha 142)
- Modify: `infra-monitor-frontend/src/app/features/mapa/mapa.component.scss` (regra `.map__unidade`, ~linha 76, e o bloco de comentário acima dela, ~linhas 58-75)
- Modify: `infra-monitor-frontend/src/app/features/mapa/mapa.component.html` (itens `--neutral` e `--muted` da legenda, ~linhas 79-80)
- Modify: `infra-monitor-frontend/src/app/features/mapa/mapa.component.scss` (`.legend__dot--neutral` e `.legend__dot--muted`, dentro da linha longa ~224)
- Test: `infra-monitor-frontend/src/app/features/mapa/mapa.component.spec.ts` (~linhas 217-228)

**Interfaces:**
- Consumes: nada de tarefas anteriores.
- Produces: `COR_DO_STATUS['sem-dados'] === '#8797a6'` e `COR_DO_STATUS['sem-equipamentos'] === '#667b8b'`. As tarefas 3 e 4 dependem desses dois literais exatos; o e2e os espelha.

- [ ] **Step 1: Escrever o teste que falha**

Em `mapa.component.spec.ts`, o teste existente de `camadasDeConexao` já lista as cores em torno da linha 217. Localize o array e troque os dois valores. O teste é este (substitua os dois hex antigos pelos novos; o resto do `expect` fica como está):

```ts
    expect(camada.paint['line-color']).toEqual([
      'match', ['get', 'status'],
      'DISPONIVEL', '#34c77b',
      'INDISPONIVEL', '#e5484d',
      'DEGRADADA', '#e8a33d',
      'SEM_DADOS', '#8797a6',
      'SEM_EQUIPAMENTOS', '#667b8b',
      'EM_MANUTENCAO', '#7fadff',
      '#8797a6']);
```

O último elemento do array é o fallback, que em `mapa.component.ts:334` é `COR_DO_STATUS['sem-dados']` — por isso muda junto.

- [ ] **Step 2: Rodar o teste e confirmar que falha**

```bash
cd infra-monitor-frontend && npx ng test --watch=false --browsers=ChromeHeadless
```

Esperado: FAIL, com o `line-color` recebido ainda trazendo `#435464` e `#263744`.

- [ ] **Step 3: Trocar os dois hex em `COR_DO_STATUS`**

Em `mapa.component.ts`, a constante fica assim:

```ts
const COR_DO_STATUS: Record<string, string> = {
  'disponivel': '#34c77b', 'indisponivel': '#e5484d', 'degradada': '#e8a33d', 'em-manutencao': '#7fadff',
  'sem-dados': '#8797a6', 'sem-equipamentos': '#667b8b',
};
```

Acrescente ao bloco de comentário que já existe acima da constante (não substitua o que está lá — é histórico útil):

```
 * D19 clareou os dois tons neutros. Enquanto o marcador tinha ARO CLARO de 2px, o miolo podia ser
 * escuro à vontade: quem separava o marcador do município era o aro, a 13,05:1. Com o aro removido
 * (D19 item 1) o miolo virou o único portador de contraste, e os valores de N06 não sustentam o
 * papel: `sem-dados` #435464 dava 1,92:1 contra #16283a e `sem-equipamentos` #263744 dava 1,22:1 —
 * a 13px, marcador invisível. #8797a6 dá 5,01:1 e #667b8b dá 3,41:1, ambos acima dos 3:1 de
 * WCAG 1.4.11 para elemento gráfico essencial. Continuam sendo os dois tons mais dessaturados da
 * tabela, que é o que os faz ler como ausência de dado e não como estado; o que mudou foi a
 * luminância, não o matiz.
```

- [ ] **Step 4: Remover o aro claro do marcador**

Em `mapa.component.scss`, a regra passa a ser:

```scss
  .map__unidade { width: 13px; height: 13px; padding: 0; border: 0; border-radius: 50%; background: var(--cor-unidade, #8797a6); box-shadow: 0 1px 3px rgba(0, 0, 0, .6); cursor: pointer; transition: width .12s ease, height .12s ease, box-shadow .12s ease; }
```

Três detalhes que não são cosméticos:

1. `border: 0` e não a ausência da propriedade — a folha do MapLibre não põe borda em `.maplibregl-marker`, mas declarar zero deixa a intenção explícita para a próxima leitura.
2. O *fallback* de `background` passa de `#435464` para `#8797a6`, acompanhando `COR_DO_STATUS['sem-dados']`. Mesma troca no fallback de `.map__unidade--pulsa::after` (Task 2) e de `.map__ping` — faça os três, senão o fallback vira uma segunda fonte de cor divergente.
3. A `transition` troca `border-color` por `box-shadow`: não há mais borda a animar, e o anel de seleção da Task 3 é `box-shadow`.

Substitua o bloco de comentário "ARO CLARO POR FORA..." (o parágrafo inteiro que explica a troca de D15) por:

```
  /* --- Marcador da unidade ----------------------------------------------------------------
   *
   * `--cor-unidade` vem do componente a partir de `COR_DO_STATUS`, desde N07 o único lugar onde a
   * cor de status entra no mapa — o polígono virou neutro e não a consome mais.
   *
   * SEM ARO E SEM HALO: disco chapado de cor de status, e nada mais. O aro claro de 2px (D15) e o
   * halo interno de 1,5px que o precedeu (N06) resolviam o mesmo problema, camuflagem do miolo
   * contra o município — e o município era pintado por status, ou seja, o fundo mudava de cor
   * debaixo do marcador. Desde N07 o polígono é neutro e constante (#16283a): o problema que os
   * dois remendos atacavam deixou de existir, e o remendo ficou custando 4px dos 13px do marcador
   * (o miolo visível era de 9px) e um aro branco que competia com o anel de foco e com o de pulso.
   *
   * A conta que o aro fazia foi transferida para a cor do miolo: os dois status escuros foram
   * clareados em D19 até passarem 3:1 sozinhos contra #16283a. Ver o comentário de `COR_DO_STATUS`
   * em `mapa.component.ts`. A `box-shadow` escura de contato fica — ela não é contraste, é
   * profundidade, e separa o marcador da linha de conexão quando os dois se cruzam. */
```

- [ ] **Step 5: Alinhar a legenda com as cores novas**

A legenda hoje pinta as duas amostras neutras com token de tema (`var(--im-text-secondary)` e `var(--im-text-muted)`), não com o hex do canvas — o que já era divergência e vira divergência visível agora. Em `mapa.component.scss`, dentro da linha longa que declara `.legend__dot--*`, troque as duas regras:

```scss
.legend__dot--neutral { background:#8797a6; }.legend__dot--muted { background:#667b8b; }
```

Hex literal e não token, pela mesma razão do resto do bloco do mapa: a amostra da legenda representa o marcador desenhado sobre o canvas, que não tem tema. As outras quatro (`--success`, `--danger`, `--warning`, `--info-soft`) já são tokens e ficam como estão — mudá-las não faz parte desta rodada e os valores coincidem na prática.

`mapa.component.html` não muda neste passo: as classes continuam `--neutral` e `--muted`. Confirme que os seis `<li>` da lista continuam intactos.

- [ ] **Step 6: Verificar o contraste por script, não por estimativa**

```bash
cd infra-monitor-frontend && node -e "
const lin=c=>{c/=255;return c<=0.04045?c/12.92:Math.pow((c+0.055)/1.055,2.4)};
const L=h=>{const n=parseInt(h.slice(1),16);return 0.2126*lin(n>>16&255)+0.7152*lin(n>>8&255)+0.0722*lin(n&255)};
const R=(a,b)=>{const x=L(a),y=L(b),[h,l]=x>y?[x,y]:[y,x];return (h+0.05)/(l+0.05)};
const BG='#16283a';
for(const h of ['#34c77b','#e5484d','#e8a33d','#7fadff','#8797a6','#667b8b'])
  console.log(h, R(h,BG).toFixed(2), R(h,BG)>=3 ? 'OK' : 'REPROVA');
"
```

Esperado: seis linhas, todas `OK`. Valores de referência: `6.86 3.84 6.96 6.67 5.01 3.41`. Se alguma linha disser `REPROVA`, pare e reporte — não ajuste a cor por conta própria.

- [ ] **Step 7: Rodar a suíte e o build**

```bash
cd infra-monitor-frontend && npx ng test --watch=false --browsers=ChromeHeadless && npx ng build
```

Esperado: todos os testes passam; build sem erro. O aviso de budget `anyComponentStyle` no SCSS do mapa é pré-existente e esperado.

- [ ] **Step 8: Commit**

```bash
git add infra-monitor-frontend/src/app/features/mapa/mapa.component.ts infra-monitor-frontend/src/app/features/mapa/mapa.component.scss infra-monitor-frontend/src/app/features/mapa/mapa.component.spec.ts
git commit -m "$(cat <<'EOF'
feat(mapa): marcador sem aro claro, com os dois status neutros clareados

O aro de 2px existia para o miolo não se camuflar contra o município pintado
por status. O polígono é neutro e constante desde N07, então o aro passou a
custar 4px do marcador sem resolver nada. Removido.

O contraste migra do aro para o miolo: sem-dados #435464 (1,92:1) vira #8797a6
(5,01:1) e sem-equipamentos #263744 (1,22:1) vira #667b8b (3,41:1) contra
#16283a. Legenda alinhada aos mesmos literais.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Pulso em todos os marcadores

**Files:**
- Modify: `infra-monitor-frontend/src/app/features/mapa/mapa.component.ts` (constante `STATUS_QUE_PULSA` ~linha 142-154 e o uso em ~linha 718)
- Modify: `infra-monitor-frontend/src/app/features/mapa/mapa.component.scss` (fallback de cor em `.map__unidade--pulsa::after`)

**Interfaces:**
- Consumes: `COR_DO_STATUS` com os valores da Task 1 — o anel de pulso herda `--cor-unidade`, e é justamente o contraste dos dois tons clareados que torna o pulso geral defensável.
- Produces: todo `.map__unidade` no DOM carrega a classe `map__unidade--pulsa`. A Task 4 (e2e) asserta exatamente isso.

- [ ] **Step 1: Remover a constante e o filtro**

Em `mapa.component.ts`, apague por inteiro a constante `STATUS_QUE_PULSA` e o bloco de comentário acima dela (`/** Status cujo marcador pulsa. Só os dois que pedem ação. ... */`). Confirme que `UnitOperationalStatus` continua importado e usado em outro lugar do arquivo antes de mexer no import — `Object.values(UnitOperationalStatus)` é usado em `camadasDeConexao` (~linha 333), então o import **fica**.

No laço de montagem dos marcadores, as duas linhas

```ts
      // Pulso só nos dois status que pedem ação, e por classe e não por `:has()`: o SCSS não precisa
      // conhecer a lista de status, e a lista vive num lugar só (STATUS_QUE_PULSA).
      if (STATUS_QUE_PULSA.includes(unidade.status)) alvo.classList.add('map__unidade--pulsa');
```

viram

```ts
      // Pulso em TODOS os marcadores — D19 reverteu o filtro de N07. Continua por classe e não por
      // `:has()` ou seletor de status: o SCSS não conhece a lista de status, e não passa a conhecer.
      alvo.classList.add('map__unidade--pulsa');
```

- [ ] **Step 2: Registrar a reversão no comentário do arquivo**

No `className` inicial não há onde documentar isso sem poluir o laço. Acrescente o parágrafo ao bloco de comentário de `COR_DO_STATUS`, logo abaixo do parágrafo de D19 escrito na Task 1:

```
 * Esse clareamento é também o que sustenta o pulso geral de D19: o argumento de N07 para pulsar só
 * dois status era, em parte, que `sem-dados` (1,92:1) e `sem-equipamentos` (1,22:1) gerariam anel de
 * pulso ilegível. Com 5,01:1 e 3,41:1 o argumento caiu — os seis pulsam com anel legível.
```

- [ ] **Step 3: Corrigir o fallback de cor do anel de pulso**

Em `mapa.component.scss`:

```scss
  .map__unidade--pulsa::after { content: ''; position: absolute; inset: -6px; border: 2px solid var(--cor-unidade, #8797a6); border-radius: 50%; animation: map-pulsar 1.9s ease-out infinite; pointer-events: none; }
```

Faça a mesma troca de fallback `#435464` → `#8797a6` nas três ocorrências de `.map__ping` (a declaração plana e as duas paradas do `radial-gradient`, incluindo o `color-mix`). Confira com:

```bash
cd infra-monitor-frontend && grep -n "435464\|263744" src/app/features/mapa/mapa.component.scss src/app/features/mapa/mapa.component.ts
```

Esperado: as únicas ocorrências restantes estão dentro de blocos de comentário histórico (explicando os valores antigos). Nenhuma em valor de propriedade CSS nem em objeto TypeScript.

- [ ] **Step 4: Atualizar o comentário do bloco de pulso no SCSS**

Substitua as duas primeiras linhas do bloco `--- Pulso (N07) ---` pelo cabeçalho novo, mantendo os parágrafos técnicos (DV13, custo por quadro, `inset: -6px`) intactos logo abaixo:

```
  /* --- Pulso (N07, generalizado em D19) -----------------------------------------------------
   *
   * Todos os marcadores pulsam. O filtro de N07 (só INDISPONIVEL e DEGRADADA) foi revertido: ver
   * D19 em Docs/mapa-architecture/mapa-decisoes.md.
```

- [ ] **Step 5: Rodar a suíte e o build**

```bash
cd infra-monitor-frontend && npx ng test --watch=false --browsers=ChromeHeadless && npx ng build
```

Esperado: passa. Nenhum teste unitário cobre `STATUS_QUE_PULSA` hoje (verificado: `grep -n "PULSA" src/app/features/mapa/mapa.component.spec.ts` não retorna nada), então nenhuma asserção quebra aqui — a cobertura do pulso é de e2e, tratada na Task 4.

- [ ] **Step 6: Commit**

```bash
git add infra-monitor-frontend/src/app/features/mapa/mapa.component.ts infra-monitor-frontend/src/app/features/mapa/mapa.component.scss
git commit -m "$(cat <<'EOF'
feat(mapa): pulso em todos os marcadores de unidade

Reverte o filtro de N07 (STATUS_QUE_PULSA). O segundo argumento daquele filtro
— anel de pulso ilegível nos dois status escuros — caiu com o clareamento de
D19: 5,01:1 e 3,41:1 contra o município.

Mantidos: animação no ::after (DV13), prefers-reduced-motion com anel estático,
e o inset de -6px que faz o pulso nascer fora do anel de foco.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Anel de seleção na cor do status

**Files:**
- Modify: `infra-monitor-frontend/src/app/features/mapa/mapa.component.scss` (regra `.map__unidade[aria-pressed='true']` e seu comentário, ~linhas 96-103)
- Modify: `infra-monitor-frontend/src/app/features/mapa/mapa.component.ts` (comentário em ~linha 206-211 que descreve o "aro lilás")

**Interfaces:**
- Consumes: `--cor-unidade`, já posta inline pelo componente em cada marcador (Task 1). Nenhuma nova variável, nenhuma segunda função de cor.
- Produces: `.map__unidade[aria-pressed='true']` com `box-shadow` cujo primeiro anel deriva de `--cor-unidade`, e caixa de 19px. A Task 4 lê ambos.

- [ ] **Step 1: Trocar a regra**

```scss
  .map__unidade[aria-pressed='true'] { width: 19px; height: 19px; box-shadow: 0 0 0 3px color-mix(in srgb, var(--cor-unidade, #8797a6) 78%, transparent), 0 1px 3px rgba(0, 0, 0, .6); }
```

Três pontos de atenção:

1. **A ordem das camadas de `box-shadow` importa.** O anel de seleção vem primeiro e a sombra de contato depois, igual à regra que ele substitui — inverter faz a sombra de contato desenhar por cima do anel.
2. **`color-mix` já é usado neste arquivo** (no `radial-gradient` do `.map__ping`), então não é a primeira ocorrência e não precisa de fallback plano adicional. O fallback de `--cor-unidade` cobre a variável ausente.
3. **Não mexa em `outline-offset`.** Com 19px de caixa, o `outline-offset: 3px` do `:focus-visible` põe o anel de foco começando a 12,5px, exatamente onde o anel de seleção termina. Alterar qualquer um dos dois números quebra a tangência.

- [ ] **Step 2: Substituir o comentário do bloco**

Troque o parágrafo "Selecionado: lilás — e desde D17..." inteiro por:

```
  /* Selecionado: anel na PRÓPRIA cor do status, e não mais o lilás #f2d6ff de D17.
   *
   * O lilás foi escolhido quando o polígono ainda carregava cor e a seleção precisava de um matiz
   * que não colidisse com nenhum status. Com o polígono neutro sobrou só o custo: uma segunda fonte
   * de cor no mapa, e um marcador selecionado cuja borda dizia "selecionado" mas já não dizia qual
   * status. D19 devolve a leitura ao marcador inteiro — miolo, anel e pulso saem todos de
   * `--cor-unidade`.
   *
   * O risco conhecido dessa troca é anel-da-mesma-cor-do-miolo sumir à distância, e é por isso que a
   * seleção NÃO é só o anel: o marcador cresce de 13px para 19px. São duas dimensões de diferença —
   * tamanho e anel — contra uma. A translucidez (78%) é o que separa anel de miolo de perto; o
   * tamanho é o que separa selecionado de não-selecionado de longe, inclusive num aglomerado de
   * marcadores do mesmo status, que é o caso difícil (Aracaju, quatro unidades).
   *
   * 19px e não 17px: 17px é o hover. Se os dois coincidissem, passar o mouse por um marcador vizinho
   * o deixaria do tamanho do selecionado.
   *
   * GEOMETRIA — os três anéis do marcador selecionado, do centro para fora:
   *   miolo        raio  9,5px
   *   seleção      9,5 → 12,5px  (box-shadow de 3px)
   *   foco         12,5 → 14,5px (outline 2px, offset 3px) — tangente, nunca sobreposto
   *   pulso nasce  15,5px        (::after com inset -6px) — fora do foco
   * Mudar o tamanho da caixa OU o offset do foco OU a espessura do anel exige refazer esta conta. */
```

- [ ] **Step 3: Corrigir o comentário em `mapa.component.ts`**

Em torno da linha 206 o comentário afirma "aro lilás em `.map__unidade[aria-pressed='true']`". Troque essa oração por:

```
 * anel na cor do status em `.map__unidade[aria-pressed='true']` (D19 — era lilás fixo até D18)
```

Mantenha o resto do parágrafo. Confirme depois que não sobrou nenhuma menção a lilás descrevendo comportamento atual:

```bash
cd infra-monitor-frontend && grep -rn -i "lilás\|lilas\|f2d6ff" src/app/features/mapa/
```

Esperado: todas as ocorrências restantes estão em texto que explicitamente descreve o passado ("era", "até D18", "saiu"). Nenhuma em valor de propriedade.

- [ ] **Step 4: Rodar a suíte e o build**

```bash
cd infra-monitor-frontend && npx ng test --watch=false --browsers=ChromeHeadless && npx ng build
```

Esperado: passa.

- [ ] **Step 5: Commit**

```bash
git add infra-monitor-frontend/src/app/features/mapa/mapa.component.scss infra-monitor-frontend/src/app/features/mapa/mapa.component.ts
git commit -m "$(cat <<'EOF'
feat(mapa): anel de seleção na cor do status

Substitui o lilás fixo #f2d6ff por color-mix sobre --cor-unidade, a mesma
variável que pinta o miolo — sem segunda fonte de cor.

Como anel e miolo passam a ter o mesmo matiz, a seleção ganha uma segunda
dimensão: o marcador cresce de 13px para 19px (hover continua em 17px). A
geometria dos três anéis — seleção 12,5px, foco 12,5→14,5px, pulso a partir de
15,5px — está registrada no comentário da regra.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Atualizar o e2e n07 e provar o anel nos seis status

**Files:**
- Modify: `infra-monitor-frontend/e2e/n07-pulso-ping-dica.cjs` (cabeçalho, mapa `COR`, constante `PULSAM`, casos 2 e 5)
- Create: `infra-monitor-frontend/e2e/n07-evidence/d19-anel-<status>.png` (seis capturas, geradas pelo roteiro)
- Create: `infra-monitor-frontend/e2e/n07-evidence/d19-tudo-junto.png` (captura final composta)

**Interfaces:**
- Consumes: `COR_DO_STATUS` da Task 1, a classe universal de pulso da Task 2, e a `box-shadow` de seleção da Task 3.
- Produces: `n07-pulso-ping-dica.json` com todos os casos `ok: true` e as sete capturas listadas acima.

**Pré-requisitos de execução (não pule):**

```bash
# terminal 1 — backend
cd infra-monitor-backend && DB_PORT=5434 JWT_SECRET=<secret de dev> ./mvnw spring-boot:run
# terminal 2 — frontend
cd infra-monitor-frontend && npx ng serve
# terminal 3 — o roteiro
cd infra-monitor-frontend && N07_SENHA=<senha> node e2e/n07-pulso-ping-dica.cjs
```

O banco de dev precisa do seed em dois mecanismos (`db/dev-seed/01-unidades-coordenadas.sql` para cadastro e `e2e/seed-topologia-unidades.cjs` para topologia). São 11 unidades.

- [ ] **Step 1: Atualizar o espelho de cores e o cabeçalho**

No topo de `n07-pulso-ping-dica.cjs`:

```js
/** Cores do canvas, espelhadas do componente. Divergir daqui é o teste falhar, que é o certo. */
const COR = {
  disponivel: '#34c77b', indisponivel: '#e5484d', degradada: '#e8a33d',
  'em-manutencao': '#7fadff', 'sem-dados': '#8797a6', 'sem-equipamentos': '#667b8b',
};
```

Apague a constante `PULSAM` — nada mais a consome depois do Step 2.

No bloco de comentário do topo, troque as duas linhas que descrevem o pulso seletivo:

```
 * - o pulso é GERAL (todos os marcadores, qualquer status) — D19 reverteu o filtro de N07;
 * - o pulso vive no ::after, nunca no elemento — é a regra que DV13 deixou;
 * - o marcador não tem mais aro claro: o contraste sai do miolo (D19);
 * - o anel de seleção sai de --cor-unidade e o selecionado cresce, nos seis status;
```

E o título da primeira linha: `N07 — município neutro, pulso GERAL (D19), ping colorido e dica de relance.`

- [ ] **Step 2: Inverter as asserções do caso 2**

Substitua os dois `checar` do caso 2 que dependiam de `PULSAM` (hoje em torno das linhas 130-138) por:

```js
    const pulsando = unidades.filter((u) => u.pulsa);
    checar(2, 'todos os marcadores pulsam (D19 reverteu o filtro de N07)',
      pulsando.length === unidades.length && unidades.length > 0,
      `${pulsando.length} pulsando de ${unidades.length}`);
    checar(2, 'nenhum marcador ficou de fora por status',
      unidades.filter((u) => !u.pulsa).length === 0,
      unidades.filter((u) => !u.pulsa).map((u) => u.status).join(', ') || 'nenhum');
```

O `checar` seguinte, que confere `animacaoNoAfter`/`animacaoNoElemento` em `pulsando`, continua válido sem mudança — `pulsando` agora é a lista inteira.

Apague o `checar(2, 'quem não pulsa não tem anel de pulso', ...)`: a condição virou vazia por construção e um teste sobre conjunto vazio passa sem provar nada.

- [ ] **Step 3: Provar que o aro claro sumiu**

Acrescente ao caso 2, logo após as asserções de pulso:

```js
    // D19 item 1 — o aro claro de 2px saiu. Lido por borda computada, não por captura.
    const bordas = await page.evaluate(() => [...document.querySelectorAll('.map__unidade')]
      .map((b) => getComputedStyle(b).borderTopWidth));
    checar(2, 'marcador sem aro claro: borda de 0px nos 11',
      bordas.every((b) => b === '0px'), [...new Set(bordas)].join(' '));

    const tamanhos = await page.evaluate(() => [...document.querySelectorAll('.map__unidade')]
      .map((b) => getComputedStyle(b).width));
    checar(2, 'miolo ocupa os 13px inteiros',
      tamanhos.every((t) => t === '13px'), [...new Set(tamanhos)].join(' '));
```

- [ ] **Step 4: Escrever o caso novo do anel de seleção nos seis status**

O banco de dev tem 11 unidades e não garante os seis status. O roteiro portanto separa **prova funcional** (nas unidades reais, com o status que existir) de **prova visual dos seis** (forçando `--cor-unidade` e `aria-pressed` via DOM, o que exercita a regra CSS real de ponta a ponta — o que ela lê é a variável, e é a variável que está sendo posta).

Acrescente como caso 9, antes do bloco `finally`:

```js
    // ------------------------------- 9. anel de seleção na cor do status (D19 item 3)
    const STATUS_TODOS = [
      ['disponivel', '#34c77b'], ['indisponivel', '#e5484d'], ['degradada', '#e8a33d'],
      ['em-manutencao', '#7fadff'], ['sem-dados', '#8797a6'], ['sem-equipamentos', '#667b8b'],
    ];

    // 9a. Prova funcional: seleciona uma unidade real e confere que o anel saiu da cor dela.
    const alvoReal = await marcadorIsolado(page);
    await page.locator(`.map__unidade[data-unidade-id="${alvoReal}"]`).click();
    await page.waitForTimeout(250);
    const selecionado = await page.evaluate((id) => {
      const b = document.querySelector(`.map__unidade[data-unidade-id="${id}"]`);
      const e = getComputedStyle(b);
      return { cor: b.style.getPropertyValue('--cor-unidade'), sombra: e.boxShadow, largura: e.width };
    }, alvoReal);
    checar(9, 'marcador selecionado cresce para 19px',
      selecionado.largura === '19px', selecionado.largura);
    checar(9, 'anel de seleção não é mais lilás',
      !/242,\s*214,\s*255/.test(selecionado.sombra), selecionado.sombra);
    checar(9, 'anel de seleção herda o matiz de --cor-unidade',
      corBateComSombra(selecionado.cor, selecionado.sombra),
      `${selecionado.cor} -> ${selecionado.sombra}`);

    // 9b. Prova visual dos seis: força cor e estado no primeiro marcador, captura um por status.
    for (const [chave, hex] of STATUS_TODOS) {
      await page.evaluate(([hex]) => {
        const b = document.querySelector('.map__unidade');
        b.style.setProperty('--cor-unidade', hex);
        b.setAttribute('aria-pressed', 'true');
      }, [hex]);
      await page.waitForTimeout(160);
      const caixa = await page.locator('.map__unidade').first().boundingBox();
      await page.screenshot({
        path: path.join(OUT, `d19-anel-${chave}.png`),
        clip: { x: caixa.x - 46, y: caixa.y - 46, width: 120, height: 120 },
      });
      const largura = await page.evaluate(() => getComputedStyle(document.querySelector('.map__unidade')).width);
      checar(9, `anel visível e marcador a 19px no status ${chave}`, largura === '19px', largura);
    }
    // Devolve o marcador ao estado real antes das capturas finais.
    await page.evaluate(() => { const b = document.querySelector('.map__unidade'); b.style.removeProperty('--cor-unidade'); b.removeAttribute('aria-pressed'); });
    await page.reload();
    await page.waitForSelector('.map__unidade', { state: 'attached' });
    await page.waitForTimeout(600); // marcadores e pings remontam com o estilo do MapLibre
```

E acrescente, junto das outras funções auxiliares do topo do arquivo:

```js
/**
 * A `box-shadow` computada vem em rgb/rgba com o `color-mix` já resolvido pelo navegador. Comparar
 * hex com hex é impossível; o que se pode afirmar é que o primeiro anel da sombra tem o MESMO matiz
 * dominante que `--cor-unidade`, isto é, o mesmo canal RGB máximo e a mesma ordem entre canais.
 * É o que distingue "anel saiu da cor do status" de "anel é lilás fixo", que é a asserção que
 * interessa.
 */
const corBateComSombra = (hex, sombra) => {
  const n = parseInt(hex.trim().slice(1), 16);
  const alvo = [n >> 16 & 255, n >> 8 & 255, n & 255];
  const m = sombra.match(/rgba?\(([^)]+)\)/);
  if (!m) return false;
  const lido = m[1].split(',').slice(0, 3).map((v) => parseInt(v.trim(), 10));
  const ordem = (a) => a.map((_, i) => i).sort((i, j) => a[j] - a[i]).join('');
  return ordem(alvo) === ordem(lido);
};
```

- [ ] **Step 5: Ajustar a captura final composta**

Localize a captura final do roteiro (`final.png`) e acrescente, imediatamente antes dela, a captura composta que o pedido exige: marcador sem halo, pulso em marcadores de status diferentes, e anel de seleção em três status ao mesmo tempo.

A aplicação seleciona **uma** unidade de cada vez, então três anéis simultâneos não são estado alcançável por clique. A composição se obtém forçando `aria-pressed` em três marcadores de status distintos via DOM, com todo o resto no estado real — e a captura fica rotulada como montagem no próprio comentário do roteiro:

```js
    // Captura única exigida por D19: marcador sem halo, pulso em vários status, e anel de seleção em
    // três marcadores de status diferentes ao mesmo tempo. Os três `aria-pressed` simultâneos são
    // uma montagem para a evidência — a aplicação seleciona um de cada vez.
    await page.evaluate(() => {
      const marcadores = [...document.querySelectorAll('.map__unidade')];
      const porStatus = new Map();
      for (const b of marcadores) {
        const s = (b.getAttribute('aria-label').match(/: ([^,]+),/) || [])[1];
        if (!porStatus.has(s)) porStatus.set(s, b);
      }
      [...porStatus.values()].slice(0, 3).forEach((b) => b.setAttribute('aria-pressed', 'true'));
    });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, 'd19-tudo-junto.png'), fullPage: false });
```

- [ ] **Step 6: Rodar o roteiro e conferir o JSON**

```bash
cd infra-monitor-frontend && N07_SENHA=<senha> node e2e/n07-pulso-ping-dica.cjs
cat e2e/n07-evidence/n07-pulso-ping-dica.json
```

Esperado: nenhum `"ok": false`. Se algum caso falhar, **pare e reporte o caso e o detalhe** — não afrouxe a asserção para o roteiro passar.

- [ ] **Step 7: Conferir as capturas com os próprios olhos**

Leia as sete imagens novas (`d19-anel-*.png` e `d19-tudo-junto.png`). O que precisa ser verdade em cada uma:

- `d19-anel-*.png`: o anel se distingue do miolo (a translucidez de 78% tem de aparecer como diferença de tom), e o marcador está visivelmente maior que os vizinhos não selecionados na mesma captura.
- Nas duas capturas dos status neutros (`sem-dados`, `sem-equipamentos`): o marcador se separa do município. Se algum dos dois ainda ler como um borrão contra o fundo, é regressão da Task 1 — reporte, não corrija por conta própria.
- `d19-tudo-junto.png`: nenhum marcador tem contorno branco; há anel de pulso em marcadores de status diferentes; três marcadores estão com anel de seleção, em três cores diferentes.

Se alguma dessas condições não se sustentar na imagem, reporte antes de commitar.

- [ ] **Step 8: Commit**

```bash
git add infra-monitor-frontend/e2e/n07-pulso-ping-dica.cjs infra-monitor-frontend/e2e/n07-evidence/
git commit -m "$(cat <<'EOF'
test(e2e): evidência do marcador sem aro, pulso geral e anel por status

Caso 2 inverte a asserção de pulso seletivo para pulso geral e passa a ler a
borda computada dos marcadores (0px) e a largura do miolo (13px).

Caso 9 é novo: prova funcional do anel na unidade real (19px, matiz vindo de
--cor-unidade, não-lilás) e prova visual nos seis status, forçando a variável
pela mesma regra CSS que a aplicação usa.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Registrar D19 em `Docs/mapa-architecture/`

**Files:**
- Modify: `Docs/mapa-architecture/mapa-decisoes.md` (acrescentar a seção D19 ao final)
- Modify: `Docs/mapa-architecture/mapa-contexto-atual.md` (estado corrente do marcador, pulso e seleção)
- Modify: `Docs/mapa-architecture/mapa-architecture.md` (só se descrever marcador/pulso/seleção — conferir antes)
- Modify: `Docs/mapa-architecture/mapa-dividas.md` (só se houver dívida registrada que D19 quita ou cria — conferir antes)

**Interfaces:**
- Consumes: as decisões e números das Tasks 1-4.
- Produces: nada que outra tarefa consuma. É a última.

- [ ] **Step 1: Ler o que já está escrito antes de escrever**

```bash
cd /c/Users/rbfilho/Documents/infra-monitor && grep -rn -i "pulso\|pulsa\|aro claro\|halo\|lilás\|lilas\|f2d6ff\|435464\|263744" Docs/mapa-architecture/
```

Toda ocorrência que descreve o comportamento **atual** precisa ser corrigida. Ocorrência que descreve o passado num registro de decisão (D15, D17, N06, N07) **fica intacta** — o histórico é o valor desses arquivos. Na dúvida sobre um trecho, o critério é o tempo verbal: "o marcador tem aro claro" muda; "D15 introduziu o aro claro" não.

- [ ] **Step 2: Escrever a seção D19 em `mapa-decisoes.md`**

Acrescente ao final do arquivo, no mesmo formato das seções D17/D18 (título, corpo, **Verificado**, **Descartado**):

```markdown
## D19 — Marcador sem aro, pulso geral e anel de seleção por status

Três pedidos na mesma rodada, e **dois deles são reversões de decisões de N07**. Vale registrar o
porquê de cada reversão, porque em ambos os casos a decisão original estava certa para o mapa que
existia na época e ficou errada quando o mapa mudou debaixo dela.

### Item 1 — O aro claro sai, e o contraste migra para o miolo

`.map__unidade` perde o `border: 2px solid rgba(232, 240, 248, .92)`.

O aro claro (D15) e o halo interno de 1,5px que o precedeu (N06) atacavam o mesmo problema: o miolo
do marcador se camuflando contra o município. O município era pintado por status — o fundo debaixo
do marcador mudava de cor de um lugar para outro, e nenhuma cor de miolo dava conta sozinha.

N07 pintou o polígono de neutro e constante (`#16283a`). Isso apagou o problema, e o remendo
sobreviveu ao problema: 4px dos 13px do marcador gastos num anel branco, com o miolo visível
reduzido a 9px, competindo com o anel de foco e com o de pulso na mesma vizinhança de pixels.

O que o aro fazia foi transferido para a cor do miolo. Os dois status escuros foram clareados até
passarem 3:1 contra `#16283a` sozinhos:

| status | antes | contraste | depois | contraste |
|---|---|---|---|---|
| `sem-dados` | `#435464` | 1,92:1 | `#8797a6` | **5,01:1** |
| `sem-equipamentos` | `#263744` | 1,22:1 | `#667b8b` | **3,41:1** |

Os outros quatro não mudam: 6,86:1, 3,84:1, 6,96:1 e 6,67:1. Matiz e dessaturação preservados — os
dois neutros continuam lendo como ausência de dado; o que mudou foi a luminância.

A `box-shadow` escura de contato fica. Ela nunca foi contraste: é o que separa o marcador da linha
de conexão quando os dois se cruzam.

Efeito colateral corrigido junto: as amostras neutras da legenda pintavam com token de tema
(`--im-text-secondary`, `--im-text-muted`) e não com o hex do canvas. Já era divergência; com o
clareamento viraria divergência visível. Passaram a literal.

### Item 2 — Pulso em todos (reverte o filtro de N07)

`STATUS_QUE_PULSA` deixa de existir; todo marcador recebe `map__unidade--pulsa`.

N07 limitou o pulso a `INDISPONIVEL` e `DEGRADADA` com dois argumentos. O primeiro era de atenção:
"pulsar os onze seria onze coisas disputando atenção". O segundo era de contraste: os dois status
escuros gerariam anel de pulso ilegível (1,92:1 e 1,22:1).

O segundo argumento caiu com o item 1 desta mesma rodada — 5,01:1 e 3,41:1. O primeiro é uma
preferência de leitura, e é o usuário quem a arbitra: o pedido é pulso geral, como sinal de que o
mapa está vivo e lendo, não como chamado de atenção por unidade. O pulso deixa de ser um indicador
de estado e passa a ser a assinatura visual da sonda — o que o estado diz é a cor.

Não muda: animação no `::after` e nunca no elemento (DV13 — o `transform` do elemento pertence ao
MapLibre), `inset: -6px` fazendo o anel nascer fora do anel de foco, e `prefers-reduced-motion`
deixando o anel **estático e visível**, nunca ausente.

### Item 3 — Anel de seleção na cor do status (reverte o lilás de D17)

`.map__unidade[aria-pressed='true']` troca `#f2d6ff` por
`color-mix(in srgb, var(--cor-unidade) 78%, transparent)`, e o marcador cresce de 13px para 19px.

O lilás foi escolhido em D17 quando o polígono ainda carregava cor: a seleção precisava de um matiz
que não colidisse com nenhum status nem com o fundo. Com o polígono neutro, o benefício acabou e
sobrou o custo — uma segunda fonte de cor no mapa, e um marcador selecionado cuja borda dizia
"selecionado" e já não dizia qual status.

O risco da troca é conhecido e foi tratado, não ignorado: anel da mesma cor do miolo tende a sumir à
distância, e o caso difícil é o aglomerado de Aracaju, quatro unidades que podem compartilhar
status. Por isso a seleção **não é só o anel**. São duas dimensões:

- **translucidez (78%)** separa anel de miolo de perto;
- **tamanho (13px → 19px)** separa selecionado de não-selecionado de longe.

19px e não 17px porque 17px é o hover: iguais, passar o mouse num vizinho o deixaria do tamanho do
selecionado.

Geometria dos anéis do marcador selecionado, do centro para fora — mudar qualquer um dos números
exige refazer a conta inteira:

| anel | raio |
|---|---|
| miolo | 9,5px |
| seleção (`box-shadow` 3px) | 9,5 → 12,5px |
| foco (`outline` 2px, offset 3px) | 12,5 → 14,5px |
| pulso nasce (`::after`, `inset: -6px`) | 15,5px |

Seleção e foco são **tangentes**, nunca sobrepostos — é a mesma relação que o lilás de 3px tinha com
o marcador de 13px, e ela existe porque o `outline` pinta por cima e recortaria o anel justamente no
estado que vem logo depois do clique: selecionado E focado.

### Verificado

- Contraste dos seis status contra `#16283a` calculado por script (fórmula WCAG 2.x de luminância
  relativa), não estimado: 6,86 / 3,84 / 6,96 / 6,67 / 5,01 / 3,41 — todos ≥ 3:1.
- `ng test` (suíte completa) e `npx ng build` sem erro. O aviso de budget `anyComponentStyle` do
  SCSS do mapa é pré-existente.
- `e2e/n07-pulso-ping-dica.cjs`: caso 2 lê `borderTopWidth === '0px'` e `width === '13px'` nos onze
  marcadores e exige `map__unidade--pulsa` em todos; caso 9 confere 19px no selecionado, ausência do
  lilás na `box-shadow` computada e coincidência de matiz com `--cor-unidade`, mais captura por
  status. Evidência em `e2e/n07-evidence/d19-anel-*.png` e `d19-tudo-junto.png`.

### Descartado

- **Remover o aro sem clarear os dois neutros.** Cumpriria o pedido ao pé da letra e deixaria
  `sem-equipamentos` a 1,22:1 — marcador de 13px invisível contra o município.
- **Remover o aro só dos quatro status coloridos.** Preservaria o contraste ao custo de um marcador
  com duas aparências, e de uma regra de exceção por status no SCSS, que é exatamente o que
  `--cor-unidade` existe para evitar.
- **Anel de seleção só translúcido, sem crescer o marcador.** Uma dimensão só; verde translúcido
  sobre verde no zoom de estado não se lê a distância.
- **Voltar o anel de seleção a uma cor neutra** quando a translucidez se mostrou fraca. Descartado
  por instrução explícita: o reforço tem de vir na mesma cor.
```

- [ ] **Step 3: Atualizar `mapa-contexto-atual.md`**

Este arquivo descreve o estado corrente, não o histórico. Corrija toda descrição do marcador, do
pulso e da seleção para o estado pós-D19. Use os mesmos números da seção D19 — não os reescreva de
memória, copie. Se o arquivo tiver uma tabela de cores de status, os dois hex mudam lá também.

- [ ] **Step 4: Conferir `mapa-architecture.md` e `mapa-dividas.md`**

Os dois só mudam se o `grep` do Step 1 tiver apontado descrição de comportamento atual. Em
`mapa-dividas.md`, verifique especificamente se existe dívida registrada sobre contraste dos status
neutros ou sobre a dupla fonte de cor da seleção — se existir, D19 a quita e ela deve ser marcada
como resolvida com referência a D19, não apagada.

- [ ] **Step 5: Reler o que foi escrito procurando contradição**

```bash
cd /c/Users/rbfilho/Documents/infra-monitor && grep -rn -i "aro claro\|halo\|pulso seletivo\|lilás\|lilas" Docs/mapa-architecture/
```

Para cada ocorrência, confirme que o tempo verbal deixa claro tratar-se de história. Uma frase no
presente descrevendo o aro claro é uma contradição direta com D19 no mesmo diretório.

- [ ] **Step 6: Commit**

```bash
git add Docs/mapa-architecture/
git commit -m "$(cat <<'EOF'
docs(mapa): registra D19 e as duas reversões de N07

Pulso seletivo -> pulso geral: o argumento de contraste que sustentava o filtro
caiu com o clareamento dos dois status neutros; o argumento de atenção é
preferência de leitura, e foi arbitrada.

Anel neutro (lilás) -> anel por status: o lilás resolvia colisão de matiz com o
polígono colorido, que não existe desde N07; sobrava só a segunda fonte de cor.

Inclui a tabela de contraste dos seis status e a geometria dos quatro anéis do
marcador selecionado.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Ordem e paralelismo

As Tasks 1, 2 e 3 tocam os mesmos dois arquivos e **são sequenciais**. A Task 4 depende das três. A
Task 5 depende de todas, porque documenta números que as anteriores produzem.

Há um ponto de paralelismo real: dentro da Task 5, os Steps 3 e 4 (contexto atual, arquitetura e
dívidas) são arquivos independentes entre si e podem ser distribuídos, desde que o Step 2 (a seção
D19 em `mapa-decisoes.md`) esteja escrito antes — é dele que os números são copiados.
