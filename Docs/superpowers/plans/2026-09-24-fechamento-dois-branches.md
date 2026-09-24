# Fechamento dos dois branches — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fechar os três riscos de execução (CAS no fechamento automático, `lock_timeout` no motor, janela na exclusão), auditar a concorrência, refazer a evidência do mapa, registrar dívidas e mesclar os dois branches na `main` local sem push.

**Architecture:** Correções mínimas no idioma que o código já usa (bulk update JPQL com CAS, `set_config(..., true)` = `SET LOCAL`, bulk delete). Provas por Testcontainers com threads reais + `CyclicBarrier` + 30 repetições + prova de reversão. Documentos em `Docs/validacao-producao/`, commitados junto da mudança que descrevem.

**Tech Stack:** Java 21, Spring Boot 4.1, Spring Data JPA/Hibernate, PostgreSQL 16, Flyway, JUnit 5, Testcontainers, Angular, Playwright (scripts `.cjs` em `infra-monitor-frontend/e2e/`).

**Spec:** `Docs/superpowers/specs/2026-09-24-fechamento-dois-branches-design.md` — leia antes de qualquer tarefa.

## Global Constraints

- Banco de dev na porta **5434**: somente `SELECT` de conferência. Nunca rodar migration, motor ou teste contra ele.
- Motor de monitoramento nunca ligado contra o banco de dev. Telegram real nunca acionado: sempre mock HTTP local (`TELEGRAM_API_BASE_URL=http://localhost:8099`).
- A árvore de trabalho tem ~60 arquivos modificados/não rastreados que **não são desta rodada** (`infra-monitor-frontend/e2e/*-evidence/*`, `infra-monitor-frontend/package.json`, `Docs/superpowers/plans/2026-09-17-*`, `screenshots/mapa/*`, `infra-monitor-frontend/e2e/perf-mapa/`). **Nunca** `git add -A`/`git add .`/`git commit -a`; sempre `git add <caminho explícito>`. Nunca `git checkout -- `/`git restore`/`git stash` nesses arquivos.
- Sem Lombok, sem abstração especulativa, `Instant` para datas, comentários em português sem acento no Java (idioma do código existente).
- Nunca editar migration existente. Esta rodada não cria migration.
- Commit termina com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- `Docs/validacao-producao/` é atualizado **no mesmo commit** da mudança que o documento descreve, e o índice `Docs/validacao-producao/validacao-producao.md` ganha uma linha por documento novo.
- Comandos Maven a partir de `infra-monitor-backend/` com `./mvnw` (Git Bash). Testes de integração exigem Docker (Testcontainers); se Docker não estiver disponível, eles são **ignorados**, não passam — nesse caso PARE e reporte, porque as provas desta rodada dependem deles.
- Relatório de cada tarefa: números reais colados da saída (contagens de teste, distribuição de desfechos), nunca paráfrase.

---

### Task 1: CAS em `fecharAutomaticamente` + corrida real + prova de reversão

**Files:**
- Modify: `infra-monitor-backend/src/main/java/br/com/inframonitor/incidente/repository/IncidenteRepository.java` (novo método depois de `reconhecerSeAberto`)
- Modify: `infra-monitor-backend/src/main/java/br/com/inframonitor/incidente/service/IncidenteService.java:100-114` (`fecharAutomaticamente`)
- Modify: `infra-monitor-backend/src/test/java/br/com/inframonitor/equipamento/ManutencaoPostgresIntegrationTest.java` (dois `@RepeatedTest(30)` novos)
- Modify (se quebrar): testes de unidade que mockam `saveAndFlush` em `fecharAutomaticamente` — procurar com `grep -rn "fecharAutomaticamente" infra-monitor-backend/src/test`
- Create: `Docs/validacao-producao/riscos-execucao-correcoes.md`
- Modify: `Docs/validacao-producao/validacao-producao.md` (linha nova na tabela)

**Interfaces:**
- Produces: `int IncidenteRepository.fecharAutomaticamenteSeEmAberto(Long id, Instant encerradoEm, String observacao, Instant agora)`; `IncidenteService.fecharAutomaticamente(Incidente, Instant, int)` mantém assinatura e retorno `Incidente`.
- Produces: documento `riscos-execucao-correcoes.md` com seção `## 1a` — Tasks 2 e 3 acrescentam `## 1b` e `## 1c`.

- [ ] **Step 1: Escrever os dois testes de corrida** em `ManutencaoPostgresIntegrationTest`, na seção 5, depois do teste existente. Adicionar imports `br.com.inframonitor.common.exception.ConflitoException` e `br.com.inframonitor.incidente.entity.Incidente`.

