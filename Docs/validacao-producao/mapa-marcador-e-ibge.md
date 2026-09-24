# Mapa: marcador e divergência de código IBGE

## Regra: coordenada prevalece

A coordenada (`latitude`/`longitude`) é o que posiciona o marcador no mapa e é considerada a fonte de
verdade geográfica. O `codigoIbge` cadastrado na unidade é só um campo de cadastro que pode divergir —
por exemplo, uma unidade cadastrada com o IBGE de um município mas cuja coordenada real cai dentro do
território de outro. Essas funções tornam essa divergência visível a quem for corrigir o cadastro, sem
decidir automaticamente qual está certo.

Implementado em `infra-monitor-frontend/src/app/core/services/geo-municipio.service.ts` como funções
puras (sem estado, sem HTTP):

- `pontoNoPoligono(ponto: [number, number], geometria): boolean` — ray casting sobre `Polygon` e
  `MultiPolygon`; anéis internos (índice > 0) são buracos e não contam como "dentro".
- `municipioDaCoordenada(ponto, municipios): Municipio | null` — primeiro município da lista cujo
  polígono contém o ponto; `null` se a coordenada não cair em nenhum.
- `interface DivergenciaIbge { codigoCadastro; nomeCadastro: string | null; codigoCoordenada;
  nomeCoordenada }`.
- `divergenciaIbge(unidade, municipios): DivergenciaIbge | null` — compara o `codigoIbge` (normalizado)
  da unidade com o município encontrado pela coordenada. Devolve `null` quando:
  - falta `codigoIbge` ou falta `latitude`/`longitude` (checagem `!= null`; `0` é coordenada válida);
  - a coordenada não cai em nenhum município da cartografia;
  - os dois códigos batem (cadastro coerente com a coordenada).
  Quando o `codigoIbge` cadastrado não existe na cartografia carregada, `nomeCadastro` vem `null` (o
  código ainda aparece em `codigoCadastro`).

### Caso real coberto (ITA-09)

Unidade com `codigo_ibge = 2803005` (Itabaianinha) e coordenada `latitude -10.6853, longitude -37.4256`,
que na cartografia de Sergipe (`public/assets/maps/se-municipalities.geo.json`) cai dentro do polígono
de **Itabaiana** (`2802908`). `divergenciaIbge` devolve
`{ codigoCadastro: '2803005', nomeCadastro: 'Itabaianinha', codigoCoordenada: '2802908', nomeCoordenada: 'Itabaiana' }`.

### Testes

`infra-monitor-frontend/src/app/core/services/geo-municipio.service.spec.ts` (TDD, RED confirmado antes
da implementação — funções não exportadas — depois GREEN):

- `pontoNoPoligono`: dentro/fora de `Polygon`, buraco não conta como dentro, `MultiPolygon` com match em
  qualquer parte.
- `municipioDaCoordenada`: acha o município certo; fora de tudo devolve `null`.
- `divergenciaIbge`: caso ITA-09 sintético, caso coerente (`null`), IBGE ausente ou coordenada ausente
  (`null`), coordenada fora da cartografia (`null`), IBGE fora da cartografia (`nomeCadastro: null`),
  normalização de espaços no `codigoIbge`.

Um teste com o GeoJSON real via `fs` não foi possível: o builder `@angular/build:unit-test` empacota o
spec para bundle de browser (esbuild) mesmo executando sobre Vitest, e `fs`/`path`/`__dirname` do Node
não resolvem nesse bundle (`TS2307: Cannot find module 'fs'`). O caso real do ITA-09 acima está coberto
com dados sintéticos equivalentes (mesmas coordenadas e mesmo par de municípios divergentes), não com o
arquivo real.
