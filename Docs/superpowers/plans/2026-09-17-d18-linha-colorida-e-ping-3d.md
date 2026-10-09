# D18 — Linha de conexão totalmente colorida + ping com volume

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A linha hub→unidade passa a ser inteiramente da cor de status da unidade filha (fim do gradiente D17), e o ping ganha volume por tratamento CSS (esfera simulada), com o nível de intensidade escolhido pelo usuário a partir de uma captura comparativa.

**Architecture:** Item 1 é remoção: `line-gradient` era a única paint property do MapLibre que não aceita expressão dirigida por feature, e foi ela que obrigou a dividir a conexão em seis camadas filtradas por status e a ligar `lineMetrics: true` na fonte. Com `line-color: ['match', ['get','status'], …]` volta a ser **uma** camada, sem filtro, sem `lineMetrics`. Item 2 é puramente `.map__ping` no SCSS: `radial-gradient` deslocado (highlight) + borda escurecida + `box-shadow` (inset para a sombra interna, externa para o assentamento), preservando os 7px e `var(--cor-ping)`.

**Tech Stack:** Angular 21, MapLibre GL 6.9, SCSS, Vitest, Playwright (roteiros `.cjs` próprios do repo).

**Spec:** este documento (tarefa bounded; brainstorming registrado no chat da sessão).

## Verificação feita antes de planejar (pergunta explícita do usuário)

`lineMetrics: true` foi ligado **só** pelo `line-gradient`. O ping NÃO depende dele:
`montarPings` (`mapa.component.ts:789-791`) lê apenas o primeiro e o último vértice da
geometria e reconstrói a curva em JS via `pontoNoArco` → `controleDoArco` → De Casteljau.
`['line-progress']` não entra nessa conta. **Conclusão: remover `lineMetrics`.**

## Global Constraints

