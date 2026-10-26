package br.com.inframonitor.incidente;

import br.com.inframonitor.common.exception.ConflitoException;
import br.com.inframonitor.equipamento.service.EquipamentoService;
import br.com.inframonitor.incidente.dto.CreateIncidenteRequest;
import br.com.inframonitor.incidente.repository.IncidenteRepository;
import br.com.inframonitor.incidente.service.IncidenteService;
import br.com.inframonitor.testsupport.RequerDocker;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.RepeatedTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.containers.PostgreSQLContainer;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Fecha o M7 da {@code auditoria-concorrencia-ciclo-de-vida.md}: a abertura MANUAL de
 * incidente ({@code IncidenteService.criar}) precisa do mesmo predicado de elegibilidade
 * do motor (monitor ativo, equipamento ativo, fora de manutencao), e precisa travar a
 * linha do equipamento para serializar com {@code entrarEmManutencao}.
 *
 * <p>Ha teste concorrente porque o sequencial nao prova a corrida: sem o
 * {@code FOR UPDATE OF e}, o INSERT ainda nao commitado do incidente escapa do
 * {@code fecharPorManutencao} (que nao o enxerga) e o incidente sobrevive ABERTO com o
 * equipamento em manutencao, sem nada que o feche. Cada thread usa sua propria transacao
 * fisica, alinhadas por {@link CyclicBarrier}.
 *
 * <p>Requer Docker. Sem Docker disponivel o teste e ignorado, nunca falha.
 */
@RequerDocker
@SpringBootTest(properties = {
        "app.auth.jwt.secret=test-only-jwt-secret-with-at-least-32-bytes",
        "app.auth.jwt.issuer=infra-monitor-test",
        "app.auth.jwt.access-token-minutes=15",
        "monitoring.engine.enabled=false",
        "notification.telegram.enabled=false",
        "notification.dispatcher.enabled=false"
})
class AberturaManualElegibilidadePostgresIntegrationTest {

    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");
    private static final Instant T0 = Instant.parse("2026-09-01T08:00:00Z");
    private static final Duration LIMITE = Duration.ofSeconds(10);
    // Atraso aleatorio (0..N ms) da entrada em manutencao depois da barreira. Sem ele, com a JVM aquecida,
    // a manutencao ganhava sempre (2 execucoes) e so um desfecho legitimo aparecia;
    // N=15 foi calibrado para os dois desfechos ocorrerem nas 20 repeticoes.
    private static final long ATRASO_MAX_MANUTENCAO_MS = 15;
    private static final Set<String> desfechos = ConcurrentHashMap.newKeySet();

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        POSTGRES.start();
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @Autowired private JdbcTemplate jdbc;
    @Autowired private EquipamentoService equipamentoService;
    @Autowired private IncidenteService incidenteService;
    @Autowired private IncidenteRepository incidenteRepository;
    @Autowired private PlatformTransactionManager transactionManager;

    private long operadorId;

    @BeforeEach
    void limparBanco() {
        jdbc.execute("truncate table janela_monitoramento, medicao, notificacao, monitor_episodio_latencia, "
                + "incidente, monitor, equipamento, tipo_equipamento, unidade, usuarios restart identity cascade");
        operadorId = insert("insert into usuarios (nome, email, senha_hash, papel, ativo, troca_senha_obrigatoria) "
                + "values ('Operador', 'operador@manutencao.test', 'hash-irrelevante', 'OPERADOR', true, false) "
                + "returning id");
    }

    @AfterAll
    static void imprimirDesfechos() {
        System.out.println("[M7 corrida] desfechos: " + desfechos);
    }

    @Test
    void recusaEquipamentoEmManutencaoSemCriarIncidenteNemNotificacao() {
        long equipamentoId = montarEquipamento(true);
        long monitorId = montarMonitor(equipamentoId);

        assertThatThrownBy(() -> incidenteService.criar(new CreateIncidenteRequest(monitorId, T0, "Manual", null)))
                .isInstanceOf(ConflitoException.class)
                .hasMessage("Nao e possivel abrir incidente porque o equipamento esta em manutencao");

        assertThat(contar("incidente")).isZero();
        assertThat(contar("notificacao")).isZero();
    }