```java
    /**
     * Corrida real entre a entrada em manutencao e o fechamento automatico do MESMO
     * incidente. A instancia que o motor fecha e carregada ANTES da barreira, como no
     * IncidentProcessor real (le, decide, fecha). Sem CAS, o UPDATE do Hibernate grava
     * todas as colunas WHERE id = ? e sobrescreve o fechamento por manutencao.
     *
     * <p>Legitimos: (M) manutencao ganhou — FECHADO/MANUTENCAO, fechado_por = operador,
     * uma INCIDENTE_ENCERRADO_MANUTENCAO e nenhuma INCIDENTE_FECHADO; (R) recuperacao
     * ganhou — FECHADO/RECUPERACAO_AUTOMATICA, fechado_por nulo, uma INCIDENTE_FECHADO
     * e nenhuma INCIDENTE_ENCERRADO_MANUTENCAO.
     */
    @RepeatedTest(30)
    void entrarEmManutencaoEFecharAutomaticamenteConcorrentesTerminamEmUmSoFechamento() throws Exception {
        long equipamentoId = montarEquipamento(false);
        long monitorId = montarMonitor(equipamentoId);
        long incidenteId = insert("insert into incidente (monitor_id, status, iniciado_em, motivo) "
                + "values (?, 'ABERTO', ?, 'Indisponibilidade') returning id", monitorId, Timestamp.from(T0));
        insert("insert into janela_monitoramento (monitor_id, inicio_em, origem) values (?, ?, 'PRECISA') "
                + "returning id", monitorId, Timestamp.from(T0));
        insert("insert into notificacao (incidente_id, canal, tipo_evento, status, mensagem, enviado_em) "
                + "values (?, 'TELEGRAM', 'INCIDENTE_ABERTO', 'ENVIADA', 'msg', ?) returning id",
                incidenteId, Timestamp.from(T0));
        Incidente carregadoPeloMotor = incidenteRepository.findById(incidenteId).orElseThrow();

        CyclicBarrier partida = new CyclicBarrier(2);
        List<Throwable> falhas = new CopyOnWriteArrayList<>();
        Thread manutencao = new Thread(() -> {
            try {
                partida.await(LIMITE.toSeconds(), TimeUnit.SECONDS);
                equipamentoService.entrarEmManutencao(equipamentoId, operadorId);
            } catch (Throwable erro) {
                falhas.add(erro);
            }
        }, "manutencao");
        Thread recuperacao = new Thread(() -> {
            try {
                partida.await(LIMITE.toSeconds(), TimeUnit.SECONDS);
                incidenteService.fecharAutomaticamente(carregadoPeloMotor, T0.plusSeconds(300), 2);
            } catch (Throwable erro) {
                falhas.add(erro);
            }
        }, "fechamento-automatico");
        manutencao.start();
        recuperacao.start();
        manutencao.join(LIMITE.toMillis());
        recuperacao.join(LIMITE.toMillis());

        assertThat(falhas.stream().map(Throwable::toString).toList()).isEmpty();

        var linha = jdbc.queryForMap("select status, motivo_encerramento, fechado_por from incidente where id = ?",
                incidenteId);
        Integer encerradasPorManutencao = jdbc.queryForObject("select count(*) from notificacao where incidente_id = ? "
                + "and tipo_evento = 'INCIDENTE_ENCERRADO_MANUTENCAO'", Integer.class, incidenteId);
        Integer fechadas = jdbc.queryForObject("select count(*) from notificacao where incidente_id = ? "
                + "and tipo_evento = 'INCIDENTE_FECHADO'", Integer.class, incidenteId);
        Object motivo = linha.get("motivo_encerramento");
        Object fechadoPor = linha.get("fechado_por");

        boolean manutencaoGanhou = "MANUTENCAO".equals(motivo) && Long.valueOf(operadorId).equals(fechadoPor)
                && encerradasPorManutencao == 1 && fechadas == 0;
        boolean recuperacaoGanhou = "RECUPERACAO_AUTOMATICA".equals(motivo) && fechadoPor == null
                && fechadas == 1 && encerradasPorManutencao == 0;
        System.out.println("[corrida-fechamento-manutencao] desfecho=" + (manutencaoGanhou ? "M-manutencao-ganhou"
                : recuperacaoGanhou ? "R-recuperacao-ganhou" : "ILEGITIMO") + " motivo=" + motivo
                + " fechadoPor=" + fechadoPor + " encerradasPorManutencao=" + encerradasPorManutencao
                + " fechadas=" + fechadas);

        assertThat(linha.get("status")).isEqualTo("FECHADO");
        assertThat(manutencaoGanhou || recuperacaoGanhou)
                .as("um fechamento so: motivo, autor e notificacao do MESMO vencedor")
                .isTrue();
    }

    /**
     * Corrida real entre reconhecer (CAS contra ABERTO) e o fechamento automatico.
     * Sem CAS no fechamento, o motor grava reconhecido_em/reconhecido_por de volta a
     * NULL a partir da instancia carregada antes — a trilha de quem reconheceu some
     * mesmo com reconhecer tendo respondido sucesso.
     *
     * <p>Legitimos: (F) o fechamento ganhou — FECHADO sem reconhecimento e reconhecer
     * recebeu 409; (RF) reconhecer ganhou e depois o motor fechou — FECHADO com
     * reconhecimento preservado.
     */
    @RepeatedTest(30)
    void reconhecerEFecharAutomaticamenteConcorrentesNaoApagamReconhecimento() throws Exception {
        long monitorId = montarEquipamentoEMonitor(false);
        long incidenteId = insert("insert into incidente (monitor_id, status, iniciado_em, motivo) "
                + "values (?, 'ABERTO', ?, 'Indisponibilidade') returning id", monitorId, Timestamp.from(T0));
        Incidente carregadoPeloMotor = incidenteRepository.findById(incidenteId).orElseThrow();

        CyclicBarrier partida = new CyclicBarrier(2);
        List<Throwable> falhas = new CopyOnWriteArrayList<>();
        java.util.concurrent.atomic.AtomicBoolean reconhecimentoRecusado = new java.util.concurrent.atomic.AtomicBoolean();
        Thread reconhecimento = new Thread(() -> {
            try {
                partida.await(LIMITE.toSeconds(), TimeUnit.SECONDS);
                incidenteService.reconhecer(incidenteId, operadorId);
            } catch (ConflitoException recusado) {
                reconhecimentoRecusado.set(true);
            } catch (Throwable erro) {
                falhas.add(erro);
            }
        }, "reconhecer");
        Thread recuperacao = new Thread(() -> {
            try {
                partida.await(LIMITE.toSeconds(), TimeUnit.SECONDS);
                incidenteService.fecharAutomaticamente(carregadoPeloMotor, T0.plusSeconds(300), 2);
            } catch (Throwable erro) {
                falhas.add(erro);
            }
        }, "fechamento-automatico");
        reconhecimento.start();
        recuperacao.start();
        reconhecimento.join(LIMITE.toMillis());
        recuperacao.join(LIMITE.toMillis());

        assertThat(falhas.stream().map(Throwable::toString).toList()).isEmpty();

        var linha = jdbc.queryForMap("select status, reconhecido_em, reconhecido_por from incidente where id = ?",
                incidenteId);
        boolean reconhecido = linha.get("reconhecido_por") != null && linha.get("reconhecido_em") != null;
        boolean fechamentoGanhou = reconhecimentoRecusado.get() && !reconhecido;
        boolean reconhecerGanhou = !reconhecimentoRecusado.get() && reconhecido;
        System.out.println("[corrida-fechamento-reconhecer] desfecho=" + (fechamentoGanhou ? "F-fechamento-ganhou"
                : reconhecerGanhou ? "RF-reconhecido-e-fechado" : "ILEGITIMO") + " recusado="
                + reconhecimentoRecusado.get() + " reconhecidoPor=" + linha.get("reconhecido_por"));

        assertThat(linha.get("status")).isEqualTo("FECHADO");
        assertThat(fechamentoGanhou || reconhecerGanhou)
                .as("reconhecer que respondeu sucesso nao pode ter o reconhecimento apagado pelo motor")
                .isTrue();
    }
```

- [ ] **Step 2: Rodar contra o código ANTIGO (é a prova de reversão, antes da correção)**

Run: `cd infra-monitor-backend && ./mvnw -q test -Dtest='ManutencaoPostgresIntegrationTest' 2>&1 | tee /tmp/1a-antes.txt | grep -E "corrida-fechamento|Tests run|FAIL"`
Expected: falhas nos dois testes novos. Contar: `grep -c "desfecho=ILEGITIMO" /tmp/1a-antes.txt` separado por prefixo (`corrida-fechamento-manutencao` e `corrida-fechamento-reconhecer`). Guardar a distribuição exata para o documento. **Se o teste de reconhecer der 0 ilegítimos no código antigo, anotar que ele NÃO discrimina** (não enfraquecer nem apagar; relatar).

- [ ] **Step 3: Implementar o CAS** em `IncidenteRepository`, logo depois de `reconhecerSeAberto`:

```java
    /**
     * Fechamento do motor como compara-e-troca contra ABERTO/RECONHECIDO, no idioma de
     * reconhecerSeAberto e fecharPorManutencao. O caminho antigo carregava a entidade,
     * chamava fechar() e fazia saveAndFlush: o UPDATE do Hibernate grava TODAS as
     * colunas WHERE id = ?, sem versao, entao sobrescrevia um fechamento por manutencao
     * que tivesse commitado no meio (motivo e autor trocados, duas notificacoes de
     * encerramento) e apagava reconhecido_em/reconhecido_por gravados por reconhecer.
     *
     * <p>So toca as colunas de fechamento. Retorna 1 quando fechou e 0 quando outra
     * transacao ja fechou. Sob READ COMMITTED, se a outra transacao segura a linha, este
     * UPDATE espera e o Postgres reavalia o WHERE sobre a versao nova (EvalPlanQual).
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("update Incidente i set i.status = br.com.inframonitor.incidente.entity.StatusIncidente.FECHADO, "
            + "i.encerradoEm = :encerradoEm, i.observacao = :observacao, "
            + "i.motivoEncerramento = br.com.inframonitor.incidente.entity.MotivoEncerramentoIncidente.RECUPERACAO_AUTOMATICA, "
            + "i.fechadoPor = null, i.updatedAt = :agora "
            + "where i.id = :id and i.status in (br.com.inframonitor.incidente.entity.StatusIncidente.ABERTO, "
            + "br.com.inframonitor.incidente.entity.StatusIncidente.RECONHECIDO)")
    int fecharAutomaticamenteSeEmAberto(@Param("id") Long id, @Param("encerradoEm") Instant encerradoEm,
                                        @Param("observacao") String observacao, @Param("agora") Instant agora);
```

Confirmar em `Incidente.java` que o campo se chama `observacao` (é o que `fechar()` escreve). Em `IncidenteService`, substituir o corpo de `fecharAutomaticamente`:

```java
    @Transactional
    public Incidente fecharAutomaticamente(Incidente incidente, Instant encerradoEm, int sucessosConsecutivos) {
        if (incidente.getStatus() == StatusIncidente.FECHADO) {
            return incidente;
        }
        if (encerradoEm.isBefore(incidente.getIniciadoEm())) {
            throw new IllegalArgumentException("encerradoEm deve ser maior ou igual a iniciadoEm");
        }
        // Sem autor: quem fechou foi o motor. E o unico caminho que deixa fechado_por nulo.
        // CAS: se a manutencao, um humano ou outro ciclo fechou entre a leitura do
        // processor e aqui, nao ha o que fechar nem o que notificar.
        String observacao = "Recuperacao detectada automaticamente apos " + sucessosConsecutivos
                + " sucessos consecutivos.";
        if (incidenteRepository.fecharAutomaticamenteSeEmAberto(incidente.getId(), encerradoEm, observacao,
                Instant.now()) == 0) {
            return obterIncidente(incidente.getId());
        }
        // O bulk update nao atualiza a instancia carregada; releitura antes de notificar,
        // senao a mensagem sai com encerradoEm nulo.
        Incidente fechado = obterIncidente(incidente.getId());
        notificacaoService.criarParaIncidenteFechado(fechado);
        return fechado;
    }
```

- [ ] **Step 4: Rodar a classe inteira e a suíte**

Run: `./mvnw -q test -Dtest='ManutencaoPostgresIntegrationTest' 2>&1 | tee /tmp/1a-depois.txt | grep -E "corrida-fechamento|Tests run|FAIL"`
Expected: 30/30 legítimas em cada teste novo, zero `ILEGITIMO`; o teste antigo de corrida continua verde. Contar a distribuição: `grep -o "corrida-fechamento-[a-z]*\] desfecho=[A-Za-z-]*" /tmp/1a-depois.txt | sort | uniq -c`.
Depois: `./mvnw test 2>&1 | tail -30`. Se testes de unidade que mockavam `saveAndFlush` quebrarem, ajustá-los para mockar `fecharAutomaticamenteSeEmAberto` (retorno 1 / 0) e `findById` — não apagar asserções.

- [ ] **Step 5: Documento.** Criar `Docs/validacao-producao/riscos-execucao-correcoes.md`:

```markdown
# Riscos de execução — correções da rodada de fechamento

Três riscos que ficaram abertos na revisão final do branch `feat/manutencao-equipamento`, corrigidos
com teste concorrente real (threads + `CyclicBarrier` + Postgres de Testcontainers + 30 repetições) e
prova de reversão. Desenho: [../superpowers/specs/2026-09-24-fechamento-dois-branches-design.md](../superpowers/specs/2026-09-24-fechamento-dois-branches-design.md).

## 1a. `fecharAutomaticamente` sem CAS
```
Preencher com: o defeito (UPDATE de todas as colunas sem versão; os dois desfechos ilegítimos
concretos), a correção (`fecharAutomaticamenteSeEmAberto`), a distribuição **antes** (colada da
contagem do Step 2) e **depois** (Step 4) para cada um dos dois testes, e a frase explícita "zero
ilegítimo em 30/30" ou o número real. Se o teste de reconhecer não discriminou, dizer.
Acrescentar ao índice `validacao-producao.md`, na tabela, depois da linha de `topologia-git...`:

```markdown
| [riscos-execucao-correcoes.md](riscos-execucao-correcoes.md) | Os três riscos de execução fechados antes do merge: CAS no fechamento automático, `lock_timeout` no motor e pool, janela na exclusão de monitor — com distribuição de desfechos das corridas reais e prova de reversão |
```

- [ ] **Step 6: Commit**

```bash
cd /c/Users/rbfilho/Documents/infra-monitor
git add infra-monitor-backend/src/main/java/br/com/inframonitor/incidente/repository/IncidenteRepository.java \
  infra-monitor-backend/src/main/java/br/com/inframonitor/incidente/service/IncidenteService.java \
  infra-monitor-backend/src/test/java/br/com/inframonitor/equipamento/ManutencaoPostgresIntegrationTest.java \
  Docs/validacao-producao/riscos-execucao-correcoes.md Docs/validacao-producao/validacao-producao.md
# mais qualquer teste de unidade ajustado no Step 4, por caminho explícito
git commit -m "fix(incidente): fechamento automatico como CAS contra ABERTO/RECONHECIDO

<corpo com a distribuicao antes/depois das duas corridas>

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `lock_timeout` nas transações do motor, decisão no estouro, pool

**Files:**
- Create: `infra-monitor-backend/src/main/java/br/com/inframonitor/monitoring/config/LimiteDeEsperaPorLock.java`
- Modify: `infra-monitor-backend/src/main/java/br/com/inframonitor/monitoring/incident/IncidentProcessor.java` (construtor + primeira linha de `process`)
- Modify: `infra-monitor-backend/src/main/java/br/com/inframonitor/monitoring/latency/LatencyEpisodeProcessor.java` (construtor + primeira linha de `process`)
- Modify: `infra-monitor-backend/src/main/java/br/com/inframonitor/medicao/service/MedicaoService.java:51-61` (catch específico)
- Modify: `infra-monitor-backend/src/main/resources/application.yml` (`maximum-pool-size` e `monitoring.engine.lock-timeout-ms`)
- Modify: testes de unidade que constroem os processors com `new` (`grep -rn "new IncidentProcessor\|new LatencyEpisodeProcessor" infra-monitor-backend/src/test`) — passar `mock(LimiteDeEsperaPorLock.class)`
- Create: `infra-monitor-backend/src/test/java/br/com/inframonitor/monitoring/incident/LockTimeoutMotorPostgresIntegrationTest.java`
- Modify: `Docs/validacao-producao/riscos-execucao-correcoes.md` (seção `## 1b`)
- Check: `grep -rn "DB_POOL_SIZE" --include=*.yml --include=*.md --include=*.env* .` e atualizar o default citado onde houver (ex.: `docker-compose.yml`, CLAUDE.md do backend) — só o número.

