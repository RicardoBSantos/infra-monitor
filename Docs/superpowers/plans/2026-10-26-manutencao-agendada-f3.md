# Manutenção agendada F3 — Telegram da janela e do botão manual — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Anunciar no Telegram início, fim e alteração de fim das janelas de manutenção e o liga/desliga do botão manual, com histórico manual no drawer e todas as mensagens em horário local.

**Architecture:** V23 adiciona `manutencao_manual` (sessão do botão) e duas âncoras explícitas em `notificacao`. A notificação é inserida na transação do CAS da janela ou do lock do equipamento; o dispatcher continua assíncrono, ganha ordem por âncora e um log que não assume incidente. O texto sai de um `NotificacaoMessageBuilder` com fuso configurado.

**Tech Stack:** Java 21, Spring Boot 4.1, Spring Data JPA + `NamedParameterJdbcTemplate`, PostgreSQL 16, Flyway, Testcontainers (`@RequerDocker`), Angular (signals, standalone), Karma/Jasmine via `ng test`, Playwright (`e2e/*.cjs`).

**Spec:** `Docs/superpowers/specs/2026-10-26-manutencao-agendada-f3-design.md` (MA27–MA36). Leia antes de qualquer tarefa; o texto exato das mensagens está no §3 do spec.

## Global Constraints

- Worktree: `C:\Users\rbfilho\Documents\infra-monitor-wt-f3`, branch `feat/manutencao-f3`. **Nunca** compilar/rodar no checkout `C:\Users\rbfilho\Documents\infra-monitor` (a 8080 do usuário roda o `target/classes` de lá).
- **Nunca** conectar no banco da carga (127.0.0.1:5436) para escrever, nem derrubar a 8080/4200. A V23 não é aplicada lá.
- Migration nova `V23__add_notificacao_manutencao_e_manutencao_manual.sql`; nenhuma migration antiga editada.
- Sem Lombok; sem `BaseX`; `Instant`/Java Time; erros no formato `ErroResposta`; prefixo `/api/v1`.
- `@AuthenticationPrincipal UsuarioPrincipal` (nunca `Usuario`).
- Classe de teste com `PostgreSQLContainer` leva `@RequerDocker`. Contagem do backend só vale sem o aviso `!!` no fim.
- Corridas: duas threads, `CyclicBarrier`, `@RepeatedTest(30)`, atraso aleatório calibrado, imprime `[corrida-<nome>] desfecho=<ROTULO>`, `ILEGITIMO` falha; reversão de cada guarda registrada no doc de validação.
- Fuso: `@Value("${app.reports.timezone:America/Sao_Paulo}")`; formato `dd/MM/yyyy HH:mm`; rodapé `Horários: UTC-03:00 (America/Sao_Paulo)` (offset do instante de referência; `Z` vira `UTC+00:00`).
- Commits só com os arquivos da tarefa: `git commit -- <arquivos>` (index compartilhado entre agentes paralelos). Mensagem termina com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Backend: comandos a partir de `infra-monitor-backend/` com `./mvnw`. Front: a partir de `infra-monitor-frontend/`, `npx ng test --watch=false`, `npx ng build`.
- Componentes/primitivas compartilhados no front; `.skeleton` exige o `@use` (memória); `.campo-select` exige wrapper `<span>`.

## Review Focus

1. Mesma janela concluída duas vezes (job e pessoa) → um único `MANUTENCAO_ENCERRADA`; o índice parcial é a prova (Task 5 `encerramentoDuplicadoNaoGeraSegundaLinha`).
2. Equipamento excluído entre a ativação e o anúncio, ou unidade sem equipamentos → mensagem com "nenhum equipamento cadastrado"/contagem 0, nunca exceção que desfaça o CAS (Task 7 `inicioDeUnidadeVaziaAnunciaZero`).
3. Usuário criador da janela desativado → nome ainda sai (`usuarios.nome` não depende de `ativo`) (Task 7 `criadorDesativadoAindaApareceNoTexto`).
4. Encerrar manual de equipamento sem sessão aberta (dado antigo divergente) → 200, flag desligado, log `warn`, zero notificação (Task 6 `encerrarSemSessaoAbertaNaoNotifica`).
5. Virada de dia no fuso (02:30Z = 23:30 do dia anterior) e duração > 24 h → data local certa e `25h 0m 0s` (Task 3 `viradaDeDiaUsaDataLocal`, Task 4 `duracaoAcimaDeUmDia`).

---

### Task 1: V23, entidades e enum

**Files:**
- Create: `infra-monitor-backend/src/main/resources/db/migration/V23__add_notificacao_manutencao_e_manutencao_manual.sql`
- Create: `infra-monitor-backend/src/main/java/br/com/inframonitor/equipamento/entity/ManutencaoManual.java`
- Modify: `.../notificacao/entity/TipoEventoNotificacao.java`, `.../notificacao/entity/Notificacao.java`
- Test: `infra-monitor-backend/src/test/java/br/com/inframonitor/notificacao/NotificacaoAncorasManutencaoPostgresIntegrationTest.java`

