# Correções antes da carga real

Data: 2026-10-08. Branch: `fix/pre-carga-real` (a partir de `main` 9c8ec02). Sem push, sem merge.

> **Situação posterior:** mesclado na `main` pelo PR #3 em 2026-10-09 (`22f5a95`).

Desenho: [2026-10-08-correcoes-pre-carga-real-design.md](../superpowers/specs/2026-10-08-correcoes-pre-carga-real-design.md).
Dívida registrada à parte: [divida-latencia-sub-milissegundo.md](divida-latencia-sub-milissegundo.md).

Regras de execução: banco de dev (`inframonitor-postgres`, 5434) sem escrita e sem boot da
aplicação apontando para ele; motor nunca contra o dev; Telegram real nunca acionado (`.env` não
exportado, `TELEGRAM_ENABLED`, `NOTIFICATION_DISPATCHER_ENABLED` e `MONITORING_ENGINE_ENABLED` no
default `false`); e2e contra um Postgres descartável restaurado de `pg_dump` (leitura pura).
Nenhuma migration nova.

## Item 0 — limpeza e verificação da V19

| Alvo | Destino | Perda |
|---|---|---|
| `feat/manutencao-equipamento` | Espaço espúrio em `MonitorExecutionCoordinator.java:73` descartado. O resto (n05 sem o anel removido pelo D17, evidências regeradas em 2026-09-22, scripts `e2e:n07`/`perf:mapa`, `e2e/perf-mapa/`, planos D18/D19, capturas `screenshots/mapa/d17-*`/`n07-*`) virou o commit `b239f9f` no branch novo. Branch apagado com `-d` (já contido em `main`). | Só o espaço. |
| `../infra-monitor-merge` | WIP do aviso de IBGE commitado em `feat/aviso-ibge-detalhe-unidade` (`aef8951`); worktree removido. Integrado nesta entrega (ver "Aviso de IBGE"). | Nada. |
| `../infra-monitor-n01-spike` | WIP do spike commitado em `spike/n01-maplibre` (`43eff74`); worktree removido. Superado pela implementação em `main`. | Nada. |
| 7 containers parados (`r0321`, `r0332`, `r036`, `r042`, `r044`, `r045`, `a041`) | Removidos com volumes. Bancos efêmeros de homologação de agosto; só citados por roteiros e2e antigos (DV05) e docs de evidência. Nenhum compose os referencia. | Dados de homologação já registrados em docs. |

### V19 no dev

Instalada em **2026-09-24 11:31:45** (`flyway_schema_history`, sucesso). Causa: a aplicação subiu
apontando para o dev e o Flyway aplicou a migration no boot. O diagnóstico de backfill
([manutencao-backfill-diagnostico.md](manutencao-backfill-diagnostico.md)) rodou corretamente na
cópia, mas nada impedia o boot seguinte.

Verificação (somente `SELECT` no dev):

| Verificação | Resultado |
|---|---|
| `flyway_schema_history`, versão mais alta e data de instalação da V19 | 19, 2026-09-24 11:31:45, sucesso |
| `motivo_encerramento` nos 76 incidentes | `FECHAMENTO_MANUAL` = 1 (id 78, `fechado_por` = 1), `RECUPERACAO_AUTOMATICA` = 0, `NULL` = 75 |
| Contagens incidente / medicao / notificacao / equipamento / janela_monitoramento / monitor_episodio_latencia | 76 / 317080 / 10 / 222 / 224 / 2, iguais à linha de base pré-V19 |
| Maior `updated_at` de incidente | 2026-09-09 |
| Maior `updated_at` de qualquer tabela | 2026-09-17 |

O resultado é idêntico ao previsto pela cópia. Além do backfill, a V19 escreveu só DDL: coluna e
CHECKs em `incidente` e `monitor_episodio_latencia`, `notificacao.tipo_evento` → `VARCHAR(40)` e
CHECKs recriados. **Não reverter**: a V19 é a migration oficial e o resultado bate com a cópia.

## Reabertura após fechamento manual

Problema: depois que um operador fechava um incidente à mão com o alvo ainda fora do ar, a "cauda"
de falhas anteriores ao fechamento reabria o incidente na primeira medição seguinte.

