# Mapa — arco de conexão: três pings em fluxo, orbe luminoso, paleta vibrante (D24)

Data: 2026-10-21 · Branch: `feat/mapa-arco-brilho` (worktree `../infra-monitor-wt-arco`, base `origin/main` 8f8b78d; rebaseado em `b380ea8` antes do PR, quando a decisão passou de D23 a D24 porque o `main` já tinha D23)

## Pedido

Ajustes visuais no arco hub↔unidade do `/mapa`:

1. Três pings por arco em vez de dois, com espaçamento regular ao longo do arco.
2. Pings menores (valor proposto + comparação).
3. Aspecto translúcido, brilhante e mais vibrante na linha, nos pings e no marcador de unidade. Cor
   continua vindo do status; "vibrante" é saturação/luminosidade, não matiz novo. Semântica das 6
   cores não muda.
4. Remover o contorno branco dos pings.

Verificações exigidas: `perf:mapa` antes/depois (e medição no banco de dev, 11 unidades, não só na
carga com 2); contraste nos dois temas; `prefers-reduced-motion`; 6 status distinguíveis lado a
lado; avaliação de DV16; capturas 2 temas × 2 bancos × zoom de estado e de município.

## Decisões tomadas com o usuário (brainstorming)

- **Movimento: fluxo contínuo a ⅓.** Três pings a ⅓ do arco um do outro, sempre hub → unidade,
  reaparecendo no hub. **Reverte o "ida e volta" de D16**: espaçamento regular é matematicamente
  incompatível com a onda triangular cruzada (com fases 0/⅓/⅔ dois pings coincidem; com duas fases
  opostas eles se cruzam no meio).
- **Acabamento: orbe luminoso.** Substitui a esfera opaca de D18 (variação B). Núcleo claro → cor de
  status → borda transparente, glow na cor do status, sem sombra escura e sem aro.
- **Brilho: abordagem A.** Mesma tabela vibrante nos três elementos; brilho por técnica nativa de
  cada superfície (DOM: `box-shadow` estático; WebGL: camada `line` de halo com `line-blur`).

## Diagnóstico

### Origem do contorno branco (item 4)

São **duas** camadas em `.map__ping` (`mapa.component.scss`), não uma:

```css
border: 1px solid rgba(232, 240, 248, .8);          /* aro de 1px */
box-shadow: 0 0 5px 1px rgba(232, 240, 248, .3),     /* glow esbranquiçado: lê como halo */
  inset -1.5px -1.5px 2.5px rgba(0, 0, 0, .38),
  0 1px 2px rgba(0, 0, 0, .45);
```

Com `box-sizing: border-box` global (`_reset.scss`), o disco visível hoje é 5px de cor dentro de 1px
de aro. As duas camadas saem; o glow volta na cor do status.

### Viabilidade do brilho por superfície (item 3)

| Elemento | Superfície | O que é possível |
|---|---|---|
| Linha | canvas WebGL | sem `filter`/`box-shadow`. `line-color`, `line-opacity`, `line-width`, `line-blur`, e uma segunda camada `line` mais larga e borrada por baixo = halo |
| Ping | DOM (`Marker`) | `radial-gradient`, `box-shadow`, `filter`. Elemento se move a cada quadro → glow tem de ser estático no elemento; `filter: drop-shadow` repinta por quadro, descartado |
| Marcador | DOM (`Marker`) | `box-shadow` estático. Miolo tem de continuar opaco (D19: ele carrega o contraste) |

Coerência: os três usam **a mesma tabela de cor** e halo de raio comparável (linha 6px borrada,
ping glow 4px, marcador glow 6px). Não há divergência de cor entre WebGL e DOM porque nenhum dos
dois usa filtro — ambos recebem o hex já vibrante.

### Conflitos com o registrado em `Docs/mapa-architecture/`

