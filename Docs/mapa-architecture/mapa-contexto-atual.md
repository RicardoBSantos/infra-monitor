# Mapa — contexto atual

Estado da rodada em curso. Atualizado como parte do commit que muda o Mapa, nunca depois.

Última atualização: 2026-09-15, branch `feat/unidade-hub`.

---

## 1. Dados de demonstração — agora persistentes

**Antes:** o banco de dev tinha 11 unidades com nome, sigla, cidade e código IBGE, inseridas à mão
(linhas 3 a 11 com `created_at` idêntico ao microssegundo). `endereco` estava **nulo nas 11** — a
suposição de que já havia endereço realista não se confirmou. Nenhum script, seed Flyway ou
`data.sql`. Nenhuma coordenada. Nenhuma topologia.

**Agora:**

| O quê | Mecanismo | Arquivo |
|---|---|---|
| `latitude`, `longitude`, `endereco` | SQL aplicado à mão, versionado | `infra-monitor-backend/db/dev-seed/01-unidades-coordenadas.sql` |
| `conecta_a_unidade_id` | `PUT /unidades/{id}/conexao` | `infra-monitor-frontend/e2e/seed-topologia-unidades.cjs` |

A divisão é deliberada — ver D09 em [mapa-decisoes.md](mapa-decisoes.md). O `README.md` da pasta
`db/dev-seed/` registra o porquê de cada escolha e os comandos.

Coordenadas: centro do município, com ponto distinto por unidade nas quatro de Aracaju (Centro,
Siqueira Campos, São José, Atalaia) para que os marcadores não colidam no mesmo pixel. Casamento por
`sigla`, não por `id`. Ambos os scripts são idempotentes — verificado: a segunda execução do seed de
topologia reporta `escritas: 0 | já corretas: 10`.

Topologia: estrela, `Sede Administrativa` (id 1) na raiz, as outras 10 conectadas a ela.

---

## 2. M04 com dado real — o que a verificação revelou

A verificação pedida partia de duas premissas que não se sustentaram, e as duas viraram trabalho:

**"Os marcadores aparecem nas posições certas, não mais no centróide do município."**
Não havia marcador de unidade. Os únicos `Marker` eram os alvos **invisíveis** de teclado, um por
município, no centróide do polígono (N02). O mapa não usava `latitude`/`longitude` para nada.
Preencher as coordenadas, sozinho, não mudaria um pixel. Daí o item novo aprovado — ver §3.

**"O painel 'Unidades sem localização' deve mostrar 0."**
Esse painel nunca dependeu de coordenada: `agruparUnidades` classifica por **código IBGE ausente**, e
as 11 unidades já tinham código. O painel já mostrava 0 antes do seed e continua mostrando 0. O
extremo oposto que faltava testar não existia — os dois extremos eram o mesmo.

---

## 3. Marcador de unidade — item novo

Primeiro uso real da coordenada no mapa. `Marker` nativo do MapLibre com `<button>` real, mesma
técnica provada em N02 para os alvos de município.

Verificado em `e2e/n06-marcadores-e-conexoes.cjs`:

| Verificação | Resultado |
|---|---|
| Um marcador por unidade com coordenada | 11/11 |
| Marcadores não colapsam no mesmo pixel | 11 posições distintas |
| As 4 unidades de Aracaju aparecem separadas | espalhamento 30 px |
| Rótulo com nome + status por extenso + contagem | `Centro Integrado de Saúde: Disponível, 16 equipamento(s)` |
| Alcançável por Tab | sim |
| Enter abre o painel da unidade | sim, painel bate com o rótulo |
| Espaço ativa o mesmo marcador | sim |
| Exatamente um `aria-pressed` por vez | sim |
| **Nenhum nó recriado em pan/zoom/pitch** | **11 nós antes, 11 depois** |
| Marcadores acompanham a câmera | posições mudaram sem troca de nó |
| Seleção sobrevive ao pan/zoom | sim |