**Decisão do usuário e âncora.** O início da observação vigente é
`max(início da janela aberta, updated_at do incidente FECHADO mais recente do monitor)`.
Componente `monitoring/InicioDaObservacao` (consulta
`IncidenteRepository.ultimoFechamentoRegistrado`), usado por `IncidentProcessor` e
`LatencyEpisodeProcessor`. Medição anterior à âncora não sustenta abertura.

- **Por que `updated_at` e não `encerrado_em`:** no fechamento manual `encerrado_em` vem do corpo da
  requisição e aceita data retroativa; retroativo reabriria na hora. O `updated_at` é o instante
  em que o fechamento foi gravado (os três CAS escrevem `updated_at = :agora`), e `FECHADO` é
  terminal, então o valor é estável.
- **Por que a janela de monitoramento não é o mecanismo:** `DisponibilidadeSqlRepository.BASE` usa
  `greatest(:inicio, j.inicio_em, min(md.executado_em))` como início efetivo de cada janela. Fechar
  e reabrir a janela a cada fechamento manual criaria um buraco entre o fechamento e a primeira
  medição seguinte (um ciclo, 30 a 60 s): o **denominador do SLA** encolheria por um período que
  continuou observado. Inaceitável.
- **Consequência intencional para o SLA:** entre o fechamento manual e a 3ª falha nova o monitor
  conta como disponível; o incidente novo nasce com `iniciado_em` = 1ª falha nova. O denominador não
  muda.
- Vale para os três motivos sem ramificar: na recuperação automática a âncora cai depois das
  falhas; na manutenção a janela nova já é posterior; no fechamento manual é a correção.
  Na latência a recuperação automática não é neutra: as respostas da sequência de recuperação têm
  `executadoEm` anterior ao `updated_at` do fechamento, então não contam; um episódio logo após a
  recuperação só nasce depois de `ciclos` medições novas acima do limiar.

**Latência (mesmo defeito, maior).** `LatencyEpisodeProcessor` não tinha âncora nenhuma: ao sair da
manutenção, a cauda congelada abria episódio com `iniciado_em` anterior à manutenção; depois de um
incidente fechado, sucessos acima do limiar medidos durante o incidente abriam episódio com início
dentro dele. Passou a usar a mesma `InicioDaObservacao`.