**Interfaces:**
- Produces: `TipoEventoNotificacao.{MANUTENCAO_INICIADA, MANUTENCAO_ENCERRADA, MANUTENCAO_FIM_ALTERADO, MANUTENCAO_MANUAL_INICIADA, MANUTENCAO_MANUAL_ENCERRADA}`; `Notificacao.getManutencaoAgendada(): ManutencaoAgendada`, `getManutencaoManual(): ManutencaoManual` (ManyToOne LAZY, `@JoinColumn` normal como as duas âncoras atuais; a escrita continua só pelo INSERT nativo); `Notificacao.descreverAncora(): String` → `"incidente=12"`, `"episodioLatencia=3"`, `"manutencao=41"`, `"manutencaoManual=7"`; entidade `ManutencaoManual` (`id`, `equipamento` ManyToOne LAZY, `iniciadaEm` Instant nulável, `iniciadaPor` Usuario nulável, `encerradaEm`, `encerradaPor`; só getters; protected ctor).

- [ ] **Step 1: Teste de integração vermelho** — `@RequerDocker @SpringBootTest` (mesmas properties de `ManutencaoAgendadaConcorrenciaPostgresIntegrationTest`), inserindo por `JdbcTemplate`:
  - `ancoraDuplaRecusada`: notificação com `incidente_id` e `manutencao_agendada_id` → `DataIntegrityViolationException` com `ck_notificacao_ancora_exclusiva`.
  - `eventoDeJanelaExigeAncoraDeJanela`: `MANUTENCAO_INICIADA` com `manutencao_manual_id` → viola `ck_notificacao_evento_coerente`.
  - `inicioUnicoPorJanela`: dois `MANUTENCAO_INICIADA` mesma janela/canal → segundo viola `uq_notificacao_manutencao_evento`; dois `MANUTENCAO_FIM_ALTERADO` → ambos entram.
  - `sessaoAbertaUnicaPorEquipamento`: duas sessões com `encerrada_em NULL` mesmo equipamento → viola `uq_manutencao_manual_aberta`; fechada + aberta entram.
  - `legadoSemInicioSoSemAutor`: `iniciada_em NULL` com `iniciada_por_id` preenchido → viola `ck_manutencao_manual_legado`.
  - `backfillCriaSessaoSemInicio`: impossível pós-boot; testar o SQL do backfill rodando o `INSERT ... SELECT` do arquivo contra um equipamento com `manutencao_manual = true` e conferir `iniciada_em IS NULL AND iniciada_por_id IS NULL`.
  - `entidadesMapeiamColunas`: o contexto sobe com `ddl-auto: validate` (o próprio boot prova) e `notificacaoRepository.findById` de uma linha de janela devolve `getManutencaoAgendada().getId()`.
- [ ] **Step 2:** `./mvnw -q test -Dtest=NotificacaoAncorasManutencaoPostgresIntegrationTest` → FAIL (V23 inexistente).
- [ ] **Step 3: V23** exatamente como o §1 do spec (DDL completa lá), com FKs nomeadas `fk_notificacao_manutencao_agendada`, `fk_notificacao_manutencao_manual`, comentário de cabeçalho no estilo da V21/V22. Recriar `ck_notificacao_evento_coerente` preservando literalmente os dois ramos da V19:77-81.
- [ ] **Step 4:** enum, entidade, campos em `Notificacao` e `descreverAncora()`.
- [ ] **Step 5:** teste verde + `./mvnw -q test -Dtest='Notificacao*'` verde.
- [ ] **Step 6:** commit `feat(notificacao): V23 com ancoras de manutencao e sessao do botao manual`.

### Task 2: Log do dispatcher sem assumir incidente (ajuste 3)

**Files:**
- Modify: `.../notificacao/dispatcher/NotificationDispatcher.java:67-70`
- Test: `.../test/.../notificacao/dispatcher/NotificationDispatcherTest.java`
- Create: `Docs/validacao-producao/manutencao-f3-auditoria-enums.md` (seção "Dispatcher, sender, telegram")

**Interfaces:** Consumes `Notificacao.descreverAncora()` (Task 1).

- [ ] **Step 1: Testes vermelhos** com `@ExtendWith(OutputCaptureExtension.class)`:
  - `envioDeLatenciaNaoLogaErroInterno`: `Notificacao` construída com `MonitorEpisodioLatencia` mock (id 3), sender devolve sucesso → `output` não contém `"Erro interno ao processar notificacao"`, contém `"Telegram enviado: notificationId="` e `"ancora=episodioLatencia=3"`; `stateService.complete` chamado **uma** vez (`verify(stateService, times(1)).complete(eq(id), any())`).
  - `falhaDeLatenciaLogaAncora`: sender falha → `"Telegram falhou"` e `"ancora=episodioLatencia=3"`, sem "Erro interno".
  - `envioDeJanelaNaoLogaErroInterno`: mesmo, com âncora de janela (`ReflectionTestUtils` para setar `manutencaoAgendada` se não houver ctor público; ou ctor package-private de teste — escolha do implementador, sem ctor público novo só para teste).
- [ ] **Step 2:** rodar → FAIL. **Registrar a saída vermelha** (trecho com o NPE/"Erro interno") para o doc de validação (Task 11).
- [ ] **Step 3:** trocar `incidentId={}` + `getIncidente().getId()` por `ancora={}` + `notification.descreverAncora()` nos dois logs.
- [ ] **Step 4:** verde. Reverter a correção localmente, rodar, ver vermelho, desfazer a reversão (prova de reversão; anotar).
- [ ] **Step 5: Auditoria** — ler `notificacao/dispatcher/*`, `notificacao/sender/*`, `notificacao/telegram/*` e `NotificacaoController`/`NotificacaoTelegramController`: listar cada `getIncidente()`/`incidente_id` com classificação "muda/não muda + por quê" no doc.
- [ ] **Step 6:** commit `fix(notificacao): log do dispatcher descreve a ancora em vez de assumir incidente`.

