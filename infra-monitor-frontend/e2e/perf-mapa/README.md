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

## Duas métricas, porque uma sozinha engana

- **Cadência de frame** (`requestAnimationFrame`): presa ao vsync, satura em 16,7 ms. Só diz se
  *caiu* de 60fps. Nenhum cenário cai — por isso ela não basta.
- **CPU de main thread** (`Performance.getMetrics` via CDP): diz *quanto* do orçamento de 16,7 ms
  foi gasto. É esta que separa "de graça" de "ainda cabe, mas come metade do orçamento".