**Prova de reversão** (Postgres real, Testcontainers,
`ReaberturaAposFechamentoManualPostgresIntegrationTest`): sem a correção, 2 testes falham ("1ª
falha nova" abre incidente imediatamente; o retroativo também) — evidência em
[evidencias/reabertura-1-sem-correcao.txt](evidencias/reabertura-1-sem-correcao.txt). Com a correção,
19 testes verdes (Reabertura 2, `IncidentProcessorTest` 8, `InicioDaObservacaoTest` 4,
`CaudaCongeladaTest` 2, `AberturaCondicionalTest` 3) — evidência em
[evidencias/reabertura-2-com-correcao.txt](evidencias/reabertura-2-com-correcao.txt).

Commits: `08b7974` (incidente), `8fc245e` (latência).

## Linha do tempo por motivo de encerramento

`features/incidentes/timeline/timeline.ts` ramifica por `motivoEncerramento`:

| Motivo | Título | Detalhe |
|---|---|---|
| `RECUPERACAO_AUTOMATICA` | "Incidente fechado" | "N respostas consecutivas restabeleceram o monitor" + eventos de recuperação |
| `FECHAMENTO_MANUAL` | "Encerrado manualmente" | "por {nome}. Nenhuma recuperação foi medida." Sem eventos de recuperação (guarda explícita) |
| `MANUTENCAO` | "Encerrado por manutenção" | como antes |
| `null` (pré-V19) | só o que o dado prova | `fechadoPorNome` presente: texto manual; sequência encontrada: texto automático; senão "Incidente fechado" sem detalhe |

A timeline usa só as medições em `[iniciadoEm, encerradoEm ?? agora]`; a folga continua carregada
para o gráfico, mas não vira evento. Layout corrigido no SCSS: "Encerrado por manutenção" estava
sobreposto ao detalhe (a quarta coluna `auto` esmagava a terceira, largura 0 do rótulo); agora são
três colunas, detalhe alinhado em `grid-column: 3`, `overflow-wrap: anywhere`. Verificação: asserção
automática de não sobreposição só em 1440 px/tema escuro (`pre-carga-timeline-e-tela.cjs`); 390 px e
tema claro conferidos por captura (`00-timeline-depois-*`); o defeito antigo está mostrado em
`00-timeline-antes-*`. Não há execução registrada do roteiro falhando com o SCSS antigo.

Decisão registrada: o texto "N respostas consecutivas…" aparece para `RECUPERACAO_AUTOMATICA` mesmo
que o recorte de histórico não liste a sequência, porque o motivo é fato gravado pelo motor.
**Revertida em 2026-10-09:** a timeline só cita N quando a sequência inteira está listada; ver
[rodada-curta-pre-carga.md](rodada-curta-pre-carga.md#item-1--a-timeline-só-afirma-o-que-lista).

Commits: `565b7d5`, `fd51987` (SCSS e e2e).

## Mensagem de fechamento manual (Telegram)

`NotificacaoMessageBuilder`, `INCIDENTE_FECHADO` com `FECHAMENTO_MANUAL`: cabeçalho
`INCIDENTE ENCERRADO MANUALMENTE` e linha `Encerrado por: {nome}` logo após `Duracao`. Autor nulo
(não deve ocorrer): `Encerrado por: operador nao identificado`. Recuperação automática mantém
`INCIDENTE ENCERRADO`. Testes sobre o texto das três variantes. Commit `7ae6c68`.

## Decimal pt-BR

- `pt-BR` registrado em `app.config.ts` (`registerLocaleData` + `LOCALE_ID`); `core/format/numero.ts`
  (`formatarDecimal`, `formatarPercentual`) substitui os `toFixed` de exibição (Relatórios, gaveta
  de equipamento, Painel, unidade) e as constantes `PERCENTUAL` duplicadas. `toFixed` de coordenada
  SVG fica.
- PDF da Visão Geral (`VisaoGeralPdfRenderer`): helper `duasCasas()` com vírgula (`87,35%`,
  `55,56 ms`); teste afirma presença da vírgula e ausência do ponto. Commit `c528d9f`.
- **CSV mantém ponto**, de propósito: é dado para máquina (planilha, importação) e o delimitador é a
  vírgula; trocar o separador decimal para vírgula quebraria o parse ou exigiria aspas em todo
  campo numérico. `CsvWriter` e `RelatorioExportService` não foram tocados.

## Plural

`core/format/plural.ts` (`plural(n, 'unidade', 'unidades')`). Ocorrências trocadas:

- Painel (`dashboard.component.html` e `.ts`, incluindo "+N incidente(s)"), login, topbar, mapa
  (`.html` e rótulos em `.ts`), monitores, lista de unidades (incluindo mensagens de
  exclusão/desativação), lista de equipamentos, tipos de equipamento, abas da unidade
  (equipamentos, monitorados/ativos), notificações, medições, gaveta de equipamento (timeouts),
  Relatórios (monitorados), lista unificada de incidentes ("ocorrência(s)"), configurações da unidade
  ("1 dispositivo vinculado").
- Textos de timeline: "1 medição consecutiva … encerrou" e "1 resposta consecutiva restabeleceu o
  monitor".
- "do 1 dispositivo" virou "do único dispositivo". Não tocados: constantes ("janela de N dias",
  "últimos N minutos") e "ms".
- Specs ajustadas para o texto novo e testes de singular adicionados.

Limite conhecido: a varredura foi por regex de template; contagens montadas em TS com outras formas
podem ter escapado. Commits `1615f58`, `0d0de52`.

## Zero não é alerta

Gaveta de equipamento (`corPerda`, `corIncidentes`) e gaveta de incidente (`corFalhas`,
`corAcimaDoLimiar`, `corPico`): zero fica neutro; tom só para valor > 0. **Inclui o pico de 0 ms**
(RTT sub-ms grava 0 no servidor real; o caso não é teórico, ver
[divida-latencia-sub-milissegundo.md](divida-latencia-sub-milissegundo.md)). Comentários que diziam
"zero inclusive" foram corrigidos. Commits `b688b22`, `2f71583`.

## Aviso de IBGE no detalhe da unidade

`feat/aviso-ibge-detalhe-unidade` integrado (commit `710e07c`). O e2e antigo falhava em 2026-09-24
(ITA-09 sem `.aviso-ibge`). **A falha não foi reproduzida**: o e2e passou na primeira execução
contra o ambiente descartável, e de novo depois das mudanças. Dado conferido no banco descartável:
id 5 `Sesc Itabaiana` com código `2803005` e coordenada dentro do polígono de Itabaiana (`2802908`),
divergente; id 1 `Sede Administrativa` `2800308`, coerente (Aracaju). A **causa da falha antiga
permanece não comprovada**; a hipótese é que o roteiro apontava para a porta 4300, que não servia
este código (o aviso só entrou em 2026-10-08), mas não há log daquela execução. Nenhuma correção de
código foi necessária. O e2e ganhou espera pela malha carregada e um sinal positivo antes de afirmar
a ausência (`de4671d`); o sinal positivo é um proxy, não prova a ausência por si.

## Seed do e2e: guarda de banco descartável

`e2e/pre-carga-seed.sql` aborta se `current_setting('app.banco_descartavel', true)` não for `sim`. O
marcador é gravado só no `infra-e2e`, uma vez, depois de restaurar o dump:
`docker exec infra-e2e psql -U inframonitor -d postgres -c "ALTER DATABASE inframonitor SET app.banco_descartavel = 'sim'"`
(vale para conexões novas). Os DELETEs só removem o que o seed grava: incidente/medição com a marca
`e2e-pre-carga` e o episódio de latência com a assinatura exata do seed (`limiar_ms = 250`,
`created_at = iniciado_em`, `encerrado_em = iniciado_em + 90 s`).

## Evidências

- Backend: [reabertura-1-sem-correcao.txt](evidencias/reabertura-1-sem-correcao.txt),
  [reabertura-2-com-correcao.txt](evidencias/reabertura-2-com-correcao.txt).
- E2E de tela (`npm run e2e:pre-carga`, 17/17):
  `infra-monitor-frontend/e2e/pre-carga-evidence/` (capturas `00-timeline-antes-*` e
  `00-timeline-depois-*`, `01` a `07`, `final.png`, `pre-carga-timeline-e-tela.json`). Casos:
  três motivos de encerramento por clique, Painel ("1 unidade afetada", "99,98%"), Relatórios (20
  percentuais com vírgula), gaveta de equipamento e de latência com zero neutro.
- E2E do aviso de IBGE: `infra-monitor-frontend/e2e/unidade-detalhe-evidence/`
  (`01-ita09-aviso.png`, `02-aracaju-sem-aviso.png`, JSON).
- Ambiente descartável `infra-e2e` (porta 5437) restaurado de `pg_dump` do dev, com motor e
  Telegram desligados; destruído ao final. Controle no dev antes e depois, idêntico:
  `76|317080|10|222|224|2|1|19` (incidente, medição, notificação, equipamento, janela, episódio,
  usuários, Flyway máximo).

## Suítes e build finais

| Comando | Resultado |
|---|---|
| `cd infra-monitor-backend && ./mvnw test` | **Tests run: 590, Failures: 0, Errors: 0, Skipped: 0 — BUILD SUCCESS** (Docker disponível, testes Postgres rodaram) |
| `cd infra-monitor-frontend && npx ng test --watch=false` | **49 arquivos, 413 testes, todos passando** |
| `npx ng build` (produção) | sucesso; bundle inicial **351,96 kB** bruto / **97,42 kB** transferido (`styles` 31,18 kB, `main` 30,12 kB, mais os chunks iniciais) |

Aviso de budget (único, preexistente, confirmado na Task 5 via stash):

```
▲ [WARNING] src/app/features/mapa/mapa.component.scss exceeded maximum budget. Budget 6.00 kB was not met by 89.78 kB with a total of 95.78 kB.
```

## Decisões do produto que valem registrar

1. Âncora de reabertura = `updated_at` do último incidente `FECHADO` (não `encerrado_em`).
2. Janela de monitoramento não é usada, por causa do denominador do SLA.
3. CSV mantém ponto decimal; tela e PDF usam vírgula.
4. Zero é neutro nas duas gavetas, inclusive o pico de 0 ms.
5. Falha antiga do e2e de IBGE não reproduzida; causa não comprovada.

## Pendências menores (não bloqueiam)

- Incidente fechado manualmente: ping iniciado antes do fechamento e processado depois não conta
  (conservador, não documentado em código).
- Invariante "FECHADO é terminal" só em comentário; um `@PreUpdate` moveria a âncora se surgir
  edição de incidente fechado.
- Sem teste Postgres dos casos negativos de latência e do texto de fechamento manual via CAS.
- Texto do aviso de IBGE duplicado entre mapa e visão geral.
- Topbar mostra "0 degradados" onde antes ficava vazio.
