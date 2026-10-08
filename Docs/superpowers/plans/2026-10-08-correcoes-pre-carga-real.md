# Correções antes da carga real — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir a reabertura após fechamento manual (incidente e latência), a linha do tempo, a mensagem de fechamento manual, decimal/plural/zero na tela, integrar o aviso de IBGE e registrar a dívida de latência sub-ms.

**Architecture:** Âncora de observação única (`InicioDaObservacao` = max(início da janela aberta, `updated_at` do último incidente FECHADO)) consumida pelos dois processadores do motor. Frontend: lógica pura em `timeline.ts` e em `core/format/*`, locale `pt-BR` global. E2E Playwright contra Postgres descartável.

**Tech Stack:** Java 21, Spring Boot 4.1, JPA, Testcontainers (Postgres 16), JUnit 5/Mockito/AssertJ; Angular 21 (signals, standalone), Vitest/Karma via `ng test`; Playwright `.cjs`.

**Spec:** `Docs/superpowers/specs/2026-10-08-correcoes-pre-carga-real-design.md`

## Global Constraints

- Branch `fix/pre-carga-real`. Sem push, sem merge.
- Banco de dev `inframonitor-postgres` (porta 5434): **nenhuma escrita, nenhum boot da aplicação apontando para ele** (Flyway migra no boot). `pg_dump` (leitura) permitido.
- Motor nunca contra o dev. Telegram real nunca: não exportar `infra-monitor-backend/.env`; `TELEGRAM_ENABLED`, `NOTIFICATION_DISPATCHER_ENABLED`, `MONITORING_ENGINE_ENABLED` ficam `false` (default).
- Nunca editar migration existente. Nenhuma migration nova neste plano.
- Sem Lombok; sem abstração especulativa; `Instant`/Java Time; erros no formato `ErroResposta`.
- Comentários e textos de UI em pt-BR, no estilo do arquivo vizinho (backend: comentários sem acento, como os existentes).
- Backend: `cd infra-monitor-backend && ./mvnw test` (Docker disponível → testes Postgres rodam). Frontend: `cd infra-monitor-frontend && npx ng test --watch=false` e `npx ng build`.
- Commits: Conventional Commits em pt-BR sem acento no assunto, terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Em execução paralela, `git add` só dos próprios arquivos e `git commit -- <paths>`; se `index.lock` existir, esperar e repetir.
- Texto de UI exato: "Encerrado manualmente", "Encerrado por manutenção", "Incidente fechado". Telegram: `INCIDENTE ENCERRADO MANUALMENTE`, `Encerrado por: {nome}`.

## Review Focus

1. Fechamento manual com `encerradoEm` **retroativo** no corpo e alvo ainda fora → não pode reabrir antes de 3 falhas novas (Task 1, teste `fechamentoRetroativoNaoAntecipaReabertura`).
2. Fechamento manual de incidente **sem** janela aberta (monitor desativado depois) → processador não abre nada e não lança (Task 1, `InicioDaObservacaoTest.semJanelaAbertaDevolveVazio`).
3. Incidente legado (pré-V19, `motivoEncerramento` nulo) na timeline → nunca afirmar recuperação que não foi medida (Task 4, teste "legado sem sequência").
4. Locale `pt-BR` global mudando texto de `DatePipe`/`number` em specs existentes → suíte inteira verde, expectativas atualizadas só quando o novo texto é o correto (Task 5).
5. Latência: saída de manutenção com cauda congelada acima do limiar → nenhum episódio na 1ª medição nova (Task 2, `caudaCongeladaPelaManutencaoNaoAbreEpisodio`).

---

## Ordem e paralelismo

- **Trilha backend (sequencial):** Task 1 → Task 2 → Task 3 → Task 6.
- **Trilha frontend (sequencial):** Task 4 → Task 5 → Task 7.
- As duas trilhas rodam em paralelo (arquivos disjuntos).
- Depois das duas: Task 8 (IBGE), Task 9 (e2e + layout), Task 10 (docs, suítes, build).

---

### Task 1: Âncora de observação e reabertura após fechamento manual (incidente)

**Files:**
- Create: `infra-monitor-backend/src/main/java/br/com/inframonitor/monitoring/observacao/InicioDaObservacao.java`
- Modify: `infra-monitor-backend/src/main/java/br/com/inframonitor/incidente/repository/IncidenteRepository.java` (nova query)
- Modify: `infra-monitor-backend/src/main/java/br/com/inframonitor/monitoring/incident/IncidentProcessor.java` (`processarAbertura`, construtor)
- Test (create): `infra-monitor-backend/src/test/java/br/com/inframonitor/monitoring/observacao/InicioDaObservacaoTest.java`
- Test (create): `infra-monitor-backend/src/test/java/br/com/inframonitor/monitoring/incident/ReaberturaAposFechamentoManualPostgresIntegrationTest.java`
- Test (modify): `infra-monitor-backend/src/test/java/br/com/inframonitor/monitoring/incident/IncidentProcessorTest.java`

**Interfaces:**
- Produces: `IncidenteRepository#ultimoFechamentoRegistrado(Long monitorId): Optional<Instant>`; `InicioDaObservacao#doMonitor(Long monitorId): Optional<Instant>` (bean `@Component`, pacote `br.com.inframonitor.monitoring.observacao`).

- [ ] **Step 1: Teste unitário da âncora (falha por classe inexistente)**

```java
package br.com.inframonitor.monitoring.observacao;

import br.com.inframonitor.incidente.repository.IncidenteRepository;
import br.com.inframonitor.relatorio.entity.JanelaMonitoramento;
import br.com.inframonitor.relatorio.repository.JanelaMonitoramentoRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class InicioDaObservacaoTest {
    private static final Instant JANELA = Instant.parse("2026-10-08T10:00:00Z");

    @Mock JanelaMonitoramentoRepository janelaRepository;
    @Mock IncidenteRepository incidenteRepository;
    @InjectMocks InicioDaObservacao inicio;

    @Test void semJanelaAbertaDevolveVazio() {
        when(janelaRepository.aberta(1L)).thenReturn(Optional.empty());
        assertThat(inicio.doMonitor(1L)).isEmpty();
    }

    @Test void semIncidenteFechadoAncoraNaJanela() {
        when(janelaRepository.aberta(1L)).thenReturn(Optional.of(janela(JANELA)));
        when(incidenteRepository.ultimoFechamentoRegistrado(1L)).thenReturn(Optional.empty());
        assertThat(inicio.doMonitor(1L)).contains(JANELA);
    }

    @Test void fechamentoDepoisDaJanelaVenceAJanela() {
        Instant fechamento = JANELA.plusSeconds(600);
        when(janelaRepository.aberta(1L)).thenReturn(Optional.of(janela(JANELA)));
        when(incidenteRepository.ultimoFechamentoRegistrado(1L)).thenReturn(Optional.of(fechamento));
        assertThat(inicio.doMonitor(1L)).contains(fechamento);
    }

    @Test void fechamentoAntesDaJanelaNaoRecuaAAncora() {
        when(janelaRepository.aberta(1L)).thenReturn(Optional.of(janela(JANELA)));
        when(incidenteRepository.ultimoFechamentoRegistrado(1L)).thenReturn(Optional.of(JANELA.minusSeconds(600)));
        assertThat(inicio.doMonitor(1L)).contains(JANELA);
    }

    private JanelaMonitoramento janela(Instant inicioEm) {
        JanelaMonitoramento janela = mock(JanelaMonitoramento.class);
        when(janela.getInicioEm()).thenReturn(inicioEm);
        return janela;
    }
}
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd infra-monitor-backend && ./mvnw test -Dtest=InicioDaObservacaoTest`
Expected: erro de compilação (`InicioDaObservacao`/`ultimoFechamentoRegistrado` não existem).

