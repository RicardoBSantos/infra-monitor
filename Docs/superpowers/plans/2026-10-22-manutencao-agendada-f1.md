# Manutenção agendada F1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Operador agenda janelas de manutenção (unidade inteira ou equipamentos) que um job ativa e conclui sozinho, convivendo com o botão manual, com tela de lista e agendamento.

**Architecture:** `equipamento.em_manutencao` vira o estado efetivo materializado (`manutencao_manual OR coberto por janela ATIVA`, CHECK no banco) e continua sendo a única guarda lida por motor, INSERTs condicionais, janela de SLA e painel. Um único componente (`EstadoManutencaoEquipamento.reavaliar`) escreve o flag sob `FOR UPDATE` e aplica os efeitos de entrada/saída já existentes. Um reconciliador de nível (`ReconciliadorManutencao`, tick de 30 s) é o único dono do relógio: CAS de situação + reavaliação dos cobertos + correção de divergência.

**Tech Stack:** Java 21, Spring Boot 4.1, Spring Data JPA + `NamedParameterJdbcTemplate`, PostgreSQL 16, Flyway, JUnit 5 + Testcontainers; Angular (standalone, signals), Jasmine/Karma; Playwright (scripts `.cjs`).

**Spec:** `Docs/superpowers/specs/2026-10-22-manutencao-agendada-f1-design.md` (+ desenho em `Docs/manutencao-agendada-architecture/`).

## Global Constraints

- Branch `feat/manutencao-agendada`. Commits sempre com `git commit -- <arquivos>` (agentes paralelos compartilham o index); mensagem termina com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Migration nova `V21__create_manutencao_agendada.sql`; nunca editar V1–V20.
- Sem Lombok; `record` para DTOs; injeção por construtor; `Instant`, nunca `Date`.
- Mensagens de erro da API em ASCII sem acento, no estilo `Nao e possivel ...`; formato `ErroResposta` (já garantido pelo `TratadorGlobalDeErros`: `IllegalArgumentException` → 400 `INVALID_REQUEST`, `ConflitoException` → 409 `BUSINESS_CONFLICT`, `RecursoNaoEncontradoException` → 404).
- Toda transição guardada no banco (CAS no `WHERE`, `FOR UPDATE`, `ON CONFLICT`). Nunca ler-depois-escrever sem lock.
- **Leitura de cobertura em instrução SEPARADA, depois do `FOR UPDATE`.** Sob READ COMMITTED, um `SELECT ... FOR UPDATE` que espera lock reavalia só a linha travada; um `EXISTS` na mesma instrução usa o snapshot de antes da espera e pode não ver a janela que o outro acabou de ativar.
- Teste de integração com Postgres leva `@RequerDocker` e `@SpringBootTest(properties = {"app.auth.jwt.secret=test-only-jwt-secret-with-at-least-32-bytes","app.auth.jwt.issuer=infra-monitor-test","app.auth.jwt.access-token-minutes=15","monitoring.engine.enabled=false","notification.telegram.enabled=false","notification.dispatcher.enabled=false"})`, container `postgres:16-alpine`, `@DynamicPropertySource` como em `FechamentoManualConcorrenciaPostgresIntegrationTest`. `truncate` deve incluir `manutencao_agendada_equipamento, manutencao_agendada`.
- Corrida = `@RepeatedTest(30)`, duas threads reais, `CyclicBarrier(2)`, atraso aleatório calibrado após a barreira, `System.out.println("[corrida-<nome>] desfecho=<ROTULO> ...")`, asserção "zero ILEGITIMO". Teste sequencial não conta.
- Frontend: geração A (`.pagina`), `app-paginacao`, `StatusBadgeComponent`, `app-modal`, `app-confirm-dialog`, `app-action-menu`, `.tabela`. Nenhum badge, modal ou diálogo local.
- Variáveis novas: `MANUTENCAO_AGENDADA_ENABLED` (padrão `false`), `MANUTENCAO_AGENDADA_INTERVALO_MS` (`30000`), `MANUTENCAO_AGENDADA_DURACAO_MAXIMA` (`72h`).
- Mensagem exata do 409 com job desligado: `Agendamento de manutencao desligado neste servidor: nenhuma janela seria ativada. Para ligar, defina MANUTENCAO_AGENDADA_ENABLED=true nas variaveis de ambiente do servico do backend e reinicie-o. Enquanto isso, use "Iniciar manutencao" no equipamento.`

## Review Focus

1. **Encerrar o manual com janela ATIVA** — o equipamento continua em manutenção, nenhum efeito de saída roda, a resposta diz `emManutencao: true`. Teste em Task 3.
2. **Edição de equipamento enquanto o job vira o flag** — `PUT /equipamentos/{id}` com entidade carregada antes não pode regravar `em_manutencao`. Teste determinístico em Task 1 e corrida em Task 6.
3. **Janela criada com início no passado recente (tolerância de 5 min) ou "agora"** — ativa na hora, sem esperar o tick. Teste em Task 4.
4. **Primeira passada do reconciliador lançando exceção** — o motor não pode ficar bloqueado para sempre; `ReconciliacaoInicial` é marcada no `finally`. Teste em Task 5.
5. **Datas digitadas no `datetime-local`** — o front envia ISO UTC do horário local do navegador; fim ≤ início e duração acima do máximo são barrados antes do envio. Spec em Task 9.

---

## File Structure

**Backend — novos**
- `src/main/resources/db/migration/V21__create_manutencao_agendada.sql` — coluna manual, CHECK, duas tabelas.
- `equipamento/service/EfeitosManutencao.java` — efeitos de entrada e saída (movidos do `EquipamentoService`).
- `equipamento/service/EstadoManutencaoEquipamento.java` — único escritor de `em_manutencao`/`manutencao_manual`.
- `manutencao/entity/{ManutencaoAgendada,SituacaoManutencao,EscopoManutencao}.java`
- `manutencao/repository/ManutencaoAgendadaRepository.java` — JPA (listagem, exists).
- `manutencao/repository/CoberturaManutencao.java` — JDBC: cobertura, divergência, transições CAS com `RETURNING`.
- `manutencao/config/ManutencaoAgendadaProperties.java`, `manutencao/config/ManutencaoAgendadaConfiguration.java`
- `manutencao/service/ManutencaoAgendadaService.java`, `manutencao/service/ReconciliadorManutencao.java`, `manutencao/service/ReconciliacaoInicial.java`
- `manutencao/dto/{CriarManutencaoRequest,ManutencaoResponse,ParametrosManutencaoResponse}.java`
- `manutencao/controller/ManutencaoAgendadaController.java`

**Backend — modificados**
- `equipamento/entity/Equipamento.java` (colunas `updatable = false`, `manutencaoManual`)
- `equipamento/repository/EquipamentoRepository.java` (CAS nativos, lock)
- `equipamento/service/EquipamentoService.java` (delegação, hooks, 409 de exclusão)
- `equipamento/dto/EquipamentoResponse.java` (+`manutencaoManual`)
- `unidade/service/UnidadeService.java` (409 de exclusão)
- `monitoring/scheduler/MonitoringScheduler.java` (gate)
- `dashboard/DashboardReadRepository.java`, `dashboard/DashboardService.java`, `dashboard/dto/DashboardEquipamentoListaResponse.java`
- `security/SecurityConfiguration.java`, `src/main/resources/application.yml`, `README` do backend
- testes que constroem `EquipamentoResponse`/`DashboardEquipamentoListaResponse`/`EquipamentoRow`

**Frontend — novos**
- `core/models/manutencao.ts`, `core/services/manutencao-api.service.ts` (+spec)
- `features/manutencoes/manutencao-list.component.{ts,html,scss,spec.ts}`
- `features/manutencoes/agendar-manutencao.component.{ts,html,scss,spec.ts}` (conteúdo do `app-modal`)
- `e2e/manutencao-agendada.cjs`

**Frontend — modificados**
- `core/models/api-enums.ts`, `shared/status-badge/status-badge.component.ts` (+spec)
- `core/models/dashboard.ts`, `core/models/equipamento.ts`
- `features/equipamentos/equipamento-list.component.{ts,html}` (+spec), `equipamento-detalhe-drawer.component.{ts,html}` (+spec)
- `app.routes.ts`, `layout/sidebar/sidebar.component.ts`

**Docs**: `Docs/validacao-producao/manutencao-agendada-f1.md` (novo), `Docs/manutencao-agendada-architecture/*`.

## Ordem e paralelismo

- Trilha backend sequencial: T1 → T2 → T3 → T4 → T5 → T6 (corridas) e T7 (read-model) depois de T3.
- Trilha frontend: T8 e T9 podem começar em paralelo à trilha backend (contrato HTTP fixado no spec §2.3 e abaixo); T8 antes de T9.
- T10 (validação integrada, e2e, carga, docs) depois de todas.

---

### Task 1: Migration V21, mapeamento da entidade e fim do lost update

**Files:**
- Create: `infra-monitor-backend/src/main/resources/db/migration/V21__create_manutencao_agendada.sql`
- Modify: `infra-monitor-backend/src/main/java/br/com/inframonitor/equipamento/entity/Equipamento.java`
- Modify: `infra-monitor-backend/src/main/java/br/com/inframonitor/equipamento/repository/EquipamentoRepository.java:38-50`
- Test: `infra-monitor-backend/src/test/java/br/com/inframonitor/manutencao/MigracaoManutencaoAgendadaPostgresIntegrationTest.java`
- Test: `infra-monitor-backend/src/test/java/br/com/inframonitor/equipamento/FlagManutencaoNaoSobrescritoPostgresIntegrationTest.java`

**Interfaces:**
- Produces: colunas/tabelas do spec §1; `Equipamento#isManutencaoManual()`; `EquipamentoRepository`:
  - `Optional<EstadoManutencaoTravado> travarEstadoManutencao(Long id)` — `SELECT em_manutencao, manutencao_manual ... FOR UPDATE`
  - `int marcarManual(Long id, Instant agora)` — CAS `NOT manutencao_manual` → `manual = true, em = true`
  - `int desmarcarManual(Long id, Instant agora)` — CAS `manutencao_manual` → `manual = false`
  - `int trocarEmManutencao(Long id, boolean anterior, boolean novo, Instant agora)` — CAS `em_manutencao = anterior`
  - interface `EstadoManutencaoTravado { boolean getEmManutencao(); boolean getManutencaoManual(); }`
  - Remove `marcarEmManutencaoSeNaoEstiver`/`desmarcarManutencaoSeEstiver` (substituídos; chamadores migram na Task 2 — neste task mantenha-os compilando como delegação temporária para `marcarManual`/`desmarcarManual` se o build exigir, e apague na Task 2).

- [ ] **Step 1: Escrever a migration**