- Sem abstração especulativa — regra do CLAUDE.md: nada de camada, util ou classe criada "para depois".
- Cores de status vivem em `COR_DO_STATUS` (`mapa.component.ts:84-96`), fonte única; o e2e espelha os hex e divergir é falhar — correto.
- Ping continua `aria-hidden`, sem `tabindex`, `pointer-events: none`.
- Tamanho do ping: 7px × 7px. Cor: `var(--cor-ping)`. **Não mudam.**
- `prefers-reduced-motion`: pings não são criados. Não mexer.
- Documentação do mapa (`Docs/mapa-architecture/*.md`) é atualizada no MESMO commit da mudança que a altera.
- Mensagens de commit em português, Conventional Commits, terminando com `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

### Task 1: Linha de conexão inteiramente na cor do status

**Files:**
- Modify: `infra-monitor-frontend/src/app/features/mapa/mapa.component.ts` (constantes 255-276, `camadasDeConexao` 332-360, fonte `conexoes` ~640-650, comentário em `conexoesDesenhaveis` ~386)
- Modify: `infra-monitor-frontend/src/app/features/mapa/mapa.component.scss` (`.legend__linha`, linhas 233-237)
- Modify: `infra-monitor-frontend/src/app/features/mapa/mapa.component.html` (nota da legenda, linha 86)
- Modify: `infra-monitor-frontend/e2e/n07-pulso-ping-dica.cjs` (check 8 da amostra, ~366-378; cabeçalho linha 20)
- Test: `infra-monitor-frontend/src/app/features/mapa/mapa.component.spec.ts`

**Interfaces:**
- Consumes: `corDoStatus(status: string): string`, `COR_DO_STATUS`, `UnitOperationalStatus`.
- Produces: `camadasDeConexao(): LayerSpecification[]` — mesma assinatura, agora **exportada**, retornando **um** elemento com `id: 'conexoes-linha'`.

- [ ] **Step 1: Escrever o teste que falha**

Em `mapa.component.spec.ts`, acrescentar `camadasDeConexao` ao import existente de `./mapa.component` e acrescentar ao fim do arquivo:

```ts
describe('camada de conexao (D18)',()=>{
  it('e uma unica camada, sem filtro por status',()=>{
    const camadas=camadasDeConexao();
    expect(camadas.length).toBe(1);
    expect(camadas[0].id).toBe('conexoes-linha');
    expect((camadas[0] as {filter?:unknown}).filter).toBeUndefined();
  });

  it('pinta a linha inteira com a cor do status da feature',()=>{
    const paint=(camadasDeConexao()[0] as unknown as {paint:Record<string,unknown>}).paint;
    expect(paint['line-gradient']).toBeUndefined();
    const cor=paint['line-color'] as unknown[];
    expect(cor[0]).toBe('match');
    expect(cor[1]).toEqual(['get','status']);
    // DISPONIVEL -> verde de COR_DO_STATUS, no proprio corpo do match.
    expect(cor).toContain('#34c77b');
    // Ultimo elemento e o fallback sem-dados.
    expect(cor[cor.length-1]).toBe('#435464');
  });
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `cd infra-monitor-frontend && npx vitest run src/app/features/mapa/mapa.component.spec.ts`
Expected: FAIL — `camadasDeConexao` não é exportada / retorna 6 camadas com `line-gradient`.

- [ ] **Step 3: Trocar as seis camadas por uma**

Em `mapa.component.ts`, apagar a constante `INICIO_DO_GRADIENTE` com todo o bloco de comentário (264-276) e a constante `COR_CONEXAO` (255) com o comentário que a acompanha. Substituir `camadasDeConexao` por:

```ts
/**
 * Uma camada só, com a cor saindo da própria feature.
 *
 * D17 tinha dividido a conexão em seis camadas filtradas por status, e ligado `lineMetrics: true`
 * na fonte, por uma razão única: `line-gradient` é a única paint property do MapLibre que NÃO
 * aceita expressão dirigida por propriedade da feature. Sem gradiente, a restrição some junto — e
 * `['get', 'status']` num `match` é o mesmo padrão de coloração por status que o resto do sistema
 * já usa (StatusBadgeComponent, cores de KPI).
 *
 * `match` e não `case`: a chave é um enum fechado, e o fallback cobre o status que a API venha a
 * acrescentar — a mesma queda para `sem-dados` que `corDoStatus` faz.
 */
export function camadasDeConexao(): LayerSpecification[] {
  return [{
    id: 'conexoes-linha',
    type: 'line',
    source: 'conexoes',
    layout: { 'line-cap': 'round' },
    paint: {
      'line-width': LARGURA_CONEXAO,
      'line-opacity': OPACIDADE_CONEXAO,
      'line-color': ['match', ['get', 'status'],
        ...Object.values(UnitOperationalStatus).flatMap(status => [status, corDoStatus(status)]),
        COR_DO_STATUS['sem-dados']],
    },
  } as LayerSpecification];
}
```

Na criação do estilo (~650), tirar `lineMetrics: true` e o comentário que o justificava:

```ts
sources: { municipios: { type: 'geojson', data: colecao }, conexoes: { type: 'geojson', data: conexoes } },
```

No comentário de `conexoesDesenhaveis` (~386-388), trocar "que o gradiente assume no trecho final" por "que a linha inteira assume". No comentário de `OPACIDADE_CONEXAO` (258-261), dizer que a translucidez continua servindo à leitura do município por baixo, agora com a linha colorida de ponta a ponta.

- [ ] **Step 4: Rodar os testes de unidade**

Run: `cd infra-monitor-frontend && npx vitest run src/app/features/mapa/mapa.component.spec.ts`
Expected: PASS, inclusive os testes de arco e de ping já existentes — a geometria não mudou.

- [ ] **Step 5: Legenda — amostra e texto**

`mapa.component.scss`, substituir a regra e o comentário de `.legend__linha`:

```scss
/* Amostra da conexao: traco solido, a mesma translucidez das linhas do canvas. Com D18 a linha
 * inteira assume a cor do status da unidade conectada, e nenhuma cor unica representaria isso —
 * a amostra vale pela FORMA (traco fino ligando duas pontas) e o texto da nota diz a cor. */
.legend__linha { flex:0 0 auto; width:18px; height:2px; margin-top:7px; background:rgba(124,150,180,.65); }
```

`mapa.component.html`, linha 86:

```html
<p class="legend__nota"><span class="legend__linha"></span>Arco discreto liga cada unidade ao hub, inteiro na cor do status da unidade conectada. Só aparece quando as duas pontas têm coordenada cadastrada.</p>
```

- [ ] **Step 6: Atualizar o check 8 do roteiro e2e**

`e2e/n07-pulso-ping-dica.cjs`: substituir a leitura `linhaNeutra` e o `checar(8, 'amostra da linha comeca neutra…')` por:

```js
    const amostraLinha = await page.evaluate(() => {
      // A camada vive no WebGL; o que da para inspecionar e o que a legenda declara sobre ela.
      const amostra = document.querySelector('.legend__linha');
      if (!amostra) return null;
      const estilo = getComputedStyle(amostra);
      return { imagem: estilo.backgroundImage, cor: estilo.backgroundColor };
    });
    /*
     * D18 removeu o gradiente: a linha do canvas e inteira da cor do status, e a amostra da legenda
     * virou traco solido — nao ha mais "ponta que tinge" para provar. O que o check protege agora e
     * que a amostra nao voltou a ser gradiente por acidente.
     */
    checar(8, 'amostra da linha e traco solido, sem gradiente',
      !!amostraLinha && amostraLinha.imagem === 'none' && amostraLinha.cor === 'rgba(124, 150, 180, 0.65)',
      JSON.stringify(amostraLinha));
```

Atualizar a última linha do cabeçalho do arquivo (linha 20) para: `* - a conexão é inteiramente da cor do status da unidade conectada (D18).`

- [ ] **Step 7: Documentação do mapa**

- `Docs/mapa-architecture/mapa-contexto-atual.md:537` — remover `lineMetrics: true ← exigido pelo line-gradient` da tabela de fontes; as linhas 544-545 passam a descrever a camada única com `line-color` por `match`.
- `Docs/mapa-architecture/mapa-decisoes.md` — acrescentar a decisão **D18** ao fim da sequência: o gradiente de D17 foi revertido a pedido; a linha inteira usa a cor de status; a divisão em seis camadas e o `lineMetrics` existiam só pela restrição do `line-gradient` e saíram juntos; o ping não dependia de `lineMetrics` (verificado — a curva é recalculada em JS a partir das duas pontas). Marcar D17 como superseded por D18 onde ela é descrita (inclusive a menção em `mapa-decisoes.md:588-592` e `:632`).

- [ ] **Step 8: Verificar que nada ficou órfão e commitar**

Run: `cd infra-monitor-frontend && grep -rn "INICIO_DO_GRADIENTE\|COR_CONEXAO\|lineMetrics\|line-gradient" src e2e`
Expected: nenhuma linha.

Run: `cd infra-monitor-frontend && npx vitest run && npx ng build`
Expected: testes PASS e build sem erro.

Commit (assunto + corpo):

```
feat(mapa): linha de conexão inteira na cor do status

Reverte o gradiente de D17. Sem line-gradient cai a restrição que obrigava
uma camada por status e lineMetrics na fonte: volta a ser uma camada com
line-color por ['match', ['get','status']], o mesmo padrão de coloração já
usado no resto do sistema.

lineMetrics era exigido só pelo gradiente — o ping reconstrói a curva em JS
a partir das duas pontas e não lê line-progress.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

---

### Task 2: Bancada de variações do ping (captura para escolha)

Tarefa de decisão, não de produto: produz uma imagem, não código que fica. Independente da Task 1 — roda em paralelo.

**Files:**
- Create (descartável, no scratchpad): `<scratchpad>/ping-3d/bancada.html`
- Create (descartável, no scratchpad): `<scratchpad>/ping-3d/captura.cjs`
- Create (entregue): `infra-monitor-frontend/e2e/n07-evidence/d18-ping-variacoes.png`

**Interfaces:**
- Produces: as três declarações CSS candidatas, em texto, para a Task 3 copiar sem reescrever.

- [ ] **Step 1: Montar a bancada**

`bancada.html` reproduz o fundo real do cartão do mapa (`#0f1821` com o `radial-gradient` do `.map-card`) e mostra, para CADA intensidade, os pings nas **seis** cores de status, em tamanho real (7px) e ampliados 8× (56px — é CSS, escala sem perda). Base comum, igual à regra atual:

```css
.ping { width:7px; height:7px; border:1px solid rgba(232,240,248,.8); border-radius:50%; background:var(--cor-ping); box-shadow:0 0 5px 1px rgba(232,240,248,.3); }
```

Variações, só o que muda em relação à base:

```css
/* A — sutil */
.ping--a {
  background: radial-gradient(circle at 34% 30%, rgba(255,255,255,.38), var(--cor-ping) 62%);
  box-shadow: 0 0 5px 1px rgba(232,240,248,.3), inset -1px -1px 2px rgba(0,0,0,.22);
}
/* B — médio */
.ping--b {
  background: radial-gradient(circle at 32% 28%, rgba(255,255,255,.62), var(--cor-ping) 52%,
              color-mix(in srgb, var(--cor-ping) 72%, #000) 100%);
  box-shadow: 0 0 5px 1px rgba(232,240,248,.3), inset -1.5px -1.5px 2.5px rgba(0,0,0,.38),
              0 1px 2px rgba(0,0,0,.45);
}
/* C — pronunciado */
.ping--c {
  background: radial-gradient(circle at 30% 26%, rgba(255,255,255,.9) 4%, rgba(255,255,255,.45) 18%,
              var(--cor-ping) 48%, color-mix(in srgb, var(--cor-ping) 55%, #000) 100%);
  box-shadow: 0 0 5px 1px rgba(232,240,248,.3), inset -2px -2px 3px rgba(0,0,0,.5),
              0 1.5px 3px rgba(0,0,0,.55);
}
```

A bancada mostra também uma coluna "atual" (a regra de hoje, sem tratamento) como referência, e rótulos A/B/C legíveis.

- [ ] **Step 2: Capturar**

`captura.cjs` abre a bancada com `chromium` em `deviceScaleFactor: 3` (o ping real tem 7px; sem escala a imagem não permite julgar), captura o elemento da bancada e grava em `infra-monitor-frontend/e2e/n07-evidence/d18-ping-variacoes.png`.

Run: `node <scratchpad>/ping-3d/captura.cjs`
Expected: PNG existente e não vazio.

- [ ] **Step 3: Conferir a própria imagem**

Abrir o PNG com a ferramenta Read. Confirmar: as três variações estão distinguíveis entre si; o `sem-equipamentos` (#263744, o mais escuro) continua visível; nenhuma variação estourou o diâmetro de 7px. Se duas variações ficarem indistinguíveis, ajustar os números e recapturar antes de mostrar.

- [ ] **Step 4: Apresentar ao usuário e PARAR**

Mostrar a captura e pedir a escolha entre A (sutil), B (médio) e C (pronunciado).
**Esta é a única pergunta da execução** — o usuário pediu explicitamente para ver antes de fixar o valor final. Nada da Task 3 começa antes da resposta.

---

### Task 3: Aplicar a variação escolhida no ping real

**Files:**
- Modify: `infra-monitor-frontend/src/app/features/mapa/mapa.component.scss` (`.map__ping`, linha 134, e o comentário 126-133)
- Modify: `infra-monitor-frontend/e2e/n07-pulso-ping-dica.cjs` (leitura da cor do ping)
- Modify: `Docs/mapa-architecture/mapa-decisoes.md`

**Interfaces:**
- Consumes: a declaração CSS da variação escolhida, literal, vinda da Task 2.
- Produces: `.map__ping` com volume; `--cor-ping` continua sendo o contrato lido pelo e2e.

- [ ] **Step 1: Conferir o e2e ANTES (ele lê a cor do ping)**

Run: `cd infra-monitor-frontend && grep -n "cor-ping\|backgroundColor" e2e/n07-pulso-ping-dica.cjs`
- Se lê `--cor-ping` (custom property inline): **nada a mudar** — `radial-gradient` não afeta a custom property. Registrar isso num comentário de uma linha no roteiro, para a próxima leitura não duvidar.
- Se lê `backgroundColor`: trocar por `getPropertyValue('--cor-ping')`, porque com `radial-gradient` o `background-color` deixa de carregar a cor.

- [ ] **Step 2: Aplicar a variação**

Em `mapa.component.scss`, substituir a regra `.map__ping` mantendo `width`, `height`, `border`, `border-radius`, `pointer-events` e `z-index`, e acrescentando o `background` e o `box-shadow` da variação escolhida, literalmente como na Task 2. Reescrever o comentário 126-133: `--cor-ping` continua sendo o status da unidade conectada, mas o parágrafo que dizia "a linha continua neutra" está errado desde D18 e sai. Acrescentar por que o volume existe: o ping é o único elemento do mapa que representa tráfego, e o volume o separa do marcador de unidade, que é chapado.

- [ ] **Step 3: Testes de unidade e build**

Run: `cd infra-monitor-frontend && npx vitest run && npx ng build`
Expected: PASS / build limpo.

- [ ] **Step 4: Documentar**

`Docs/mapa-architecture/mapa-decisoes.md` — na decisão D18, acrescentar o segundo item: ping com volume por `radial-gradient` + sombra interna + sombra externa, nível escolhido pelo usuário sobre captura comparativa (`e2e/n07-evidence/d18-ping-variacoes.png`). Registrar que **não** é extrusão geométrica — essa saiu de propósito e não volta.

- [ ] **Step 5: Commitar**

```
feat(mapa): volume no ping da conexão

radial-gradient deslocado (highlight), borda escurecida e sombra interna +
externa dão esfera ao ponto de 7px, sem mudar tamanho nem a cor de status.
Nível escolhido sobre captura comparativa das três intensidades.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

---

### Task 4: Validação no app real

**Files:**
- Create (evidência): `infra-monitor-frontend/e2e/n07-evidence/d18-linha-colorida.png`, `.../d18-ping-no-mapa.png`

- [ ] **Step 1: Subir o ambiente**

Backend: `cd infra-monitor-backend && DB_PORT=5434 JWT_SECRET=<secret de dev> ./mvnw spring-boot:run` (as duas variáveis são obrigatórias no dev deste projeto).
Frontend: `cd infra-monitor-frontend && npx ng serve`.
Confirmar `http://127.0.0.1:8080/actuator/health` e `http://127.0.0.1:4200`.

- [ ] **Step 2: Rodar o roteiro N07**

Run: `cd infra-monitor-frontend && N07_SENHA=<senha de dev> npm run e2e:n07`
Expected: todos os checks OK, inclusive o 8 reescrito.
Check que falhar é falha de verdade — diagnosticar (systematic-debugging), nunca afrouxar o check para passar.

- [ ] **Step 3: Rodar o roteiro N06 (marcadores e conexões)**

Run: `cd infra-monitor-frontend && npm run e2e:n06` com a variável de senha que o cabeçalho de `e2e/n06-marcadores-e-conexoes.cjs` declara.
Expected: OK. É ele que mede as linhas e a legenda.

- [ ] **Step 4: Captura de prova no mapa real**

Com Playwright: logar, navegar **por clique** até /mapa (`page.goto` pós-login cai em /login), aguardar os marcadores, e capturar:
- `d18-linha-colorida.png` — tela inteira, com os arcos coloridos por status;
- `d18-ping-no-mapa.png` — recorte ampliado de um trecho com ping visível.
Gravar em `e2e/n07-evidence/`. Ler as duas com a ferramenta Read e confirmar: linha colorida de ponta a ponta, ping com volume.

- [ ] **Step 5: Commitar as evidências**

```
test(e2e): evidência da linha colorida e do ping com volume

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```
