# Banco de medição — animações do Mapa

Custo real de cada técnica de animação sobre o canvas WebGL do `/mapa`. **Não precisa de backend,
`ng serve` nem login**: monta um MapLibre próprio com a mesma lib, a mesma cartografia de Sergipe, o
mesmo estilo de camadas, a mesma câmera e os mesmos dados de demonstração que a tela real usa.

```bash
cd infra-monitor-frontend
npm run perf:mapa
```

Abre Chromium com GPU real (headless desligado de propósito — em headless o WebGL cai para
SwiftShader e o número deixa de valer), mede 6s por cenário e grava `bench.json`.

## Para que serve

**Mexeu em animação do Mapa, rode isto e compare com a tabela de
`Docs/mapa-architecture/mapa-contexto-atual.md` §9.2. Não remeça do zero.**

O que importa é o **Δ sobre o cenário A** (mapa parado), não o absoluto: o absoluto depende da
máquina, e entre duas execuções na mesma máquina os valores variam ~20%. A **ordem** entre os
cenários é estável, e foi ela que sustentou as escolhas de D16.

## Cenários

| | O que mede |
|---|---|
| A | mapa parado — a linha de base |
| B | 11 marcadores pulsando, `::after` com `transform`+`opacity` — **a técnica em produção** |
| C | o mesmo pulso via `box-shadow` (idioma de `.sidebar__pulse`) — a alternativa descartada |
| D | 20 pings como `Marker` DOM, `setLngLat` por quadro — **a técnica em produção** |
| E | 20 pings como camada `circle` com `setData` de GeoJSON por quadro — alternativa descartada |
| F | `line-dasharray` animado por `setPaintProperty` a 20 Hz — alternativa descartada |
| BD | B + D juntos: a carga real da tela |
| B5 / D5 / E5 | 5× a carga real — margem antes de doer |
| D2r | 20 pings com o CSS de `origin/main` (7px, aro, esfera de 3 sombras), vai-e-volta — a produção ANTES de D23 |
| BD2r | B + D2r — a tela inteira ANTES |
| D3 | 30 pings com o CSS de D23 (5px, glow estático), fluxo hub→unidade, `faseDeFluxo` + `opacidadeNaPonta` por quadro |
| D3w | D3 com `will-change: transform` — serviu para decidir; ver D23 |
| H | mapa parado com o halo das conexões visível |
| BD3 | B com glow no marcador + D3 + halo — a tela inteira DEPOIS de D23 |
| BD3x5 | 5× BD3 (150 pings, 55 marcadores) — margem |

Os cenários A–F, BD, B5, D5 e E5 não mudaram, para continuar comparáveis com a §9.2. Os novos usam a
paleta de D23; `faseDeFluxo`/`opacidadeNaPonta` são cópias literais de `mapa.component.ts`, porque a
bancada não importa o componente — se mudarem lá, mudam aqui. A bancada tem 10 linhas sintéticas (30
pings em D3); o dev real tem 9 (27 pings).

**Gate de D23:** 0% de quadros > 20 ms em todos os cenários e Δ CPU de BD3 sobre A ≤ 2,35 ms.
`will-change: transform` só entra em `.map__ping` se D3w ficar mais de 10% abaixo de D3 (não ficou:
−6%, ver `mapa.component.scss`).

`bench-final.png` é artefato de execução (captura do BD3 ao fim da corrida); nunca foi versionado.

## Duas métricas, porque uma sozinha engana

- **Cadência de frame** (`requestAnimationFrame`): presa ao vsync, satura em 16,7 ms. Só diz se
  *caiu* de 60fps. Nenhum cenário cai — por isso ela não basta.
- **CPU de main thread** (`Performance.getMetrics` via CDP): diz *quanto* do orçamento de 16,7 ms
  foi gasto. É esta que separa "de graça" de "ainda cabe, mas come metade do orçamento".

## App real (`perf:mapa-app`)

A bancada tem topologia fixa; este script mede a tela de verdade, com o banco que estiver atrás do
backend (dev: 11 unidades; carga: 2). Mesmas duas métricas, cenários `animado` e `parado` (parado =
`animation:none` e pings removidos: é a base, não o zero absoluto).

```bash
FRONT_URL=http://127.0.0.1:4201 API_PORT=8082 E2E_EMAIL=<admin> PERF_SENHA=<senha> PERF_ROTULO=depois-dev \
  npm run perf:mapa-app
```

- `FRONT_URL`: onde o `ng serve` está (padrão 4200). `API_PORT`: porta do backend (`api-porta.cjs`
  reescreve 8080 para ela). `E2E_EMAIL`/`PERF_SENHA`: credencial (senha obrigatória, nunca gravada).
  `PERF_ROTULO`: nome do `app-<rotulo>.json`, que guarda só contagens e números.
- O custo inclui Angular e as camadas do mapa, por isso o `parado` da app (~1 ms) é maior que o A
  da bancada.