```sql
-- V21 - Manutencao agendada (janelas) e separacao do botao manual.
--
-- equipamento.em_manutencao passa a ser o estado EFETIVO: manutencao manual OU
-- janela ATIVA cobrindo o equipamento. Continua sendo a unica coluna lida por motor,
-- INSERTs condicionais (V7/V15), M7, janela de SLA e painel: nenhum deles muda.
-- O botao ganha coluna propria, e o CHECK torna impossivel "a janela terminou e o
-- equipamento voltou a ser pingado com o botao ainda ligado".
-- Desenho: Docs/manutencao-agendada-architecture/manutencao-agendada-desenho.md

ALTER TABLE equipamento ADD COLUMN manutencao_manual BOOLEAN NOT NULL DEFAULT FALSE;

-- Ate aqui toda manutencao era manual.
UPDATE equipamento SET manutencao_manual = em_manutencao;

ALTER TABLE equipamento ADD CONSTRAINT ck_equipamento_manutencao_manual_efetiva
    CHECK (NOT manutencao_manual OR em_manutencao);

-- Nome longe de janela_monitoramento de proposito: aquela e a elegibilidade temporal
-- do SLA, por monitor; a manutencao e uma das causas para ela fechar (MA03).
CREATE TABLE manutencao_agendada (
    id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    unidade_id BIGINT NOT NULL REFERENCES unidade(id) ON DELETE RESTRICT,
    escopo VARCHAR(12) NOT NULL,
    inicio_previsto TIMESTAMPTZ NOT NULL,
    fim_previsto TIMESTAMPTZ NOT NULL,
    motivo VARCHAR(300) NOT NULL,
    status VARCHAR(10) NOT NULL DEFAULT 'AGENDADA',
    criado_por_id BIGINT NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
    ativada_em TIMESTAMPTZ,
    encerrada_em TIMESTAMPTZ,
    -- NULL = fim automatico pelo reconciliador.
    encerrada_por_id BIGINT REFERENCES usuarios(id) ON DELETE RESTRICT,
    cancelada_em TIMESTAMPTZ,
    cancelada_por_id BIGINT REFERENCES usuarios(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_manutencao_agendada_escopo CHECK (escopo IN ('UNIDADE', 'EQUIPAMENTOS')),
    CONSTRAINT ck_manutencao_agendada_status CHECK (
        status IN ('AGENDADA', 'ATIVA', 'CONCLUIDA', 'CANCELADA', 'EXPIRADA')),
    CONSTRAINT ck_manutencao_agendada_periodo CHECK (fim_previsto > inicio_previsto),
    CONSTRAINT ck_manutencao_agendada_motivo CHECK (btrim(motivo) <> ''),
    -- Irma de ck_incidente_fechamento_coerente (V17): cada status carrega exatamente os seus carimbos.
    CONSTRAINT ck_manutencao_agendada_coerente CHECK (
        (status = 'AGENDADA'  AND ativada_em IS NULL     AND encerrada_em IS NULL     AND cancelada_em IS NULL)
     OR (status = 'ATIVA'     AND ativada_em IS NOT NULL AND encerrada_em IS NULL     AND cancelada_em IS NULL)
     OR (status = 'CONCLUIDA' AND ativada_em IS NOT NULL AND encerrada_em IS NOT NULL AND cancelada_em IS NULL)
     OR (status = 'CANCELADA' AND ativada_em IS NULL     AND encerrada_em IS NULL
                              AND cancelada_em IS NOT NULL AND cancelada_por_id IS NOT NULL)
     OR (status = 'EXPIRADA'  AND ativada_em IS NULL     AND encerrada_em IS NULL     AND cancelada_em IS NULL)),
    CONSTRAINT ck_manutencao_agendada_encerrador CHECK (encerrada_por_id IS NULL OR status = 'CONCLUIDA'),
    -- Nunca ativa antes do previsto; ativar DEPOIS e o caso do sistema parado (MA08).
    CONSTRAINT ck_manutencao_agendada_ativacao CHECK (ativada_em IS NULL OR ativada_em >= inicio_previsto),
    CONSTRAINT ck_manutencao_agendada_encerramento CHECK (encerrada_em IS NULL OR encerrada_em >= ativada_em)
);

-- O reconciliador so olha o que ainda pode mudar.
CREATE INDEX ix_manutencao_agendada_vigentes ON manutencao_agendada (inicio_previsto)
    WHERE status IN ('AGENDADA', 'ATIVA');
CREATE INDEX ix_manutencao_agendada_unidade ON manutencao_agendada (unidade_id, inicio_previsto DESC);

CREATE TABLE manutencao_agendada_equipamento (
    manutencao_id BIGINT NOT NULL REFERENCES manutencao_agendada(id) ON DELETE RESTRICT,
    equipamento_id BIGINT NOT NULL REFERENCES equipamento(id) ON DELETE RESTRICT,
    PRIMARY KEY (manutencao_id, equipamento_id)
);
CREATE INDEX ix_manutencao_agendada_equipamento_equip ON manutencao_agendada_equipamento (equipamento_id);
```

- [ ] **Step 2: Teste da migration (falha antes do Step 1 rodar no Flyway — confirme que o arquivo é V21 e que o teste pega cada CHECK)**

`MigracaoManutencaoAgendadaPostgresIntegrationTest` (anotações das Global Constraints). Fixtures por SQL (unidade, tipo, equipamento, usuário como no teste de fechamento manual). Casos, cada um `assertThatThrownBy(() -> jdbc.update(...)).isInstanceOf(DataIntegrityViolationException.class).hasMessageContaining("<nome da constraint>")`:

```java
@Test void manualSemEfetivoERecusado() {
    long e = equipamento(false);
    assertThatThrownBy(() -> jdbc.update("update equipamento set manutencao_manual = true where id = ?", e))
            .isInstanceOf(DataIntegrityViolationException.class)
            .hasMessageContaining("ck_equipamento_manutencao_manual_efetiva");
}
@Test void efetivoSemManualEPermitido() { // e o caso "so janela"
    long e = equipamento(false);
    jdbc.update("update equipamento set em_manutencao = true where id = ?", e);
    assertThat(jdbc.queryForObject("select em_manutencao from equipamento where id = ?", Boolean.class, e)).isTrue();
}
@Test void backfillCopiaManutencaoExistente() // insere com em_manutencao = true via SQL ANTES? Nao: Flyway ja rodou.
// Em vez disso: provar o DEFAULT -> novo equipamento nasce manual = false.
@Test void ativaSemCarimboERecusada()       // status ATIVA, ativada_em NULL -> ck_manutencao_agendada_coerente
@Test void canceladaSemAutorERecusada()     // CANCELADA com cancelada_em e sem cancelada_por_id -> coerente
@Test void periodoInvertidoERecusado()      // fim <= inicio -> ck_manutencao_agendada_periodo
@Test void motivoEmBrancoERecusado()        // '   ' -> ck_manutencao_agendada_motivo
@Test void ativacaoAntesDoPrevistoERecusada() // ativada_em < inicio_previsto -> ck_manutencao_agendada_ativacao
@Test void encerradorSoEmConcluida()        // ATIVA com encerrada_por_id -> ck_manutencao_agendada_encerrador
@Test void excluirEquipamentoLigadoEBarradoPelaFk() // delete equipamento ligado -> fk (DataIntegrityViolationException)
```

Run: `cd infra-monitor-backend && ./mvnw -q test -Dtest=MigracaoManutencaoAgendadaPostgresIntegrationTest`
Expected: PASS (com Docker). Sem Docker, a classe aparece pulada no aviso `!!` — **não aceite isso como verde**; rode com Docker.

- [ ] **Step 3: Escrever o teste do lost update (falha com a entidade atual)**

`FlagManutencaoNaoSobrescritoPostgresIntegrationTest`:

```java
@Test
void atualizarComEntidadeVelhaNaoRegravaEmManutencao() {
    long id = equipamento(false);
    new TransactionTemplate(transactionManager).executeWithoutResult(s -> {
        Equipamento velho = equipamentoRepository.findById(id).orElseThrow(); // em_manutencao = false na sessao
        emOutraThread(() -> jdbc.update("update equipamento set em_manutencao = true where id = ?", id));
        velho.setNome("SW-CORE-RENOMEADO");  // dirty-check dispara UPDATE da linha
    });
    Map<String, Object> linha = jdbc.queryForMap("select nome, em_manutencao from equipamento where id = ?", id);
    assertThat(linha).containsEntry("nome", "SW-CORE-RENOMEADO").containsEntry("em_manutencao", true);
}
```
(`emOutraThread` copiado de `FechamentoManualConcorrenciaPostgresIntegrationTest`.)

Run: `./mvnw -q test -Dtest=FlagManutencaoNaoSobrescritoPostgresIntegrationTest`
Expected: FAIL — `em_manutencao` volta a `false` (prova de que o lost update existe hoje). Registre a saída para o doc de evidências.

- [ ] **Step 4: Entidade**

Em `Equipamento.java`:

```java
    // Escritos SOMENTE por SQL nativo com CAS (EquipamentoRepository) sob FOR UPDATE.
    // updatable = false: atualizar/ativar/desativar fazem dirty-check da linha inteira e,
    // sem isto, regravariam o valor que estava na sessao por cima de uma virada feita
    // pelo reconciliador no meio (lost update provado em FlagManutencaoNaoSobrescrito...).
    @Column(name = "em_manutencao", nullable = false, updatable = false)
    private boolean emManutencao;

    @Column(name = "manutencao_manual", nullable = false, updatable = false)
    private boolean manutencaoManual;

    public boolean isManutencaoManual() { return manutencaoManual; }
```
Mantém `setEmManutencao` (usado por testes em memória: `AberturaCondicionalTest`, `InvarianteJanelaTest`) com javadoc "só para testes em memória; não persiste (`updatable = false`)".

- [ ] **Step 5: Repositório**

Substitua os dois CAS JPQL por:

```java
    interface EstadoManutencaoTravado {
        boolean getEmManutencao();
        boolean getManutencaoManual();
    }

    // Ponto de serializacao unico de tudo que mexe em manutencao: o mesmo lock de linha que
    // IncidenteRepository.inserirSeElegivel e travarElegibilidadeParaAbertura (M7) tomam.
    // SO a linha: a cobertura por janela e lida em instrucao SEPARADA, depois do lock
    // (ver EstadoManutencaoEquipamento).
    @Query(value = "SELECT em_manutencao AS emManutencao, manutencao_manual AS manutencaoManual "
            + "FROM equipamento WHERE id = :id FOR UPDATE", nativeQuery = true)
    Optional<EstadoManutencaoTravado> travarEstadoManutencao(@Param("id") Long id);

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query(value = "UPDATE equipamento SET manutencao_manual = true, em_manutencao = true, updated_at = :agora "
            + "WHERE id = :id AND NOT manutencao_manual", nativeQuery = true)
    int marcarManual(@Param("id") Long id, @Param("agora") Instant agora);

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query(value = "UPDATE equipamento SET manutencao_manual = false, updated_at = :agora "
            + "WHERE id = :id AND manutencao_manual", nativeQuery = true)
    int desmarcarManual(@Param("id") Long id, @Param("agora") Instant agora);

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query(value = "UPDATE equipamento SET em_manutencao = :novo, updated_at = :agora "
            + "WHERE id = :id AND em_manutencao = :anterior", nativeQuery = true)
    int trocarEmManutencao(@Param("id") Long id, @Param("anterior") boolean anterior,
                           @Param("novo") boolean novo, @Param("agora") Instant agora);
```

- [ ] **Step 6: Rodar os dois testes**

Run: `./mvnw -q test -Dtest='MigracaoManutencaoAgendadaPostgresIntegrationTest,FlagManutencaoNaoSobrescritoPostgresIntegrationTest'`
Expected: PASS. Prova de reversão do lost update: remova `updatable = false` de `emManutencao`, rode, veja FAIL, restaure; cole as duas saídas (curtas) em `Docs/validacao-producao/manutencao-agendada-f1.md` (crie o arquivo com cabeçalho "Evidências da F1").

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(manutencao): V21 com janela agendada e flag manual separado

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- <arquivos do task>
```

---

### Task 2: Efeitos extraídos e `EstadoManutencaoEquipamento`

**Files:**
- Create: `.../equipamento/service/EfeitosManutencao.java`
- Create: `.../equipamento/service/EstadoManutencaoEquipamento.java`
- Create: `.../manutencao/repository/CoberturaManutencao.java`
- Modify: `.../equipamento/service/EquipamentoService.java:133-200` (entrar/sair delegam; `criar`/`atualizar` chamam `reavaliar`)
- Modify: `.../equipamento/dto/EquipamentoResponse.java` (+`boolean manutencaoManual` depois de `emManutencao`) e todos os construtores dele em `src/main` e `src/test`
- Test: `.../equipamento/ConvivenciaManualJanelaPostgresIntegrationTest.java`

**Interfaces:**
- Consumes (Task 1): `EquipamentoRepository.travarEstadoManutencao/marcarManual/desmarcarManual/trocarEmManutencao`.
- Produces:
  - `EfeitosManutencao#aplicarEntrada(Long equipamentoId, Usuario autor, Instant agora)`; `#aplicarSaida(Long equipamentoId)`
  - `EstadoManutencaoEquipamento#reavaliar(Long equipamentoId)` (`@Transactional`, `Propagation.REQUIRED`): devolve `boolean` = estado efetivo final
  - `EstadoManutencaoEquipamento#iniciarManual(Long id, Long usuarioId)`, `#encerrarManual(Long id)` (`@Transactional`)
  - `CoberturaManutencao` (JDBC, `@Repository`): `boolean coberto(long equipamentoId)`, `Optional<Long> autorDaCobertura(long equipamentoId)`, `List<Long> divergentes()`, `List<Long> cobertosPor(long manutencaoId)`, constante `public static final String COBERTO_E` (predicado com alias `e`), e as transições usadas na Task 4/5.