    @Test
    void recusaEquipamentoInativo() {
        long equipamentoId = montarEquipamento(false);
        jdbc.update("update equipamento set ativo = false where id = ?", equipamentoId);
        long monitorId = montarMonitor(equipamentoId);

        assertThatThrownBy(() -> incidenteService.criar(new CreateIncidenteRequest(monitorId, T0, "Manual", null)))
                .isInstanceOf(ConflitoException.class)
                .hasMessage("Nao e possivel abrir incidente porque o equipamento esta inativo");
        assertThat(contar("incidente")).isZero();
        assertThat(contar("notificacao")).isZero();
    }

    @Test
    void recusaMonitorInativo() {
        long monitorId = montarMonitor(montarEquipamento(false));
        jdbc.update("update monitor set ativo = false where id = ?", monitorId);

        assertThatThrownBy(() -> incidenteService.criar(new CreateIncidenteRequest(monitorId, T0, "Manual", null)))
                .isInstanceOf(ConflitoException.class)
                .hasMessage("Nao e possivel abrir incidente porque o monitor esta inativo");
        assertThat(contar("incidente")).isZero();
        assertThat(contar("notificacao")).isZero();
    }

    @Test
    void monitorElegivelContinuaAbrindoENotificando() {
        long monitorId = montarMonitor(montarEquipamento(false));

        incidenteService.criar(new CreateIncidenteRequest(monitorId, T0, "Manual", null));

        assertThat(contar("incidente")).isEqualTo(1);
        assertThat(jdbc.queryForObject("select count(*) from notificacao where tipo_evento = 'INCIDENTE_ABERTO'",
                Integer.class)).isEqualTo(1);
    }

    /**
     * Prova deterministica do lock: uma transacao segura a linha do equipamento via
     * travarElegibilidadeParaAbertura; entrarEmManutencao tem de ficar bloqueada ate o commit.
     * Sem o FOR UPDATE OF e, a manutencao termina na hora e o teste falha.
     */
    @Test
    void travarElegibilidadeBloqueiaEntrarEmManutencaoAteOCommit() throws Exception {
        long equipamentoId = montarEquipamento(false);
        long monitorId = montarMonitor(equipamentoId);
        CountDownLatch travou = new CountDownLatch(1);
        CountDownLatch liberar = new CountDownLatch(1);
        List<Throwable> falhas = new CopyOnWriteArrayList<>();

        Thread segurador = new Thread(() -> {
            try {
                new TransactionTemplate(transactionManager).executeWithoutResult(status -> {
                    incidenteRepository.travarElegibilidadeParaAbertura(monitorId).orElseThrow();
                    travou.countDown();
                    try {
                        liberar.await(LIMITE.toSeconds(), TimeUnit.SECONDS);
                    } catch (InterruptedException e) {
                        Thread.currentThread().interrupt();
                    }
                });
            } catch (Throwable erro) {
                falhas.add(erro);
            }
        }, "segurador");
        Thread manutencao = new Thread(() -> {
            try {
                equipamentoService.entrarEmManutencao(equipamentoId, operadorId);
            } catch (Throwable erro) {
                falhas.add(erro);
            }
        }, "manutencao");

        segurador.start();
        assertThat(travou.await(LIMITE.toSeconds(), TimeUnit.SECONDS)).isTrue();
        manutencao.start();
        Thread.sleep(500);

        boolean bloqueada = manutencao.isAlive();
        Integer locksEsperando = jdbc.queryForObject("select count(*) from pg_locks where not granted and pid <> pg_backend_pid()", Integer.class);
        liberar.countDown();
        segurador.join(LIMITE.toMillis());
        manutencao.join(LIMITE.toMillis());

        assertThat(falhas.stream().map(Throwable::toString).toList()).isEmpty();
        assertThat(bloqueada).as("manutencao deveria estar bloqueada pelo lock da elegibilidade").isTrue();
        assertThat(locksEsperando).as("pg_locks com lock nao concedido").isGreaterThan(0);
        assertThat(manutencao.isAlive()).isFalse();
        assertThat(segurador.isAlive()).isFalse();
        assertThat(jdbc.queryForObject("select em_manutencao from equipamento where id = ?", Boolean.class,
                equipamentoId)).isTrue();
    }