### Task 3: Fuso em todas as mensagens existentes (ajuste 1)

Paralelizável com Task 1 (arquivos disjuntos).

**Files:**
- Modify: `.../notificacao/service/NotificacaoMessageBuilder.java`
- Test: `.../test/.../notificacao/service/NotificacaoMessageBuilderTest.java` (+ ajustar qualquer teste que monte o builder com `new NotificacaoMessageBuilder()` ou compare texto com ISO: `grep -rn "NotificacaoMessageBuilder()\|T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z" src/test` e ler cada um)

**Interfaces:**
- Produces: `public NotificacaoMessageBuilder(@Value("${app.reports.timezone:America/Sao_Paulo}") String fuso)`; package-private `String hora(Instant instante)` → `dd/MM/yyyy HH:mm`; `String rodape(Instant referencia)` → `Horários: UTC-03:00 (America/Sao_Paulo)`; `String formatarDuracao(Duration)` (já existe; mantém `Xh Ym Zs`, horas acumulam acima de 24).

- [ ] **Step 1: Testes de conteúdo vermelhos** (builder `new NotificacaoMessageBuilder("America/Sao_Paulo")`), com `isEqualTo` do texto inteiro para: `INCIDENTE_ABERTO` (com e sem IP, com motivo), `INCIDENTE_FECHADO` automático, `INCIDENTE_FECHADO` manual, `INCIDENTE_ENCERRADO_MANUTENCAO`, `LATENCIA_ALTA`, `LATENCIA_NORMALIZADA`, `LATENCIA_ENCERRADA_MANUTENCAO`. Ex. (incidente iniciado `2026-08-19T12:00:00Z`, fechado `13:02:03Z`):
  ```
  INCIDENTE ENCERRADO MANUALMENTE

  Unidade: Matriz
  Equipamento: SW-01
  Monitor: ICMP principal
  Inicio: 19/08/2026 09:00
  Fim: 19/08/2026 10:02
  Duracao: 1h 2m 3s
  Encerrado por: Ricardo Barbosa
  Horários: UTC-03:00 (America/Sao_Paulo)
  ```
  - `viradaDeDiaUsaDataLocal`: início `2026-08-20T02:30:00Z` → `Inicio: 19/08/2026 23:30`.
  - `fusoConfiguradoMudaTexto`: builder com `"UTC"` → `Inicio: 19/08/2026 12:00` e `Horários: UTC+00:00 (UTC)`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** implementar; referência do rodapé = `incidente.getIniciadoEm()` / `episodio.getIniciadoEm()`. Labels existentes (`Inicio`, `Fim`, `Duracao`) não mudam.
- [ ] **Step 4:** `./mvnw -q test -Dtest='*Notificacao*,*Manutencao*'` verde (testes que comparavam ISO ajustados com o texto novo, nunca afrouxados para `contains` genérico).
- [ ] **Step 5:** commit `feat(notificacao): mensagens em horario local com o fuso configurado`.

### Task 4: Textos das mensagens novas (builder puro)

**Files:**
- Create: `.../notificacao/service/DadosAnuncio.java`
- Modify: `.../notificacao/service/NotificacaoMessageBuilder.java`
- Test: `.../test/.../notificacao/service/NotificacaoMessageBuilderManutencaoTest.java`

**Interfaces:**
- Consumes: `hora`, `rodape`, `formatarDuracao` (Task 3).
- Produces (`DadosAnuncio` = `public final class` só com tipos aninhados):
  - `record Janela(long id, String unidadeNome, EscopoManutencao escopo, int totalEquipamentos, List<String> nomesEquipamentos /*ordenados por nome, todos*/, String motivo, Instant inicioPrevisto, Instant fimPrevisto, String criadoPorNome)`
  - `record Manual(long sessaoId, String unidadeNome, String equipamentoNome, String ip /*nulável*/, Instant iniciadaEm /*nulável*/, String iniciadaPorNome /*nulável*/)`
  - `record JanelaVigente(long id, Instant fimPrevisto)`
  - `enum TipoTermino { COMO_PREVISTO, ANTECIPADO, APOS_PRORROGACAO, APOS_ANTECIPACAO }`
  - `record Termino(TipoTermino tipo, String autorNome /*nulável em COMO_PREVISTO*/, Instant fimOriginal, Instant fimFinal)`
  - `record Seguinte(String equipamentoNome, Long janelaId /*null = manual*/)`
  - `enum EntregaInicio { ENTREGUE, NAO_ENTREGUE, TALVEZ_ENTREGUE }`
  - Builder: `String construirInicioJanela(DadosAnuncio.Janela j, Instant ativadaEm, boolean atrasado)`; `String construirFimJanela(DadosAnuncio.Janela j, Instant ativadaEm, Instant encerradaEm, DadosAnuncio.Termino t, List<DadosAnuncio.Seguinte> seguem, DadosAnuncio.EntregaInicio entrega)`; `String construirFimAlterado(DadosAnuncio.Janela j, Instant fimAnterior, Instant fimNovo, String autorNome)`; `String construirManualIniciada(DadosAnuncio.Manual m, boolean jaEmManutencao, DadosAnuncio.JanelaVigente janela /*nulável*/)`; `String construirManualEncerrada(DadosAnuncio.Manual m, Instant encerradaEm, String encerradaPorNome, boolean segueEmManutencao, DadosAnuncio.JanelaVigente janela /*nulável*/, DadosAnuncio.EntregaInicio entrega)`.

