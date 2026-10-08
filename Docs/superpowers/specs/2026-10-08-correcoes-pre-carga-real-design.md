# Correções antes da carga real — desenho

Data: 2026-10-08. Branch: `fix/pre-carga-real` (a partir de `main` 9c8ec02).

## Regras de execução (valem para todas as tarefas)

- Banco de dev (`inframonitor-postgres`, 5434) **intocado**: nenhuma escrita, nenhum boot da
  aplicação apontando para ele (o Flyway roda no boot — foi assim que a V19 chegou lá).
- Motor nunca contra o dev. Telegram real nunca acionado: `.env` não é exportado,
  `TELEGRAM_ENABLED`, `NOTIFICATION_DISPATCHER_ENABLED` ficam no default `false`.
- E2E roda contra um Postgres **descartável** (`infra-e2e`, porta 5437) restaurado de
  `pg_dump` do dev (leitura pura), com motor desligado. Destruído ao final, com prova.
- Sem push, sem merge.

## Item 0 — limpeza e verificação (executado no brainstorming)

| Alvo | Destino | Perda |
|---|---|---|
| `feat/manutencao-equipamento` | Espaço espúrio em `MonitorExecutionCoordinator.java:73` descartado. O resto (n05 sem o anel removido pelo D17, evidências regeradas em 2026-09-22, scripts `e2e:n07`/`perf:mapa`, `e2e/perf-mapa/`, planos D18/D19, capturas `screenshots/mapa/d17-*`/`n07-*`) virou o commit `b239f9f` no branch novo. Branch apagado com `-d` (já contido em `main`). | Só o espaço. |
| `../infra-monitor-merge` | WIP do aviso de IBGE commitado em `feat/aviso-ibge-detalhe-unidade` (`aef8951`); worktree removido. Integrado nesta entrega (item 0b). | Nada. |
| `../infra-monitor-n01-spike` | WIP do spike commitado em `spike/n01-maplibre` (`43eff74`); worktree removido. Superado pela implementação em `main`. | Nada. |
| 7 containers parados (`r0321`, `r0332`, `r036`, `r042`, `r044`, `r045`, `a041`) | Removidos com volumes. Bancos efêmeros de homologação de agosto; só citados por roteiros e2e antigos (DV05) e docs de evidência. Nenhum compose os referencia. | Dados de homologação já registrados em docs. |

**V19 no dev.** Instalada em 2026-09-24 11:31:45 (`flyway_schema_history`, sucesso). Causa: a
aplicação subiu apontando para o dev e o Flyway aplicou a migration no boot — o diagnóstico de
backfill rodou corretamente na cópia, mas nada impedia o boot seguinte. Efeito nas 76 linhas:
`FECHAMENTO_MANUAL` = 1 (id 78, `fechado_por` = 1), `RECUPERACAO_AUTOMATICA` = 0, `NULL` = 75 —
idêntico ao previsto pela cópia. Nada além: contagens 76/317080/10/222/224/2 iguais à linha de
base pré-V19, maior `updated_at` de incidente = 2026-09-09, de qualquer tabela = 2026-09-17. Além
do backfill, a V19 escreveu só DDL (coluna e CHECKs em `incidente`/`monitor_episodio_latencia`,
`notificacao.tipo_evento` → `VARCHAR(40)`, CHECKs recriados). Não reverter: a V19 é a
migration oficial e o resultado bate com a cópia.

## Item 1 — Reabertura após fechamento manual

### Decisão de mecanismo

**Janela de monitoramento não é o mecanismo.** `DisponibilidadeSqlRepository.BASE` usa
`greatest(:inicio, j.inicio_em, min(md.executado_em))` como início efetivo de cada janela. Fechar
e reabrir a janela no fechamento manual criaria, a cada fechamento, um buraco entre o instante do
fechamento e a primeira medição seguinte (um ciclo, ~30–60 s): o denominador do SLA encolheria por
um período que continuou observado. Inaceitável. Além disso a janela tem invariante própria
("aberta ⇔ monitor é candidato a execução") que o fechamento manual não altera.