- [ ] **Step 3: Query no repositório** (junto às outras queries de `IncidenteRepository`)

```java
    /**
     * Instante em que o fechamento mais recente do monitor foi GRAVADO, nao o encerrado_em
     * informado: no fechamento manual o encerrado_em vem do corpo e aceita data retroativa.
     * Os tres CAS de fechamento escrevem updated_at = :agora, e FECHADO e terminal (nenhum
     * endpoint escreve num incidente fechado), entao o valor nao se move depois.
     */
    @Query("select max(i.updatedAt) from Incidente i where i.monitor.id = :monitorId "
            + "and i.status = br.com.inframonitor.incidente.entity.StatusIncidente.FECHADO")
    Optional<Instant> ultimoFechamentoRegistrado(@Param("monitorId") Long monitorId);
```

- [ ] **Step 4: Componente**

```java
package br.com.inframonitor.monitoring.observacao;

import br.com.inframonitor.incidente.repository.IncidenteRepository;
import br.com.inframonitor.relatorio.entity.JanelaMonitoramento;
import br.com.inframonitor.relatorio.repository.JanelaMonitoramentoRepository;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.Optional;

/**
 * Desde quando as medicoes de um monitor podem sustentar uma ocorrencia nova (incidente ou
 * episodio de latencia). Medicao anterior a este instante ja foi lida por outra coisa: pela
 * observacao anterior a uma manutencao, ou pelo incidente que acabou de ser fechado.
 *
 * <p>Nao e a janela_monitoramento sozinha: o fechamento manual nao pode fechar e reabrir
 * janela, porque o SQL de disponibilidade comeca cada janela na primeira medicao dentro dela
 * (greatest(j.inicio_em, min(md.executado_em))) e cada fechamento encolheria o denominador
 * do SLA por um periodo que continuou observado.
 */
@Component
public class InicioDaObservacao {
    private final JanelaMonitoramentoRepository janelaRepository;
    private final IncidenteRepository incidenteRepository;

    public InicioDaObservacao(JanelaMonitoramentoRepository janelaRepository, IncidenteRepository incidenteRepository) {
        this.janelaRepository = janelaRepository;
        this.incidenteRepository = incidenteRepository;
    }

    /** Vazio quando o monitor nao esta sendo observado (sem janela aberta). */
    public Optional<Instant> doMonitor(Long monitorId) {
        Optional<JanelaMonitoramento> janela = janelaRepository.aberta(monitorId);
        if (janela.isEmpty()) {
            return Optional.empty();
        }
        Instant inicioDaJanela = janela.get().getInicioEm();
        return Optional.of(incidenteRepository.ultimoFechamentoRegistrado(monitorId)
                .filter(fechamento -> fechamento.isAfter(inicioDaJanela))
                .orElse(inicioDaJanela));
    }
}
```

- [ ] **Step 5: Rodar `InicioDaObservacaoTest`** — Expected: 4 PASS.

- [ ] **Step 6: Teste de integração com Postgres real (reversão), falhando antes da troca no processor**

Criar `ReaberturaAposFechamentoManualPostgresIntegrationTest` copiando o cabeçalho de `CaudaCongeladaTest` (mesmas `properties`, mesmo `PostgreSQLContainer`, mesmo `truncate`, acrescentando `usuarios` ao truncate e o insert do operador de `FechamentoManualConcorrenciaPostgresIntegrationTest:102-104`). Monitor com `falhasParaIncidente = 3`, `sucessosParaRecovery = 2`. Instantes relativos a `Instant.now().truncatedTo(ChronoUnit.MILLIS)` porque o `updated_at` do fechamento é relógio real.

```java
    @Autowired IncidenteService incidenteService;

    private Instant agora;

    // no @BeforeEach, depois de criar o monitor:
    //   agora = Instant.now().truncatedTo(ChronoUnit.MILLIS);
    //   abrirJanela(agora.minusSeconds(3600));

    @Test
    void alvoForaDoArFechadoManualmenteSoReabreNaTerceiraFalhaNova() {
        Incidente aberto = abrirComTresFalhas();
        incidenteService.fechar(aberto.getId(), new CloseIncidenteRequest(Instant.now(), null), operadorId);

        Instant base = Instant.now().truncatedTo(ChronoUnit.MILLIS).plusSeconds(1);
        incidentProcessor.process(medicao(StatusMedicao.FALHA, base));
        assertThat(incidentesAbertos()).as("1a falha nova").isZero();
        incidentProcessor.process(medicao(StatusMedicao.FALHA, base.plusSeconds(30)));
        assertThat(incidentesAbertos()).as("2a falha nova").isZero();
        incidentProcessor.process(medicao(StatusMedicao.FALHA, base.plusSeconds(60)));
        assertThat(incidentesAbertos()).as("3a falha nova").isEqualTo(1);

        Incidente novo = incidenteRepository
                .findFirstByMonitorIdAndStatusInOrderByIniciadoEmDescIdDesc(monitor.getId(), StatusIncidente.EM_ABERTO)
                .orElseThrow();
        assertThat(novo.getId()).isNotEqualTo(aberto.getId());
        assertThat(novo.getIniciadoEm()).isEqualTo(base);
    }

    @Test
    void fechamentoRetroativoNaoAntecipaReabertura() {
        Incidente aberto = abrirComTresFalhas();
        // encerradoEm retroativo: as 3 falhas que abriram ficam "depois" dele.
        incidenteService.fechar(aberto.getId(),
                new CloseIncidenteRequest(aberto.getIniciadoEm(), null), operadorId);

        incidentProcessor.process(medicao(StatusMedicao.FALHA,
                Instant.now().truncatedTo(ChronoUnit.MILLIS).plusSeconds(1)));

        assertThat(incidentesAbertos()).isZero();
    }

    private Incidente abrirComTresFalhas() {
        medicao(StatusMedicao.FALHA, agora.minusSeconds(90));
        medicao(StatusMedicao.FALHA, agora.minusSeconds(60));
        incidentProcessor.process(medicao(StatusMedicao.FALHA, agora.minusSeconds(30)));
        return incidenteRepository
                .findFirstByMonitorIdAndStatusInOrderByIniciadoEmDescIdDesc(monitor.getId(), StatusIncidente.EM_ABERTO)
                .orElseThrow();
    }

    private long incidentesAbertos() {
        return jdbc.queryForObject("select count(*) from incidente where monitor_id = ? and status <> 'FECHADO'",
                Long.class, monitor.getId());
    }

    private Medicao medicao(StatusMedicao status, Instant executadoEm) {
        return medicaoRepository.saveAndFlush(new Medicao(monitor, status, null, null, executadoEm));
    }
```