**Interfaces:**
- Consumes: nada da Task 1.
- Produces: `LimiteDeEsperaPorLock.aplicarNaTransacaoCorrente()`; propriedade `monitoring.engine.lock-timeout-ms` (default `2000`).

- [ ] **Step 1: Confirmar a conta do pool por leitura de código.** Ler `MonitorExecutionCoordinator`, `MonitoringScheduler`, `NotificationDispatcher`, `NotificationDispatchStateService`, `MedicaoService.criar`. Para cada thread de segundo plano, anotar se segura **no máximo uma** conexão por vez e se segura conexão durante I/O externo (ping, HTTP do Telegram). Resultado esperado: 4 + 1 + 1 + 5 = 11. Anotar arquivo:linha de cada evidência para o documento. Se o número real for outro, usar o real no Step 6.

- [ ] **Step 2: Escrever o teste do caminho do timeout** (`LockTimeoutMotorPostgresIntegrationTest`), usando o mesmo cabeçalho de `ManutencaoPostgresIntegrationTest` (`@EnabledIf("dockerDisponivel")`, `@SpringBootTest(properties = {...})` com as mesmas propriedades, container `postgres:16-alpine`, `@DynamicPropertySource`, truncate no `@BeforeEach`):

```java
    @Autowired private MedicaoService medicaoService;
    @Autowired private PlatformTransactionManager transactionManager;

    /**
     * Uma transacao externa segura a linha de equipamento (a mesma que
     * entrarEmManutencao trava) por SEGURA_LOCK. A 3a falha consecutiva chega pelo
     * caminho real do motor (MedicaoService.criar -> IncidentProcessor), cujo
     * inserirSeElegivel faz FOR UPDATE OF e na mesma linha. Com lock_timeout de 2 s a
     * chamada volta bem antes do lock ser solto: medicao gravada, incidente adiado.
     * Sem lock_timeout, ela espera o lock inteiro — o worker e a conexao ficam presos.
     */
    @Test
    void lockEstouradoPulaOCicloSemPerderMedicaoEAProximaMedicaoAbre() throws Exception {
        long equipamentoId = montarEquipamento();
        long monitorId = montarMonitor(equipamentoId); // falhas_para_incidente = 3
        Instant agora = Instant.now();
        jdbc.update("insert into janela_monitoramento (monitor_id, inicio_em, origem) values (?, ?, 'PRECISA')",
                monitorId, Timestamp.from(agora.minusSeconds(3600)));
        jdbc.update("insert into medicao (monitor_id, status, mensagem, executado_em) values (?, 'FALHA', 'x', ?)",
                monitorId, Timestamp.from(agora.minusSeconds(20)));
        jdbc.update("insert into medicao (monitor_id, status, mensagem, executado_em) values (?, 'FALHA', 'x', ?)",
                monitorId, Timestamp.from(agora.minusSeconds(10)));

        CountDownLatch lockTomado = new CountDownLatch(1);
        Thread detentor = new Thread(() -> new TransactionTemplate(transactionManager).executeWithoutResult(s -> {
            jdbc.queryForObject("select id from equipamento where id = ? for update", Long.class, equipamentoId);
            lockTomado.countDown();
            try { Thread.sleep(SEGURA_LOCK.toMillis()); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
        }), "detentor-do-lock");
        detentor.start();
        assertThat(lockTomado.await(5, TimeUnit.SECONDS)).isTrue();

        long inicio = System.nanoTime();
        medicaoService.criar(new CreateMedicaoRequest(monitorId, StatusMedicao.FALHA, null, "timeout", agora));
        Duration espera = Duration.ofNanos(System.nanoTime() - inicio);
        System.out.println("[lock-timeout] chamada voltou em " + espera.toMillis() + " ms");

        assertThat(espera).as("o motor nao pode esperar o lock inteiro").isLessThan(Duration.ofSeconds(4));
        assertThat(jdbc.queryForObject("select count(*) from medicao where monitor_id = ?", Integer.class, monitorId))
                .as("a medicao e o dado primario e nao se perde").isEqualTo(3);
        assertThat(jdbc.queryForObject("select count(*) from incidente", Integer.class)).isZero();
        assertThat(jdbc.queryForObject("select count(*) from notificacao", Integer.class)).isZero();

        detentor.join(SEGURA_LOCK.plusSeconds(5).toMillis());

        medicaoService.criar(new CreateMedicaoRequest(monitorId, StatusMedicao.FALHA, null, "timeout",
                agora.plusSeconds(10)));
        assertThat(jdbc.queryForObject("select count(*) from incidente where status = 'ABERTO'", Integer.class))
                .as("a proxima medicao reavalia a cauda e abre").isEqualTo(1);
    }
```

Com `private static final Duration SEGURA_LOCK = Duration.ofSeconds(8);`, fixtures `montarEquipamento()`/`montarMonitor()` copiadas de `ManutencaoPostgresIntegrationTest` (mesmas colunas), e imports `CreateMedicaoRequest`, `StatusMedicao`, `CountDownLatch`, `TransactionTemplate`. Conferir a assinatura de `CreateMedicaoRequest` e as colunas NOT NULL de `medicao` em `V6__create_medicao.sql` antes de rodar; ajustar o insert para elas.

- [ ] **Step 3: Rodar — deve falhar pelo tempo (código atual sem lock_timeout)**

Run: `./mvnw -q test -Dtest='LockTimeoutMotorPostgresIntegrationTest' 2>&1 | grep -E "lock-timeout|Tests run|expected|Expect"`
Expected: FAIL — `[lock-timeout] chamada voltou em ~8000 ms`, asserção de tempo falha. Esta é a prova de reversão; guardar o número.

- [ ] **Step 4: Implementar** `LimiteDeEsperaPorLock`:

```java
package br.com.inframonitor.monitoring.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * lock_timeout das transacoes do motor que disputam a linha de equipamento com a
 * manutencao (FOR UPDATE OF e em inserirSeElegivel, e os CAS de fechamento).
 *
 * <p>set_config(..., true) e SET LOCAL: vale so para a transacao corrente e morre no
 * commit/rollback, nao vaza para a conexao devolvida ao pool. Por isso precisa ser a
 * primeira instrucao DENTRO da transacao REQUIRES_NEW de cada processor.
 *
 * <p>2 s: quem segura a linha sao transacoes curtas (entrarEmManutencao, CRUD de
 * equipamento, abertura de outro monitor do mesmo equipamento), na casa de
 * milissegundos; e o menor intervalo de monitor e 10 s. Estourou, o processor faz
 * rollback e a proxima medicao reavalia a cauda — ver MedicaoService.criar.
 */
@Component
public class LimiteDeEsperaPorLock {

    private final JdbcTemplate jdbc;
    private final String valor;

    public LimiteDeEsperaPorLock(JdbcTemplate jdbc,
                                 @Value("${monitoring.engine.lock-timeout-ms:2000}") long lockTimeoutMs) {
        this.jdbc = jdbc;
        this.valor = lockTimeoutMs + "ms";
    }

    public void aplicarNaTransacaoCorrente() {
        jdbc.queryForObject("select set_config('lock_timeout', ?, true)", String.class, valor);
    }
}
```

Em `IncidentProcessor` e `LatencyEpisodeProcessor`: novo parâmetro final no construtor, campo `limiteDeEsperaPorLock`, e primeira linha de `process(...)`: `limiteDeEsperaPorLock.aplicarNaTransacaoCorrente();`.

Em `MedicaoService.criar`, antes de cada `catch (RuntimeException exception)`, um catch específico (import `org.springframework.dao.PessimisticLockingFailureException`):

```java
        } catch (PessimisticLockingFailureException lockNaoObtido) {
            // Contencao esperada com a manutencao, nao erro interno: a transacao do
            // processor voltou inteira, a medicao ficou, e a proxima medicao reavalia a
            // cauda. Tentar de novo aqui prenderia o worker atras do mesmo detentor.
            log.warn("Lock not acquired while processing incidents for measurement {}; "
                    + "re-evaluated on the next measurement", persistida.getId());
        }
```
(e o equivalente no bloco de latência, mensagem com "latency").

Em `application.yml`:

```yaml
      # 4 workers do motor + 1 scheduler + 1 poll e ate 5 workers do dispatcher = 11 conexoes
      # de segundo plano no pico (cada um segura no maximo uma por vez), ja acima do antigo
      # default 10 antes de qualquer requisicao HTTP. 20 deixa 9 para a API.
      maximum-pool-size: ${DB_POOL_SIZE:20}
```
(ajustar a conta ao número real do Step 1) e, sob `monitoring.engine`:

```yaml
    # Espera maxima por lock de linha nas transacoes do motor (SET LOCAL lock_timeout).
    lock-timeout-ms: ${MONITORING_ENGINE_LOCK_TIMEOUT_MS:2000}
```

Se `MonitoringEngineProperties` for validado contra chaves desconhecidas (não é, hoje é bean simples), acrescentar o campo; caso contrário, não.

- [ ] **Step 5: Rodar o teste — deve passar; rodar a suíte**

Run: `./mvnw -q test -Dtest='LockTimeoutMotorPostgresIntegrationTest' 2>&1 | grep -E "lock-timeout|Tests run"` → PASS, ~2000 ms.
Run: `./mvnw test 2>&1 | tail -30` → 0 falhas (ajustar construtores em testes de unidade com `mock(LimiteDeEsperaPorLock.class)`).
Conferir no log do teste a linha WARN `Lock not acquired while processing incidents` (e não um ERROR com stack trace).

- [ ] **Step 6: Documento** — acrescentar `## 1b. lock_timeout e pool` em `riscos-execucao-correcoes.md`: onde o motor espera lock, valor e justificativa, decisão no estouro (pula o ciclo) e por que não "registrar falha" nem "tentar de novo", custo conhecido (abertura adiada um ciclo tem `iniciado_em` um intervalo depois), tempos medidos antes (~8000 ms) e depois (~2000 ms) colados, conta do pool com arquivo:linha de cada detentor, novo default. Registrar explicitamente o que ficou **fora**: os `PESSIMISTIC_WRITE` de `UsuarioRepository` (HTTP) e o `UPDATE` de `entrarEmManutencao` (HTTP) continuam sem `lock_timeout` — vão para a auditoria.

- [ ] **Step 7: Commit** (caminhos explícitos: os arquivos main/test/yml tocados + o documento), mensagem `fix(monitoring): lock_timeout de 2s nas transacoes do motor e pool dimensionado para os workers`, corpo com os tempos medidos e a conta do pool, rodapé Co-Authored-By.

---

### Task 3: Exclusão de monitor apaga a janela; invariante provada para equipamento

**Files:**
- Modify: `infra-monitor-backend/src/main/java/br/com/inframonitor/relatorio/repository/JanelaMonitoramentoRepository.java`
- Modify: `infra-monitor-backend/src/main/java/br/com/inframonitor/relatorio/service/CicloJanelaMonitoramentoService.java`
- Modify: `infra-monitor-backend/src/main/java/br/com/inframonitor/monitor/service/MonitorService.java` (`excluir`)
- Create: `infra-monitor-backend/src/test/java/br/com/inframonitor/monitor/ExclusaoEJanelaPostgresIntegrationTest.java`
- Modify: `Docs/validacao-producao/riscos-execucao-correcoes.md` (seção `## 1c`)

**Interfaces:**
- Produces: `int JanelaMonitoramentoRepository.apagarDoMonitor(Long monitorId)`; `void CicloJanelaMonitoramentoService.apagarDoMonitor(Long monitorId)`.

- [ ] **Step 1: Teste de integração** (mesmo cabeçalho Testcontainers da Task 2; `@Autowired MonitorService monitorService; EquipamentoService equipamentoService; JdbcTemplate jdbc`):