- [ ] **Step 1: Teste de convivência (falha: classes não existem)**

`ConvivenciaManualJanelaPostgresIntegrationTest` monta unidade/tipo/equipamento/monitor/janela de SLA aberta e insere janelas por SQL. Helper:

```java
private long janelaAtivaDoEquipamento(long equipamentoId, long unidadeId) {
    long id = insert("insert into manutencao_agendada (unidade_id, escopo, inicio_previsto, fim_previsto, motivo, "
            + "status, criado_por_id, ativada_em) values (?, 'EQUIPAMENTOS', now() - interval '10 minutes', "
            + "now() + interval '1 hour', 'Troca do switch', 'ATIVA', ?, now() - interval '10 minutes') returning id",
            unidadeId, operadorId);
    jdbc.update("insert into manutencao_agendada_equipamento values (?, ?)", id, equipamentoId);
    return id;
}
```
Casos (tabela §4.1 do desenho), cada um conferindo `em_manutencao`, `manutencao_manual`, nº de `janela_monitoramento` abertas do monitor e incidentes:

```java
@Test void janelaAtivaSemManualEntraComEfeitos() {
    // incidente ABERTO pre-existente
    janelaAtivaDoEquipamento(e, u);
    assertThat(estado.reavaliar(e)).isTrue();
    assertThat(flags(e)).containsEntry("em_manutencao", true).containsEntry("manutencao_manual", false);
    assertThat(incidente(i)).containsEntry("status", "FECHADO").containsEntry("motivo_encerramento", "MANUTENCAO")
            .containsEntry("fechado_por", operadorId);   // autor = criado_por da janela (MA10)
    assertThat(janelasSlaAbertas(m)).isZero();
}
@Test void janelaTerminaComManualLigadoNaoSai() {
    estado.iniciarManual(e, operadorId);
    long j = janelaAtivaDoEquipamento(e, u);
    jdbc.update("update manutencao_agendada set status='CONCLUIDA', encerrada_em = now() where id = ?", j);
    assertThat(estado.reavaliar(e)).isTrue();
    assertThat(janelasSlaAbertas(m)).isZero();
}
@Test void encerrarManualDuranteJanelaAtivaContinuaEmManutencao() {
    estado.iniciarManual(e, operadorId);
    janelaAtivaDoEquipamento(e, u);
    EquipamentoResponse r = equipamentoService.sairDeManutencao(e);
    assertThat(r.emManutencao()).isTrue();
    assertThat(r.manutencaoManual()).isFalse();
    assertThat(janelasSlaAbertas(m)).isZero();   // nenhum efeito de saida
}
@Test void manualLigadoDuranteJanelaNaoRodaEfeitosDeNovo() {
    janelaAtivaDoEquipamento(e, u); estado.reavaliar(e);
    int notificacoesAntes = contarNotificacoes();
    estado.iniciarManual(e, operadorId);
    assertThat(flags(e)).containsEntry("manutencao_manual", true).containsEntry("em_manutencao", true);
    assertThat(contarNotificacoes()).isEqualTo(notificacoesAntes);
}
@Test void osDoisTerminamSaiEReabreJanelaSla() {
    estado.iniciarManual(e, operadorId);
    long j = janelaAtivaDoEquipamento(e, u);
    jdbc.update("update manutencao_agendada set status='CONCLUIDA', encerrada_em = now() where id = ?", j);
    equipamentoService.sairDeManutencao(e);
    assertThat(flags(e)).containsEntry("em_manutencao", false);
    assertThat(janelasSlaAbertas(m)).isEqualTo(1);
}
@Test void escopoUnidadeCobreEquipamentoCriadoDuranteAJanela()  // janela UNIDADE ativa; equipamentoService.criar(...) -> em_manutencao = true
@Test void equipamentoMovidoParaForaDaUnidadeSaiDaJanela()      // atualizar com outra unidadeId -> em_manutencao = false
@Test void escopoEquipamentosSegueOIdAoMudarDeUnidade()          // EQUIPAMENTOS; atualizar unidade -> continua true
```

Run: `./mvnw -q test -Dtest=ConvivenciaManualJanelaPostgresIntegrationTest` → FAIL (compilação).

- [ ] **Step 2: `CoberturaManutencao`**

```java
package br.com.inframonitor.manutencao.repository;

@Repository
public class CoberturaManutencao {

    /**
     * Fonte unica do predicado "coberto por janela ATIVA", com alias {@code e} para equipamento.
     * Olha o STATUS, nunca o relogio: so o reconciliador consulta o relogio (MA06), e painel,
     * motor e efeitos nao podem discordar por segundos.
     */
    public static final String COBERTO_E = """
            EXISTS (SELECT 1 FROM manutencao_agendada ma
                     WHERE ma.status = 'ATIVA'
                       AND ((ma.escopo = 'UNIDADE' AND ma.unidade_id = e.unidade_id)
                         OR (ma.escopo = 'EQUIPAMENTOS' AND EXISTS (
                               SELECT 1 FROM manutencao_agendada_equipamento mae
                                WHERE mae.manutencao_id = ma.id AND mae.equipamento_id = e.id))))""";

    private final NamedParameterJdbcTemplate jdbc;

    public CoberturaManutencao(NamedParameterJdbcTemplate jdbc) { this.jdbc = jdbc; }

    public boolean coberto(long equipamentoId) {
        return Boolean.TRUE.equals(jdbc.queryForObject(
                "SELECT " + COBERTO_E + " FROM equipamento e WHERE e.id = :id",
                Map.of("id", equipamentoId), Boolean.class));
    }

    /** Criador da janela ATIVA de menor id que cobre o equipamento: autor da entrada pelo job (MA10). */
    public Optional<Long> autorDaCobertura(long equipamentoId) {
        List<Long> ids = jdbc.queryForList("""
                SELECT ma.criado_por_id FROM manutencao_agendada ma JOIN equipamento e ON e.id = :id
                 WHERE ma.status = 'ATIVA'
                   AND ((ma.escopo = 'UNIDADE' AND ma.unidade_id = e.unidade_id)
                     OR (ma.escopo = 'EQUIPAMENTOS' AND EXISTS (SELECT 1 FROM manutencao_agendada_equipamento mae
                          WHERE mae.manutencao_id = ma.id AND mae.equipamento_id = e.id)))
                 ORDER BY ma.id LIMIT 1""", Map.of("id", equipamentoId), Long.class);
        return ids.stream().findFirst();
    }

    /** Equipamentos cujo efetivo diverge do desejado. Ordem por id: mesma ordem de lock em todo lugar. */
    public List<Long> divergentes() {
        return jdbc.queryForList("SELECT e.id FROM equipamento e WHERE e.em_manutencao <> (e.manutencao_manual OR "
                + COBERTO_E + ") ORDER BY e.id", Map.of(), Long.class);
    }

    /** Equipamentos que a janela cobre AGORA (escopo UNIDADE e dinamico: le a unidade no momento). */
    public List<Long> cobertosPor(long manutencaoId) {
        return jdbc.queryForList("""
                SELECT e.id FROM manutencao_agendada ma JOIN equipamento e
                    ON (ma.escopo = 'UNIDADE' AND e.unidade_id = ma.unidade_id)
                    OR (ma.escopo = 'EQUIPAMENTOS' AND EXISTS (SELECT 1 FROM manutencao_agendada_equipamento mae
                         WHERE mae.manutencao_id = ma.id AND mae.equipamento_id = e.id))
                 WHERE ma.id = :id ORDER BY e.id""", Map.of("id", manutencaoId), Long.class);
    }
}
```
(Transições CAS entram neste arquivo na Task 4.)

- [ ] **Step 3: `EfeitosManutencao`** — mova, sem mudar comportamento, os passos 2–5 de `EquipamentoService.entrarEmManutencao` (incidentes, episódios, `cicloJanela.fecharEquipamento`, notificações com releitura e filtro por motivo, comentários junto) para `aplicarEntrada(Long equipamentoId, Usuario autor, Instant agora)`, e `cicloJanela.abrirEquipamento(id)` para `aplicarSaida(Long equipamentoId)`. Construtor recebe `IncidenteRepository, MonitorEpisodioLatenciaRepository, CicloJanelaMonitoramentoService, NotificacaoService`. Não é `@Transactional` (roda dentro da transação de quem chama; javadoc diz isso).

- [ ] **Step 4: `EstadoManutencaoEquipamento`**

```java
package br.com.inframonitor.equipamento.service;

/**
 * Unico escritor de equipamento.em_manutencao e equipamento.manutencao_manual (MA01).
 *
 * <p>Toda operacao comeca travando a linha do equipamento (FOR UPDATE), o mesmo lock que o
 * INSERT condicional do motor e o M7 tomam. A cobertura por janela e lida DEPOIS, em instrucao
 * separada: sob READ COMMITTED, cada instrucao ve o que foi commitado antes dela comecar, e o
 * lock garante que quem commitou uma mudanca de janela e ja reavaliou este equipamento terminou
 * antes. Na mesma instrucao do lock, um EXISTS usaria o snapshot de antes da espera e podia
 * tirar da manutencao um equipamento cuja janela acabou de ativar.
 */
@Service
public class EstadoManutencaoEquipamento {
    private final EquipamentoRepository equipamentos;
    private final CoberturaManutencao cobertura;
    private final EfeitosManutencao efeitos;
    private final UsuarioRepository usuarios;

    // construtor com os quatro

    @Transactional
    public boolean reavaliar(Long equipamentoId) {
        var travado = equipamentos.travarEstadoManutencao(equipamentoId)
                .orElseThrow(() -> new RecursoNaoEncontradoException("Equipamento nao encontrado"));
        boolean desejado = travado.getManutencaoManual() || cobertura.coberto(equipamentoId);
        boolean atual = travado.getEmManutencao();
        if (desejado == atual) return atual;
        Instant agora = Instant.now();
        if (equipamentos.trocarEmManutencao(equipamentoId, atual, desejado, agora) == 0) {
            // Impossivel com o lock: falhar alto e melhor que aplicar efeito sem a virada.
            throw new IllegalStateException("em_manutencao mudou sob lock do equipamento " + equipamentoId);
        }
        if (desejado) {
            // Entrar sem manual so acontece por cobertura: o autor e quem criou a janela.
            Long autorId = cobertura.autorDaCobertura(equipamentoId).orElseThrow();
            efeitos.aplicarEntrada(equipamentoId, usuarioObrigatorio(autorId), agora);
        } else {
            efeitos.aplicarSaida(equipamentoId);
        }
        return desejado;
    }

    @Transactional
    public void iniciarManual(Long equipamentoId, Long usuarioId) {
        Usuario autor = usuarioObrigatorio(usuarioId);   // falha antes do lock, como EquipamentoService.autor
        var travado = equipamentos.travarEstadoManutencao(equipamentoId)
                .orElseThrow(() -> new RecursoNaoEncontradoException("Equipamento nao encontrado"));
        if (travado.getManutencaoManual()) return;      // idempotente
        Instant agora = Instant.now();
        equipamentos.marcarManual(equipamentoId, agora);
        if (!travado.getEmManutencao()) efeitos.aplicarEntrada(equipamentoId, autor, agora);
    }

    @Transactional
    public void encerrarManual(Long equipamentoId) {
        var travado = equipamentos.travarEstadoManutencao(equipamentoId)
                .orElseThrow(() -> new RecursoNaoEncontradoException("Equipamento nao encontrado"));
        if (!travado.getManutencaoManual()) return;
        equipamentos.desmarcarManual(equipamentoId, Instant.now());
        reavaliar(equipamentoId);   // mesma transacao; o lock ja e nosso
    }

    private Usuario usuarioObrigatorio(Long usuarioId) {
        if (usuarioId == null) throw new IllegalStateException("Acao exige usuario autenticado");
        return usuarios.findById(usuarioId).orElseThrow(() -> new RecursoNaoEncontradoException("Usuario nao encontrado"));
    }
}
```