- [ ] **Step 1: Testes vermelhos, `isEqualTo` com o texto do §3 do spec** (fuso `America/Sao_Paulo`), um por variante:
  `inicioUnidadeInteira`, `inicioUnidadeVazia` (`Escopo: unidade inteira (nenhum equipamento cadastrado)`), `inicioUmEquipamento` (`Escopo: 1 equipamento — AD2`), `inicioSeteEquipamentosMostraCincoEMaisDois`, `inicioAtrasado` (`Início: 26/10/2026 08:17 (previsto 08:00 — sistema esteve fora)`), `fimComoPrevisto`, `fimAntecipado` (`Término: antecipado por Fulano (previsto 12:00)`), `fimAposProrrogacao` (`Término: como previsto, após prorrogação de 12:00 para 14:00 por Fulano`), `fimAposAntecipacao`, `fimComSeguintes` (`Seguem em manutenção: Switch CPD (manual), AP-02 (janela #43)`, até 5 + "e mais N"), `fimInicioNaoEntregue`, `fimInicioTalvezEntregue`, `duracaoAcimaDeUmDia` (`(25h 0m 0s)`), `fimAlteradoProrrogado` (cabeçalho `⏱️ MANUTENÇÃO PRORROGADA`), `fimAlteradoAntecipado` (`⏱️ FIM DA MANUTENÇÃO ANTECIPADO`), `manualIniciadaLivre`, `manualIniciadaSemIp` (sem linha `IP:`), `manualIniciadaJaNaJanela`, `manualIniciadaJaEmManutencaoSemJanela` (`Já estava em manutenção; agora não volta sozinho.`), `manualEncerradaRetoma`, `manualEncerradaSeguePelaJanela` (cabeçalho com `— segue em manutenção pela janela #41 até 26/10/2026 12:00`), `manualEncerradaLegadoSemInicio` (`Período: início não registrado (anterior ao histórico) → 26/10/2026 10:40`, sem duração), `manualEncerradaInicioNaoEntregue`.
  Regras do texto que o spec deixa implícitas e ficam fixadas aqui: horários de `Término`/"previsto" só `HH:mm` quando no mesmo dia local do fim; senão `dd/MM/yyyy HH:mm`. Período sempre completo. Rodapé com referência = `ativadaEm` (janela) / `iniciadaEm` ou `encerradaEm` (manual).
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** verde.
- [ ] **Step 5:** commit `feat(notificacao): textos dos anuncios de manutencao`.

### Task 5: Repositório — inserção com 4 âncoras, cancelamento do início, ordem da fila

**Files:**
- Modify: `.../notificacao/repository/NotificacaoRepository.java`, `.../notificacao/service/NotificacaoService.java`
- Create: `.../notificacao/repository/InicioAnuncioRepository.java` (`@Repository`, `NamedParameterJdbcTemplate`)
- Test: `.../test/.../notificacao/FilaAnuncioManutencaoPostgresIntegrationTest.java`

**Interfaces:**
- Consumes: Task 1, Task 4.
- Produces:
  - `int inserirPendenteSeAusente(Long incidenteId, Long episodioLatenciaId, Long manutencaoAgendadaId, Long manutencaoManualId, String canal, String tipoEvento, String mensagem, Instant agora)` (todos os chamadores atuais passam `null` nas novas).
  - `InicioAnuncioRepository`: `Optional<Integer> cancelarInicioDaJanela(long janelaId, Instant agora)`, `Optional<Integer> cancelarInicioDaSessao(long sessaoId, Instant agora)` (UPDATE ... `RETURNING tentativas`), `boolean inicioEmFalhaDaJanela(long)`, `boolean inicioEmFalhaDaSessao(long)`.
  - `NotificacaoService` (todos `@Transactional`, entram na transação do chamador): `void criarParaManutencaoIniciada(DadosAnuncio.Janela j, Instant ativadaEm, boolean atrasado)`, `void criarParaManutencaoEncerrada(DadosAnuncio.Janela j, Instant ativadaEm, Instant encerradaEm, DadosAnuncio.Termino t, List<DadosAnuncio.Seguinte> seguem)`, `void criarParaManutencaoFimAlterado(DadosAnuncio.Janela j, Instant fimAnterior, Instant fimNovo, String autorNome, Instant agora)`, `void criarParaManualIniciada(DadosAnuncio.Manual m, boolean jaEmManutencao, DadosAnuncio.JanelaVigente janela, Instant agora)`, `void criarParaManualEncerrada(DadosAnuncio.Manual m, Instant encerradaEm, String encerradaPorNome, boolean segue, DadosAnuncio.JanelaVigente janela)`. Os de "encerrada" resolvem `EntregaInicio` pela regra do spec §2.4 (cancelamento primeiro, FALHA lido depois).
  - `findIdsReadyForDispatch` com o `NOT EXISTS` do spec §2.4.