- [ ] **Step 7: Rodar e registrar a falha (prova de reversão, lado "sem correção")**

Run: `./mvnw test -Dtest=ReaberturaAposFechamentoManualPostgresIntegrationTest 2>&1 | tee ../Docs/validacao-producao/evidencias/reabertura-1-sem-correcao.txt`
Expected: FAIL em `alvoForaDoArFechadoManualmenteSoReabreNaTerceiraFalhaNova` com `[1a falha nova] expected: 0 but was: 1` (e o retroativo também falha).

- [ ] **Step 8: Trocar a âncora no `IncidentProcessor`**

Substituir o campo/parâmetro `JanelaMonitoramentoRepository janelaRepository` por `InicioDaObservacao inicioDaObservacao` (construtor e campo; remover imports não usados) e o bloco da janela em `processarAbertura` por:

```java
        // Medicao anterior ao inicio da observacao atual nao sustenta abertura. A ancora e a
        // mais recente entre a janela aberta (cauda congelada pela manutencao, B.5) e a
        // gravacao do ultimo fechamento do monitor: fechado a mao com o alvo ainda fora, o
        // incidente novo so nasce de falhas NOVAS, contadas a partir do fechamento.
        Optional<Instant> inicioDaObservacao = this.inicioDaObservacao.doMonitor(monitor.getId());
        if (inicioDaObservacao.isEmpty()) {
            log.debug("No open monitoring window for monitor {}; opening skipped", monitor.getId());
            return;
        }
        if (medicoes.stream().anyMatch(m -> m.getExecutadoEm().isBefore(inicioDaObservacao.get()))) {
            log.debug("Failure tail predates the observation start for monitor {}; opening skipped", monitor.getId());
            return;
        }
```

- [ ] **Step 9: Atualizar `IncidentProcessorTest`**

Trocar `@Mock private JanelaMonitoramentoRepository janelaRepository;` por `@Mock private InicioDaObservacao inicioDaObservacao;` e cada `when(janelaRepository.aberta(1L)).thenReturn(Optional.of(janela(monitor, X)))` por `when(inicioDaObservacao.doMonitor(1L)).thenReturn(Optional.of(X))`; `Optional.empty()` idem. Remover o helper `janela(...)` se ficar sem uso. Acrescentar:

```java
    @Test void caudaAnteriorAoUltimoFechamentoNaoAbre() {
        Monitor monitor = monitor(3, 2);
        Medicao primeira = medicao(monitor, 1L, StatusMedicao.FALHA, T0);
        Medicao segunda = medicao(monitor, 2L, StatusMedicao.FALHA, T0.plusSeconds(60));
        Medicao terceira = medicao(monitor, 3L, StatusMedicao.FALHA, T0.plusSeconds(120));
        prepararAtual(terceira);
        when(medicaoRepository.findByMonitorIdOrderByExecutadoEmDescIdDesc(eq(1L), any(Pageable.class)))
                .thenReturn(List.of(terceira, segunda, primeira));
        when(inicioDaObservacao.doMonitor(1L)).thenReturn(Optional.of(T0.plusSeconds(90)));

        processor.process(terceira);

        verify(incidenteService, never()).abrirAutomaticamente(any(), any(), any(Integer.class));
    }
```

- [ ] **Step 10: Rodar e registrar o lado "com correção"**

Run: `./mvnw test -Dtest='ReaberturaAposFechamentoManualPostgresIntegrationTest,IncidentProcessorTest,InicioDaObservacaoTest,CaudaCongeladaTest,AberturaCondicionalTest' 2>&1 | tee ../Docs/validacao-producao/evidencias/reabertura-2-com-correcao.txt`
Expected: tudo PASS.

- [ ] **Step 11: Commit**

```bash
git add infra-monitor-backend/src Docs/validacao-producao/evidencias/reabertura-*.txt
git commit -m "fix(motor): fechamento manual reinicia a contagem de falhas do incidente

Ancora de observacao = max(inicio da janela aberta, gravacao do ultimo fechamento).
Janela nao serve: cada fechar/abrir encolheria o denominador do SLA.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Mesma âncora no episódio de latência

**Files:**
- Modify: `infra-monitor-backend/src/main/java/br/com/inframonitor/monitoring/latency/LatencyEpisodeProcessor.java`
- Test (modify): `infra-monitor-backend/src/test/java/br/com/inframonitor/monitoring/latency/LatencyEpisodeProcessorTest.java`

**Interfaces:**
- Consumes: `InicioDaObservacao#doMonitor(Long): Optional<Instant>` (Task 1).

- [ ] **Step 1: Testes falhando** (em `LatencyEpisodeProcessorTest`; adicionar `@Mock private InicioDaObservacao inicioDaObservacao;` e, no helper `processor()`, passar `inicioDaObservacao` logo após `notificacaoService`). Helpers `monitor()` (id 1), `medicao(monitor, id, status, latenciaMs, quando)`, `prepararAtual`, `semEpisodioAberto` já existem no arquivo; `LIMIAR = 250`, `CICLOS = 2`:

```java
    @Test void caudaCongeladaPelaManutencaoNaoAbreEpisodio() {
        Monitor monitor = monitor();
        Medicao antiga = medicao(monitor, 1L, StatusMedicao.SUCESSO, 300, T0);                 // antes da manutencao
        Medicao nova = medicao(monitor, 2L, StatusMedicao.SUCESSO, 310, T0.plusSeconds(3600)); // 1a depois da saida
        prepararAtual(nova);
        semEpisodioAberto();
        when(medicaoRepository.findByMonitorIdOrderByExecutadoEmDescIdDesc(eq(1L), any(Pageable.class)))
                .thenReturn(List.of(nova, antiga));
        when(inicioDaObservacao.doMonitor(1L)).thenReturn(Optional.of(T0.plusSeconds(3000)));

        processor().process(nova);

        verify(episodioRepository, never()).inserirSeElegivel(any(), any(), anyInt(), any());
        verify(notificacaoService, never()).criarParaLatenciaAlta(any());
    }

    @Test void caudaAnteriorAoFechamentoDoIncidenteNaoAbreEpisodio() {
        Monitor monitor = monitor();
        Medicao duranteOIncidente = medicao(monitor, 1L, StatusMedicao.SUCESSO, 300, T0);
        Medicao depoisDoFechamento = medicao(monitor, 2L, StatusMedicao.SUCESSO, 310, T0.plusSeconds(60));
        prepararAtual(depoisDoFechamento);
        semEpisodioAberto();
        when(medicaoRepository.findByMonitorIdOrderByExecutadoEmDescIdDesc(eq(1L), any(Pageable.class)))
                .thenReturn(List.of(depoisDoFechamento, duranteOIncidente));
        when(inicioDaObservacao.doMonitor(1L)).thenReturn(Optional.of(T0.plusSeconds(30)));

        processor().process(depoisDoFechamento);

        verify(episodioRepository, never()).inserirSeElegivel(any(), any(), anyInt(), any());
    }

    @Test void semJanelaAbertaNaoAbreEpisodio() {
        Monitor monitor = monitor();
        Medicao primeira = medicao(monitor, 1L, StatusMedicao.SUCESSO, 300, T0);
        Medicao segunda = medicao(monitor, 2L, StatusMedicao.SUCESSO, 310, T0.plusSeconds(60));
        prepararAtual(segunda);
        semEpisodioAberto();
        when(medicaoRepository.findByMonitorIdOrderByExecutadoEmDescIdDesc(eq(1L), any(Pageable.class)))
                .thenReturn(List.of(segunda, primeira));
        when(inicioDaObservacao.doMonitor(1L)).thenReturn(Optional.empty());

        processor().process(segunda);

        verify(episodioRepository, never()).inserirSeElegivel(any(), any(), anyInt(), any());
    }
```

Nos testes existentes que esperam abertura, stubar `when(inicioDaObservacao.doMonitor(<id>)).thenReturn(Optional.of(<instante anterior a todas as medições>))` **só** nos testes que chegam à abertura (Mockito strict: stub sem uso falha).

- [ ] **Step 2: Rodar** `./mvnw test -Dtest=LatencyEpisodeProcessorTest` — Expected: os 3 novos FAIL (episódio é inserido).

- [ ] **Step 3: Implementar.** Construtor ganha `InicioDaObservacao inicioDaObservacao` logo após `NotificacaoService notificacaoService`; campo final. Em `processarAbertura`, logo após o `if (!sequenciaCompleta(...))`:

```java
        // Mesma ancora do IncidentProcessor. Sem ela a cauda congelada pela manutencao abria
        // episodio com iniciado_em de antes da manutencao, e sucessos lentos medidos durante um
        // incidente ja fechado abriam episodio com inicio dentro dele.
        Optional<Instant> inicioDaObservacao = this.inicioDaObservacao.doMonitor(monitorId);
        if (inicioDaObservacao.isEmpty()
                || medicoes.stream().anyMatch(m -> m.getExecutadoEm().isBefore(inicioDaObservacao.get()))) {
            log.debug("Latency tail predates the observation start for monitor {}", monitorId);
            return;
        }
```

- [ ] **Step 4: Rodar** `./mvnw test -Dtest='LatencyEpisodeProcessorTest,EpisodioLatenciaConcorrenciaPostgresIntegrationTest'` — Expected: PASS. Se o teste Postgres de concorrência quebrar por falta de janela aberta no fixture, abrir janela no `@BeforeEach` dele (é pré-condição real de produção), sem afrouxar a regra.

- [ ] **Step 5: Commit** `fix(latencia): episodio usa a mesma ancora de observacao do incidente`.

---

### Task 3: Mensagem de fechamento manual

**Files:**
- Modify: `infra-monitor-backend/src/main/java/br/com/inframonitor/notificacao/service/NotificacaoMessageBuilder.java`
- Test: `infra-monitor-backend/src/test/java/br/com/inframonitor/notificacao/service/NotificacaoMessageBuilderTest.java`

- [ ] **Step 1: Testes sobre o texto completo**

```java
    @Test
    void fechamentoManualDizQueFoiOperadorEQuem() {
        Incidente incidente = incidente();
        Usuario operador = new Usuario("Ricardo Barbosa", "r@x.test", "hash", Papel.OPERADOR, false);
        incidente.fechar(Instant.parse("2026-08-19T13:02:03Z"), null, operador, MotivoEncerramentoIncidente.FECHAMENTO_MANUAL);
        assertThat(builder.construir(incidente, TipoEventoNotificacao.INCIDENTE_FECHADO)).isEqualTo("""
                INCIDENTE ENCERRADO MANUALMENTE

                Unidade: Matriz
                Equipamento: SW-01
                Monitor: ICMP principal
                Inicio: 2026-08-19T12:00:00Z
                Fim: 2026-08-19T13:02:03Z
                Duracao: 1h 2m 3s
                Encerrado por: Ricardo Barbosa""");
    }

    @Test
    void recuperacaoAutomaticaNaoCitaOperador() {
        Incidente incidente = incidente();
        incidente.fechar(Instant.parse("2026-08-19T13:02:03Z"), null, null, MotivoEncerramentoIncidente.RECUPERACAO_AUTOMATICA);
        String mensagem = builder.construir(incidente, TipoEventoNotificacao.INCIDENTE_FECHADO);
        assertThat(mensagem).startsWith("INCIDENTE ENCERRADO\n").doesNotContain("MANUALMENTE", "Encerrado por");
    }

    @Test
    void fechamentoManualSemAutorNaoInventaNome() {
        Incidente incidente = incidente();
        incidente.fechar(Instant.parse("2026-08-19T13:02:03Z"), null, null, MotivoEncerramentoIncidente.FECHAMENTO_MANUAL);
        assertThat(builder.construir(incidente, TipoEventoNotificacao.INCIDENTE_FECHADO))
                .endsWith("\nEncerrado por: operador nao identificado");
    }
```