- [ ] **Step 5: `EquipamentoService`**
  - `entrarEmManutencao(id, usuarioId)` → `estado.iniciarManual(id, usuarioId); return paraResposta(obterEquipamento(id));`
  - `sairDeManutencao(id)` → `estado.encerrarManual(id); return paraResposta(obterEquipamento(id));`
  - `criar`: depois do `save`, `equipamentoRepository.flush(); estado.reavaliar(salvo.getId());` e responde relendo.
  - `atualizar`: guarde `Long unidadeAnterior` antes; se mudou, `equipamentoRepository.flush(); estado.reavaliar(id);` e responda relendo (`obterEquipamento`).
  - Remova os campos/injeções que só os efeitos usavam (passam a viver em `EfeitosManutencao`), mantenha o javadoc histórico de ordem/CAS migrado para `EstadoManutencaoEquipamento`.
  - `paraResposta` passa `equipamento.isManutencaoManual()`.
  - Apague `marcarEmManutencaoSeNaoEstiver`/`desmarcarManutencaoSeEstiver` do repositório.

- [ ] **Step 6: Rodar convivência + regressão de manutenção**

Run: `./mvnw -q test -Dtest='ConvivenciaManualJanelaPostgresIntegrationTest,ManutencaoPostgresIntegrationTest,EntradaEmManutencaoTest,FechamentoManualConcorrenciaPostgresIntegrationTest,AberturaManualElegibilidadePostgresIntegrationTest,NotificacaoManutencaoTest'`
Expected: PASS. Testes unitários que mockavam `incidenteRepository` dentro de `EquipamentoService` (ex.: `EntradaEmManutencaoTest`) migram para `EstadoManutencaoEquipamento`/`EfeitosManutencao` mantendo as mesmas asserções.

- [ ] **Step 7: Commit** — `feat(manutencao): estado efetivo com escritor unico sob lock do equipamento`

---

### Task 3: Módulo `manutencao` — entidade, serviço, API, segurança, configuração

**Files:**
- Create: `manutencao/entity/{ManutencaoAgendada,SituacaoManutencao,EscopoManutencao}.java`
- Create: `manutencao/repository/ManutencaoAgendadaRepository.java`
- Create: `manutencao/config/{ManutencaoAgendadaProperties,ManutencaoAgendadaConfiguration}.java`
- Create: `manutencao/service/ManutencaoAgendadaService.java`, `manutencao/service/ReconciliacaoInicial.java`
- Create: `manutencao/dto/{CriarManutencaoRequest,ManutencaoResponse,ParametrosManutencaoResponse}.java`
- Create: `manutencao/controller/ManutencaoAgendadaController.java`
- Modify: `security/SecurityConfiguration.java:14,16`, `application.yml`, `ConfiguracaoPadraoDesligadaTest`, `EquipamentoService.excluir`, `UnidadeService.excluir`, README do backend (seção de variáveis)
- Test: `manutencao/ManutencaoAgendadaServicePostgresIntegrationTest.java`, `manutencao/ManutencaoAgendadaControllerSecurityTest.java` (ou integração HTTP com JWT como os testes existentes de segurança)

**Interfaces:**
- Consumes: `EstadoManutencaoEquipamento#reavaliar`, `CoberturaManutencao#cobertosPor`.
- Produces (usado por Task 4/5/7 e pelo front):
  - `enum SituacaoManutencao { AGENDADA, ATIVA, CONCLUIDA, CANCELADA, EXPIRADA }`, `enum EscopoManutencao { UNIDADE, EQUIPAMENTOS }`
  - `ManutencaoAgendadaProperties` (`@ConfigurationProperties("manutencao.agendada")`): `boolean enabled`, `long intervaloMs = 30000`, `Duration duracaoMaxima = Duration.ofHours(72)`
  - `ManutencaoAgendadaService#criar(CriarManutencaoRequest, Long usuarioId): ManutencaoResponse`, `#cancelar(Long id, Long usuarioId)`, `#encerrar(Long id, Long usuarioId)`, `#listar(String situacao, String busca, Pageable)`: `Page<ManutencaoResponse>`, `#parametros()`
  - `ReconciliacaoInicial#pronta()`, `#marcarPronta()`
  - JSON de `ManutencaoResponse`: `{id, unidade:{id,nome}, escopo, equipamentos:[{id,nome}], inicioPrevisto, fimPrevisto, motivo, situacao, criadoPor:{id,nome}, ativadaEm, encerradaEm, encerradaPor:{id,nome}|null, canceladaEm, canceladaPor:{id,nome}|null, sobreposicoes:[number]}`

- [ ] **Step 1: Testes do serviço (falham: classes não existem)**

Mesmas anotações, mas com `"manutencao.agendada.enabled=true"` em `properties` e `"manutencao.agendada.intervalo-ms=3600000"` (o tick não interfere). Casos:

```java
@Test void criaJanelaFuturaAgendada()            // situacao AGENDADA, criadoPor = operador, equipamentos vazios p/ UNIDADE
@Test void criaComInicioAgoraAtivaNaHora()        // inicio = now(); resposta ATIVA; em_manutencao = true no equipamento
@Test void criaComInicioQuatroMinutosAtrasAtiva() // tolerancia de 5 min (Review Focus 3)
@Test void recusaInicioSeisMinutosAtras()         // IllegalArgumentException -> "Nao e possivel agendar manutencao com inicio no passado"
@Test void recusaFimAntesDoInicio()               // "O fim da janela deve ser depois do inicio"
@Test void recusaDuracaoAcimaDoMaximo()           // 72h + 1min -> "A janela nao pode passar de 72 horas"
@Test void recusaEscopoEquipamentosSemEquipamento()
@Test void recusaEquipamentoDeOutraUnidade()
@Test void recusaEquipamentoInativo()
@Test void recusaUnidadeInativa()                 // ConflitoException
@Test void recusaUnidadeComEquipamentos()         // escopo UNIDADE com ids -> 400
@Test void informaSobreposicao()                  // segunda janela no mesmo periodo/unidade -> sobreposicoes = [id da primeira]
@Test void cancelaAgendada()                      // CANCELADA, canceladaPor = operador
@Test void cancelarAtivaDevolve409ComSituacao()   // "Nao e possivel cancelar: a janela esta ATIVA. Use Encerrar agora."
@Test void encerraAtivaEOsEquipamentosSaem()      // CONCLUIDA, encerradaPor = operador, em_manutencao = false, janela SLA reaberta
@Test void encerrarAgendadaDevolve409()
@Test void listaVigentesComAtivaPrimeiro()        // ATIVA(inicio tarde) antes de AGENDADA(inicio cedo); depois por inicio asc
@Test void listaHistoricoPorInicioDesc()
@Test void buscaPorMotivoEUnidadeSemDiferenciarCaixa()
@Test void excluirEquipamentoComJanela409()       // "Nao e possivel excluir o equipamento porque ele consta em janelas de manutencao"
@Test void excluirUnidadeComJanela409()           // "Nao e possivel excluir a unidade porque ela consta em janelas de manutencao"
```
E uma classe separada `ManutencaoAgendadaDesligadaPostgresIntegrationTest` (`manutencao.agendada.enabled=false`):
```java
@Test void criarComJobDesligadoDevolve409ComInstrucao() {
    assertThatThrownBy(() -> service.criar(requisicaoValida(), operadorId))
        .isInstanceOf(ConflitoException.class)
        .hasMessage("Agendamento de manutencao desligado neste servidor: nenhuma janela seria ativada. Para ligar, defina MANUTENCAO_AGENDADA_ENABLED=true nas variaveis de ambiente do servico do backend e reinicie-o. Enquanto isso, use \"Iniciar manutencao\" no equipamento.");
}
@Test void parametrosDizemDesligado() // agendadorLigado = false, duracaoMaximaHoras = 72
```

- [ ] **Step 2: Entidade**

```java
@Entity @Table(name = "manutencao_agendada")
public class ManutencaoAgendada {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) private Long id;
    @ManyToOne(fetch = FetchType.LAZY, optional = false) @JoinColumn(name = "unidade_id", nullable = false, updatable = false)
    private Unidade unidade;
    @Enumerated(EnumType.STRING) @Column(nullable = false, length = 12, updatable = false) private EscopoManutencao escopo;
    @Column(name = "inicio_previsto", nullable = false, updatable = false) private Instant inicioPrevisto;
    @Column(name = "fim_previsto", nullable = false, updatable = false) private Instant fimPrevisto;
    @Column(nullable = false, length = 300, updatable = false) private String motivo;
    // Transicoes so por SQL com CAS (CoberturaManutencao). updatable = false: a entidade nunca
    // regrava status/carimbos com o que estava na sessao.
    @Enumerated(EnumType.STRING) @Column(name = "status", nullable = false, length = 10, updatable = false)
    private SituacaoManutencao situacao;
    @ManyToOne(fetch = FetchType.LAZY, optional = false) @JoinColumn(name = "criado_por_id", nullable = false, updatable = false)
    private Usuario criadoPor;
    @Column(name = "ativada_em", updatable = false) private Instant ativadaEm;
    @Column(name = "encerrada_em", updatable = false) private Instant encerradaEm;
    @ManyToOne(fetch = FetchType.LAZY) @JoinColumn(name = "encerrada_por_id", updatable = false) private Usuario encerradaPor;
    @Column(name = "cancelada_em", updatable = false) private Instant canceladaEm;
    @ManyToOne(fetch = FetchType.LAZY) @JoinColumn(name = "cancelada_por_id", updatable = false) private Usuario canceladaPor;
    @ManyToMany(fetch = FetchType.LAZY)
    @JoinTable(name = "manutencao_agendada_equipamento",
            joinColumns = @JoinColumn(name = "manutencao_id"), inverseJoinColumns = @JoinColumn(name = "equipamento_id"))
    @BatchSize(size = 50)
    private Set<Equipamento> equipamentos = new LinkedHashSet<>();
    @Column(name = "created_at", nullable = false, updatable = false) private Instant createdAt;
    @Column(name = "updated_at", nullable = false) private Instant updatedAt;

    protected ManutencaoAgendada() { }
    public ManutencaoAgendada(Unidade unidade, EscopoManutencao escopo, Instant inicioPrevisto, Instant fimPrevisto,
                              String motivo, Usuario criadoPor, Set<Equipamento> equipamentos) {
        // situacao = AGENDADA
    }
    @PrePersist void aoCriar() { createdAt = updatedAt = Instant.now(); }
    // getters
}
```

- [ ] **Step 3: Repositório JPA**