**Âncora escolhida:** início da observação vigente =
`max(janela_aberta.inicio_em, updated_at do incidente FECHADO mais recente do monitor)`.

- `updated_at` do incidente fechado = instante em que o fechamento foi gravado (os três CAS de
  fechamento escrevem `updated_at = :agora`). `FECHADO` é terminal: nenhum endpoint escreve num
  incidente fechado, então o valor é estável. Não usar `encerrado_em`: no fechamento manual ele vem
  do corpo da requisição e aceita data retroativa — retroativo reabriria na hora.
- Vale para os três motivos sem ramificar: na recuperação automática a âncora cai depois das
  falhas (não muda nada); na manutenção a janela nova já é posterior; no fechamento manual é a
  correção.
- Sem migration.

Consequência para o SLA (intencional, decorre da decisão do usuário): entre o fechamento manual e a
3ª falha nova o monitor conta como disponível; o incidente novo nasce com `iniciado_em` = 1ª falha
nova. O denominador não muda.

### Componentes

- `IncidenteRepository.ultimoFechamentoRegistrado(monitorId): Optional<Instant>` —
  `select max(i.updatedAt) ... status = FECHADO`.
- `monitoring/InicioDaObservacao` (componente, dois consumidores reais):
  `Optional<Instant> doMonitor(Long monitorId)` → vazio sem janela aberta; senão o `max` acima.
- `IncidentProcessor.processarAbertura`: troca a leitura direta da janela por
  `InicioDaObservacao`; mesma regra que já vale para a janela — medição com `executadoEm` anterior
  à âncora não sustenta abertura. Um único critério para as duas origens da âncora (empate no mesmo
  microssegundo da gravação é irrelevante na prática). Comentário atualizado.
- `LatencyEpisodeProcessor.processarAbertura`: **mesmo defeito, maior.** Hoje não tem âncora
  nenhuma: ao sair da manutenção, a cauda congelada abre episódio com `iniciado_em` anterior à
  manutenção; depois de um incidente fechado, sucessos acima do limiar medidos durante o incidente
  abrem episódio com início dentro dele. Passa a usar `InicioDaObservacao` igual ao incidente.

### Testes

- Unitários (padrão `CaudaCongeladaTest`): cauda de 3 falhas anterior ao fechamento manual não
  abre; 3 falhas novas abrem com `iniciadoEm` = 1ª nova; 2 novas + 1 antiga não abrem; episódio de
  latência idem (manutenção e incidente fechado).
- **Prova de reversão com Postgres real** (Testcontainers, padrão
  `FechamentoManualConcorrenciaPostgresIntegrationTest`): alvo "fora do ar" simulado por medições
  `FALHA` persistidas e `IncidentProcessor.process` real; incidente aberto → fechamento manual pelo
  `IncidenteService.fechar` → 1ª e 2ª falhas novas: nenhum incidente aberto → 3ª: abre, com
  `iniciado_em` = 1ª nova. Rodado também com a correção revertida (falha esperada registrada em
  evidência) e restaurada.

## Item 2 — Linha do tempo

- `timeline.ts` ramifica por `motivoEncerramento`:
  - `RECUPERACAO_AUTOMATICA`: "Incidente fechado" + "N respostas consecutivas restabeleceram o
    monitor" + eventos de recuperação (como hoje).
  - `FECHAMENTO_MANUAL`: "Encerrado manualmente" + "por {fechadoPorNome}. Nenhuma recuperação foi
    medida." Sem eventos de recuperação (guarda explícita, não depender de não casar o instante).
  - `MANUTENCAO`: como hoje.
  - `null` (pré-V19): só afirma o que o dado prova — `fechadoPorNome` presente → texto manual;
    sequência de recuperação encontrada → texto automático; senão "Incidente fechado" sem detalhe.
  - `OcorrenciaTimeline` ganha `fechadoPorNome`.
