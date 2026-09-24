package br.com.inframonitor.monitoring.incident;

import br.com.inframonitor.medicao.dto.CreateMedicaoRequest;
import br.com.inframonitor.medicao.entity.StatusMedicao;
import br.com.inframonitor.medicao.service.MedicaoService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.DockerClientFactory;
import org.testcontainers.containers.PostgreSQLContainer;

import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Integracao real contra PostgreSQL para o lock_timeout das transacoes do motor.
 *
 * <p>So o banco real prova que o SET LOCAL cai na mesma conexao da transacao
 * REQUIRES_NEW do processor e que o estouro vira rollback limpo, sem perder a medicao.
 *
 * <p>Requer Docker. Sem Docker disponivel o teste e ignorado, nunca falha.
 */
@EnabledIf("dockerDisponivel")
@SpringBootTest(properties = {
        "app.auth.jwt.secret=test-only-jwt-secret-with-at-least-32-bytes",
        "app.auth.jwt.issuer=infra-monitor-test",
        "app.auth.jwt.access-token-minutes=15",
        "monitoring.engine.enabled=false",
        "notification.telegram.enabled=false",
        "notification.dispatcher.enabled=false"
})
class LockTimeoutMotorPostgresIntegrationTest {

    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");
    private static final Duration SEGURA_LOCK = Duration.ofSeconds(8);

    static boolean dockerDisponivel() {
        return DockerClientFactory.instance().isDockerAvailable();
    }

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        POSTGRES.start();
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @Autowired private JdbcTemplate jdbc;
    @Autowired private MedicaoService medicaoService;
    @Autowired private PlatformTransactionManager transactionManager;

    @BeforeEach
    void limparBanco() {
        jdbc.execute("truncate table janela_monitoramento, medicao, notificacao, monitor_episodio_latencia, "
                + "incidente, monitor, equipamento, tipo_equipamento, unidade restart identity cascade");
    }

    /**
     * Uma transacao externa segura a linha de equipamento (a mesma que
     * entrarEmManutencao trava) por SEGURA_LOCK. A 3a falha consecutiva chega pelo
     * caminho real do motor (MedicaoService.criar -> IncidentProcessor), cujo
     * inserirSeElegivel faz FOR UPDATE OF e na mesma linha. Com lock_timeout de 2 s a
     * chamada volta bem antes do lock ser solto: medicao gravada, incidente adiado.
     * Sem lock_timeout, ela espera o lock inteiro: o worker e a conexao ficam presos.
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
            try {
                Thread.sleep(SEGURA_LOCK.toMillis());
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
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
        assertThat(detentor.isAlive()).isFalse();

        medicaoService.criar(new CreateMedicaoRequest(monitorId, StatusMedicao.FALHA, null, "timeout",
                agora.plusSeconds(10)));
        assertThat(jdbc.queryForObject("select count(*) from incidente where status = 'ABERTO'", Integer.class))
                .as("a proxima medicao reavalia a cauda e abre").isEqualTo(1);
    }

    /**
     * Mesmo cenario pelo caminho de latencia. Com medicoes SUCESSO e nenhum incidente
     * aberto, o IncidentProcessor nao trava nada (a cauda nao e de FALHA, ele retorna
     * antes de inserirSeElegivel), entao a unica espera possivel e a do
     * LatencyEpisodeProcessor: a medicao degradada fecha a cauda de
     * monitoring.latencia-ciclos (2) medicoes SUCESSO com latencia acima de
     * monitoring.latencia-degradada-ms (250), e inserirSeElegivel faz FOR UPDATE OF e
     * na linha de equipamento. Sem o lock_timeout desse processor, a chamada espera o
     * lock inteiro.
     */
    @Test
    void lockEstouradoNoProcessorDeLatenciaPulaOCicloSemPerderMedicaoEAProximaAbreOEpisodio() throws Exception {
        long equipamentoId = montarEquipamento();
        long monitorId = montarMonitor(equipamentoId);
        Instant agora = Instant.now();
        jdbc.update("insert into janela_monitoramento (monitor_id, inicio_em, origem) values (?, ?, 'PRECISA')",
                monitorId, Timestamp.from(agora.minusSeconds(3600)));
        jdbc.update("insert into medicao (monitor_id, status, latencia_ms, executado_em) values (?, 'SUCESSO', 400, ?)",
                monitorId, Timestamp.from(agora.minusSeconds(20)));
        jdbc.update("insert into medicao (monitor_id, status, latencia_ms, executado_em) values (?, 'SUCESSO', 400, ?)",
                monitorId, Timestamp.from(agora.minusSeconds(10)));

        CountDownLatch lockTomado = new CountDownLatch(1);
        Thread detentor = new Thread(() -> new TransactionTemplate(transactionManager).executeWithoutResult(s -> {
            jdbc.queryForObject("select id from equipamento where id = ? for update", Long.class, equipamentoId);
            lockTomado.countDown();
            try {
                Thread.sleep(SEGURA_LOCK.toMillis());
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }), "detentor-do-lock-latencia");
        detentor.start();
        assertThat(lockTomado.await(5, TimeUnit.SECONDS)).isTrue();

        long inicio = System.nanoTime();
        medicaoService.criar(new CreateMedicaoRequest(monitorId, StatusMedicao.SUCESSO, 400, null, agora));
        Duration espera = Duration.ofNanos(System.nanoTime() - inicio);
        System.out.println("[lock-timeout-latencia] chamada voltou em " + espera.toMillis() + " ms");

        assertThat(espera).as("o processor de latencia nao pode esperar o lock inteiro")
                .isLessThan(Duration.ofSeconds(4));
        assertThat(jdbc.queryForObject("select count(*) from medicao where monitor_id = ?", Integer.class, monitorId))
                .as("a medicao e o dado primario e nao se perde").isEqualTo(3);
        assertThat(jdbc.queryForObject("select count(*) from monitor_episodio_latencia", Integer.class)).isZero();
        assertThat(jdbc.queryForObject("select count(*) from notificacao", Integer.class)).isZero();
        assertThat(jdbc.queryForObject("select count(*) from incidente", Integer.class)).isZero();

        detentor.join(SEGURA_LOCK.plusSeconds(5).toMillis());
        assertThat(detentor.isAlive()).isFalse();

        medicaoService.criar(new CreateMedicaoRequest(monitorId, StatusMedicao.SUCESSO, 400, null,
                agora.plusSeconds(10)));
        assertThat(jdbc.queryForObject(
                "select count(*) from monitor_episodio_latencia where encerrado_em is null", Integer.class))
                .as("a proxima medicao degradada reavalia a cauda e abre o episodio").isEqualTo(1);
    }

    private long montarEquipamento() {
        long tipo = insert("insert into tipo_equipamento (nome, ativo) values ('Switch', true) returning id");
        long unidade = insert("insert into unidade (nome, sigla, ativo) values ('Centro', 'CTR', true) returning id");
        return insert("insert into equipamento (unidade_id, tipo_equipamento_id, nome, ip_address, ativo, "
                        + "em_manutencao) values (?, ?, 'SW-CORE', '10.0.0.10', true, false) returning id",
                unidade, tipo);
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