(Conferir o pacote de `Papel` e o construtor de `Usuario` em `usuario/entity`. Ajustar o teste antigo `montaMensagemDeFechamentoComDuracaoDosTimestamps` para `RECUPERACAO_AUTOMATICA`.)

- [ ] **Step 2: Rodar** `./mvnw test -Dtest=NotificacaoMessageBuilderTest` — Expected: FAIL nos novos.

- [ ] **Step 3: Implementar** em `construir`:

```java
        boolean fechamentoManual = tipoEvento == TipoEventoNotificacao.INCIDENTE_FECHADO
                && incidente.getMotivoEncerramento() == MotivoEncerramentoIncidente.FECHAMENTO_MANUAL;
        // ... no else final do cabecalho:
        //     cabecalho = fechamentoManual ? "INCIDENTE ENCERRADO MANUALMENTE" : "INCIDENTE ENCERRADO";
        // ... depois do bloco Fim/Duracao:
        if (fechamentoManual) {
            // Recuperacao e fechamento a mao saiam com o mesmo texto: quem le no Telegram
            // achava que o equipamento tinha voltado.
            mensagem.append("\nEncerrado por: ").append(incidente.getFechadoPor() != null
                    ? incidente.getFechadoPor().getNome() : "operador nao identificado");
        }
```

- [ ] **Step 4: Rodar** `./mvnw test -Dtest='NotificacaoMessageBuilderTest,NotificacaoServiceTest,NotificacaoManutencaoTest'` — PASS.
- [ ] **Step 5: Commit** `fix(notificacao): fechamento manual diz que foi operador e quem`.

---

### Task 4: Linha do tempo — três motivos e recorte das medições

**Files:**
- Modify: `infra-monitor-frontend/src/app/features/incidentes/timeline/timeline.ts`
- Test: `infra-monitor-frontend/src/app/features/incidentes/timeline/timeline.spec.ts`

**Interfaces:**
- Produces: `OcorrenciaTimeline.fechadoPorNome: string | null` (o drawer já passa `OcorrenciaDetalhe`, que tem o campo — nada muda no drawer além do tipo bater).

- [ ] **Step 1: Specs falhando** (acrescentar `fechadoPorNome: null` em `entradaDeIncidente.ocorrencia` e nas demais fixtures):

```ts
describe('fechamento por motivo', () => {
  const fechamento = (entrada: EntradaTimeline) => derivarTimeline(entrada).find((e) => e.tipo === 'fechamento')!;
  const comMotivo = (motivo: IncidentClosureReason | null, fechadoPorNome: string | null, encerradoEm = '2026-09-01T08:02:30Z'): EntradaTimeline => ({
    ...entradaDeIncidente,
    ocorrencia: { ...entradaDeIncidente.ocorrencia, motivoEncerramento: motivo, fechadoPorNome, encerradoEm },
  });

  it('recuperação automática afirma as respostas consecutivas e lista a recuperação', () => {
    const entrada = comMotivo(IncidentClosureReason.AutomaticRecovery, null);
    expect(fechamento(entrada).rotulo).toBe('Incidente fechado');
    expect(fechamento(entrada).detalhe).toBe('2 respostas consecutivas restabeleceram o monitor');
    expect(derivarTimeline(entrada).filter((e) => e.tipo === 'recuperacao')).toHaveLength(2);
  });

  it('fechamento manual diz quem fechou e não afirma recuperação', () => {
    // encerradoEm coincide com uma medição de sucesso de propósito: a guarda é explícita, não acidental.
    const entrada = comMotivo(IncidentClosureReason.ManualClosure, 'Ricardo');
    expect(fechamento(entrada).rotulo).toBe('Encerrado manualmente');
    expect(fechamento(entrada).detalhe).toBe('por Ricardo. Nenhuma recuperação foi medida.');
    expect(derivarTimeline(entrada).filter((e) => e.tipo === 'recuperacao')).toHaveLength(0);
  });

  it('manutenção mantém o texto de manutenção', () => {
    const entrada = comMotivo(IncidentClosureReason.Maintenance, null);
    expect(fechamento(entrada).rotulo).toBe('Encerrado por manutenção');
    expect(derivarTimeline(entrada).filter((e) => e.tipo === 'recuperacao')).toHaveLength(0);
  });

  it('legado com autor é lido como manual', () => {
    expect(fechamento(comMotivo(null, 'Ana')).rotulo).toBe('Encerrado manualmente');
  });

  it('legado sem autor e sem sequência não afirma causa', () => {
    const entrada = comMotivo(null, null, '2026-09-01T08:02:10Z');
    expect(fechamento(entrada).rotulo).toBe('Incidente fechado');
    expect(fechamento(entrada).detalhe).toBeNull();
  });

  it('legado sem autor com sequência medida é lido como recuperação', () => {
    expect(fechamento(comMotivo(null, null)).detalhe).toBe('2 respostas consecutivas restabeleceram o monitor');
  });
});

describe('recorte das medições', () => {
  it('não mostra medições posteriores ao encerramento nem anteriores ao início', () => {
    const entrada: EntradaTimeline = {
      ...entradaDeIncidente,
      medicoes: [
        medicao('2026-09-01T07:59:30Z', MeasurementStatus.Failure, null, 90),
        ...medicoesDoIncidente,
        medicao('2026-09-01T08:03:00Z', MeasurementStatus.Failure, null, 91),
        medicao('2026-09-01T08:03:30Z', MeasurementStatus.Failure, null, 92),
      ],
    };
    const chaves = derivarTimeline(entrada).map((e) => e.chave);
    expect(chaves).not.toContain('falha-90');
    expect(chaves).not.toContain('falha-91');
    expect(chaves).not.toContain('falha-92');
  });
});
```

- [ ] **Step 2: Rodar** `cd infra-monitor-frontend && npx ng test --watch=false --include='**/timeline.spec.ts'` — Expected: FAIL.

- [ ] **Step 3: Implementar**
  1. `OcorrenciaTimeline` ganha `/** Só o incidente tem; nulo é motor, episódio ou legado sem autor. */ fechadoPorNome: string | null;`
  2. Em `derivarTimeline`: `const medicoes = entrada.medicoes.filter((m) => dentroDaJanela(m.executadoEm, ocorrencia)).sort(porMedicao);` com comentário: "A folga carregada pelo drawer é contexto do gráfico, não evento: medição fora da janela pertence a outra ocorrência."
  3. Substituir o bloco `if (ocorrencia.encerradoEm) { ... }` de `eventosDeIncidente` por `if (ocorrencia.encerradoEm) eventos.push(...eventosDeFechamento(ocorrencia, ocorrencia.encerradoEm, medicoes, limiares));` e criar:

```ts
/**
 * O fechamento só afirma o que o dado prova. Manual e manutenção não têm sequência de
 * recuperação — a guarda é pelo motivo, não por a medição não casar com `encerradoEm`. Legado
 * (antes da V19, motivo nulo) se decide pelo autor e pela sequência medida; sem nenhum dos dois,
 * o fechamento sai sem causa.
 */
function eventosDeFechamento(ocorrencia: OcorrenciaTimeline, encerradoEm: string,
                             medicoes: HistoricoMedicaoResponse[], limiares: LimiaresMonitor): EventoTimeline[] {
  const fechamento = (rotulo: string, detalhe: string | null): EventoTimeline => ({
    chave: 'fechamento', instante: encerradoEm, tipo: 'fechamento', severidade: 'ok', rotulo, detalhe,
  });
  const motivo = ocorrencia.motivoEncerramento;
  if (motivo === IncidentClosureReason.Maintenance) {
    return [fechamento('Encerrado por manutenção',
      'O equipamento entrou em manutenção e saiu da observação. Nenhuma recuperação foi medida.')];
  }
  if (motivo === IncidentClosureReason.ManualClosure || (motivo === null && ocorrencia.fechadoPorNome)) {
    const autor = ocorrencia.fechadoPorNome ? `por ${ocorrencia.fechadoPorNome}` : 'por um operador';
    return [fechamento('Encerrado manualmente', `${autor}. Nenhuma recuperação foi medida.`)];
  }
  const recuperacao = eventosDeRecuperacao(encerradoEm, medicoes, limiares.sucessosParaRecovery);
  if (motivo === null && recuperacao.length === 0) return [fechamento('Incidente fechado', null)];
  return [...recuperacao, fechamento('Incidente fechado', limiares.sucessosParaRecovery !== null
    ? `${limiares.sucessosParaRecovery} respostas consecutivas restabeleceram o monitor` : null)];
}
```

- [ ] **Step 4: Rodar** a spec da timeline e a do drawer (`--include='**/incidentes/**/*.spec.ts'`) — PASS.
- [ ] **Step 5: Commit** `fix(timeline): fechamento por motivo e medicoes restritas a ocorrencia`.

---

### Task 5: Locale pt-BR, decimal e plural

**Files:**
- Create: `infra-monitor-frontend/src/app/core/format/numero.ts`, `numero.spec.ts`, `plural.ts`, `plural.spec.ts`
- Modify: `infra-monitor-frontend/src/app/app.config.ts`
- Modify: `features/relatorios/relatorios.component.ts:308-310`, `features/equipamentos/equipamento-detalhe-drawer.component.ts:404`, `features/dashboard/dashboard.component.ts:29` (+ usos), `features/unidades/detalhe/unidade-detalhe.store.ts:18` (+ usos)
- Modify (plural): `features/dashboard/dashboard.component.html:6,28,31,40` (+ `.ts`), `features/auth/login.component.html:44`, `features/mapa/mapa.component.html:25`, `features/monitores/monitor-management.component.html:106`, `features/unidades/unidade-list.component.html:30`, `features/dashboard/dashboard.component.html:62`, e o que mais a varredura achar.

**Interfaces:**
- Produces: `formatarDecimal(valor: number | null | undefined, casas?: number): string` ('—' para nulo/não finito); `formatarPercentual(valor: number | null | undefined): string` (`'99,50%'`); `plural(n: number, singular: string, pluralForma: string): string` (`'1 unidade'`, `'0 unidades'`).

- [ ] **Step 1: Specs**

```ts
// numero.spec.ts
import { formatarDecimal, formatarPercentual } from './numero';
describe('formatarDecimal', () => {
  it('usa vírgula e duas casas', () => expect(formatarDecimal(12.5)).toBe('12,50'));
  it('agrupa milhar com ponto', () => expect(formatarDecimal(1234.5)).toBe('1.234,50'));
  it('respeita casas', () => expect(formatarDecimal(3, 0)).toBe('3'));
  it('nulo e não finito viram travessão', () => {
    expect(formatarDecimal(null)).toBe('—'); expect(formatarDecimal(Number.NaN)).toBe('—');
  });
});
describe('formatarPercentual', () => {
  it('formata com sinal colado', () => expect(formatarPercentual(99.5)).toBe('99,50%'));
  it('nulo vira travessão', () => expect(formatarPercentual(undefined)).toBe('—'));
});

// plural.spec.ts
import { plural } from './plural';
describe('plural', () => {
  it('singular só para 1', () => expect(plural(1, 'unidade', 'unidades')).toBe('1 unidade'));
  it('zero é plural em pt-BR', () => expect(plural(0, 'unidade', 'unidades')).toBe('0 unidades'));
  it('muitos', () => expect(plural(3, 'unidade afetada', 'unidades afetadas')).toBe('3 unidades afetadas'));
});
```

- [ ] **Step 2: Rodar** — FAIL (módulos inexistentes).

- [ ] **Step 3: Implementar**

```ts
// numero.ts
/** Formatação numérica de exibição: sempre pt-BR. `toFixed` só para coordenada de SVG. */
const formatadores = new Map<number, Intl.NumberFormat>();
function formatador(casas: number): Intl.NumberFormat {
  let f = formatadores.get(casas);
  if (!f) { f = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas }); formatadores.set(casas, f); }
  return f;
}
export function formatarDecimal(valor: number | null | undefined, casas = 2): string {
  return valor === null || valor === undefined || !Number.isFinite(valor) ? '—' : formatador(casas).format(valor);
}
export function formatarPercentual(valor: number | null | undefined): string {
  const texto = formatarDecimal(valor);
  return texto === '—' ? texto : `${texto}%`;
}

// plural.ts
/** Concordância de número em pt-BR: singular só para 1; zero é plural. */
export function plural(n: number, singular: string, pluralForma: string): string {
  return `${n} ${n === 1 ? singular : pluralForma}`;
}
```

`app.config.ts`: `registerLocaleData(localePt, 'pt-BR');` (import de `@angular/common` e `@angular/common/locales/pt`) e `{ provide: LOCALE_ID, useValue: 'pt-BR' }` nos providers.

- [ ] **Step 4: Aplicar.** Relatórios: `availability` → `formatarPercentual(value)`; `latency` → `average ? \`${formatarDecimal(value)} ms\` : \`${value} ms\`` (mantendo os guards de nulo). Drawer de equipamento linha 404 → `formatarPercentual(valor)`. Dashboard e store: trocar `PERCENTUAL.format(x)` pelo helper equivalente e apagar as constantes. Varredura: `grep -rnE "toFixed\(|toLocaleString|Intl\.NumberFormat|\| number" src/app --include=*.ts --include=*.html | grep -v spec` — o que restar deve ser coordenada SVG ou o próprio `numero.ts`. Plural: varrer `grep -rnE "\}\} ?[a-zà-ú]+s\b" src/app --include=*.html` e trocar cada contagem variável por `{{ plural(n, '…', '…') }}` (expor `protected readonly plural = plural;` no componente). "1 de 1 unidades" → `{{ x }} de {{ plural(total, 'unidade', 'unidades') }}`.

