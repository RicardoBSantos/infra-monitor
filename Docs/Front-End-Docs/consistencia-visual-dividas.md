# Consistência visual — dívidas registradas

Registro das rodadas 1 (2026-10-20) e 2 (2026-10-21). Itens conscientemente fora de escopo.

| # | Dívida | Onde | Por que ficou |
|---|---|---|---|
| CV1 | 17 valores distintos de `max-width` em media query (400…1280), sem escala de pontos de quebra | SCSS das telas | Projeto de layout; medir com `npm run e2e:overflow` antes de mexer |
| CV2 | Escala tipográfica: 19 tamanhos (9–48px), nenhum por token | SCSS em geral | Projeto de design, rodada própria |
| CV3 | Escala de espaçamento: 31 valores, muitos fora da grade de 4px; `--im-space-*` quase sem uso | SCSS em geral | Idem |
| CV4 | Topbar estoura em ≤1366px | ver DV18 em `Docs/mapa-architecture/mapa-dividas.md` | Já registrada |
| CV5 | `.tipos__abas` (filtro em pílula) e abas-filtro do Painel/Incidentes sem semântica de tab | Tipos, Painel, Incidentes | São filtros, não abas; decidir padrão de "segmento" |
| CV6 | `<a class="botao botao--primario">+ Novo equipamento` é link de criação | detalhe da unidade, aba Equipamentos | Criação mantém primário mesmo navegando |
| CV7 | Aviso de sucesso duplicado: `.equipamentos__aviso`, `.tipos__aviso`, `.monitor-page__nota`, `.notice` de Usuários | 4 telas | Candidato a primitiva futura |
| CV8 | Abas de Relatórios ativam com as setas (ativação automática) e cada uma dispara uma consulta não cancelada | Relatórios | Avaliar ativação manual ou `switchMap` |
