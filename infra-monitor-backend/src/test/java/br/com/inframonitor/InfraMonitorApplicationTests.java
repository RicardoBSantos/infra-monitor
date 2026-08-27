package br.com.inframonitor;

import br.com.inframonitor.incidente.entity.StatusIncidente;
import br.com.inframonitor.incidente.repository.IncidenteRepository;
import br.com.inframonitor.medicao.dto.CreateMedicaoRequest;
import br.com.inframonitor.medicao.entity.StatusMedicao;
import br.com.inframonitor.medicao.service.MedicaoService;
import br.com.inframonitor.notificacao.entity.StatusNotificacao;
import br.com.inframonitor.notificacao.entity.TipoEventoNotificacao;
import br.com.inframonitor.notificacao.repository.NotificacaoRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.health.actuate.endpoint.HealthDescriptor;
import org.springframework.boot.health.actuate.endpoint.HealthEndpoint;
import org.springframework.boot.health.contributor.Status;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.DockerClientFactory;
import org.testcontainers.containers.PostgreSQLContainer;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Sobe o contexto completo contra um PostgreSQL real e verifica que o Flyway
 * migrou o banco e que o health do Actuator enxerga a conexao.
 *
 * Requer Docker. Sem Docker disponivel o teste e ignorado em vez de falhar.
 */
@EnabledIf("dockerDisponivel")
@SpringBootTest(properties = {
        "app.auth.jwt.secret=test-only-jwt-secret-with-at-least-32-bytes",
        "app.auth.jwt.issuer=infra-monitor-test",
        "app.auth.jwt.access-token-minutes=15"
})
class InfraMonitorApplicationTests {

    private static final PostgreSQLContainer<?> POSTGRES =
            new PostgreSQLContainer<>("postgres:16-alpine");

    static boolean dockerDisponivel() {
        return DockerClientFactory.instance().isDockerAvailable();
    }