- [ ] **Step 5: Suíte inteira** `npx ng test --watch=false`. Specs que quebrarem só por formato de data/número: atualizar a expectativa **se** o texto novo for o pt-BR correto; caso contrário investigar. Expected: PASS.
- [ ] **Step 6: Commit** `fix(ui): locale pt-BR, decimal com virgula e concordancia de plural`.

---

### Task 6: PDF com vírgula decimal

**Files:**
- Modify: `infra-monitor-backend/src/main/java/br/com/inframonitor/relatorio/pdf/VisaoGeralPdfRenderer.java:118,123`
- Test: o teste existente do renderer/serviço de PDF (`grep -rln VisaoGeralPdf infra-monitor-backend/src/test`); se nenhum cobrir o texto, criar `VisaoGeralPdfRendererFormatoTest` extraindo texto com `PDFTextStripper`.

- [ ] **Step 1: Teste** que gera o PDF com disponibilidade `99.50` e latência `12.34` e afirma que o texto extraído contém `99,50%` e `12,34 ms` e não contém `99.50%`.
- [ ] **Step 2: Rodar** — FAIL.
- [ ] **Step 3: Implementar** um helper privado `duasCasas(BigDecimal)` = `value.setScale(2, RoundingMode.HALF_UP).toPlainString().replace('.', ',')` usado nas duas linhas, comentário: "PDF e leitura humana: virgula como o resto da tela. CSV continua com ponto (dado para maquina, delimitador virgula)."
- [ ] **Step 4: Rodar** testes de PDF — PASS. **Step 5: Commit** `fix(pdf): decimal com virgula na visao geral`.

---

### Task 7: Zero não é alerta

**Files:**
- Modify: `infra-monitor-frontend/src/app/features/equipamentos/equipamento-detalhe-drawer.component.ts:344,353-356`
- Modify: `infra-monitor-frontend/src/app/features/incidentes/incidente-detalhe-drawer.component.ts:309-313`
- Test: specs dos dois drawers (`*.spec.ts` ao lado).

- [ ] **Step 1: Specs** — para cada cor: valor 0 → `''`; valor > 0 → classe atual (`kpi--warn` perda, `kpi--down` incidentes, `kpi--down` falhas, `kpi--warn` acima do limiar); sem dado → `''`. Seguir o padrão de montagem já usado nas specs dos drawers (ler antes).
- [ ] **Step 2: Rodar** — FAIL nos casos zero.
- [ ] **Step 3: Implementar**

```ts
  // equipamento
  protected readonly corPerda = computed(() => { const perda = this.perdaDePacotes(); return perda ? 'kpi--warn' : ''; });
  protected readonly corIncidentes = computed(() => { const contagem = /* expressão atual */; return contagem ? 'kpi--down' : ''; });
  // incidente — comentário corrigido: "Tom só quando há o que alertar: zero é neutro, não alerta."
  protected readonly corAcimaDoLimiar = computed(() => (this.medicoesProntas() && (this.medicoesAcimaDoLimiar() ?? 0) > 0 ? 'kpi--warn' : ''));
  protected readonly corFalhas = computed(() => (this.medicoesProntas() && this.falhasNaJanela() > 0 ? 'kpi--down' : ''));
```

(`perda` é `number | null`: `0` e `null` são falsy — intencional.)
- [ ] **Step 4: Rodar** specs dos drawers — PASS. **Step 5: Commit** `fix(ui): valor zero nao e pintado como alerta nas gavetas`.

---

### Task 8: Aviso de IBGE no detalhe da unidade

**Files:** branch `feat/aviso-ibge-detalhe-unidade` (`aef8951`): `features/unidades/detalhe/visao-geral.component.{ts,html,scss}`, `abas.spec.ts`, `e2e/unidade-detalhe-aviso-ibge.cjs`.

- [ ] **Step 1:** `git cherry-pick aef8951` no `fix/pre-carga-real`; resolver conflito se Task 5 tocou o mesmo arquivo.
- [ ] **Step 2:** `npx ng test --watch=false --include='**/unidades/detalhe/**/*.spec.ts'` — PASS esperado.
- [ ] **Step 3:** Com o ambiente e2e da Task 9 de pé, rodar `MAPA_BASE=http://127.0.0.1:4200 MAPA_EMAIL=... MAPA_SENHA=... node e2e/unidade-detalhe-aviso-ibge.cjs`. Se falhar (falha anterior: `.aviso-ibge` não visível para id 5), aplicar superpowers:systematic-debugging: confirmar no banco descartável `codigo_ibge`/lat/lon da unidade 5; checar se `store.cadastro()` chega preenchido e se `getMunicipios()` responde; corrigir a causa (dado → roteiro com evidência; código → correção com spec). Só seguir com e2e verde.
- [ ] **Step 4: Commit** `feat(unidades): aviso de IBGE divergente na visao geral` (squash do WIP + correção, mensagem nova).

---

### Task 9: Ambiente e2e descartável, layout da timeline e e2e por clique

**Files:**
- Create: `infra-monitor-frontend/e2e/pre-carga-timeline-e-tela.cjs`, `infra-monitor-frontend/e2e/pre-carga-evidence/`
- Create: `infra-monitor-frontend/e2e/pre-carga-seed.sql`
- Modify: `infra-monitor-frontend/src/app/features/incidentes/timeline/incidente-timeline.component.scss`
- Modify: `infra-monitor-frontend/package.json` (script `e2e:pre-carga`)

- [ ] **Step 1: Banco descartável**

```bash
SCRATCH=<scratchpad>
docker exec inframonitor-postgres pg_dump -U inframonitor -d inframonitor -Fc > $SCRATCH/dev.dump
docker run -d --name infra-e2e -e POSTGRES_USER=inframonitor -e POSTGRES_PASSWORD=e2e-descartavel \
  -e POSTGRES_DB=inframonitor -p 5437:5432 postgres:16-alpine
# aguardar pg_isready
docker exec -i infra-e2e pg_restore -U inframonitor -d inframonitor --no-owner < $SCRATCH/dev.dump
```

Controle: contar `incidente/medicao/notificacao` no dev **antes e depois** de toda a Task 9 (`SELECT` puro) e registrar.