- [ ] **Step 1: Testes vermelhos** (`@RequerDocker`):
  - `fimNaoFicaProntoComInicioPendenteOuEnviando` / `fimFicaProntoComInicioEnviadaFalhaOuCancelada` (5 estados do início, mesmo para âncora manual).
  - `inicioNuncaSeBloqueia`; `fimDeOutraJanelaNaoBloqueia`.
  - `encerradaComInicioPendenteSemTentativaCancelaEDizNaoEntregue` (texto contém `não foi entregue`; início `CANCELADA`).
  - `encerradaComInicioPendenteComTentativaDizTalvez`; `encerradaComInicioFalhaDizTalvez`; `encerradaComInicioEnviadaDizNada` (sem nenhuma das duas frases).
  - `encerramentoDuplicadoNaoGeraSegundaLinha` (chamar `criarParaManutencaoEncerrada` duas vezes → 1 linha).
  - `fimAlteradoRepete` (2 chamadas → 2 linhas).
  - Regressão: `criarParaIncidenteAberto` e latência continuam inserindo (testes existentes verdes).
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** verde + `./mvnw -q test -Dtest='*Notificacao*'`.
- [ ] **Step 5:** commit `feat(notificacao): anuncios de manutencao na fila com ordem por ancora e entrega do inicio`.

### Task 6: Botão manual — sessão, anúncios, contrato do encerrar, exclusão, histórico

**Files:**
- Create: `.../equipamento/repository/SessaoManutencaoManual.java` (`@Repository`, jdbc), `.../equipamento/service/AnuncioManutencaoManual.java`, `.../equipamento/dto/ManutencaoManualResponse.java`
- Modify: `.../equipamento/service/EstadoManutencaoEquipamento.java`, `.../equipamento/service/EquipamentoService.java`, `.../equipamento/controller/EquipamentoController.java`, `.../manutencao/repository/CoberturaManutencao.java` (+ `janelaVigente`)
- Test: `.../test/.../equipamento/ManutencaoManualAnuncioPostgresIntegrationTest.java`; ajustar chamadores de `sairDeManutencao`/`encerrarManual` nos testes existentes (`grep -rn "sairDeManutencao\|encerrarManual" src/test`) e o `@WebMvcTest` do controller se houver.

**Interfaces:**
- Consumes: Tasks 1, 4, 5.
- Produces:
  - `SessaoManutencaoManual`: `long abrir(long equipamentoId, long usuarioId, Instant agora)`, `Optional<Long> fecharAberta(long equipamentoId, long usuarioId, Instant agora)`, `Optional<DadosAnuncio.Manual> dados(long sessaoId)`, `boolean existeHistorico(long equipamentoId)`, `Page<ManutencaoManualResponse> listar(long equipamentoId, Pageable pageable)`.
  - `CoberturaManutencao.janelaVigente(long equipamentoId): Optional<DadosAnuncio.JanelaVigente>` (ATIVA de menor id que cobre; mesmo predicado de `autorDaCobertura`).
  - `EstadoManutencaoEquipamento.encerrarManual(Long equipamentoId, Long usuarioId)`; `EquipamentoService.sairDeManutencao(Long id, Long usuarioId)`; `EquipamentoService.historicoManutencaoManual(Long id, Pageable): Page<ManutencaoManualResponse>`.
  - `record ManutencaoManualResponse(Long id, Instant iniciadaEm, ReferenciaResponse iniciadaPor, Instant encerradaEm, ReferenciaResponse encerradaPor, Long duracaoSegundos)`.
  - `GET /api/v1/equipamentos/{id}/manutencoes-manuais?page=0&size=5` → `PaginaResposta<ManutencaoManualResponse>`, ordem `id desc`, `size` máx. 50, 404 equipamento inexistente; mesmos papéis do `GET /equipamentos/{id}`.
- Ordem dentro de `iniciarManual`: `marcarManual` → `abrir` → `anunciarInicio(sessao, travado.getEmManutencao(), agora)` → efeitos de entrada (o anúncio vem antes dos `INCIDENTE_ENCERRADO_MANUTENCAO`). `encerrarManual`: `desmarcarManual` → `fecharAberta` → `segue = reavaliar(id)` → `anunciarFim(sessao, segue, agora)`; sem sessão: `warn` e nada.
- Recusa de exclusão: `"Nao e possivel excluir o equipamento porque ele tem historico de manutencao manual"`, checada depois das duas existentes.

- [ ] **Step 1: Testes vermelhos** (`@RequerDocker`), conferindo **texto** (`contains` das linhas-chave do §3) e linhas:
  `iniciarCriaSessaoENotificacaoAntesDosEncerramentos` (equipamento com incidente aberto e abertura ENVIADA: a `MANUTENCAO_MANUAL_INICIADA` tem id menor que a `INCIDENTE_ENCERRADO_MANUTENCAO`), `iniciarIdempotenteNaoDuplica`, `iniciarDentroDeJanelaCitaJanela` (flag efetivo já true pela reavaliação), `encerrarGravaQuemEncerrouEDuracao`, `encerrarComJanelaAtivaDizQueSegue`, `encerrarSemSessaoAbertaNaoNotifica`, `encerrarLegadoSemInicio` (sessão inserida por SQL sem início), `excluirComHistoricoManualRecusaComMensagem` (409 e mensagem exata), `historicoPaginadoMaisRecentePrimeiro`, `historicoEquipamentoInexistente404`, controller `encerrarUsaPrincipal` (MockMvc com usuário autenticado; `encerrada_por_id` = id do principal).
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** verde + `./mvnw -q test -Dtest='*Manutencao*,*Equipamento*'`.
- [ ] **Step 5:** commit `feat(equipamento): sessao do botao manual com anuncio, autor do encerramento e historico`.