```java
public interface ManutencaoAgendadaRepository extends JpaRepository<ManutencaoAgendada, Long> {
    @Query(value = """
            select m from ManutencaoAgendada m join fetch m.unidade u join fetch m.criadoPor
             where m.situacao in :situacoes and (lower(u.nome) like :busca or lower(m.motivo) like :busca)
             order by case when m.situacao = br.com.inframonitor.manutencao.entity.SituacaoManutencao.ATIVA then 0 else 1 end,
                      m.inicioPrevisto asc, m.id asc""",
           countQuery = "select count(m) from ManutencaoAgendada m join m.unidade u where m.situacao in :situacoes "
                   + "and (lower(u.nome) like :busca or lower(m.motivo) like :busca)")
    Page<ManutencaoAgendada> vigentes(@Param("situacoes") Collection<SituacaoManutencao> situacoes,
                                      @Param("busca") String busca, Pageable pageable);

    // historico: mesmo filtro, order by m.inicioPrevisto desc, m.id desc
    Page<ManutencaoAgendada> historico(...);

    boolean existsByUnidadeId(Long unidadeId);

    @Query(value = "SELECT EXISTS (SELECT 1 FROM manutencao_agendada_equipamento WHERE equipamento_id = :id)", nativeQuery = true)
    boolean equipamentoConstaEmJanela(@Param("id") Long equipamentoId);

    @Query(value = """
            SELECT o.id FROM manutencao_agendada o
             WHERE o.id <> :id AND o.status IN ('AGENDADA', 'ATIVA') AND o.unidade_id = :unidadeId
               AND o.inicio_previsto < :fim AND o.fim_previsto > :inicio
               AND (:escopo = 'UNIDADE' OR o.escopo = 'UNIDADE' OR EXISTS (
                    SELECT 1 FROM manutencao_agendada_equipamento a JOIN manutencao_agendada_equipamento b
                        ON a.equipamento_id = b.equipamento_id
                     WHERE a.manutencao_id = o.id AND b.manutencao_id = :id))
             ORDER BY o.id""", nativeQuery = true)
    List<Long> sobreposicoes(@Param("id") Long id, @Param("unidadeId") Long unidadeId, @Param("escopo") String escopo,
                             @Param("inicio") Instant inicio, @Param("fim") Instant fim);
}
```
`busca` chega como `"%" + texto.strip().toLowerCase(Locale.ROOT) + "%"` (vazio → `"%%"`). Paginação: chame com `PageRequest.of(page, size)` sem `Sort` (a ordem está na query); `size` limitado a `Paginacao.TAMANHO_MAXIMO`.

- [ ] **Step 4: Transições CAS em `CoberturaManutencao`** (usadas pelo serviço e pelo reconciliador)

```java
    /** CAS AGENDADA -> ATIVA das devidas. Devolve as ativadas, com previsto e real (log de atraso). */
    public List<Transicao> ativarDevidas(Instant agora) {
        return jdbc.query("""
                UPDATE manutencao_agendada SET status = 'ATIVA', ativada_em = :agora, updated_at = :agora
                 WHERE status = 'AGENDADA' AND inicio_previsto <= :agora AND fim_previsto > :agora
                RETURNING id, inicio_previsto AS previsto""", Map.of("agora", ts(agora)), Transicao.MAPPER(agora));
    }
    /** Mesmo CAS, restrito a uma janela (ativacao imediata na criacao). */
    public boolean ativarSeDevida(long id, Instant agora) { ...WHERE id = :id AND status='AGENDADA' AND inicio_previsto <= :agora AND fim_previsto > :agora ... return linhas == 1; }
    /** Janela inteira perdida: nunca ativou e o fim ja passou. Sem efeito nenhum (MA08). */
    public List<Transicao> expirarPerdidas(Instant agora) { UPDATE ... SET status='EXPIRADA', updated_at=:agora WHERE status='AGENDADA' AND fim_previsto <= :agora RETURNING id, fim_previsto AS previsto }
    /** CAS ATIVA -> CONCLUIDA no instante REAL, nunca no fim previsto (MA08). */
    public List<Transicao> concluirVencidas(Instant agora) { UPDATE ... SET status='CONCLUIDA', encerrada_em=:agora, updated_at=:agora WHERE status='ATIVA' AND fim_previsto <= :agora RETURNING id, fim_previsto AS previsto }
    public boolean cancelar(long id, long usuarioId, Instant agora) { UPDATE ... SET status='CANCELADA', cancelada_em=:agora, cancelada_por_id=:u, updated_at=:agora WHERE id=:id AND status='AGENDADA' }
    public boolean encerrar(long id, long usuarioId, Instant agora) { UPDATE ... SET status='CONCLUIDA', encerrada_em=:agora, encerrada_por_id=:u, updated_at=:agora WHERE id=:id AND status='ATIVA' }

    public record Transicao(long manutencaoId, Instant previsto, Instant real) {
        public Duration atraso() { return Duration.between(previsto, real); }
    }
```
`ts(Instant)` = `Timestamp.from(instant)`; `MAPPER(agora)` lê `id` e `previsto` e usa `agora` como `real`.

- [ ] **Step 5: Serviço**

```java
@Service
public class ManutencaoAgendadaService {
    static final String MSG_DESLIGADO = "Agendamento de manutencao desligado neste servidor: nenhuma janela seria ativada. "
            + "Para ligar, defina MANUTENCAO_AGENDADA_ENABLED=true nas variaveis de ambiente do servico do backend e "
            + "reinicie-o. Enquanto isso, use \"Iniciar manutencao\" no equipamento.";
    static final Duration TOLERANCIA_PASSADO = Duration.ofMinutes(5);
    // deps: ManutencaoAgendadaRepository repo, CoberturaManutencao cobertura, EstadoManutencaoEquipamento estado,
    //       UnidadeRepository, EquipamentoRepository, UsuarioRepository, ManutencaoAgendadaProperties props,
    //       PlatformTransactionManager tm  (TransactionTemplate)

    public ManutencaoResponse criar(CriarManutencaoRequest req, Long usuarioId) {
        if (!props.isEnabled()) throw new ConflitoException(MSG_DESLIGADO);
        Instant agora = Instant.now();
        Long id = tx().execute(s -> {
            validar(req, agora);   // IllegalArgumentException/ConflitoException conforme Step 1
            ManutencaoAgendada nova = repo.saveAndFlush(new ManutencaoAgendada(...));
            return nova.getId();
        });
        // Fora da transacao de criacao: a ativacao e a reavaliacao sao transacoes proprias,
        // como no reconciliador. Uma falha aqui deixa a janela AGENDADA, e o tick a ativa.
        if (!req.inicioPrevisto().isAfter(agora) && tx().execute(s -> cobertura.ativarSeDevida(id, agora))) {
            cobertura.cobertosPor(id).forEach(estado::reavaliar);
        }
        return detalhar(id);
    }

    public ManutencaoResponse cancelar(Long id, Long usuarioId) {
        ManutencaoAgendada atual = obter(id);
        if (!tx().execute(s -> cobertura.cancelar(id, usuarioId, Instant.now()))) {
            throw new ConflitoException(recusa("cancelar", situacaoAtual(id)));
        }
        return detalhar(id);
    }

    public ManutencaoResponse encerrar(Long id, Long usuarioId) {
        obter(id);
        if (!tx().execute(s -> cobertura.encerrar(id, usuarioId, Instant.now()))) {
            throw new ConflitoException(recusa("encerrar", situacaoAtual(id)));
        }
        cobertura.cobertosPor(id).forEach(estado::reavaliar);   // um equipamento por transacao, ordem por id
        return detalhar(id);
    }
    // recusa("cancelar", ATIVA)  -> "Nao e possivel cancelar: a janela esta ATIVA. Use Encerrar agora."
    // recusa("cancelar", outra)  -> "Nao e possivel cancelar: a janela esta <SITUACAO>."
    // recusa("encerrar", outra)  -> "Nao e possivel encerrar: a janela esta <SITUACAO>."
}
```
`validar`: unidade existe (404) e ativa (409 `Nao e possivel agendar manutencao em unidade inativa`); `fim > inicio` (400 `O fim da janela deve ser depois do inicio`); `inicio >= agora − 5 min` (400 `Nao e possivel agendar manutencao com inicio no passado`); `Duration.between(inicio, fim) <= duracaoMaxima` (400 `A janela nao pode passar de N horas`, N = `duracaoMaxima.toHours()`); escopo UNIDADE ⇒ ids vazios/nulos (400 `Escopo UNIDADE nao recebe equipamentos`); EQUIPAMENTOS ⇒ ≥1 id (400 `Selecione ao menos um equipamento`), todos existentes (404), da unidade (400 `O equipamento X nao pertence a unidade`), ativos (409 `Nao e possivel agendar manutencao do equipamento X porque ele esta inativo`); motivo `strip()` não vazio. `detalhar(id)` lê entidade + `sobreposicoes` (só para AGENDADA/ATIVA) e monta `ManutencaoResponse`.

`CriarManutencaoRequest`: `record(@NotNull Long unidadeId, @NotNull EscopoManutencao escopo, List<Long> equipamentoIds, @NotNull Instant inicioPrevisto, @NotNull Instant fimPrevisto, @NotBlank @Size(max = 300) String motivo)`.

- [ ] **Step 6: Configuração, controller, segurança**

`application.yml` (depois de `notification`):
```yaml
manutencao:
  agendada:
    # Liga o reconciliador que ativa e conclui as janelas. Desligado, a criacao de janela e recusada (409).
    enabled: ${MANUTENCAO_AGENDADA_ENABLED:false}
    intervalo-ms: ${MANUTENCAO_AGENDADA_INTERVALO_MS:30000}
    # java.time.Duration: 72h, 5d, 90m. Ajustar = mudar a variavel e reiniciar (MA15).
    duracao-maxima: ${MANUTENCAO_AGENDADA_DURACAO_MAXIMA:72h}
```
`ManutencaoAgendadaConfiguration`: `@Configuration(proxyBeanMethods = false) @EnableConfigurationProperties(ManutencaoAgendadaProperties.class)`.
`ReconciliacaoInicial`: `@Component`, construtor `(ManutencaoAgendadaProperties p)` → `pronta = new AtomicBoolean(!p.isEnabled())`.

Controller `@RequestMapping("/api/v1/manutencoes")`: `GET` (`situacao` default `VIGENTES`, `busca` default `""`, `@PageableDefault(size = 20) Pageable`) → `PaginaResposta.de(...)`; `GET /parametros`; `POST` (`@Valid`, `@AuthenticationPrincipal UsuarioPrincipal`, 201 + Location); `PATCH /{id}/cancelar`; `PATCH /{id}/encerrar`. `situacao` fora de `VIGENTES|HISTORICO` → 400.

`SecurityConfiguration`: acrescente `"/api/v1/manutencoes/**"` nas listas de **POST** e **PATCH** (`hasAnyRole("ADMIN","OPERADOR")`). Teste de segurança: OPERADOR → POST 201/409-desligado (não 403); VISUALIZADOR → POST 403, GET 200; sem token → 401. Siga o estilo do teste de segurança existente em `src/test/java/br/com/inframonitor/security/`.

`ConfiguracaoPadraoDesligadaTest`: acrescente `assertThat(resolver.getProperty("manutencao.agendada.enabled", Boolean.class)).isFalse();` e renomeie o método para `semVariaveisDeAmbienteNadaQueAgeSozinhoLiga`.

`EquipamentoService.excluir` e `UnidadeService.excluir`: checagens 409 antes do `delete`, mensagens do Step 1.

README do backend: as três variáveis na tabela/seção de variáveis, com o efeito do padrão desligado.

- [ ] **Step 7: Rodar** `./mvnw -q test -Dtest='Manutencao*Test,ConfiguracaoPadraoDesligadaTest,*Security*'` → PASS.

- [ ] **Step 8: Commit** — `feat(manutencao): API de janelas agendadas com CAS de situacao`

---

### Task 4: Reconciliador, casos de sistema parado e gate do motor

