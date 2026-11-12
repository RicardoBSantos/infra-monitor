# Modo TV (painel de parede) — desenho aprovado

Aprovado pelo responsável em 2026-11-12 (Etapa 1 da conversa; decisões pendentes 1, 2 e 3 aprovadas;
item 4 já resolvido: V26 e PRs #33–#38 estão em produção).

## Intenção

Uma TV na sala de TI mostra o sistema trocando de tela sozinha, em ciclo
(mapa → painel → incidentes → relatórios → …), com os dados rebuscados a cada minuto. O admin
configura o ciclo numa tela de Configurações do sistema (Administração); a TV obedece sem ninguém
tocar nela.

## Decisões do responsável (não reabrir)

- **D1** "Atualizar" = rebuscar os dados. Nunca `location.reload()`.
- **D2** A rotação existe só para quem entra no modo TV. Quem trabalha nunca tem a tela trocada.
- **D3** Configuração no banco (V27) e lida por API.
- **D4** Sessão: só avisar na tela quando cair. Sessão longa é item futuro — não implementar.
- **P1** TV com as telas montadas em paralelo, URL fixa em `/tv` (não rotação por troca de rota).
- **P2** Corrigir nesta feature o plano genérico das consultas de latência (D-07) com
  `plan_cache_mode = force_custom_plan` local à transação.
- **P3** A TV usa uma conta VISUALIZADOR dedicada (ato operacional do responsável; o código não cria usuário).

## Contrato de atualização

Cada uma das 4 telas expõe `recarregarDados(): void`, silencioso:
- não volta ao estado `loading` quando já há dado (sem esqueleto, sem piscar);
- troca o dado só quando a resposta chega; falha mantém o dado anterior;
- cada tela decide o que rebusca e o que tem validade longa.

| Tela | Rebusca a cada tique | Não rebusca / validade longa |
|---|---|---|
| Painel | resumo, unidades (dashboard), incidentes do banner | agregados de 30 d (disponibilidade e latência por unidade): 15 min; catálogo de tipos e cadastro: só ao montar |
| Mapa | `GET /dashboard/unidades`; remenda marcadores, conexões e pings no lugar | GeoJSON, `MaplibreMap`, câmera — nunca |
| Incidentes | lista + contadores com a janela deslizada até agora (preset relativo) | lista de unidades |
| Relatórios | aba Visão geral, últimas 24 h deslizantes (indicadores, top 5 disp. unidades, top 5 disp. equipamentos, top 5 latência) | listas de consulta; CSV/PDF nunca |

O uso manual não muda: `DashboardStateService.atualizar()` e o botão da topbar mantêm assinatura
e comportamento (põem `loading`).

## Modo TV

- Rota `/tv` no nível de cima, fora do `ApplicationShellComponent`, `canActivate: [businessGuard]`,
  qualquer papel.
- `TvComponent` monta as telas configuradas ao mesmo tempo; mostra uma; as outras ficam
  `visibility:hidden` + `inert`, empilhadas (nunca `display:none`: zera o container do MapLibre).
- Mapa nasce uma vez por sessão de TV. Pings pausam (rAF cancelado) enquanto o mapa está oculto.
- Timer: um `setTimeout` encadeado no componente; `DestroyRef` cancela tudo. Respostas de geração
  antiga são descartadas. Nada em serviço global, `localStorage` ou parâmetro.
- Escondido na TV: sidebar, topbar, breadcrumbs, filtros, botões de ação, exportação, paginação
  (atributo `data-tv-oculto` nos templates). Conteúdo da tela é `inert`.
- Moldura: nome da tela, relógio, "dados de HH:MM" (vira alerta "desatualizado desde HH:MM" quando a
  última atualização falhou), progresso da rotação, botão "Sair do modo TV" (único foco; vai a
  `/dashboard`). Sem atalhos de teclado.
- A TV relê a configuração a cada tique de atualização e aplica na próxima troca de tela. `ativo=false`
  → tela cheia "Modo TV desativado pelo administrador", continua relendo.
- Entrada: botão "Abrir modo TV" na tela de Configurações (nova aba) e URL `/tv` direta.

## Configuração (V27)

Uma linha só. Tabelas `configuracao_modo_tv` (id identity, `ativo`, `intervalo_atualizacao_segundos`
30..600, `atualizado_em`, `atualizado_por` FK usuarios; índice único `((true))`) e
`configuracao_modo_tv_tela` (`tela` ∈ MAPA/PAINEL/INCIDENTES/RELATORIOS, `ordem` ≥ 1,
`duracao_segundos` 10..3600, PK (configuracao_id, tela), UNIQUE (configuracao_id, ordem) deferrable).
Migration não insere linha. Padrões numa constante Java: ativo, 60 s, MAPA→PAINEL→INCIDENTES→RELATORIOS
com 60 s cada.

- `GET /api/v1/configuracoes/modo-tv`: ADMIN, OPERADOR, VISUALIZADOR. Sem linha → padrões com
  `persistida:false`.
- `PUT /api/v1/configuracoes/modo-tv`: só ADMIN (regra geral `/api/**`). Campo ausente/null
  preserva; `telas` presente substitui a lista; `telas: []` → 400. Wrappers, nunca primitivos.
  Primeiro PUT aplica sobre os padrões e faz upsert.
- Acesso por `JdbcTemplate`, sem entidade JPA: produção sobe com Flyway desligado. Tabela ausente →
  GET devolve padrões, PUT responde 503.

## Tela de Configurações

Página própria `/configuracoes` (Administração, `roleGuard` ADMIN), filhas no padrão de
`/notificacoes`: `''` → `modo-tv`. Cada configuração futura é uma rota filha com componente próprio e
um item na navegação da página. Seção Modo TV: estado (StatusBadge), interruptor ativo, intervalo
(`.campo-select`), lista das 4 telas (incluir, duração em `.campo-select`, ↑↓), "ciclo completo:
N min", Salvar (`.botao--primario`), Descartar e Abrir modo TV (`.botao`). Tokens `--im-*`.

## Sessão na TV

Quando o interceptor encerra a sessão com a URL em `/tv`, navega para
`/login?sessionExpired=1&origem=tv&returnUrl=/tv`; o login mostra faixa grande: "Modo TV parado: a
sessão encerrou às HH:MM. Entre novamente para retomar." Fora de `/tv`, comportamento atual.
Pendência registrada: sessão longa para TV.

## Plano genérico (D-07)

`select set_config('plan_cache_mode','force_custom_plan', true)` antes das consultas de latência:
`RelatorioService.latencia`, `RelatorioService.latenciaUnidades`, bloco de latência do
`VisaoGeralPdfRepository`, e o CSV de latência se rodar em transação.

## Fora de escopo

Sessão longa; perfis nomeados; configuração da aba/período de Relatórios; ferramentas de release
(`schemaVersion` 25 cravado em `deployment/windows` — registrar como pendência, não alterar).