### Task 7: Janela — anúncios nas transições

**Files:**
- Create: `.../manutencao/service/AnuncioManutencao.java` (`@Component`, não condicional)
- Modify: `.../manutencao/service/ReconciliadorManutencao.java`, `.../manutencao/service/ManutencaoAgendadaService.java`, `.../manutencao/repository/CoberturaManutencao.java` (consultas de dados do anúncio, se não couberem no componente)
- Test: `.../test/.../manutencao/ManutencaoAnuncioPostgresIntegrationTest.java`

**Interfaces:**
- Consumes: Tasks 4, 5.
- Produces: `AnuncioManutencao.anunciarInicio(long janelaId, Instant agora)`, `anunciarFim(long janelaId, Instant agora)`, `anunciarFimAlterado(long janelaId, Instant fimAnterior, Instant fimNovo, long autorId, Instant agora)`. Lê na transação corrente: unidade, escopo, `cobertosPor` (nomes ordenados), motivo, previstos, `ativada_em`, `encerrada_em`, `encerrada_por` (nome), criador (nome), alterações (`manutencao_agendada_alteracao` PRORROGACAO/ANTECIPACAO: primeiro `antes->>'fimPrevisto'`, último `depois->>'fimPrevisto'`, autor da última), seguintes (cobertos com `manutencao_manual` ou outra janela ATIVA cobrindo). `atrasado` = `ativada_em - inicio_previsto > 2 × manutencao.agendada.intervalo-ms`.
- Chamadas, **dentro do mesmo `transacao.execute`** do CAS: reconciliador `ativarDevidas` → `anunciarInicio` por id; `concluirVencidas` → `anunciarFim` por id; service `ativarSeDevida` (criar e editar) true → `anunciarInicio`; `encerrar` true → `anunciarFim`; `alterarFim` depois de `registrar` → `anunciarFimAlterado`. O `agora` passado é o mesmo do CAS (capturar em variável).
- Término: `encerrada_por` presente → `ANTECIPADO` (fimOriginal = `fim_previsto`); senão última alteração de fim PRORROGACAO → `APOS_PRORROGACAO`; ANTECIPACAO → `APOS_ANTECIPACAO`; nenhuma → `COMO_PREVISTO`.

- [ ] **Step 1: Testes vermelhos** (`@RequerDocker`, `manutencao.agendada.enabled=true`, intervalo 1 h, `reconciliar(agora)` direto):
  `ativacaoPeloJobAnuncia`, `ativacaoImediataNaCriacaoAnuncia`, `ativacaoAtrasadaDizPrevisto`, `inicioDeUnidadeVaziaAnunciaZero`, `criadorDesativadoAindaApareceNoTexto`, `conclusaoPeloJobComoPrevisto`, `encerrarAgoraDizAntecipadoPorQuem`, `prorrogarAnunciaEFimDizAposProrrogacao`, `cancelarNaoAnuncia`, `expirarNaoAnuncia`, `editarAgendadaNaoAnuncia`, `fimListaQuemSegueEmManutencao`, `anuncioVemAntesDosEncerramentosIndividuais` (janela sobre equipamento com incidente aberto e abertura ENVIADA), `falhaDoTelegramNaoImpedeAtivacao` (dispatcher desligado: janela ATIVA e notificação PENDENTE).
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** verde + `./mvnw -q test -Dtest='*Manutencao*'`.
- [ ] **Step 5:** commit `feat(manutencao): anuncia inicio, fim e alteracao de fim da janela na transacao do CAS`.

### Task 8: Corridas reais

**Files:**
- Create: `.../test/.../manutencao/AnuncioManutencaoConcorrenciaPostgresIntegrationTest.java`

**Interfaces:** Consumes Tasks 5–7.

- [ ] **Step 1:** as cinco corridas do spec §5, cada uma `@RepeatedTest(30)`, padrão de `ManutencaoAgendadaConcorrenciaPostgresIntegrationTest` (barreira, atraso calibrado com o comentário "medição de calibração", rótulos):
  1. `conclusaoJobVsEncerrarAgora` — rótulos `AUTO`/`OPER`; `ILEGITIMO` se ≠ 1 `MANUTENCAO_ENCERRADA` ou texto "antecipado" sem `encerrada_por_id`.
  2. `alterarFimVsConclusao` — `PRORROGOU`/`RECUSADO`; ilegítimo: `FIM_ALTERADO` sem linha `PRORROGACAO` em `manutencao_agendada_alteracao`, ou `ENCERRADA` incoerente com ela.
  3. `fimVsDispatcherReservaInicio` — thread A `reserveForDispatch(inicioId)`; thread B `encerrar`; `CANCELOU`/`RESERVOU`; ilegítimo conforme spec §5.
  4. `doisCliquesIniciar` — 1 sessão aberta, 1 `MANUTENCAO_MANUAL_INICIADA`, a outra chamada sem exceção.
  5. `iniciarManualVsAtivacaoJanela` — `BOTAO_PRIMEIRO`/`JANELA_PRIMEIRO`; ilegítimo: texto cita janela **e** `fechado_por` do incidente = usuário do botão, ou não cita **e** `fechado_por` = criador da janela.
  Calibrar até os dois desfechos legítimos aparecerem em 30.