    @RepeatedTest(20)
    void entrarEmManutencaoEAbrirManualmenteConcorrentesNuncaDeixamIncidenteEmAberto() throws Exception {
        long equipamentoId = montarEquipamento(false);
        long monitorId = montarMonitor(equipamentoId);

        CyclicBarrier partida = new CyclicBarrier(2);
        List<Throwable> falhas = new CopyOnWriteArrayList<>();
        AtomicBoolean recusado = new AtomicBoolean(false);

        Thread manutencao = new Thread(() -> {
            try {
                partida.await(LIMITE.toSeconds(), TimeUnit.SECONDS);
                Thread.sleep(ThreadLocalRandom.current().nextLong(ATRASO_MAX_MANUTENCAO_MS + 1));
                equipamentoService.entrarEmManutencao(equipamentoId, operadorId);
            } catch (Throwable erro) {
                falhas.add(erro);
            }
        }, "manutencao");

        Thread abertura = new Thread(() -> {
            try {
                partida.await(LIMITE.toSeconds(), TimeUnit.SECONDS);
                incidenteService.criar(new CreateIncidenteRequest(monitorId, T0, "Manual", null));
            } catch (ConflitoException recusa) {
                if ("Nao e possivel abrir incidente porque o equipamento esta em manutencao".equals(recusa.getMessage())) {
                    recusado.set(true);
                } else {
                    falhas.add(recusa);
                }
            } catch (Throwable erro) {
                falhas.add(erro);
            }
        }, "abertura-manual");

        manutencao.start();
        abertura.start();
        manutencao.join(LIMITE.toMillis());
        abertura.join(LIMITE.toMillis());
        assertThat(manutencao.isAlive()).isFalse();
        assertThat(abertura.isAlive()).isFalse();

        assertThat(falhas.stream().map(Throwable::toString).toList()).isEmpty();
        // Desfecho ilegitimo do M7: incidente ABERTO/RECONHECIDO sobrevivendo com o equipamento em manutencao.
        assertThat(jdbc.queryForObject("select count(*) from incidente where status in ('ABERTO','RECONHECIDO')",
                Integer.class)).isZero();
        if (recusado.get()) {
            assertThat(contar("incidente")).isZero();
        } else {
            assertThat(jdbc.queryForObject("select motivo_encerramento from incidente", String.class))
                    .isEqualTo("MANUTENCAO");
        }
        desfechos.add(recusado.get() ? "manutencao-primeiro" : "criar-primeiro");
    }

    private int contar(String tabela) {
        return jdbc.queryForObject("select count(*) from " + tabela, Integer.class);
    }

    private long montarEquipamento(boolean emManutencao) {
        long tipo = insert("insert into tipo_equipamento (nome, ativo) values ('Switch', true) returning id");
        long unidade = insert("insert into unidade (nome, sigla, ativo) values ('Centro', 'CTR', true) returning id");
        return insert("insert into equipamento (unidade_id, tipo_equipamento_id, nome, ip_address, ativo, "
                        + "em_manutencao, manutencao_manual) values (?, ?, 'SW-CORE', '10.0.0.10', true, ?, ?) "
                        + "returning id",
                unidade, tipo, emManutencao, emManutencao);   // legado: toda manutencao pre-V21 e manual
    }

    private long montarMonitor(long equipamentoId) {
        return insert("insert into monitor (equipamento_id, tipo, nome, intervalo_segundos, timeout_ms, ativo, "
                        + "falhas_para_incidente, sucessos_para_recovery) "
                        + "values (?, 'ICMP', 'ICMP CORE', 60, 2000, true, 3, 2) returning id",
                equipamentoId);
    }

    private long insert(String sql, Object... args) {
        return jdbc.queryForObject(sql, Long.class, args);
    }
}