```java
    /** Estado de hoje: criar/ativar abre janela, e a FK da janela e ON DELETE RESTRICT. */
    @Test
    void excluirMonitorSemHistoricoApagaAJanelaEOMonitor() {
        long equipamentoId = montarEquipamento();
        long monitorId = montarMonitor(equipamentoId);
        jdbc.update("insert into janela_monitoramento (monitor_id, inicio_em, origem) values (?, now(), 'PRECISA')",
                monitorId);

        monitorService.excluir(monitorId);

        assertThat(jdbc.queryForObject("select count(*) from monitor where id = ?", Integer.class, monitorId)).isZero();
        assertThat(jdbc.queryForObject("select count(*) from janela_monitoramento where monitor_id = ?",
                Integer.class, monitorId)).isZero();
    }

    @Test
    void excluirMonitorComMedicaoRecusaEPreservaAJanela() {
        long equipamentoId = montarEquipamento();
        long monitorId = montarMonitor(equipamentoId);
        jdbc.update("insert into janela_monitoramento (monitor_id, inicio_em, origem) values (?, now(), 'PRECISA')",
                monitorId);
        jdbc.update("insert into medicao (monitor_id, status, mensagem, executado_em) values (?, 'FALHA', 'x', now())",
                monitorId);

        assertThatThrownBy(() -> monitorService.excluir(monitorId)).isInstanceOf(ConflitoException.class);

        assertThat(jdbc.queryForObject("select count(*) from janela_monitoramento where monitor_id = ? "
                + "and fim_em is null", Integer.class, monitorId)).isEqualTo(1);
    }

    @Test
    void excluirEquipamentoSoComZeroMonitoresLogoSemJanelaOrfa() {
        long comMonitor = montarEquipamento();
        montarMonitor(comMonitor);
        assertThatThrownBy(() -> equipamentoService.excluir(comMonitor)).isInstanceOf(ConflitoException.class);

        long semMonitor = montarEquipamentoComNome("SW-SEM-MONITOR", "10.0.0.11");
        equipamentoService.excluir(semMonitor);
        assertThat(jdbc.queryForObject("select count(*) from equipamento where id = ?", Integer.class, semMonitor))
                .isZero();
        assertThat(jdbc.queryForObject("select count(*) from janela_monitoramento j "
                + "left join monitor m on m.id = j.monitor_id where m.id is null", Integer.class)).isZero();
    }
```

Fixtures copiadas de `ManutencaoPostgresIntegrationTest` (`montarEquipamento` cria tipo+unidade; `montarEquipamentoComNome` reusa a mesma unidade/tipo ou cria outros — nomes únicos por unidade). Conferir colunas NOT NULL de `medicao`.

- [ ] **Step 2: Rodar — o primeiro teste deve falhar** com `DataIntegrityViolationException` (FK `janela_monitoramento` RESTRICT). Guardar a mensagem real do Postgres para o documento.

Run: `./mvnw -q test -Dtest='ExclusaoEJanelaPostgresIntegrationTest' 2>&1 | grep -E "Tests run|violates|FAIL"`

- [ ] **Step 3: Implementar.** Repositório:

```java
 @Modifying(clearAutomatically = true, flushAutomatically = true)
 @Query("delete from JanelaMonitoramento j where j.monitor.id = :id") int apagarDoMonitor(@Param("id") Long id);
```

Serviço (mesmo estilo compacto do arquivo):

```java
 /**
  * Exclusao fisica de monitor: a FK de janela_monitoramento e ON DELETE RESTRICT, e
  * criar/ativar sempre abrem janela — sem isto nenhum monitor ativo sem historico podia
  * ser excluido. Apagar, nao fechar: so e chamado depois das guardas de medicao e
  * incidente, entao nao ha periodo observado a preservar no relatorio.
  */
 @Transactional public void apagarDoMonitor(Long monitorId){repo.apagarDoMonitor(monitorId);}
```

`MonitorService.excluir`, entre a última guarda e o `delete`:

```java
        // Mesma transacao: se o motor gravar uma medicao entre a guarda e o DELETE, a FK
        // de medicao estoura, tudo volta (janelas inclusive) e a API responde 409.
        if (cicloJanela != null) cicloJanela.apagarDoMonitor(id);
        monitorRepository.delete(monitor);
```

- [ ] **Step 4: Rodar a classe (3/3) e a suíte completa** (`./mvnw test 2>&1 | tail -30`, 0 falhas).

- [ ] **Step 5: Documento** — `## 1c` em `riscos-execucao-correcoes.md`: o achado (a exclusão não deixava janela órfã; **falhava** — colar a mensagem real do Postgres do Step 2), a correção, a corrida medição×exclusão resolvida pela FK, equipamento sem mudança de código com o motivo, e "exclusão lógica: não existe — `deleted_at` na V2 sem nenhum uso em Java; nada a cobrir".

- [ ] **Step 6: Commit** — `fix(monitor): exclusao apaga as janelas do monitor na mesma transacao`, caminhos explícitos, Co-Authored-By.

---

### Task 4: Auditoria de concorrência (documento; roda em paralelo às Tasks 1–3, SEM commit)

**Files:**
- Create: `Docs/validacao-producao/auditoria-concorrencia-ciclo-de-vida.md`
- Nada em `src/`. **Não commitar** (o controlador commita na Task 6). Não rodar Maven (a árvore está sendo usada pelas Tasks 1–3).

- [ ] **Step 1: Inventário.** Encontrar toda escrita de ciclo de vida: `grep -rn "@Modifying\|saveAndFlush\|\.save(\|\.delete(\|setAtivo\|setStatus\|FOR UPDATE\|ON CONFLICT\|PESSIMISTIC" infra-monitor-backend/src/main/java` e ler cada serviço: `IncidenteService` (criar, abrirAutomaticamente, reconhecer, fechar, fecharAutomaticamente), `EquipamentoService` (entrar/sairDeManutencao, ativar, desativar, excluir, atualizar), `MonitorService` (criar, atualizar — **move monitor de equipamento sem reavaliar janela** —, ativar, desativar, excluir), `TipoEquipamentoService`, `UnidadeService` (inclui conexão de hub `conecta_a_unidade_id`), `LatencyEpisodeProcessor` + `MonitorEpisodioLatenciaRepository`, `NotificacaoService` + `NotificacaoRepository` + `NotificationDispatchStateService`, `CicloJanelaMonitoramentoService`, serviço de usuário (criar, papel, ativar/desativar, senha, último admin via `lockActiveAdmins`/`findByIdForUpdate`).

- [ ] **Step 2: Para cada escrita, uma linha de tabela** com colunas: `Escrita | arquivo:linha | Guarda no banco (CAS / FOR UPDATE / ON CONFLICT / índice parcial / constraint / nenhuma — ler-depois-escrever) | Teste concorrente real? (classe:método, ou "só sequencial"/"só mock") | Desfecho ilegítimo possível (concreto: qual coluna fica com qual valor errado) | Risco`. Os testes concorrentes reais existentes são só: `ManutencaoPostgresIntegrationTest` (corridas), `NotificacaoConcorrenciaPostgresIntegrationTest`, e os novos das Tasks 1–2 — confirmar lendo, citando método. Marcar `fecharAutomaticamente` e `excluir` de monitor como "corrigido nesta rodada (Task 1/3)".