- Medições: a timeline usa só as medições em `[iniciadoEm, encerradoEm ?? agora]`. A folga continua
  carregada para o gráfico (contexto visual), mas não vira evento.
- Layout: "Encerrado por manutenção" sobreposto à descrição — corrigido no SCSS da timeline
  (rótulo e detalhe não podem disputar a mesma célula; quebra em linha própria quando não cabe).
- Testes: unitários em `timeline.spec.ts` para os três motivos + legado + recorte das medições;
  e2e Playwright por clique abrindo um incidente de cada motivo, com capturas.

## Item 3 — Mensagem de fechamento manual

`NotificacaoMessageBuilder.construir`, `INCIDENTE_FECHADO` com
`motivoEncerramento == FECHAMENTO_MANUAL`: cabeçalho `INCIDENTE ENCERRADO MANUALMENTE` e linha
`Encerrado por: {nome}` logo após `Duracao`. Autor nulo (não deve ocorrer) → `Encerrado por:
operador nao identificado`. Recuperação automática mantém `INCIDENTE ENCERRADO`. Grafo de
`obterIncidente` já carrega `fechadoPor`. Testes sobre o texto completo das três variantes.

## Item 4 — Detalhes de tela

- **Decimal pt-BR.** Não há `LOCALE_ID` nem `registerLocaleData` no frontend (confirmado).
  Registrar `pt-BR` em `app.config.ts`. Um módulo `core/format/numero.ts` com
  `formatarDecimal`/`formatarPercentual` (`Intl.NumberFormat('pt-BR')`) substitui os `toFixed` de
  exibição (Relatórios: disponibilidade e latência média; gaveta de equipamento) e as duas
  constantes `PERCENTUAL` duplicadas. `toFixed` de coordenada SVG fica. PDF da Visão Geral
  (`VisaoGeralPdfRenderer` linhas 118/123) passa a vírgula. **CSV mantém ponto** (dado para
  máquina, delimitador vírgula) — registrado na doc.
- **Plural.** `core/format/plural.ts` (`plural(n, 'unidade', 'unidades')`). Aplicar em "N unidades
  afetadas" e em todas as ocorrências do mesmo padrão (painel, login, mapa, monitores, lista de
  unidades) — varredura por grep de `{{ … }} <substantivo>`.
- **Zero não é alerta.** Gaveta de equipamento (`corPerda`, `corIncidentes`) e gaveta de
  incidente (`corFalhas`, `corAcimaDoLimiar`): zero → neutro; tom só para valor > 0. Comentário
  que dizia "zero inclusive" corrigido.
- Testes unitários dos formatadores e das classes de cor; e2e por clique com capturas do Painel,
  Relatórios e gaveta.

## Item 5 — Latência sub-milissegundo (só dívida)

`Docs/validacao-producao/divida-latencia-sub-milissegundo.md`: `medicao.latencia_ms INTEGER`
grava RTT < 1 ms como 0. Opções: `NUMERIC(10,3)` em ms, ou `latencia_us BIGINT`. Impacto: migration
nova (sem editar antigas) e conversão, `Medicao`/DTOs, SQL de relatório (`avg`, limiar de
episódio `> limiar_ms`), CSV/PDF, gráficos e timeline do front, parser do ping e runner nativo
Windows (que já devolve RTT inteiro em ms — teria de mudar a fonte).

## Item 0b — Aviso de IBGE no detalhe da unidade

Integrar `feat/aviso-ibge-detalhe-unidade`. Investigar por que o e2e falhou (ITA-09 sem
`.aviso-ibge`) com systematic-debugging; só fica se o e2e passar no banco descartável. Se a causa
for dado (dev mudou), ajustar o roteiro com evidência; se for código, corrigir.

## Fechamento

Suítes completas backend (`./mvnw test`) e frontend (`ng test`) com contagens, `ng build`
produção, e2e novos verdes, e `Docs/validacao-producao/` atualizado no mesmo commit final
(`correcoes-pre-carga-real.md` + índice em `validacao-producao.md`).