| Registro | Conflito | Tratamento |
|---|---|---|
| D16 — dois pings em fase oposta, ida e volta | revertido por decisão do usuário | D24 registra a reversão; D16 fica |
| D16/D17 — técnica `Marker` DOM + `pontoNoArco` O(1) | **não** contrariado: continua `Marker` DOM e `setLngLat`, só muda a fase | — |
| D17 — `PERIODO_PING_MS` 4200 contra "tráfego agitado" | 3 pings aumentam densidade | período mantém 4200 ms, agora por travessia de ida: velocidade cai à metade, chegada a cada 1400 ms |
| D18-B — esfera com highlight e sombra interna | substituída pelo orbe, a pedido | D24 registra; D18 fica |
| D19 — marcador sem aro, contraste no miolo | não contrariado: miolo segue opaco; glow é acréscimo | geometria de seleção/foco/pulso inalterada |
| D16 — canvas sem tema, `--cor-foco-mapa` literal | não contrariado | paleta vibrante é literal, como `COR_DO_STATUS` |
| §9.2 — `box-shadow` animado 45% mais caro | não contrariado: glow é estático, nunca animado | — |
| DV16 — gradiente do ping é decisão do usuário | o usuário decidiu (orbe) nesta rodada | DV16 fecha com captura dos 6 |

### `perf:mapa`

É bancada sintética (`e2e/perf-mapa/banco.html`): sem backend e sem banco, com as 11 coordenadas do
dev-seed e topologia em estrela (10 arcos, 20 pings). O CSS do ping lá (`.ping`) é anterior a D18 —
defasado. A medição "no banco de dev" e "na carga" exige medir a aplicação real em `/mapa`.

## Desenho

### 1. Paleta vibrante

`COR_DO_STATUS` (só o Mapa a consome) passa aos valores vibrantes. Calculados por script (HSL:
coloridos `S×1,18+0,04`, `L+0,05` com teto 0,72 sem baixar; neutros `S×1,1`, `L+0,08` sem-dados e
`+0,04` sem-equipamentos). Contraste WCAG contra o município `#16283a`; ΔE OKLab ×100:

| status | atual | ×mun | vibrante | ×mun |
|---|---|---|---|---|
| disponível | `#34c77b` | 6,86 | `#35e087` | 8,70 |
| indisponível | `#e5484d` | 3,84 | `#f84e54` | 4,44 |
| degradada | `#e8a33d` | 6,96 | `#fcb142` | 8,23 |
| em manutenção | `#7fadff` | 6,67 | `#7fadff` | 6,67 (saturação já 100%) |
| sem dados | `#8797a6` | 5,01 | `#9dabb9` | 6,41 |
| sem equipamentos | `#667b8b` | 3,41 | `#6e8698` | 3,95 |

Par mais próximo: hoje sem-dados × sem-equipamentos ΔE 9,7 → 12,8. Novo mínimo: em-manutenção ×
sem-dados 10,5, acima do pior de hoje. Todos ≥ 3:1 contra o município.

A legenda passa a pintar as 6 amostras com o hex literal (hoje 4 usam token de tema) — mesma regra
que D19 aplicou aos dois neutros: a amostra espelha o canvas, não o tema.

### 2. Ping

- `PINGS_POR_LINHA = 3`; defasagem `k/3`.
- Nova função pura `faseDeFluxo(ciclos) = ((ciclos % 1) + 1) % 1` substitui `faseVaiEVolta` (que
  sai, sem chamador).
- Nova função pura `opacidadeNaPonta(u)`: `min(1, u/0,08, (1−u)/0,08)` — o ping nasce no hub e
  some na unidade, sem salto na volta ao início. Aplicada por `style.opacity` a cada quadro
  (compositor, barato).
- Período `PERIODO_PING_MS` = 4200 por travessia (semântica muda: era ida+volta).
- Caixa 7px → **5px**. Sem `border`.
- Fundo:
  `radial-gradient(circle, color-mix(in srgb, #fff 55%, var(--cor-ping)) 0%, var(--cor-ping) 45%, color-mix(in srgb, var(--cor-ping) 0%, transparent) 100%)`
  com declaração plana antes (fallback, como hoje).
