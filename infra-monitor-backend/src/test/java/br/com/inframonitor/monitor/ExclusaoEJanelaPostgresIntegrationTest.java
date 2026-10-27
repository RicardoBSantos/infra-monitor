package br.com.inframonitor.monitor;

import br.com.inframonitor.common.exception.ConflitoException;
import br.com.inframonitor.equipamento.service.EquipamentoService;
import br.com.inframonitor.monitor.service.MonitorService;
import br.com.inframonitor.testsupport.RequerDocker;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Integracao real contra PostgreSQL para a invariante de {@code janela_monitoramento} na
 * exclusao de monitor e de equipamento.
 *
 * <p>Estado de hoje: {@code criar}/{@code ativar} sempre abrem janela, e a FK
 * {@code janela_monitoramento.monitor_id} e {@code ON DELETE RESTRICT} (V13). So o banco
 * real prova a violacao — um mock ou um teste sequencial em memoria nao teria a FK.
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
class ExclusaoEJanelaPostgresIntegrationTest {

    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        POSTGRES.start();
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @Autowired private JdbcTemplate jdbc;
    @Autowired private DataSource dataSource;
    @Autowired private MonitorService monitorService;
    @Autowired private EquipamentoService equipamentoService;

    private long tipoId;
    private long unidadeId;

    @BeforeEach
    void limparBanco() {
        jdbc.execute("truncate table janela_monitoramento, medicao, notificacao, monitor_episodio_latencia, "
                + "incidente, monitor, equipamento, tipo_equipamento, unidade restart identity cascade");
        tipoId = insert("insert into tipo_equipamento (nome, ativo) values ('Switch', true) returning id");
        unidadeId = insert("insert into unidade (nome, sigla, ativo) values ('Centro', 'CTR', true) returning id");
    }

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

    /**
     * A ordem que a exclusao seguia ate a V24 (apaga a janela, depois o monitor) contra o motor
     * gravando a primeira medicao no meio: o gatilho da V24 faz o INSERT de medicao esperar a janela
     * apagada enquanto segura FOR KEY SHARE no monitor, e o DELETE do monitor espera esse KEY SHARE.
     * Fica aqui como prova de que a trava de MonitorService.excluir e necessaria.
     */
    @Test
    void semTravarOMonitorAntesApagarJanelaEMonitorDaDeadlockComOGatilho() throws Exception {
        long monitorId = montarMonitor(montarEquipamento());
        jdbc.update("insert into janela_monitoramento (monitor_id, inicio_em, origem) values (?, now() - interval '1 minute', 'PRECISA')",
                monitorId);

        try (Connection exclusao = transacao(); Connection motor = transacao()) {
            executar(exclusao, "delete from janela_monitoramento where monitor_id = ?", monitorId);
            CompletableFuture<Void> insercao = CompletableFuture.runAsync(() -> executarOuFalhar(motor,
                    "insert into medicao (monitor_id, status, latencia_ms, executado_em) values (?, 'SUCESSO', 5, now())",
                    monitorId));
            esperarBloqueio();

            // O PostgreSQL escolhe a vitima: pode ser qualquer um dos dois lados.
            Throwable deadlock = null;
            try {
                executar(exclusao, "delete from monitor where id = ?", monitorId);
            } catch (SQLException e) {
                deadlock = e;
                exclusao.rollback();
            }
            try {
                insercao.get(10, TimeUnit.SECONDS);
            } catch (ExecutionException e) {
                deadlock = e.getCause().getCause();
            }
            assertThat(deadlock).isInstanceOf(SQLException.class);
            assertThat(((SQLException) deadlock).getSQLState()).isEqualTo("40P01");
        }
    }

    /**
     * Com a trava, o motor que grava a primeira medicao durante a exclusao so atrasa: quem chegou
     * primeiro termina, e a exclusao responde 409 pela guarda em vez de 500 por deadlock. Falha se a
     * trava sair do comeco de excluir: o primeiro bloqueio passa a ser o DELETE da janela.
     */
    @Test
    void excluirTravaOMonitorAntesDeTocarAJanela() throws Exception {
        long monitorId = montarMonitor(montarEquipamento());
        jdbc.update("insert into janela_monitoramento (monitor_id, inicio_em, origem) values (?, now() - interval '1 minute', 'PRECISA')",
                monitorId);

        try (Connection motor = transacao()) {
            executar(motor, "insert into medicao (monitor_id, status, latencia_ms, executado_em) values (?, 'SUCESSO', 5, now())",
                    monitorId);
            CompletableFuture<Void> exclusao = CompletableFuture.runAsync(() -> monitorService.excluir(monitorId));

            String esperando = esperarBloqueio();
            assertThat(esperando).containsIgnoringCase("for update").doesNotContainIgnoringCase("janela_monitoramento");
            motor.commit();

            assertThatThrownBy(() -> exclusao.get(10, TimeUnit.SECONDS)).hasCauseInstanceOf(ConflitoException.class);
        }
        assertThat(jdbc.queryForObject("select count(*) from monitor where id = ?", Integer.class, monitorId)).isEqualTo(1);
        assertThat(jdbc.queryForObject("select count(*) from janela_monitoramento where monitor_id = ? "
                + "and primeira_medicao_em is not null", Integer.class, monitorId)).isEqualTo(1);
    }

    private Connection transacao() throws SQLException {
        Connection c = dataSource.getConnection();
        c.setAutoCommit(false);
        return c;
    }

    /** Espera algum backend ficar parado em lock e devolve a instrucao que ele esta executando. */
    private String esperarBloqueio() throws InterruptedException {
        for (int i = 0; i < 100; i++) {
            var esperando = jdbc.queryForList("select query from pg_stat_activity where wait_event_type = 'Lock' "
                    + "and datname = current_database()", String.class);
            if (!esperando.isEmpty()) return esperando.getFirst();
            Thread.sleep(50);
        }
        throw new AssertionError("nenhuma transacao ficou esperando lock");
    }

    private void executar(Connection c, String sql, Object... args) throws SQLException {
        try (PreparedStatement s = c.prepareStatement(sql)) {
            for (int i = 0; i < args.length; i++) s.setObject(i + 1, args[i]);
            s.executeUpdate();
        }
    }

    private void executarOuFalhar(Connection c, String sql, Object... args) {
        try {
            executar(c, sql, args);
        } catch (SQLException e) {
            throw new IllegalStateException(e);
        }
    }

    // ---------------------------------------------------------------------------
    // Fixtures
    // ---------------------------------------------------------------------------

    private long montarEquipamento() {
        return montarEquipamentoComNome("SW-CORE", "10.0.0.10");
    }

    /** Reusa a mesma unidade/tipo criados no @BeforeEach — so' o nome/ip precisam ser unicos. */
    private long montarEquipamentoComNome(String nome, String ip) {
        return insert("insert into equipamento (unidade_id, tipo_equipamento_id, nome, ip_address, ativo, "
                        + "em_manutencao) values (?, ?, ?, ?, true, false) returning id",
                unidadeId, tipoId, nome, ip);
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