**Files:**
- Create: `manutencao/service/ReconciliadorManutencao.java`
- Modify: `monitoring/scheduler/MonitoringScheduler.java`
- Test: `manutencao/ReconciliadorManutencaoPostgresIntegrationTest.java`, `monitoring/scheduler/MonitoringSchedulerGateTest.java`

**Interfaces:**
- Consumes: `CoberturaManutencao#{ativarDevidas,expirarPerdidas,concluirVencidas,cobertosPor,divergentes}`, `EstadoManutencaoEquipamento#reavaliar`, `ReconciliacaoInicial`.
- Produces: `ReconciliadorManutencao#reconciliar(Instant agora): Resultado` com `record Resultado(List<Transicao> ativadas, List<Transicao> expiradas, List<Transicao> concluidas, int reavaliados)`.

- [ ] **Step 1: Testes de borda (falham: classe não existe)**

Com `manutencao.agendada.enabled=true` e `intervalo-ms=3600000` (o `@Scheduled` não interfere; o teste chama `reconciliar(Instant.now())` direto). "Sistema parado" = janelas com horários já passados e nenhum tick até agora.

```java
@Test void inicioPerdidoComFimNoFuturoAtivaAtrasada() {
    long j = janela("AGENDADA", agora.minus(47, MINUTES), agora.plus(1, HOURS), equipamento);
    var r = reconciliador.reconciliar(agora);
    assertThat(r.ativadas()).extracting(Transicao::manutencaoId).containsExactly(j);
    assertThat(r.ativadas().get(0).atraso()).isGreaterThanOrEqualTo(Duration.ofMinutes(47));
    assertThat(linhaJanela(j)).containsEntry("status", "ATIVA");
    assertThat(((Timestamp) linhaJanela(j).get("ativada_em")).toInstant()).isEqualTo(agora); // real, nao previsto
    assertThat(flags(equipamento)).containsEntry("em_manutencao", true);
    assertThat(incidente(aberto)).containsEntry("motivo_encerramento", "MANUTENCAO");
}
@Test void janelaInteiraPerdidaExpiraSemEfeito() {
    long j = janela("AGENDADA", agora.minus(3, HOURS), agora.minus(1, HOURS), equipamento);
    var antes = fotografia();  // incidentes, janelas SLA, notificacoes, flags
    reconciliador.reconciliar(agora);
    assertThat(linhaJanela(j)).containsEntry("status", "EXPIRADA");
    assertThat(linhaJanela(j).get("ativada_em")).isNull();
    assertThat(fotografia()).isEqualTo(antes);
}
@Test void fimPerdidoConcluiNoInstanteReal() {
    long j = janelaAtivaComEfeitosAplicados(agora.minus(3, HOURS), agora.minus(1, HOURS), equipamento);
    reconciliador.reconciliar(agora);
    assertThat(linhaJanela(j)).containsEntry("status", "CONCLUIDA");
    assertThat(((Timestamp) linhaJanela(j).get("encerrada_em")).toInstant()).isEqualTo(agora);
    assertThat(linhaJanela(j).get("encerrada_por_id")).isNull();
    // Janela de SLA reaberta AGORA, nao no fim previsto: o buraco fica fora do denominador.
    assertThat(inicioDaJanelaSlaAberta(monitor)).isAfterOrEqualTo(agora.minusSeconds(5));
    assertThat(flags(equipamento)).containsEntry("em_manutencao", false);
}
@Test void divergenciaECorrigidaMesmoSemTransicao()  // em_manutencao=false com janela ATIVA via SQL -> reconciliar entra
@Test void janelaUnidadeCobreEquipamentoNovoNoTick()  // criar equipamento por SQL (sem hook) na unidade -> reconciliar entra
@Test void marcaReconciliacaoInicialPronta()
@Test void primeiraPassadaComFalhaAindaLiberaOMotor() // Review Focus 4: Cobertura mockada lancando -> pronta() == true e excecao logada
```
`janelaAtivaComEfeitosAplicados` = insere AGENDADA no passado com `inicio_previsto` antigo, chama `reconciliar(inicio + 1min)` e depois roda o teste com `agora`.

Atenção à constraint `ativada_em >= inicio_previsto`: em todos os testes `agora` ≥ início.

`MonitoringSchedulerGateTest` (unitário, Mockito):
```java
@Test void naoAgendaAntesDaPrimeiraPassada() {
    var inicial = new ReconciliacaoInicial(propsLigado());
    new MonitoringScheduler(coordenador, inicial).scheduleMonitors();
    verifyNoInteractions(coordenador);
    inicial.marcarPronta();
    new MonitoringScheduler(coordenador, inicial).scheduleMonitors();
    verify(coordenador).scheduleDueMonitors();
}
@Test void comReconciliadorDesligadoAgendaDeCara()
```

- [ ] **Step 2: Implementação**

```java
@Component
@ConditionalOnProperty(prefix = "manutencao.agendada", name = "enabled", havingValue = "true")
public class ReconciliadorManutencao {
    private static final Logger log = LoggerFactory.getLogger(ReconciliadorManutencao.class);
    // deps: CoberturaManutencao, EstadoManutencaoEquipamento, ReconciliacaoInicial, ManutencaoAgendadaProperties,
    //       PlatformTransactionManager, @Qualifier("monitoringClock") Clock

    @Scheduled(fixedDelayString = "${manutencao.agendada.intervalo-ms:30000}")
    public void agendado() { reconciliar(Instant.now(clock)); }

    /**
     * Uma passada. Cada transicao CAS e cada reavaliacao em transacao propria: um equipamento com
     * problema nao segura os outros, e nenhuma transacao segura dois locks de equipamento.
     * Depois de cada transicao, reavalia os cobertos POR LOCK (nao so a divergencia lida por
     * snapshot): e isso que fecha a corrida com o botao manual (Task 6, corrida 3).
     */
    public Resultado reconciliar(Instant agora) {
        try {
            var tx = new TransactionTemplate(transactionManager);
            List<Transicao> ativadas = tx.execute(s -> cobertura.ativarDevidas(agora));
            List<Transicao> expiradas = tx.execute(s -> cobertura.expirarPerdidas(agora));
            List<Transicao> concluidas = tx.execute(s -> cobertura.concluirVencidas(agora));
            SortedSet<Long> alvos = new TreeSet<>();
            Stream.concat(ativadas.stream(), concluidas.stream())
                    .forEach(t -> alvos.addAll(cobertura.cobertosPor(t.manutencaoId())));
            alvos.addAll(cobertura.divergentes());
            alvos.forEach(estado::reavaliar);
            avisarAtrasos(ativadas, concluidas, expiradas);
            return new Resultado(ativadas, expiradas, concluidas, alvos.size());
        } finally {
            // Mesmo com falha: o motor nao pode ficar parado para sempre esperando esta passada.
            inicial.marcarPronta();
        }
    }

    private void avisarAtrasos(...) {
        Duration limite = Duration.ofMillis(2 * props.getIntervaloMs());
        // ativada/concluida com atraso() > limite -> log.warn("Janela de manutencao {} ativada com {} min de atraso: o sistema
        //   esteve fora (ou o reconciliador desligado) no horario previsto", ...)
        // expirada -> log.warn("Janela de manutencao {} expirou sem ativar: o sistema esteve fora durante a janela inteira", ...)
    }
}
```
`estado.reavaliar` lança se o equipamento sumiu: capture `RecursoNaoEncontradoException` por equipamento, logue e siga.

`MonitoringScheduler`: construtor recebe `ReconciliacaoInicial`; `scheduleMonitors()` começa com `if (!inicial.pronta()) return;` e comentário citando MA12.

- [ ] **Step 3: Rodar** `./mvnw -q test -Dtest='ReconciliadorManutencaoPostgresIntegrationTest,MonitoringSchedulerGateTest'` → PASS.

- [ ] **Step 4: Commit** — `feat(manutencao): reconciliador de nivel e gate do motor na subida`

---

### Task 5: Read-model do painel com origem da manutenção

**Files:**
- Modify: `dashboard/DashboardReadRepository.java:125-167`, `dashboard/DashboardService.java:77-83`, `dashboard/dto/DashboardEquipamentoListaResponse.java`
- Modify: testes que constroem `EquipamentoRow`/`DashboardEquipamentoListaResponse` (`DashboardControllerTest` e afins)
- Test: `dashboard/OrigemManutencaoNoInventarioPostgresIntegrationTest.java`

**Interfaces:**
- Produces JSON de `/api/v1/dashboard/equipamentos` com três campos novos após `emManutencao`: `manutencaoManual: boolean`, `janelaAtivaId: number|null`, `janelaAtivaFim: string(ISO)|null`.

- [ ] **Step 1: Teste (falha)** — três equipamentos: só manual; só janela ATIVA (escopo UNIDADE); manual + duas janelas ATIVAS (deve vir a de maior `fim_previsto`). Chama `dashboardService.equipamentos()` e confere os três campos.

- [ ] **Step 2: Query** — no select final acrescente `e.manutencao_manual, ja.id, ja.fim_previsto` e o join:

```sql
                left join lateral (
                    select ma.id, ma.fim_previsto from manutencao_agendada ma
                     where ma.status = 'ATIVA'
                       and ((ma.escopo = 'UNIDADE' and ma.unidade_id = e.unidade_id)
                         or (ma.escopo = 'EQUIPAMENTOS' and exists (
                               select 1 from manutencao_agendada_equipamento mae
                                where mae.manutencao_id = ma.id and mae.equipamento_id = e.id)))
                     order by ma.fim_previsto desc, ma.id desc limit 1
                ) ja on true
```
`EquipamentoRow` ganha `boolean manutencaoManual, Long janelaAtivaId, Instant janelaAtivaFim` (converta `Timestamp`/`OffsetDateTime` do driver para `Instant`); mapeamento em `DashboardService.equipamentos`. Atualize o javadoc do response explicando os três campos.

- [ ] **Step 3: Rodar** `./mvnw -q test -Dtest='OrigemManutencaoNoInventarioPostgresIntegrationTest,Dashboard*Test,InventarioDashboardPostgresIntegrationTest'` → PASS.

- [ ] **Step 4: Commit** — `feat(dashboard): origem da manutencao na lista de equipamentos`

---

### Task 6: Corridas reais e provas de reversão

**Files:**
- Test: `manutencao/ManutencaoAgendadaConcorrenciaPostgresIntegrationTest.java`
- Modify: `Docs/validacao-producao/manutencao-agendada-f1.md`

**Interfaces:** consome tudo de T1–T4.

Fixture e helpers `correr`, `largar`, `emOutraThread` copiados de `FechamentoManualConcorrenciaPostgresIntegrationTest`. Cada corrida: `@RepeatedTest(30)`, atraso aleatório calibrado (comece com 0–8 ms no lado mais rápido e ajuste até aparecerem os dois desfechos legítimos; registre a calibração em comentário como o arquivo de referência faz), `System.out.println("[corrida-<nome>] desfecho=...")`, asserção final de legitimidade.

- [ ] **Step 1: Escrever as sete corridas**

