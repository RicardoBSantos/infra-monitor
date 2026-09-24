package br.com.inframonitor.relatorio.integration;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.testcontainers.containers.PostgreSQLContainer;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.sql.Statement;
import java.sql.Timestamp;
import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class V13JanelaMonitoramentoPostgresIntegrationTest {

    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");

    @BeforeEach
    void migrate() {
        POSTGRES.start();
        Flyway flyway = Flyway.configure()
                .dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
                .locations("classpath:db/migration")
                .cleanDisabled(false)
                .load();
        flyway.clean();
        flyway.migrate();
    }

    @AfterAll
    static void stop() {
        POSTGRES.stop();
    }

    @Test
    void v13CriaTabelaComFkNotNullCheckDePeriodoOrigemEIndiceParcial() throws Exception {
        try (Connection connection = connection()) {
            long monitorId = criarMonitor(connection, "v13");

            assertThat(existe(connection, "select to_regclass('public.janela_monitoramento') is not null")).isTrue();
            assertThat(existe(connection, """
                    select exists (
                      select 1 from pg_constraint c
                      join pg_class t on t.oid = c.conrelid
                      where t.relname = 'janela_monitoramento' and c.contype = 'f'
                    )
                    """)).isTrue();
            assertThat(existe(connection, """
                    select is_nullable = 'NO' from information_schema.columns
                    where table_name = 'janela_monitoramento' and column_name = 'inicio_em'
                    """)).isTrue();
            assertThat(existe(connection, """
                    select is_nullable = 'YES' from information_schema.columns
                    where table_name = 'janela_monitoramento' and column_name = 'fim_em'
                    """)).isTrue();
            assertThat(existe(connection, """
                    select indexdef like '%WHERE (fim_em IS NULL)%'
                    from pg_indexes
                    where tablename = 'janela_monitoramento' and indexname = 'uq_janela_monitoramento_aberta'
                    """)).isTrue();

            inserirJanela(connection, monitorId, Instant.parse("2026-01-01T10:00:00Z"), null, "PRECISA");
            assertThatThrownBy(() -> inserirJanela(connection, monitorId,
                    Instant.parse("2026-01-01T11:00:00Z"), Instant.parse("2026-01-01T10:00:00Z"), "INFERIDA"))
                    .isInstanceOf(SQLException.class);
            assertThatThrownBy(() -> inserirJanela(connection, monitorId,
                    Instant.parse("2026-01-01T12:00:00Z"), Instant.parse("2026-01-01T13:00:00Z"), "INVALIDA"))
                    .isInstanceOf(SQLException.class);
        }
    }

    @Test
    void indiceParcialImpedeDuasJanelasAbertasEMasPermiteNovaAposFechamento() throws Exception {
        try (Connection connection = connection()) {
            long monitorId = criarMonitor(connection, "indice");
            Instant t0 = Instant.parse("2026-01-01T10:00:00Z");
            Instant t1 = Instant.parse("2026-01-01T10:30:00Z");
            Instant t2 = Instant.parse("2026-01-01T11:00:00Z");

            inserirJanela(connection, monitorId, t0, null, "PRECISA");
            assertThatThrownBy(() -> inserirJanela(connection, monitorId, t1, null, "PRECISA"))
                    .isInstanceOf(SQLException.class);

            try (PreparedStatement statement = connection.prepareStatement("""
                    update janela_monitoramento set fim_em = ? where monitor_id = ? and fim_em is null
                    """)) {
                statement.setTimestamp(1, Timestamp.from(t1));
                statement.setLong(2, monitorId);
                assertThat(statement.executeUpdate()).isEqualTo(1);
            }
            inserirJanela(connection, monitorId, t2, null, "PRECISA");
            assertThat(contar(connection, "select count(*) from janela_monitoramento where monitor_id = " + monitorId + " and fim_em is null"))
                    .isEqualTo(1);
        }
    }

    @Test
    void backfillV13UsaCreatedAtEMedicoesNuncaUpdatedAtENemAbreJanelaHistorica() throws Exception {
        Flyway ateV12 = flyway("12");
        ateV12.clean();
        ateV12.migrate();
        try (Connection connection = connection()) {
            criarBaseLegada(connection);
            long bf1 = criarMonitorLegado(connection, "BF1", Instant.parse("2026-01-01T09:00:00Z"), Instant.parse("2030-01-01T00:00:00Z"));
            long bf2 = criarMonitorLegado(connection, "BF2", Instant.parse("2026-01-01T09:30:00Z"), Instant.parse("2030-01-01T00:00:00Z"));
            criarMonitorLegado(connection, "BF3", Instant.parse("2026-01-01T09:00:00Z"), Instant.parse("2030-01-01T00:00:00Z"));
            inserirMedicao(connection, bf1, Instant.parse("2026-01-01T09:15:00Z"));
            inserirMedicao(connection, bf1, Instant.parse("2026-01-01T10:00:00Z"));
            inserirMedicao(connection, bf2, Instant.parse("2026-01-01T09:15:00Z"));
            inserirMedicao(connection, bf2, Instant.parse("2026-01-01T10:00:00Z"));
        }

        flyway(null).migrate();

        try (Connection connection = connection()) {
            assertJanelaInferida(connection, "Monitor BF1", Instant.parse("2026-01-01T09:15:00Z"), Instant.parse("2026-01-01T10:01:00Z"));
            assertJanelaInferida(connection, "Monitor BF2", Instant.parse("2026-01-01T09:30:00Z"), Instant.parse("2026-01-01T10:01:00Z"));
            assertThat(contar(connection, "select count(*) from janela_monitoramento j join monitor m on m.id = j.monitor_id where m.nome = 'Monitor BF3'"))
                    .isZero();
            assertThat(contar(connection, "select count(*) from janela_monitoramento where fim_em is null")).isZero();
        }
    }

    private Connection connection() throws SQLException {
        return DriverManager.getConnection(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
    }

    private Flyway flyway(String target) {
        var configuration = Flyway.configure()
                .dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
                .locations("classpath:db/migration")
                .cleanDisabled(false);
        if (target != null) {
            configuration.target(target);
        }
        return configuration.load();
    }

    private void criarBaseLegada(Connection connection) throws SQLException {
        try (Statement statement = connection.createStatement()) {
            statement.executeUpdate("insert into unidade(nome, sigla) values ('Unidade legado', 'LEG')");
            statement.executeUpdate("insert into tipo_equipamento(nome, slug) values ('Tipo legado', 'tipo-legado')");
            statement.executeUpdate("insert into equipamento(unidade_id, tipo_equipamento_id, nome, ip_address) values (1, 1, 'Equipamento legado', '10.0.0.1')");
        }
    }

    private long criarMonitorLegado(Connection connection, String suffix, Instant createdAt, Instant updatedAt) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement("""
                insert into monitor(equipamento_id, tipo, nome, intervalo_segundos, timeout_ms, created_at, updated_at)
                values (1, 'ICMP', ?, 60, 1000, ?, ?)
                """, Statement.RETURN_GENERATED_KEYS)) {
            statement.setString(1, "Monitor " + suffix);
            statement.setTimestamp(2, Timestamp.from(createdAt));
            statement.setTimestamp(3, Timestamp.from(updatedAt));
            statement.executeUpdate();
            try (var keys = statement.getGeneratedKeys()) {
                keys.next();
                return keys.getLong(1);
            }
        }
    }

    private void inserirMedicao(Connection connection, long monitorId, Instant executadoEm) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement("""
                insert into medicao(monitor_id, status, latencia_ms, executado_em)
                values (?, 'SUCESSO', 1, ?)
                """)) {
            statement.setLong(1, monitorId);
            statement.setTimestamp(2, Timestamp.from(executadoEm));
            statement.executeUpdate();
        }
    }

    private void assertJanelaInferida(Connection connection, String monitorNome, Instant inicio, Instant fim) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement("""
                select j.inicio_em, j.fim_em, j.origem
                from janela_monitoramento j join monitor m on m.id = j.monitor_id
                where m.nome = ?
                """)) {
            statement.setString(1, monitorNome);
            try (var result = statement.executeQuery()) {
                assertThat(result.next()).isTrue();
                assertThat(result.getTimestamp("inicio_em").toInstant()).isEqualTo(inicio);
                assertThat(result.getTimestamp("fim_em").toInstant()).isEqualTo(fim);
                assertThat(result.getString("origem")).isEqualTo("INFERIDA");
                assertThat(result.next()).isFalse();
            }
        }
    }

    private long criarMonitor(Connection connection, String suffix) throws SQLException {
        try (Statement statement = connection.createStatement()) {
            statement.executeUpdate("insert into unidade(nome, sigla) values ('Unidade " + suffix + "', 'U" + suffix + "')");
            statement.executeUpdate("insert into tipo_equipamento(nome, slug) values ('Tipo " + suffix + "', 't" + suffix + "')");
            statement.executeUpdate("insert into equipamento(unidade_id, tipo_equipamento_id, nome, ip_address) values (1, 1, 'Equipamento " + suffix + "', '10.0.0.1')");
            statement.executeUpdate("insert into monitor(equipamento_id, tipo, nome, intervalo_segundos, timeout_ms) values (1, 'ICMP', 'Monitor " + suffix + "', 60, 1000)");
            try (var result = statement.executeQuery("select id from monitor where nome = 'Monitor " + suffix + "'")) {
                result.next();
                return result.getLong(1);
            }
        }
    }

    private void inserirJanela(Connection connection, long monitorId, Instant inicio, Instant fim, String origem) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement("""
                insert into janela_monitoramento(monitor_id, inicio_em, fim_em, origem)
                values (?, ?, ?, ?)
                """)) {
            statement.setLong(1, monitorId);
            statement.setTimestamp(2, Timestamp.from(inicio));
            if (fim == null) {
                statement.setNull(3, java.sql.Types.TIMESTAMP_WITH_TIMEZONE);
            } else {
                statement.setTimestamp(3, Timestamp.from(fim));
            }
            statement.setString(4, origem);
            statement.executeUpdate();
        }
    }

    private boolean existe(Connection connection, String sql) throws SQLException {
        try (Statement statement = connection.createStatement(); var result = statement.executeQuery(sql)) {
            result.next();
            return result.getBoolean(1);
        }
    }

    private long contar(Connection connection, String sql) throws SQLException {
        try (Statement statement = connection.createStatement(); var result = statement.executeQuery(sql)) {
            result.next();
            return result.getLong(1);
        }
    }
}