- [ ] **Step 2:** verde, com distribuição impressa (copiar para Task 11).
- [ ] **Step 3: Reversões** (uma por vez, local, nunca commitada), rodar e registrar vermelho: (1) inserir ENCERRADA fora do ramo `true` do CAS; (2) anunciar FIM_ALTERADO antes do `gravarFim`; (3) decidir `EntregaInicio` por `existeAberturaJaDespachada`-like lido **antes** do UPDATE; (4) remover o retorno idempotente de `iniciarManual`; (5) `jaEmManutencao` por `cobertura.coberto(id)` em vez do flag travado.
- [ ] **Step 4:** commit `test(manutencao): corridas dos anuncios com duas threads e 30 repeticoes`.

### Task 9: Listagem, relatórios e export

**Files:**
- Modify: `.../notificacao/dto/NotificacaoResponse.java`, `.../notificacao/service/NotificacaoService.java` (`paraResposta`, `listar`), `.../notificacao/controller/NotificacaoController.java`, `.../notificacao/repository/NotificacaoRepository.java` (entity graphs), `.../relatorio/dto/HistoricoNotificacaoResponse.java`, `.../relatorio/service/RelatorioService.java`, `.../relatorio/exportacao/RelatorioExportService.java`
- Create: `.../notificacao/dto/ManutencaoNotificacaoResponse.java`, `.../notificacao/dto/ManutencaoManualNotificacaoResponse.java`
- Test: testes existentes de listagem/relatório/export + novos casos.

**Interfaces:**
- Consumes: Task 1.
- Produces (contrato do front):
  - `NotificacaoResponse` + `manutencao: ManutencaoNotificacaoResponse(Long id, String unidadeNome) | null` e `manutencaoManual: ManutencaoManualNotificacaoResponse(Long id, Long equipamentoId, String equipamentoNome) | null`, posicionados depois de `episodioLatencia`. `equipamentoNome`/`unidadeNome` do topo: janela → equipamento `null`, unidade da janela; manual → equipamento e unidade do equipamento.
  - `GET /notificacoes?manutencaoId=&manutencaoManualId=`; mais de uma âncora → 400 `"informe apenas uma ancora: incidenteId, episodioLatenciaId, manutencaoId ou manutencaoManualId"`.
  - `HistoricoNotificacaoResponse` + `Long manutencaoId, Long manutencaoManualId` (no fim do record); CSV de notificações com `manutencao_id,manutencao_manual_id` **no fim** do cabeçalho.
- [ ] **Step 1: Testes vermelhos:** listagem de janela traz `manutencao.id` e `unidadeNome`; filtro por `manutencaoId`; 400 com duas âncoras; histórico/CSV trazem as colunas no fim; `VisaoGeralPdfPostgresIntegrationTest` ganha caso "falha de anúncio conta em notificacoes_falha".
- [ ] **Step 2–4:** FAIL → implementar → verde (`./mvnw -q test -Dtest='*Notificacao*,*Relatorio*,*VisaoGeral*'`).
- [ ] **Step 5:** auditoria (doc da Task 2): seções "Listagem, relatórios, export, PDF, dashboard" com cada call site do spec §6 (back) classificado.
- [ ] **Step 6:** commit `feat(notificacao): origem de manutencao na listagem, relatorio e export`.

### Task 10: Frontend — rótulos compartilhados, origem e histórico no drawer

Paralelizável com Tasks 5–9 (contrato fixado nas Tasks 6 e 9). Visual com `/frontend-design` (frontend-design:frontend-design).

**Files:**
- Create: `infra-monitor-frontend/src/app/core/models/rotulos-notificacao.ts` (+ spec)
- Modify: `core/models/api-enums.ts`, `core/models/notificacao.ts`, `core/models/relatorio.ts`, `core/models/equipamento.ts`, `core/services/equipamento-api.service.ts`, `features/notificacoes/notificacao-list.component.{ts,html}`, `features/notificacoes/notificacao-detail.component.{ts,html}`, `features/relatorios/relatorios.component.{ts,html}`, `features/incidentes/timeline/timeline.ts`, `features/equipamentos/equipamento-detalhe-drawer.component.{ts,html,scss}` e specs correspondentes.

**Interfaces:**
- Produces: `NotificationEventType.{MaintenanceStarted='MANUTENCAO_INICIADA', MaintenanceEnded='MANUTENCAO_ENCERRADA', MaintenanceEndChanged='MANUTENCAO_FIM_ALTERADO', ManualMaintenanceStarted='MANUTENCAO_MANUAL_INICIADA', ManualMaintenanceEnded='MANUTENCAO_MANUAL_ENCERRADA'}`; `ROTULOS_EVENTO_NOTIFICACAO: Record<NotificationEventType, string>` e `OPCOES_EVENTO_NOTIFICACAO` (ordem do enum) em `rotulos-notificacao.ts`; rótulos novos: `Manutenção iniciada`, `Manutenção encerrada`, `Fim da manutenção alterado`, `Manutenção manual iniciada`, `Manutenção manual encerrada`; `EquipamentoApiService.historicoManutencaoManual(id: number, size = 5): Observable<PageResponse<ManutencaoManualResponse>>`.
- [ ] **Step 1: Specs vermelhos:** `rotulos-notificacao.spec` (todo valor do enum tem rótulo; opções = valores do enum); lista e Relatórios renderizam as 11 opções de evento a partir de `OPCOES_EVENTO_NOTIFICACAO` (nenhum `<option>` de evento escrito à mão); lista/detalhe mostram origem `Janela #41` com link `/manutencoes` e `Manutenção manual · SW-01`; drawer: seção "Manutenção manual — histórico" com 5 linhas (período em `dd/MM/yyyy HH:mm`, duração, iniciada/encerrada por, aberta = "em andamento", legado = "início não registrado"), vazio = "Nenhuma manutenção manual registrada", erro mostra aviso e o resto do drawer continua; recarrega quando `linha().manutencaoManual` muda; aparece com `acoesDeGestao=false` (Mapa).
- [ ] **Step 2:** `npx ng test --watch=false` → FAIL nos novos. **Step 3:** implementar (rótulos duplicados de lista e detalhe removidos em favor do módulo; `timeline.ts` ganha os `case` para exaustividade). **Step 4:** `npx ng test --watch=false` verde inteiro + `npx ng build` OK.
- [ ] **Step 5:** auditoria (doc da Task 2): seção front com cada arquivo do spec §6 classificado, incluindo `StatusBadgeComponent` (sem status novo → não muda).
- [ ] **Step 6:** commit `feat(front): rotulos de notificacao compartilhados, origem de manutencao e historico manual no drawer`.