- [ ] **Step 3: Classificar** com critério escrito no topo: **alto** = caminho do motor (roda sozinho, sem humano) × escrita humana, sem guarda, desfecho corrompe dado ou notifica errado; **médio** = duas ações humanas concorrentes sem guarda, ou guarda só por constraint que vira 409/500 genérico; **baixo** = guarda no banco presente mas sem teste concorrente real, ou desfecho só cosmético. Tabela final ordenada por risco. Incluir as linhas: `fechar` manual (read-modify-write sem CAS), `MonitorService.atualizar` trocando equipamento (janela não reavaliada — pode medir equipamento em manutenção), `CicloJanelaMonitoramentoService.abrir` (ler-depois-escrever protegido só por `uq_janela_monitoramento_aberta` → exceção), `UsuarioRepository` `PESSIMISTIC_WRITE` e `entrarEmManutencao` sem `lock_timeout` (espera ilimitada no HTTP), candidatos do motor não filtram `deleted_at`.

- [ ] **Step 4: Fechar o documento** com "Nada foi corrigido além do item 1" e a lista priorizada para o usuário decidir o escopo. Reportar o caminho do arquivo e a contagem de linhas por risco.

---

### Task 5: Documento de dívidas (em paralelo às Tasks 1–3, SEM commit)

**Files:**
- Create: `Docs/validacao-producao/dividas-fechamento-branches.md`
- Nada em `src/`. Não commitar. Não rodar Maven nem `ng test` na árvore principal.

- [ ] **Step 1: Topo em destaque** — seção `## ⚠ Achado metodológico: teste sequencial de concorrência passa sobre código quebrado`. Evidência: corpo dos commits `9bac9f0` (0/30 legítimos no teste real) e `8ce49f5` (30/30 após o `FOR UPDATE`), e o Javadoc de `ManutencaoPostgresIntegrationTest` ("passam mesmo sem o CAS"). Regra dali em diante: toda afirmação de segurança concorrente exige threads reais + barreira + banco real + repetição + prova de reversão; teste sequencial pode existir, mas não conta como prova. Citar as corridas da Task 1 como a primeira aplicação.

- [ ] **Step 2: Cada dívida com evidência verificada no código ATUAL** (arquivo:linha lidos agora). Fonte dos detalhes da revisão anterior: `grep -o` no transcript `~/.claude/projects/C--Users-rbfilho-Documents-infra-monitor/3ba51cb4-00dc-455a-b1ce-a3bf75c8c74f.jsonl` (buscar "M3", "M4", "M5", "achado conhecido 5", "K1", "não discriminam", "ConditionalOnMissingBean"). Itens:
  1. Dois testes da gaveta que não discriminam o bug antigo — identificar quais dos testes novos de `06413cd` (spec do componente de detalhe/gaveta de incidente) passariam com a guarda antiga (`tipo === Incident` em vez de `encerradoEm`), **por leitura** do teste contra o diff de `06413cd` (`git show 06413cd -- infra-monitor-frontend`). Não rodar `ng test`.
  2. Motivo de encerramento do **episódio** não projetado na lista unificada — `DashboardIncidenteReadRepository` (ramo episódio devolve NULL) e o Javadoc de `DashboardIncidenteResponse:14`.
  3. `motivoEncerramento` enum em `IncidenteResponse:25`, `String` em `DashboardIncidenteResponse:30` e `HistoricoIncidenteResponse:6`.
  4. `@ConditionalOnMissingBean` vestigial — verificar o estado atual (`grep -rn ConditionalOnMissingBean infra-monitor-backend/src` e `git log -S"ConditionalOnMissingBean" --oneline`). Se já foi removido, registrar como **resolvido** com o commit; se ainda existe em algum lugar, registrar onde.
  5. Três pares de testes sobrepostos — M3 (`IcmpAmbienteConfigurationTest` `motorDesligadoAindaAssimTentaACarga` × `cargaNativaComMotorDesligadoQueFuncionaEntregaALigacao`), M4 (`MonitoringEngineConfigurationTest` teste de `:26` × `engineHabilitadoCriaExecutorComMonitoringClockMesmoComNotificationClock`), e o terceiro par (o "achado conhecido 5" da revisão) reidentificado no transcript e confirmado no código. Linhas conferidas hoje.
  6. Memória por thread parada — **NÃO VERIFICADO**, citando `capacidade-pool-monitoramento.md` (seção "Memória — NÃO VERIFICADO") e o que faltaria (`-XX:NativeMemoryTracking`).
  Se algum item não puder ser confirmado no código, escrever "não reidentificado" com o que foi tentado — nunca inventar arquivo/linha.

- [ ] **Step 3: Reportar** caminho e um resumo de uma linha por item.

---

### Task 6: Commit dos documentos das Tasks 4 e 5 (controlador)

- [ ] Revisar os dois documentos (conferir 3 arquivo:linha de cada, por amostragem).
- [ ] Acrescentar ao índice `validacao-producao.md`:

```markdown
| [auditoria-concorrencia-ciclo-de-vida.md](auditoria-concorrencia-ciclo-de-vida.md) | Inventário de toda escrita de ciclo de vida: guarda no banco ou ler-depois-escrever, teste concorrente real ou só sequencial, desfecho ilegítimo possível, classificado por risco — sem correções |
| [dividas-fechamento-branches.md](dividas-fechamento-branches.md) | Dívidas registradas no fechamento dos dois branches, com o achado metodológico em destaque: teste sequencial de concorrência passa sobre código quebrado |
```

- [ ] `git add` dos três caminhos; commit `docs(validacao-producao): auditoria de concorrencia e dividas do fechamento dos branches`.

---

### Task 7: Evidência do mapa em ambiente descartável

**Files:**
- Create: `infra-monitor-frontend/e2e/mapa-manutencao-verificacao.cjs`
- Create: `infra-monitor-frontend/e2e/mapa-manutencao-evidence/` (screenshots + JSON do resultado)
- Modify: `Docs/validacao-producao/manutencao-verificacao-ponta-a-ponta.md` (seção nova "Mapa — refeito com coordenadas", e a tela 5 antiga ganha nota apontando para ela)

**Pré-requisito:** Tasks 1–3 commitadas.

- [ ] **Step 1: Ledger do banco de dev (antes).** Somente SELECT na 5434 (credenciais: ver `backend-dev-run-env` na memória / `.env` local, sem imprimir senha): `select (select count(*) from incidente),(select count(*) from medicao),(select count(*) from notificacao),(select count(*) from equipamento),(select count(*) from janela_monitoramento),(select count(*) from monitor_episodio_latencia),(select max(version) from flyway_schema_history where success)`. Guardar.

- [ ] **Step 2: Ler o roteiro anterior** `infra-monitor-frontend/e2e/manutencao-verificacao.cjs` e reaproveitar login por clique, log de rede em `finally`, e o mock do Telegram se houver script (procurar `8099` no repo e no scratchpad). Ler `infra-monitor-frontend/proxy.conf*` / `angular.json` para saber para onde o dev server aponta a API.

