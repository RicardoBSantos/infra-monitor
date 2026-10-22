# Capturas comparativas de D24 (banco de dev)

Geradas por `e2e/d24-arco-capturas.cjs` em 2026-10-21, clone do banco de dev (backend 8082; 11
marcadores, 9 linhas). "Antes" = `ng serve` do merge-base do branch (`8f8b78d`, pré-D24) — não
`origin/main`, que já recebeu o PR #14 e mudou o `mapa.component.scss` por outra razão; "depois" =
`feat/mapa-arco-brilho`. As capturas do banco da carga ficaram fora do repositório (scratchpad).
Checagens de cada execução em `antes-dev-checagens.json` e `depois-dev-checagens.json` (15/15 nas duas).

| Imagem | O que se vê |
|---|---|
| `seis-status-antes.png` | Dois pings de 7px por linha com aro branco e sombreado de esfera; linha 1,4px fosca; `sem-dados`, `sem-equipamentos` e o fundo quase se confundem, e o ping só se separa pelo aro branco. |
| `seis-status-depois.png` | Três orbes de 5px por linha (o primeiro a meia opacidade, no fade da ponta), sem aro branco; linha 1,6px com halo; os seis status distinguíveis, `sem-dados` (claro) × `sem-equipamentos` (ardósia) × `em-manutencao` (azul) separados. Na coluna clara o orbe vira anelzinho (núcleo claro ≈ fundo) — só no sintético: no mapa real o ping nunca cai sobre `#f2f6fa`. |
| `ping-7px-vs-5px.png` | Lado a lado a 4×: antes, bola com aro branco que lê como "botão"; depois, ponto de luz na cor do status com glow. `sem-equipamentos` é o mais discreto dos seis, mas lê como ponto claro, não como anel vazio (DV16). |
| `antes-dev-escuro-estado.png` | 18 pings em bola clara com aro, contrastando mais com a linha fina do que com o status; marcadores sem glow. |
| `depois-dev-escuro-estado.png` | 27 pings; arcos em verde/âmbar vibrantes com halo discreto; marcadores com glow da própria cor; municípios e bordas intactos sob o halo. |
| `antes-dev-escuro-municipio.png` | Zoom em Aracaju com a Sede selecionada (anel âmbar); pings com aro branco chamam mais atenção que as linhas finas. |
| `depois-dev-escuro-municipio.png` | Mesmo zoom: três pings por arco, espaçados a ⅓; linhas visivelmente mais fortes; anel de seleção da Sede legível e separado do glow. |
| `antes-dev-claro-estado.png` | Tema claro: cartão claro, mas o canvas segue com municípios escuros (igual ao escuro); pings com aro. |
| `depois-dev-claro-estado.png` | Tema claro, depois: mesmo canvas escuro, glow do marcador e do ping não vira borrão — fica contido sobre o município navy. |
| `antes-dev-claro-municipio.png` | Zoom em Aracaju no tema claro, antes: idem ao escuro, título e "Ver estado inteiro" em cartão claro. |
| `depois-dev-claro-municipio.png` | Zoom em Aracaju no tema claro, depois: orbes e halo idênticos ao escuro; o mar (branco) não recebe glow nenhum. |
| `antes-dev-reduced-motion-escuro.png` | Reduced-motion, antes: 0 pings, anéis de pulso estáticos. |
| `depois-dev-reduced-motion-escuro.png` | Reduced-motion, depois: 0 pings, anéis estáticos, linhas com halo — não regrediu. |