A prova de preservação de nó é a mesma de N05 para município (75/75), aplicada aos marcadores de
unidade: a identidade do elemento é registrada num `WeakMap` antes do gesto e conferida depois. Nó
preservado é o que autoriza dizer que a lib reposiciona, em vez de o componente redesenhar.

---

## 4. N06 — linhas de conexão

Camada `line` sobre GeoJSON gerado de `conexoesDesenhaveis()`, função pura com 4 testes unitários.

- Só desenha o par em que **ambas** as pontas têm coordenada.
- Cor `#4a6c8c`, largura `1.4`, opacidade `0.65`. Fora da escala de status de propósito.
- Camada depois da extrusão na ordem do estilo — antes dela o bloco de Aracaju cobria o feixe
  inteiro que sai dele.

Dependência resolvida no backend: `conectaAUnidadeId` entrou no read-model do dashboard
(`DashboardUnidadeResponse`, `UnidadeCounts`, a query nativa e o `group by`). Aditivo, anulável, no
**fim** do record — a projeção nativa é lida por posição em `Object[]`, e inserir no meio trocaria
colunas em silêncio. `longOrNull` em vez de `longValue` porque a raiz tem pai nulo e `longValue`
devolveria `0`, que seria lido como id de unidade.

---

## 5. Layout

**Rolagem da página (4a).** Duas causas, não uma:

1. `.map` tinha `aspect-ratio: 760/680`, herança do SVG antigo — ~1074 px de altura numa coluna de
   ~1200 px. Substituído por altura presa à viewport.
2. Descoberta ao medir: **o painel lateral também estourava**. Com unidade selecionada ele passa dos
   1200 px e, como as duas colunas dividem a mesma linha da grade, era ele quem esticava a página —
   o cartão já cabia. Preso à mesma altura do cartão, com rolagem própria.

Resultado medido: excedente de rolagem `0 px` na área principal do shell **e** no documento.

**Recalibração de câmera.** A altura nova invalidava a calibração de N05, então os dois valores foram
refeitos contra ela — não herdados:

| | Antes | Depois |
|---|---|---|
| `OFFSET_CAMERA` | `[0, 40]` | `[0, 82]` |
| `ZOOM_AO_INCLINAR` | `0.55` | `0.75` |
| Folga no topo | 13,9% | **3,6%** |
| Folga na base | 25,1% | **8,2%** |
| Desequilíbrio | 11,1 p.p. | **4,6 p.p.** |
| Sobra total | 39,0% | **11,8%** |

As duas correções convivem: `e2e/n05-mapa-maplibre.cjs` continua **21/21**, incluindo a própria
verificação de faixa morta do N05 (`4 alvos acima de 28% e 8 abaixo de 72% da altura`).

**Legenda (4c).** Quatro status operacionais visíveis; os quatro estados de ausência de dado atrás
de `<details>` nativo; as três notas de leitura atrás de botão de informação com `aria-expanded`.

**Painel (4d).** 270 → **320 px**. Medido em tela: 320 px.

**Texto "em azul" (4b).** Retirado do escopo pelo próprio pedido, após a varredura não encontrar
nenhum texto azul na página. Cabeçalho da página intocado.

---

## 6. Custo de bundle

| | Antes | Depois |
|---|---|---|
| Bundle inicial | 96,94 kB gz | 96,35 kB gz |
| Chunk do Mapa | 244,51 kB gz | 246,09 kB gz |

O aviso de budget de `mapa.component.scss` continua (94,95 kB contra os 6 kB do
`anyComponentStyle`), como previsto em D04 — é a folha do MapLibre dentro do chunk lazy.

---

## 7. Suítes

| Suíte | Resultado |
|---|---|
| Backend (`./mvnw test`) | 241/241 |
| Frontend (`ng test`) | 353/353 |
| `e2e:n04` — conexão entre unidades | 9/9 |
| `e2e:n05` — MapLibre | 21/21 |
| `e2e:n06` — marcadores, conexões e layout | 22/22 |