- [ ] **Step 3: Derivar a cor esperada ANTES de subir nada.** Ler a regra de agregação da unidade em `dashboard/OperationalStatusResolver.java` (qual status a unidade assume quando seu único equipamento está em manutenção) e o token de cor desse status no frontend (`grep -rn "EM_MANUTENCAO\|em-manutencao\|manutencao" infra-monitor-frontend/src/app/features/mapa`). Escrever no relatório: status esperado + valor de cor esperado (hex/rgb) + arquivo:linha de onde saiu.

- [ ] **Step 4: Ambiente.** Portas 5435/8099/8080/4200 livres (`netstat -ano | grep -E ":(5435|8099|8080|4200) .*LISTEN"`); se 8080/4200 estiverem ocupadas por processo do usuário, **não matar** — usar outra porta para o backend (`SERVER_PORT`) e um proxy de dev apontando para ela via arquivo temporário no scratchpad. `docker run -d --name infra-e2e -e POSTGRES_DB=inframonitor -e POSTGRES_USER=inframonitor -e POSTGRES_PASSWORD=<gerada> -p 5435:5432 postgres:16-alpine`. Mock do Telegram (Node `http`, 8099, responde `{"ok":true,"result":{"message_id":1}}` a `POST /bot*/sendMessage`, grava JSON-lines no scratchpad). Backend a partir de jar empacotado copiado para o scratchpad (`./mvnw -q -DskipTests package` e `cp target/*.jar <scratchpad>/`), com `DB_PORT=5435`, `DB_PASSWORD`, `JWT_SECRET` gerado, `MONITORING_ENGINE_ENABLED=true`, `NOTIFICATION_DISPATCHER_ENABLED=true`, `TELEGRAM_ENABLED=true`, `TELEGRAM_BOT_TOKEN=token-de-teste`, `TELEGRAM_CHAT_ID=-1`, `TELEGRAM_API_BASE_URL=http://localhost:8099`, admin via `BOOTSTRAP_ADMIN_EMAIL`/senha gerada só em variável de ambiente. Confirmar pelo log que a URL da API do Telegram é a do mock **antes** de ligar o dispatcher com dados.

- [ ] **Step 5: Cadastro pela API.** Tipo; unidade **com latitude/longitude** dentro da área que o mapa enquadra (copiar coordenada de uma unidade do dev-seed/`Docs/mapa-architecture` — não inventar fora do enquadramento); um equipamento `192.0.2.11` nessa unidade; monitor ICMP (`intervaloSegundos=10`, `falhasParaIncidente=3`). Opcional: segunda unidade com coordenadas e `192.0.2.10` sem manutenção, para contraste. Esperar o incidente abrir e o mock receber `INCIDENTE ABERTO`; então `entrar em manutenção` no `.11`. Conferir por SQL na 5435: `em_manutencao=true`, incidente FECHADO/MANUTENCAO.

- [ ] **Step 6: Congelar** — motor e dispatcher desligados (reiniciar backend com `MONITORING_ENGINE_ENABLED=false`, `NOTIFICATION_DISPATCHER_ENABLED=false`), duas contagens de `medicao` com 15 s de intervalo iguais.

- [ ] **Step 7: Playwright** (`mapa-manutencao-verificacao.cjs`): login por clique; navegar ao Mapa pelo menu (clique); esperar o marcador da unidade de teste; ler a cor computada do marcador (o elemento que carrega a cor de status — descobrir pelo DOM do componente do marcador) e comparar com a esperada do Step 3; screenshot `01-marcador-em-manutencao.png` (de perto) e `02-mapa-inteiro.png`; clicar no marcador; esperar o painel com o equipamento e o badge "Em manutenção"; screenshot `03-painel-equipamento-em-manutencao.png`. Sem `catch` mudo; resultado e log de rede gravados em `finally` em `mapa-manutencao-evidence/mapa-manutencao-verificacao.json`. **Se a cor divergir: registrar esperado × obtido e seguir — não alterar código nem CSS.** Olhar cada screenshot (Read) antes de descrevê-lo.

- [ ] **Step 8: Destruir e provar** — parar backend, mock, dev server que esta tarefa subiu; `docker rm -f infra-e2e`; nenhuma porta 5435/8099 em LISTEN; ledger do banco de dev de novo — números idênticos ao Step 1.

- [ ] **Step 9: Documento + commit.** Seção nova em `manutencao-verificacao-ponta-a-ponta.md` com: ambiente, cadastro (coordenadas usadas), SQL de conferência colado, cor esperada (com origem) × obtida, descrição de cada screenshot, ledger antes/depois. Commit com caminhos explícitos (`e2e/mapa-manutencao-verificacao.cjs`, `e2e/mapa-manutencao-evidence/`, o documento): `test(e2e): evidencia do marcador em manutencao no mapa com unidade georreferenciada`.

---

### Task 8: Merge na `main` local, sem push

- [ ] **Step 1: Suítes antes, na ponta de `feat/manutencao-equipamento`** (árvore principal): `cd infra-monitor-backend && ./mvnw test 2>&1 | grep -E "Tests run:|BUILD"` e `cd ../infra-monitor-frontend && npx ng test --watch=false 2>&1 | tail -15`. Colar contagens. Qualquer vermelho: PARE, não mescle.
- [ ] **Step 2: Worktree** — `git fetch origin`; `git worktree add ../infra-monitor-merge main`; nele `git merge --ff-only origin/main` e `git log --oneline -1`.
- [ ] **Step 3: Merges** — `git merge --no-ff fix/icmp-nativo-windows -m "Merge branch 'fix/icmp-nativo-windows'"` e depois `git merge --no-ff feat/manutencao-equipamento -m "Merge branch 'feat/manutencao-equipamento'"` (mensagens com rodapé Co-Authored-By). Se houver conflito: `git diff --name-only --diff-filter=U`, mostrar cada hunk, resolver preservando a versão do branch (que descende de `origin/main`) salvo evidência contrária, registrar cada resolução.
- [ ] **Step 4: Suítes depois, no worktree** — `npm ci` no frontend do worktree, `./mvnw test`, `npx ng test --watch=false`, `npx ng build`. Colar contagens e o resumo do build (tamanhos, warnings).
- [ ] **Step 5: Registrar** em `Docs/validacao-producao/topologia-git-e-estrategia-de-merge.md` uma seção `## 7. Execução (2026-09-24)` com os comandos, hashes resultantes, conflitos (ou "nenhum"), contagens antes/depois — commit **no branch `feat/manutencao-equipamento` antes do Step 3** não é possível (o merge já teria de conter o doc): fazer esse commit **na main do worktree** depois do merge, `docs(validacao-producao): registra a execucao do merge`, e informar ao usuário que esse commit existe só na `main`.
- [ ] **Step 6: Não fazer push.** `git -C ../infra-monitor-merge log --oneline --graph -6` e `git status -sb` (mostra `ahead N`) para o relatório. Manter o worktree (o usuário decide o push a partir dele ou da main).