```java
/** 1. Job ativa x operador cancela. Legitimos: CANC (CANCELADA, equipamento fora) ou ATIV (ATIVA, cancelar -> 409, equipamento em manutencao). */
@RepeatedTest(30) void ativacaoECancelamentoConcorrentes() {
    long j = janela("AGENDADA", agora.minusSeconds(1), agora.plus(1, HOURS), equipamento);
    AtomicReference<Throwable> recusa = new AtomicReference<>();
    var falhas = correr(() -> reconciliador.reconciliar(Instant.now()),
            () -> { atrasar(ATRASO_CANCELAR_MS); try { service.cancelar(j, operadorId); } catch (ConflitoException e) { recusa.set(e); } });
    assertThat(falhas).isEmpty();
    String s = situacao(j); boolean em = emManutencao(equipamento);
    boolean canc = "CANCELADA".equals(s) && !em && recusa.get() == null;
    boolean ativ = "ATIVA".equals(s) && em && recusa.get() != null;
    println("[corrida-ativar-cancelar] desfecho=" + (canc ? "CANC" : ativ ? "ATIV" : "ILEGITIMO") + ...);
    assertThat(canc || ativ).isTrue();
}

/** 2. Encerrar agora x conclusao automatica. Legitimos: OPER (encerrada_por = operador) ou AUTO (encerrada_por nulo);
 *  nos dois: CONCLUIDA, equipamento fora, UMA janela de SLA aberta (saida aplicada uma vez). */
@RepeatedTest(30) void encerrarAgoraEConclusaoAutomatica()

/** 3. Botao encerrar manual x janela ativando no mesmo equipamento.
 *  Inicial: manual ligado (efeitos aplicados), janela AGENDADA devida. Legitimo unico em estado final:
 *  ATIVA, manual = false, em_manutencao = true, ZERO janelas de SLA abertas. Desfechos impressos pela
 *  ordem observada: SAIU_E_VOLTOU (houve saida+entrada) ou FICOU (nunca saiu) — conte janelas de SLA fechadas
 *  criadas no teste para distinguir. ILEGITIMO: em_manutencao = false com janela ATIVA cobrindo. */
@RepeatedTest(30) void encerrarManualEAtivacaoDeJanela()

/** 4. Duas janelas sobrepostas terminando juntas (encerrar(j1) x encerrar(j2), ambas ATIVAS cobrindo o equipamento).
 *  Legitimo: as duas CONCLUIDA, em_manutencao = false, exatamente UMA janela de SLA aberta (saida uma vez). */
@RepeatedTest(30) void duasJanelasSobrepostasTerminandoJuntas()

/** 5. Janela ativando x motor abrindo incidente (incidenteRepository.inserirSeElegivel / incidenteService.abrirAutomaticamente
 *  com 3 falhas ja gravadas apos a ancora). Legitimos: MANUT_PRIMEIRO (nenhum incidente novo) ou INC_PRIMEIRO
 *  (incidente FECHADO com MANUTENCAO). ILEGITIMO: incidente ABERTO com em_manutencao = true. */
@RepeatedTest(30) void ativacaoEMotorAbrindoIncidente()

/** 6. Duas janelas UNIDADE (mesma unidade, 3 equipamentos com incidente aberto cada) ativando juntas:
 *  thread A reconciliar(agora), thread B encerrar?? -> NAO: B = segunda passada do reconciliador
 *  (reconciliar(agora) em paralelo, simulando dois nos ou tick sobreposto). Legitimo: sem deadlock (threads
 *  terminam no LIMITE), cada incidente fechado UMA vez, notificacoes de encerramento uma por incidente,
 *  todos em_manutencao = true. */
@RepeatedTest(30) void duasPassadasDoReconciliadorComJanelasDeUnidadeSobrepostas()

/** 7. Atualizar equipamento (PUT) x job virando o flag. Legitimo: nome novo E em_manutencao = true. */
@RepeatedTest(30) void atualizarEquipamentoEJobVirandoFlag()
```
Escreva o corpo completo de cada uma no padrão da corrida 1 (helpers `janela`, `situacao`, `emManutencao`, `janelasSlaAbertas`, `contar`, `atrasar`).

- [ ] **Step 2: Rodar** `./mvnw test -Dtest=ManutencaoAgendadaConcorrenciaPostgresIntegrationTest 2>&1 | tee target/corridas.log` → PASS. Extraia a distribuição: `grep -o '\[corrida-[a-z-]*\] desfecho=[A-Z_]*' target/corridas.log | sort | uniq -c`. Cada corrida deve mostrar ≥2 desfechos legítimos quando a corrida admite dois (1, 2, 3, 5); recalibre o atraso se só um aparecer.

- [ ] **Step 3: Provas de reversão** — para cada linha abaixo: aplique a reversão localmente, rode SÓ aquela corrida (`-Dtest=...#metodo`), confirme FAIL com ILEGITIMO, restaure (`git checkout -- <arquivo>`), registre no doc o trecho bruto (linhas `[corrida-...]` e o `Tests run: ..., Failures: ...`).

| Corrida | Reversão |
|---|---|
| 1 | `cancelar` sem `AND status = 'AGENDADA'` |
| 2 | `encerrar` sem `AND status = 'ATIVA'` (e `concluirVencidas` sem o filtro de status) |
| 3 | `reavaliar` lendo a cobertura NA MESMA instrução do `FOR UPDATE` (EXISTS dentro de `travarEstadoManutencao`) **e** reconciliador sem reavaliar os `cobertosPor` (só divergência) |
| 4 | `travarEstadoManutencao` sem `FOR UPDATE` |
| 5 | `inserirSeElegivel` sem `FOR UPDATE OF e` (já provado no M7; refaça aqui para a janela) |
| 6 | `reavaliar` dos alvos em ordem inversa dentro de UMA transação (provoca deadlock/erro) |
| 7 | remover `updatable = false` de `em_manutencao` |

Se uma reversão NÃO deixar o teste vermelho, a corrida não está exercitando a guarda: corrija o teste (atraso, fixture) até que deixe, e registre isso no doc.

- [ ] **Step 4: Commit** — `test(manutencao): corridas reais com distribuicao e provas de reversao`

---

### Task 7: Front — modelos, API e badges

**Files:**
- Create: `infra-monitor-frontend/src/app/core/models/manutencao.ts`
- Create: `infra-monitor-frontend/src/app/core/services/manutencao-api.service.ts` (+`.spec.ts`)
- Modify: `core/models/api-enums.ts`, `shared/status-badge/status-badge.component.ts` (+spec), `core/models/dashboard.ts:32-46`, `core/models/equipamento.ts`

**Interfaces (produz para T8, T9):**

```ts
// api-enums.ts
export enum MaintenanceWindowStatus { Scheduled = 'AGENDADA', Active = 'ATIVA', Completed = 'CONCLUIDA', Cancelled = 'CANCELADA', Expired = 'EXPIRADA' }
export enum MaintenanceScope { Unit = 'UNIDADE', Equipment = 'EQUIPAMENTOS' }

// manutencao.ts
export interface Referencia { id: number; nome: string; }
export interface ManutencaoResponse {
  id: number; unidade: Referencia; escopo: MaintenanceScope; equipamentos: Referencia[];
  inicioPrevisto: string; fimPrevisto: string; motivo: string; situacao: MaintenanceWindowStatus;
  criadoPor: Referencia; ativadaEm: string | null; encerradaEm: string | null; encerradaPor: Referencia | null;
  canceladaEm: string | null; canceladaPor: Referencia | null; sobreposicoes: number[];
}
export interface CriarManutencaoRequest {
  unidadeId: number; escopo: MaintenanceScope; equipamentoIds: number[];
  inicioPrevisto: string; fimPrevisto: string; motivo: string;
}
export interface ParametrosManutencao { agendadorLigado: boolean; duracaoMaximaHoras: number; }
export type FiltroManutencao = 'VIGENTES' | 'HISTORICO';

// manutencao-api.service.ts
list(filtro: FiltroManutencao, busca: string, page: number, size = 20): Observable<PageResponse<ManutencaoResponse>>
parametros(): Observable<ParametrosManutencao>
create(req: CriarManutencaoRequest): Observable<ManutencaoResponse>
cancel(id: number): Observable<ManutencaoResponse>     // PATCH /manutencoes/{id}/cancelar
end(id: number): Observable<ManutencaoResponse>        // PATCH /manutencoes/{id}/encerrar

// dashboard.ts — DashboardEquipamentoLista ganha:
manutencaoManual: boolean; janelaAtivaId: number | null; janelaAtivaFim: string | null;
// equipamento.ts — EquipamentoResponse ganha: manutencaoManual: boolean;
```

- [ ] **Step 1: Specs (falham)** — `manutencao-api.service.spec.ts` com `HttpTestingController` no padrão de `usuario-api.service.spec.ts`: URL, método, params (`situacao`, `busca`, `page`, `size`) e corpo. `status-badge.component.spec.ts`: `AGENDADA`→"Agendada"/muted, `ATIVA`→"Ativa"/info, `CONCLUIDA`→"Concluída"/muted, `EXPIRADA`→"Expirada"/warning, `CANCELADA`→"Cancelada"/muted.
- [ ] **Step 2: Implementar** — enum, modelos, serviço (`environment.apiUrl + '/manutencoes'`), e no badge: acrescente `MaintenanceWindowStatus` à união `DisplayStatus` e as entradas `AGENDADA: 'Agendada', ATIVA: 'Ativa', CONCLUIDA: 'Concluída', EXPIRADA: 'Expirada'` em `LABELS` e `AGENDADA: 'muted', ATIVA: 'info', CONCLUIDA: 'muted', EXPIRADA: 'warning'` em `TONES`, com comentário "janelas de manutenção; CANCELADA já existia pelas notificações". Atualize fixtures de spec que montam `DashboardEquipamentoLista`/`EquipamentoResponse` (`manutencaoManual: false, janelaAtivaId: null, janelaAtivaFim: null`).
- [ ] **Step 3: Rodar** `cd infra-monitor-frontend && npx ng test --watch=false` → PASS; `npx ng build` → sem erro.
- [ ] **Step 4: Commit** — `feat(front): modelos, API e badges de janela de manutencao`

---

### Task 8: Front — origem da manutenção em Equipamentos (ajuste do PR #17)

**Files:**
- Modify: `features/equipamentos/equipamento-list.component.ts:35-38,351,405-445,628-636`, `equipamento-list.component.html:142-150`
- Modify: `features/equipamentos/equipamento-detalhe-drawer.component.{ts,html}:173,266-268`
- Test: `equipamento-list.component.spec.ts`, `equipamento-detalhe-drawer.spec.ts`

**Interfaces:**
- Consumes (T7): `DashboardEquipamentoLista.manutencaoManual/janelaAtivaId/janelaAtivaFim`.
- Produces: função exportada `origemDaManutencao(linha): string | null` em `features/equipamentos/origem-manutencao.ts`:

```ts
import { DatePipe } from '@angular/common';
import { DashboardEquipamentoLista } from '../../core/models/dashboard';

type LinhaComOrigem = Pick<DashboardEquipamentoLista, 'emManutencao' | 'manutencaoManual' | 'janelaAtivaId'>;

/** Legenda curta da origem: "Manual", "Janela #41", "Manual + janela #41"; nula fora de manutenção. */
export function origemDaManutencao(linha: LinhaComOrigem): string | null {
  if (!linha.emManutencao) return null;
  const janela = linha.janelaAtivaId !== null ? `janela #${linha.janelaAtivaId}` : null;
  if (linha.manutencaoManual && janela) return `Manual + ${janela}`;
  if (linha.manutencaoManual) return 'Manual';
  return janela ? `J${janela.slice(1)}` : null;
}
```

- [ ] **Step 1: Specs (falham)**
  - `acaoDeManutencao`: `{ativo:true, manutencaoManual:false, emManutencao:true}` (só janela) → `'iniciarManutencao'`; `{manutencaoManual:true, ativo:false}` → `'encerrarManutencao'`; `{ativo:false, manutencaoManual:false, emManutencao:true}` → `null`.
  - Linha só em janela mostra badge "Em manutenção" e legenda "Janela #41"; manual → "Manual"; ambos → "Manual + janela #41".
  - Confirmação de encerrar manual com `janelaAtivaId = 41` contém "continua em manutenção pela janela #41 até"; aviso de sucesso = "Manutenção manual de SW-CORE encerrada. Continua em manutenção pela janela #41."
  - Drawer: em "Estado atual", `dt` "Origem da manutenção" com "Janela #41 até dd/MM HH:mm" e link para `/manutencoes`; botão do rodapé decide por `manutencaoManual`.
- [ ] **Step 2: Implementar**
  - `acaoDeManutencao(linha: Pick<DashboardEquipamentoLista, 'ativo' | 'manutencaoManual'>)`: `if (linha.manutencaoManual) return 'encerrarManutencao'; return linha.ativo ? 'iniciarManutencao' : null;` com comentário: "decide pelo BOTÃO, não pelo estado efetivo: com janela ativa e botão desligado, 'Encerrar' não faria nada (o CAS do manual devolve 0)".
  - Coluna de status (`html:142`): depois do `<app-status-badge>`, `@if (origemDaManutencao(linha); as origem) { <small class="equipamentos__origem">{{ origem }}</small> }`.
  - Texto da confirmação de `encerrarManutencao`: o atual + (se `janelaAtivaId`) ` ${nome} continua em manutenção pela janela #${id} até ${fim formatado dd/MM HH:mm}.`. `avisoDeSucesso` passa a receber a linha e devolve a frase da janela quando `janelaAtivaId !== null`.
  - Drawer: input já recebe `linha`; adicione o `dt/dd` e troque `linha()?.emManutencao` por `linha()?.manutencaoManual` no rótulo/condição do botão (`@if (linha()?.manutencaoManual || linha()?.ativo)`).
  - Estilo da legenda: `font-size: 11px; color: var(--im-text-secondary); display:block; margin-top:2px` (use `/frontend-design` só se a legenda brigar com o badge visualmente).
