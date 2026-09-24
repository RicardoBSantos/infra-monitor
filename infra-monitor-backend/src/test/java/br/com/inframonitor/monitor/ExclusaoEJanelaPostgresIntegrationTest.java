package br.com.inframonitor.monitor;

import br.com.inframonitor.common.exception.ConflitoException;
import br.com.inframonitor.equipamento.service.EquipamentoService;
import br.com.inframonitor.monitor.service.MonitorService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.DockerClientFactory;
import org.testcontainers.containers.PostgreSQLContainer;

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
@EnabledIf("dockerDisponivel")
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