### Task 11: Documentação

**Files:** `Docs/manutencao-agendada-architecture/manutencao-agendada-{decisoes,pendencias,desenho,architecture}.md`, `infra-monitor-backend/README.md`, `Docs/validacao-producao/manutencao-agendada-f3.md` (novo), `Docs/validacao-producao/manutencao-f3-auditoria-enums.md` (fechar).

- [ ] **Step 1:** MA27–MA36 em decisões (texto do spec, com "descartado:" onde houver); P-02 fechada em pendências; desenho §6.3 aponta para a F3; architecture com o estado.
- [ ] **Step 2:** README do backend: V23, rollback ("código da V22 sobre banco com linhas F3 quebra o dispatcher antigo ao ler o enum"), `REPORT_TIMEZONE` afeta mensagens, novo endpoint de histórico, contrato do encerrar.
- [ ] **Step 3:** validação: saídas vermelhas (Task 2), distribuições e reversões (Task 8), suítes e exercício (Task 12).
- [ ] **Step 4:** commit `docs(manutencao-f3): decisoes MA27-MA36, auditoria, README e validacao`.

### Task 12: Verificação final, exercício no clone e e2e

- [ ] **Step 1: Suítes** — `docker info` OK; `./mvnw test` inteiro (contagem completa, sem `!!`); `npx ng test --watch=false`; `npx ng build`. Copiar números para o doc.
- [ ] **Step 2: Clone** — `pg_dump` do `inframonitor-carga` (só leitura: `docker exec ... pg_dump`) → `docker run` container `inframonitor-f3-clone` em `127.0.0.1:5440` (volume anônimo), restore; jar da F3 (`./mvnw -DskipTests package` no worktree, copiado para o scratchpad) na 8083 com `DB_PORT=5440`, `MANUTENCAO_AGENDADA_ENABLED=true`, `TELEGRAM_ENABLED=true`, `NOTIFICATION_DISPATCHER_ENABLED=true`, `TELEGRAM_API_BASE_URL=http://127.0.0.1:<porta>`, token/chat fictícios, `JWT_SECRET` próprio, motor ligado, admin de bootstrap próprio (e-mail inexistente no dump). A V23 roda no clone no boot.
- [ ] **Step 3: Mock Telegram** — node no scratchpad: `POST /bot<token>/sendMessage` → `{"ok":true,"result":{"message_id":N}}` e grava o corpo em `mock-telegram.jsonl`; `GET /bot<token>/getMe` → bot fictício.
- [ ] **Step 4: Prova SQL** no clone antes de cada passo (ativo, fora de manutenção, zero incidente ABERTO/RECONHECIDO, medições SUCESSO na última hora), colada no doc. Equipamentos: 4 (Servidor AD2) e 9 (gateway) para escopo de equipamentos; unidade inteira em Sesc Socorro/Hotel Atalaia/Sesc Indiaroba. **Nunca** ids 1, 2, 8.
- [ ] **Step 5: Roteiro pela API** (MSYS_NO_PATHCONV=1): janela de equipamentos com início agora → prorrogar → encerrar agora; janela de unidade inteira curta com fim pelo job; botão manual liga/desliga; botão manual dentro de janela. Conferir cada corpo do mock contra o §3 e o SQL de `notificacao` (status ENVIADA, ordem).
- [ ] **Step 6: E2E Playwright** `e2e/manutencao-agendada-f3.cjs` (script `e2e:manutencao-agendada-f3`) contra o clone (front `ng serve` em porta própria via `api-porta.cjs`/API_PORT apontando 8083), por clique, log de rede em `finally`, sem `catch` em seletor: drawer mostra histórico após liga/desliga; filtro de evento "Manutenção iniciada" na lista de notificações; origem "Janela #N" com link; Relatórios lista o evento. Capturas em `e2e/manutencao-agendada-f3-evidence/`.
- [ ] **Step 7: Limpeza** — parar jar/ng por PID, `docker rm -f inframonitor-f3-clone`, provar portas 8083/5440/porta do front livres; carga intocada (`select max(installed_rank) from flyway_schema_history` = 22 na 5436).
- [ ] **Step 8:** commit evidências + doc de validação.