- [ ] **Step 3: Rodar** `npx ng test --watch=false` → PASS.
- [ ] **Step 4: Commit** — `feat(equipamentos): manutencao manual e janela distinguidas na lista e no drawer`

---

### Task 9: Front — tela `/manutencoes` e modal de agendamento

**Files:**
- Create: `features/manutencoes/manutencao-list.component.{ts,html,scss,spec.ts}`
- Create: `features/manutencoes/agendar-manutencao.component.{ts,html,scss,spec.ts}`
- Create: `features/manutencoes/periodo.ts` (+`periodo.spec.ts`)
- Modify: `app.routes.ts` (rota em `businessRoutes`, depois de `medicoes`), `layout/sidebar/sidebar.component.ts:34` (item depois de "Monitoramento": `{ label: 'Manutenções', path: '/manutencoes', icon: 'wrench' }`)

**Interfaces:**
- Consumes (T7): `ManutencaoApiService`, modelos, `MaintenanceWindowStatus`; `UnidadeApiService`/`DashboardApiService` existentes para listar unidades ativas e equipamentos ativos da unidade (use o que a tela de Equipamentos já usa para o select de unidades e `dashboard/equipamentos` filtrado por `unidadeId` e `ativo`).
- `periodo.ts`:

```ts
/** `datetime-local` (horário local do navegador, sem fuso) → ISO UTC. Vazio/inválido → null. */
export function localParaIso(valor: string): string | null {
  if (!valor) return null;
  const data = new Date(valor);          // ECMAScript: sem 'Z' é interpretado como horário LOCAL
  return Number.isNaN(data.getTime()) ? null : data.toISOString();
}
/** ISO → valor de `datetime-local` no horário local, para preencher o campo. */
export function isoParaLocal(iso: string): string {
  const d = new Date(iso); const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
/** Erro de período ou null. Espelha o backend (tolerância de 5 min no passado; máximo em horas). */
export function erroDoPeriodo(inicio: string | null, fim: string | null, agora: Date, maxHoras: number): string | null {
  if (!inicio || !fim) return 'Informe início e fim.';
  const i = Date.parse(inicio), f = Date.parse(fim);
  if (f <= i) return 'O fim deve ser depois do início.';
  if (i < agora.getTime() - 5 * 60_000) return 'O início não pode estar no passado.';
  if (f - i > maxHoras * 3_600_000) return `A janela não pode passar de ${maxHoras} horas.`;
  return null;
}
```

- [ ] **Step 1: Specs (falham)**
  - `periodo.spec.ts`: fim = início → erro; início 6 min atrás → erro; 4 min atrás → ok; 72h → ok; 72h + 1 min → erro "72 horas"; `localParaIso('2026-10-22T10:00')` = `new Date(2026, 9, 22, 10, 0).toISOString()`.
  - Lista: carrega `parametros` + `list('VIGENTES','',0)`; estados carregando/vazio/erro; linha mostra `#41`, unidade, escopo ("Unidade inteira" | "3 equipamentos" com nomes no `title`), início/fim `dd/MM/yyyy HH:mm`, segunda linha de atraso quando `ativadaEm - inicioPrevisto > 60s` ("ativada 10:47 · 47 min de atraso"), motivo, criado por, badge da situação; menu: AGENDADA → "Cancelar", ATIVA → "Encerrar agora", demais → nenhum menu (célula "—"); VISUALIZADOR (`!authState.canManageInventory()`) → itens desabilitados e "+ Agendar manutenção" oculto; filtro Vigentes/Histórico chama `list('HISTORICO', ...)` e volta à página 0; busca com debounce 300 ms; `app-paginacao` com `totalPages` da resposta.
  - Banner quando `agendadorLigado = false` com o texto exato do spec §3.1 e botão de agendar `disabled`.
  - Diálogos: cancelar → título `Cancelar a janela #41?`, botão `Cancelar janela`, mensagem exata do spec §3.2; encerrar → título `Encerrar agora a janela #41?`, botão `Encerrar janela`, mensagem exata; ambos `confirmTone="primario"`; erro da API aparece em `erro` do diálogo; sucesso → aviso `Janela #41 cancelada.` / `Janela #41 encerrada.` e recarga.
  - Nota fixa abaixo da tabela com o texto do spec §3.2 ("Cancelar ou encerrar uma janela não recupera SLA: ...").
  - Modal: abre com foco no primeiro campo (Unidade); Escape fecha e o foco volta ao botão "+ Agendar manutenção" (teste com `document.activeElement`); escopo "Equipamentos selecionados" mostra checkboxes dos equipamentos ATIVOS da unidade e exige ≥1; motivo obrigatório (máx 300); período validado por `erroDoPeriodo` antes de enviar (nenhuma chamada HTTP com período inválido); envio monta `CriarManutencaoRequest` com ISO; erro 409/400 da API aparece no rodapé do modal (`role="alert"`); sucesso fecha o modal, mostra `Janela #N agendada.` e, se `sobreposicoes.length`, ` Atenção: sobrepõe a janela #M.`.
- [ ] **Step 2: Implementar** — siga `usuario-list.component.*` como molde de estrutura (cabeçalho `.pagina__cabecalho` com `h1#manutencoes-title` "Janelas de manutenção", `p.pagina__descricao` com o subtítulo do spec, `.cartao` > rolagem > `table.tabela`, `.feedback`, `.notice`, `.esqueleto`). Filtro segmentado: dois `<button class="botao" [attr.aria-pressed]>` num `div role="group" aria-label="Situação"`. Use **/frontend-design** para o acabamento visual (banner, segunda linha de atraso, nota de SLA, lista de checagem do modal), mantendo tokens `--im-*` existentes e a geração A. Rota:

```ts
{ path: 'manutencoes', loadComponent: () => import('./features/manutencoes/manutencao-list.component').then(m => m.ManutencaoListComponent), data: { breadcrumb: 'Manutenções', title: 'Janelas de manutenção', section: 'Gerenciamento' } },
```
- [ ] **Step 3: Rodar** `npx ng test --watch=false` e `npx ng build` → PASS.
- [ ] **Step 4: Commit** — `feat(manutencoes): tela de janelas com agendamento, cancelamento e encerramento`

---

### Task 10: Validação integrada, e2e, carga e documentação

**Files:**
- Create: `infra-monitor-frontend/e2e/manutencao-agendada.cjs`, evidências em `infra-monitor-frontend/e2e/manutencao-agendada-evidence/`
- Modify: `infra-monitor-frontend/package.json` (script `e2e:manutencao-agendada`)
- Modify: `Docs/validacao-producao/manutencao-agendada-f1.md`, `Docs/validacao-producao/validacao-producao.md` (índice), `Docs/manutencao-agendada-architecture/{manutencao-agendada-architecture.md,manutencao-agendada-decisoes.md}`

- [ ] **Step 1: Suítes completas** — `cd infra-monitor-backend && ./mvnw test` com Docker ligado: anotar `Tests run` total e confirmar **ausência** da linha `!! N classes puladas`. `cd infra-monitor-frontend && npx ng test --watch=false && npx ng build`.
- [ ] **Step 2: e2e** — roteiro no padrão de `e2e/manutencao-interface.cjs` (armadilhas 1–4 do cabeçalho dele valem): env `MANUT_AG_EMAIL`, `MANUT_AG_SENHA`, `MANUT_AG_EQUIPAMENTO`, `MANUT_AG_UNIDADE`, `BASE`, `API_PORT`, `MANUT_AG_OUT`. Fluxo por clique: login → menu "Manutenções" → "+ Agendar manutenção" (captura do modal) → Escape fecha e foco volta ao botão (checar `document.activeElement`) → reabre → unidade, escopo Equipamentos selecionados, marca o equipamento, início = agora + 90 s, fim = agora + 30 min, motivo "E2E F1" → Agendar → aviso + linha AGENDADA (captura) → espera até 150 s recarregando pelo filtro (clique) até a linha virar ATIVA (captura) → menu lateral Equipamentos → busca → legenda "Janela #N" na linha (captura) → volta a Manutenções → menu da linha → "Encerrar agora" → diálogo com o texto de SLA (captura, conferir texto) → confirmar → filtro Histórico → linha CONCLUÍDA (captura). Log de rede e resultado em `finally`. Backend do e2e: banco descartável clonado do dev (memória "E2E com clone descartável do dev": `pg_dump` do dev em container na 5440, jar em 8082 com admin próprio) com `MANUTENCAO_AGENDADA_ENABLED=true MANUTENCAO_AGENDADA_INTERVALO_MS=5000`, motor desligado.
- [ ] **Step 3: Banco da carga** — credencial em `~/.inframonitor-carga/env.sh` (não o env.sh de scratchpad antigo); jar fora do `target` do dev, porta 8081, `MANUTENCAO_AGENDADA_ENABLED=true`, intervalo 5000; nunca `docker compose` no banco da carga. Escolher um equipamento real da Sede, agendar pela tela (e2e com `API_PORT=8081`) e conferir por SQL, com saída bruta no doc:
  ```sql
  select id, status, inicio_previsto, ativada_em, fim_previsto, encerrada_em, encerrada_por_id from manutencao_agendada order by id desc limit 3;
  select id, em_manutencao, manutencao_manual from equipamento where id = :eq;
  select id, monitor_id, inicio_em, fim_em from janela_monitoramento where monitor_id in (select id from monitor where equipamento_id = :eq) order by id desc limit 4;
  select id, status, motivo_encerramento, fechado_por from incidente where monitor_id in (select id from monitor where equipamento_id = :eq) order by id desc limit 3;
  select id, tipo_evento, status from notificacao order by id desc limit 5;
  ```
  Esperado: janela CONCLUÍDA com carimbos reais; flags voltaram a false/false; uma janela de SLA fechada no instante de ativação e outra aberta no encerramento. Dev é reerguido por último.
- [ ] **Step 4: Docs** — `manutencao-agendada-f1.md` com: distribuições das corridas, provas de reversão, contagem das suítes, lista de capturas, SQL da carga; link no índice `validacao-producao.md`; `manutencao-agendada-architecture.md` com estado "F1 implementada" e qualquer decisão nova tomada durante a execução (MA18+).
- [ ] **Step 5: Commit** — `test(e2e): fluxo de janela agendada e exercicio no banco da carga` e `docs(manutencao-agendada): evidencias da F1`.