- Glow: `box-shadow: 0 0 4px 1px color-mix(in srgb, var(--cor-ping) 70%, transparent)`.
- `will-change: transform` medido A/B na bancada; fica só se reduzir CPU.
- `--cor-ping` continua o contrato do e2e; `aria-hidden`, sem `tabindex`, `pointer-events: none`.

### 3. Linha

- Núcleo `conexoes-linha`: `LARGURA_CONEXAO` 1,4 → 1,6; `OPACIDADE_CONEXAO` 0,65 → 0,85.
- Nova camada `conexoes-halo`, **antes** do núcleo na ordem de camadas: `line-width` 6,
  `line-blur` 4, `line-opacity` 0,28, mesma `line-color` por `match`. `camadasDeConexao()` devolve as
  duas.
- Estáticas: custo por quadro ~0.

### 4. Marcador de unidade

- Miolo opaco, inalterado em tamanho.
- `box-shadow` de repouso ganha glow: `0 0 6px 1px color-mix(in srgb, var(--cor-unidade) 55%, transparent), 0 1px 3px rgba(0,0,0,.6)`.
- Selecionado: anel de 3px (D19) + glow + contato. Geometria de raios de D19 inalterada.
- Pulso (`::after`) inalterado.

### 5. Temas

Canvas sem tema: município `#16283a` e cores do mapa idênticas nos dois. O que muda é o fundo do
cartão fora do estado (`--im-map-glow` `#0e1924` × `#f2f6fa`). Glow colorido translúcido sobre fundo
claro (litoral, borda do estado) é o caso a conferir em captura.

### 6. `prefers-reduced-motion`

Inalterado: pings não são criados; pulso fica estático visível. Glow e halo são estáticos.

### 7. DV16

O stop escuro (`70% + #000`) deixa de existir — o orbe não escurece borda. Pior núcleo:
sem-equipamentos 3,95:1. DV16 fecha com a captura dos 6 status.

## Verificação

1. **Bancada `perf:mapa`**: CSS do ping e do marcador atualizado para o real; 3 pings/linha; cenários
   novos `D3` (30 pings orbe), `D3w` (D3 + `will-change`), `H` (halo de linha, parado), `BD3` (pulso
   + 30 pings + halo + glow do marcador). Rodar antes (cenários atuais) e depois. **Gate:** 0% de
   frames > 20 ms em todos; Δ CPU de `BD3` sobre `A` ≤ 2,35 ms (Δ do cenário E, a alternativa já
   rejeitada por custo).
2. **Aplicação real `/mapa`**: CDP `Performance.getMetrics`, 6 s, banco de dev (11 unidades) e banco
   da carga (2), antes (`origin/main`) e depois. Mesmo gate de frames.
3. `ng test` (funções puras novas, 2 camadas, ausência de `faseVaiEVolta`), `ng build`.
4. `e2e:n06`, `e2e:n07`, `e2e:n08` ajustados: 3 pings por linha; sentido único (u cresce entre
   amostras, salvo na volta ao início); `borderTopWidth` 0 e largura 5px; ausência de cor branca no
   `box-shadow`.
5. **Capturas** (Playwright): 6 status lado a lado (antes/depois, 4×, 7px × 5px); dark + light ×
   dev + carga × zoom de estado + zoom de município; reduced-motion. Conferidas visualmente.
6. Docs: D24 em `mapa-decisoes.md`; `mapa-contexto-atual.md` com números novos (§9.2 + seção D24);
   DV16 fechada em `mapa-dividas.md`; índice `mapa-architecture.md`. No mesmo commit da mudança.

## Fora de escopo

Mudar matiz de status; mexer em badges/tokens do resto do sistema; pings em WebGL; pulso.