- [ ] **Step 2: Seed (só no `infra-e2e`)** `pre-carga-seed.sql`: escolher um monitor existente; inserir medições e 3 incidentes FECHADO, um por motivo, cada um com medições de FALHA depois do `encerrado_em` (para provar o recorte): RECUPERACAO_AUTOMATICA (com 2 sucessos terminando exatamente em `encerrado_em`), FECHAMENTO_MANUAL (`fechado_por` = id do admin bootstrap), MANUTENCAO. Instantes nos últimos 2 dias, `observacao` marcando `e2e-pre-carga`.

- [ ] **Step 3: Subir backend contra 5437** (motor/Telegram/dispatcher no default desligado; `.env` NÃO exportado):

```bash
cd infra-monitor-backend
DB_PORT=5437 DB_PASSWORD=e2e-descartavel JWT_SECRET=e2e-descartavel-jwt-secret-com-32-bytes-ou-mais \
BOOTSTRAP_ADMIN_ENABLED=true BOOTSTRAP_ADMIN_NAME='Admin E2E' BOOTSTRAP_ADMIN_EMAIL=e2e@inframonitor.local \
BOOTSTRAP_ADMIN_PASSWORD='E2e-Descartavel-123' ./mvnw spring-boot:run   # em background
```

Conferir no log `monitoring.engine` desligado e Telegram desabilitado. Frontend: `npx ng serve --port 4200` em background.

- [ ] **Step 4: Reproduzir o layout** — Playwright abrindo o incidente MANUTENCAO por clique (Incidentes → linha → gaveta), screenshot de `.timeline` em 1440 e 390 de largura. Guardar como `pre-carga-evidence/00-timeline-antes-*.png`.

- [ ] **Step 5: Corrigir o layout** (usar superpowers… frontend-design como guia visual) em `incidente-timeline.component.scss`: detalhe sempre na linha de baixo, sob o rótulo, alinhado à esquerda; marca cobrindo as duas linhas:

```scss
.timeline__item { grid-template-columns: 10px 92px minmax(0, 1fr); }
.timeline__item:has(.timeline__detalhe) .timeline__marca { grid-row: span 2; }
.timeline__rotulo { overflow-wrap: anywhere; }
.timeline__detalhe { grid-column: 3; text-align: left; }
```

e remover o bloco `@media (max-width: 620px)` que fazia o mesmo só no estreito. Validar visualmente as duas larguras, temas claro e escuro.

- [ ] **Step 6: E2E `pre-carga-timeline-e-tela.cjs`** (padrões de `m06-drawer-no-mapa.cjs`: login → navegação só por clique, sem catch em seletor, resultados em `finally`, `process.exitCode = 1` em falha). Casos:
  1–3. Para cada motivo: abrir a gaveta do incidente seed; afirmar o rótulo do fechamento (`Incidente fechado` / `Encerrado manualmente` + `por Admin E2E` / `Encerrado por manutenção`); afirmar que nenhum evento `.timeline__item` tem hora posterior ao fechamento; afirmar sem sobreposição: `boundingBox` de `.timeline__rotulo` e `.timeline__detalhe` do item de fechamento não se interceptam; screenshot.
  4. Painel: KPI OFFLINE com "unidade afetada"/"unidades afetadas" coerente com o número; percentuais com vírgula.
  5. Relatórios: disponibilidade e latência média com vírgula (regex `/\d+,\d{2}%/`, nenhum `/\d+\.\d{2}%/`).
  6. Gaveta de equipamento com perda 0 e 0 incidentes: cartões sem classe `kpi--warn`/`kpi--down`.
  7. Gaveta de incidente com 0 acima do limiar: sem `kpi--warn`.

  Script em `package.json`: `"e2e:pre-carga": "node e2e/pre-carga-timeline-e-tela.cjs"`. Credenciais via env `PRE_CARGA_EMAIL`/`PRE_CARGA_SENHA`.

- [ ] **Step 7: Rodar até verde**, e rodar o e2e da Task 8. Evidências em `e2e/pre-carga-evidence/`.
- [ ] **Step 8: Derrubar ambiente com prova:** parar `ng serve` e o Java **por PID** e provar portas 8080/4200 livres; `docker rm -f infra-e2e`; `docker ps -a --filter name=infra-e2e` vazio; apagar o dump; `SELECT` de controle no dev igual ao do Step 1.
- [ ] **Step 9: Commit** `test(e2e): timeline por motivo, decimal, plural e zero neutro por clique` (+ scss do layout).

---

### Task 10: Dívida sub-ms, documentação, suítes e build

**Files:**
- Create: `Docs/validacao-producao/divida-latencia-sub-milissegundo.md`
- Create: `Docs/validacao-producao/correcoes-pre-carga-real.md`
- Modify: `Docs/validacao-producao/validacao-producao.md` (índice/resumo)
- Modify: `Docs/validacao-producao/manutencao-backfill-diagnostico.md` (nota: a V19 depois chegou ao dev pelo boot de 2026-09-24 11:31:45; efeito igual ao previsto)

- [ ] **Step 1: Dívida** — conteúdo mínimo: sintoma (`latencia_ms INTEGER`, RTT < 1 ms gravado 0; servidor real mede ~0,3 ms), opções (A `NUMERIC(10,3)` em ms; B `latencia_us BIGINT`), impacto por camada (migration nova + conversão; `Medicao`/DTOs/JSON; SQL de relatório — `avg`, comparação `> limiar_ms` do episódio; CSV/PDF; gráficos, timeline e KPIs do front; `PingOutputParser`; `WindowsNativeIcmpRunner`/`IcmpEchoReply` que já entregam ms inteiro — mudar a fonte), recomendação e gatilho de cobrança.
- [ ] **Step 2: `correcoes-pre-carga-real.md`** — item a item: item 0 (tabela do spec + verificação da V19 com as consultas e números), decisão da âncora com o argumento do SLA, latência, timeline, mensagem, decimal (CSV com ponto, por quê), plural (lista de ocorrências trocadas), zero, IBGE, links para evidências (`reabertura-*.txt`, `e2e/pre-carga-evidence/`), contagens das suítes e do build.
- [ ] **Step 3: Suítes completas**
  - `cd infra-monitor-backend && ./mvnw test` → anotar `Tests run / Failures / Errors / Skipped`.
  - `cd infra-monitor-frontend && npx ng test --watch=false` → anotar arquivos/testes.
  - `npx ng build` (produção) → anotar tamanho inicial e avisos de budget.
- [ ] **Step 4: Commit final (docs no mesmo commit da última mudança)** `docs(validacao-producao): correcoes antes da carga real, divida sub-ms e verificacao da V19`.