    @DynamicPropertySource
    static void propriedadesDoBanco(DynamicPropertyRegistry registry) {
        POSTGRES.start();
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @Autowired
    private DataSource dataSource;

    @Autowired
    private HealthEndpoint healthEndpoint;

    @Autowired
    private MedicaoService medicaoService;

    @Autowired
    private IncidenteRepository incidenteRepository;

    @Autowired
    private NotificacaoRepository notificacaoRepository;

    @Test
    void contextoCarregaEFlywayAplicaMigrations() throws Exception {
        try (Connection conexao = dataSource.getConnection();
             Statement statement = conexao.createStatement();
             ResultSet resultado = statement.executeQuery(
                     "select count(*) from flyway_schema_history where success = true")) {

            assertThat(resultado.next()).isTrue();
            assertThat(resultado.getInt(1)).isPositive();
        }
    }

    @Test
    void healthReportaAplicacaoEBancoDisponiveis() {
        HealthDescriptor saude = healthEndpoint.health();
        HealthDescriptor banco = healthEndpoint.healthForPath("db");

        assertThat(saude.getStatus()).isEqualTo(Status.UP);
        assertThat(banco).isNotNull();
        assertThat(banco.getStatus()).isEqualTo(Status.UP);
    }

    @Test
    void indiceParcialImpedeDoisIncidentesAbertosParaOMesmoMonitor() throws Exception {
        try (Connection conexao = dataSource.getConnection()) {
            long unidadeId = inserirERetornarId(conexao, "INSERT INTO unidade (nome, sigla) VALUES ('Matriz teste incidente', 'MTI') RETURNING id");
            long tipoId = inserirERetornarId(conexao, "INSERT INTO tipo_equipamento (nome) VALUES ('Tipo teste incidente') RETURNING id");
            long equipamentoId = inserirERetornarId(conexao, "INSERT INTO equipamento (unidade_id, tipo_equipamento_id, nome) VALUES (" + unidadeId + ", " + tipoId + ", 'EQ teste incidente') RETURNING id");
            long monitorId = inserirERetornarId(conexao, "INSERT INTO monitor (equipamento_id, tipo, nome, intervalo_segundos, timeout_ms) VALUES (" + equipamentoId + ", 'ICMP', 'Monitor teste incidente', 60, 2000) RETURNING id");
            try (PreparedStatement inserir = conexao.prepareStatement(
                    "INSERT INTO incidente (monitor_id, status, iniciado_em) VALUES (?, 'ABERTO', CURRENT_TIMESTAMP)")) {
                inserir.setLong(1, monitorId);
                inserir.executeUpdate();
                inserir.setLong(1, monitorId);
                assertThatThrownBy(inserir::executeUpdate)
                        .isInstanceOf(SQLException.class)
                        .hasMessageContaining("uq_incidente_monitor_aberto");
            }
        }
    }

    @Test
    void constraintDeNotificacaoImpedeMesmoCanalEEventoNoMesmoIncidente() throws Exception {
        try (Connection conexao = dataSource.getConnection()) {
            long unidadeId = inserirERetornarId(conexao, "INSERT INTO unidade (nome, sigla) VALUES ('Matriz teste notificacao', 'MTN') RETURNING id");
            long tipoId = inserirERetornarId(conexao, "INSERT INTO tipo_equipamento (nome) VALUES ('Tipo teste notificacao') RETURNING id");
            long equipamentoId = inserirERetornarId(conexao, "INSERT INTO equipamento (unidade_id, tipo_equipamento_id, nome) VALUES (" + unidadeId + ", " + tipoId + ", 'EQ teste notificacao') RETURNING id");
            long monitorId = inserirERetornarId(conexao, "INSERT INTO monitor (equipamento_id, tipo, nome, intervalo_segundos, timeout_ms) VALUES (" + equipamentoId + ", 'ICMP', 'Monitor teste notificacao', 60, 2000) RETURNING id");
            long incidenteId = inserirERetornarId(conexao, "INSERT INTO incidente (monitor_id, status, iniciado_em) VALUES (" + monitorId + ", 'ABERTO', CURRENT_TIMESTAMP) RETURNING id");
            try (PreparedStatement inserir = conexao.prepareStatement(
                    "INSERT INTO notificacao (incidente_id, canal, tipo_evento, status, tentativas, mensagem) VALUES (?, 'TELEGRAM', 'INCIDENTE_ABERTO', 'PENDENTE', 0, 'snapshot')")) {
                inserir.setLong(1, incidenteId);
                inserir.executeUpdate();
                inserir.setLong(1, incidenteId);
                assertThatThrownBy(inserir::executeUpdate)
                        .isInstanceOf(SQLException.class)
                        .hasMessageContaining("uq_notificacao_incidente_canal_evento");
            }
        }
    }

    @Test
    void medicaoProcessorEIncidenteAbremEFechamSemRedeExterna() throws Exception {
        long monitorId;
        try (Connection conexao = dataSource.getConnection()) {
            long unidadeId = inserirERetornarId(conexao, "INSERT INTO unidade (nome, sigla) VALUES ('Matriz integration', 'MII') RETURNING id");
            long tipoId = inserirERetornarId(conexao, "INSERT INTO tipo_equipamento (nome) VALUES ('Tipo integration') RETURNING id");
            long equipamentoId = inserirERetornarId(conexao, "INSERT INTO equipamento (unidade_id, tipo_equipamento_id, nome) VALUES (" + unidadeId + ", " + tipoId + ", 'EQ integration') RETURNING id");
            monitorId = inserirERetornarId(conexao, "INSERT INTO monitor (equipamento_id, tipo, nome, intervalo_segundos, timeout_ms, falhas_para_incidente, sucessos_para_recovery) VALUES (" + equipamentoId + ", 'ICMP', 'Monitor integration', 60, 2000, 3, 2) RETURNING id");
        }
        Instant inicio = Instant.parse("2026-08-19T12:00:00Z");
        registrar(monitorId, StatusMedicao.FALHA, inicio);
        registrar(monitorId, StatusMedicao.FALHA, inicio.plusSeconds(60));
        registrar(monitorId, StatusMedicao.FALHA, inicio.plusSeconds(120));

        var aberto = incidenteRepository.findFirstByMonitorIdAndStatusOrderByIniciadoEmDescIdDesc(monitorId, StatusIncidente.ABERTO);
        assertThat(aberto).isPresent();
        assertThat(aberto.orElseThrow().getIniciadoEm()).isEqualTo(inicio);

        registrar(monitorId, StatusMedicao.SUCESSO, inicio.plusSeconds(180));
        registrar(monitorId, StatusMedicao.SUCESSO, inicio.plusSeconds(240));

        assertThat(incidenteRepository.findFirstByMonitorIdAndStatusOrderByIniciadoEmDescIdDesc(monitorId, StatusIncidente.ABERTO)).isEmpty();
        var fechado = incidenteRepository.findFirstByMonitorIdAndStatusOrderByIniciadoEmDescIdDesc(monitorId, StatusIncidente.FECHADO);
        assertThat(fechado).isPresent();
        assertThat(fechado.orElseThrow().getEncerradoEm()).isEqualTo(inicio.plusSeconds(240));
        var notificacoes = notificacaoRepository.findByIncidenteId(fechado.orElseThrow().getId());
        assertThat(notificacoes)
                .extracting(notificacao -> notificacao.getTipoEvento())
                .containsExactlyInAnyOrder(TipoEventoNotificacao.INCIDENTE_ABERTO, TipoEventoNotificacao.INCIDENTE_FECHADO);
        assertThat(notificacoes)
                .allSatisfy(notificacao -> {
                    assertThat(notificacao.getStatus()).isEqualTo(StatusNotificacao.PENDENTE);
                    assertThat(notificacao.getTentativas()).isZero();
                    assertThat(notificacao.getEnviadoEm()).isNull();
                });
    }

    private void registrar(long monitorId, StatusMedicao status, Instant executadoEm) {
        medicaoService.criar(new CreateMedicaoRequest(monitorId, status, null, null, executadoEm));
    }

    private long inserirERetornarId(Connection conexao, String sql) throws SQLException {
        try (Statement statement = conexao.createStatement(); ResultSet resultado = statement.executeQuery(sql)) {
            assertThat(resultado.next()).isTrue();
            return resultado.getLong(1);
        }
    }
}
