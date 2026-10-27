package br.com.inframonitor.relatorio.integration;

import br.com.inframonitor.testsupport.RequerDocker;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.testcontainers.containers.PostgreSQLContainer;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * V24: janela_monitoramento.primeira_medicao_em, mantida pelo banco. A regra e a mesma que o SQL de
 * disponibilidade usava ate a V23 — menor executado_em em [inicio_em, fim_em) — e este teste a cobra
 * no preenchimento da migration e nos dois gatilhos, em qualquer ordem de chegada.
 */
@RequerDocker
class V24PrimeiraMedicaoDaJanelaPostgresIntegrationTest {

    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");
    private static final Instant T = Instant.parse("2026-08-01T00:00:00Z");

    @BeforeEach
    void limpar() {
        POSTGRES.start();
        Flyway.configure().dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
                .locations("classpath:db/migration").cleanDisabled(false).load().clean();
    }

    @AfterAll
    static void stop() {
        POSTGRES.stop();
    }

    @Test
    void migrationPreencheAsJanelasExistentesComAMesmaRegraDoSqlAntigo() throws Exception {
        migrar("22");
        try (Connection c = conexao()) {
            long m = monitor(c);
            medicao(c, m, T.minusSeconds(60));                 // antes da primeira janela: nao conta
            long fechada = janela(c, m, T, T.plusSeconds(600));
            medicao(c, m, T.plusSeconds(600));                 // exatamente no fim: nao conta
            medicao(c, m, T.plusSeconds(120));
            medicao(c, m, T);                                   // exatamente no inicio: conta
            long vazia = janela(c, m, T.plusSeconds(700), T.plusSeconds(800));
            long aberta = janela(c, m, T.plusSeconds(900), null);
            medicao(c, m, T.plusSeconds(1000));

            migrar("24");

            assertThat(primeira(c, fechada)).isEqualTo(T);
            assertThat(primeira(c, vazia)).isNull();
            assertThat(primeira(c, aberta)).isEqualTo(T.plusSeconds(1000));
        }
    }

    @Test
    void medicaoNovaRegistraAPrimeiraEMedicaoAtrasadaAnteriorAssumeOLugar() throws Exception {
        migrar("24");
        try (Connection c = conexao()) {
            long m = monitor(c);
            long j = janela(c, m, T, null);
            assertThat(primeira(c, j)).isNull();

            medicao(c, m, T.plusSeconds(300));
            assertThat(primeira(c, j)).isEqualTo(T.plusSeconds(300));
            medicao(c, m, T.plusSeconds(400));
            assertThat(primeira(c, j)).isEqualTo(T.plusSeconds(300));
            medicao(c, m, T.plusSeconds(100));                 // chegou fora de ordem
            assertThat(primeira(c, j)).isEqualTo(T.plusSeconds(100));
            medicao(c, m, T.minusSeconds(100));                // antes do inicio: ignorada
            assertThat(primeira(c, j)).isEqualTo(T.plusSeconds(100));
        }
    }

    @Test
    void medicaoSoEntraNaJanelaQueAContem() throws Exception {
        migrar("24");
        try (Connection c = conexao()) {
            long m = monitor(c);
            long fechada = janela(c, m, T, T.plusSeconds(600));
            long aberta = janela(c, m, T.plusSeconds(600), null);

            medicao(c, m, T.plusSeconds(600));                 // fim da fechada = inicio da aberta

            assertThat(primeira(c, fechada)).isNull();
            assertThat(primeira(c, aberta)).isEqualTo(T.plusSeconds(600));
        }
    }

    @Test
    void janelaCriadaDepoisDasMedicoesBuscaAPrimeiraNoPeriodo() throws Exception {
        migrar("24");
        try (Connection c = conexao()) {
            long m = monitor(c);
            medicao(c, m, T.plusSeconds(50));
            medicao(c, m, T.plusSeconds(20));
            medicao(c, m, T.minusSeconds(10));

            long j = janela(c, m, T, null);

            assertThat(primeira(c, j)).isEqualTo(T.plusSeconds(20));
        }
    }

    @Test
    void fecharAJanelaPreservaAPrimeiraMesmoSemAMedicaoQueAOriginou() throws Exception {
        migrar("24");
        try (Connection c = conexao()) {
            long m = monitor(c);
            long j = janela(c, m, T, null);
            medicao(c, m, T.plusSeconds(30));
            medicao(c, m, T.plusSeconds(90));

            // Retencao futura: a medicao que originou a primeira deixa de existir.
            executar(c, "delete from medicao where executado_em = ?", Timestamp.from(T.plusSeconds(30)));
            executar(c, "update janela_monitoramento set fim_em = ? where id = ?", Timestamp.from(T.plusSeconds(600)), j);

            assertThat(primeira(c, j)).isEqualTo(T.plusSeconds(30));
        }
    }

    @Test
    void estenderJanelaSemPrimeiraBuscaNoPeriodoNovo() throws Exception {
        migrar("24");
        try (Connection c = conexao()) {
            long m = monitor(c);
            long j = janela(c, m, T, T.plusSeconds(60));
            medicao(c, m, T.plusSeconds(120));
            assertThat(primeira(c, j)).isNull();

            executar(c, "update janela_monitoramento set fim_em = null where id = ?", j);

            assertThat(primeira(c, j)).isEqualTo(T.plusSeconds(120));
        }
    }

    @Test
    void checkRecusaPrimeiraAnteriorAoInicio() throws Exception {
        migrar("24");
        try (Connection c = conexao()) {
            long j = janela(c, monitor(c), T, null);
            // O gatilho de janela so dispara em inicio_em/fim_em; aqui a escrita e direta na coluna.
            assertThatThrownBy(() -> executar(c, "update janela_monitoramento set primeira_medicao_em = ? where id = ?",
                    Timestamp.from(T.minusSeconds(1)), j)).isInstanceOf(SQLException.class)
                    .hasMessageContaining("ck_janela_monitoramento_primeira_medicao");
        }
    }

    /**
     * Duas medicoes do mesmo monitor em transacoes concorrentes, a mais nova primeiro: a segunda
     * espera na linha da janela e o WHERE reavaliado sobre a versao nova ainda deixa a menor.
     */
    @Test
    void medicoesConcorrentesFicamComAMenor() throws Exception {
        migrar("24");
        long m;
        long j;
        try (Connection c = conexao()) {
            m = monitor(c);
            j = janela(c, m, T, null);
        }
        try (Connection nova = conexao(); Connection antiga = conexao()) {
            nova.setAutoCommit(false);
            antiga.setAutoCommit(false);
            medicao(nova, m, T.plusSeconds(200));

            CompletableFuture<Void> segunda = CompletableFuture.runAsync(() -> {
                try {
                    medicao(antiga, m, T.plusSeconds(100));
                    antiga.commit();
                } catch (SQLException e) {
                    throw new IllegalStateException(e);
                }
            });
            Thread.sleep(300);
            assertThat(segunda).as("a segunda precisa esperar a linha da janela").isNotDone();
            nova.commit();
            segunda.get(10, TimeUnit.SECONDS);
        }
        try (Connection c = conexao()) {
            assertThat(primeira(c, j)).isEqualTo(T.plusSeconds(100));
        }
    }

    private void migrar(String alvo) {
        Flyway.configure().dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
                .locations("classpath:db/migration").target(alvo).load().migrate();
    }

    private Connection conexao() throws SQLException {
        return DriverManager.getConnection(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
    }

    private long monitor(Connection c) throws SQLException {
        long tipo = id(c, "insert into tipo_equipamento (nome) values ('Switch') returning id");
        long unidade = id(c, "insert into unidade (nome, sigla) values ('Sede', 'SEDE') returning id");
        long equipamento = id(c, "insert into equipamento (unidade_id, tipo_equipamento_id, nome) values (?, ?, 'SW') returning id",
                unidade, tipo);
        return id(c, "insert into monitor (equipamento_id, tipo, nome, intervalo_segundos, timeout_ms) "
                + "values (?, 'ICMP', 'ping', 60, 2000) returning id", equipamento);
    }

    private long janela(Connection c, long monitor, Instant inicio, Instant fim) throws SQLException {
        return id(c, "insert into janela_monitoramento (monitor_id, inicio_em, fim_em, origem) values (?, ?, ?, 'PRECISA') returning id",
                monitor, Timestamp.from(inicio), fim == null ? null : Timestamp.from(fim));
    }

    private void medicao(Connection c, long monitor, Instant em) throws SQLException {
        executar(c, "insert into medicao (monitor_id, status, latencia_ms, executado_em) values (?, 'SUCESSO', 10, ?)",
                monitor, Timestamp.from(em));
    }

    private Instant primeira(Connection c, long janela) throws SQLException {
        try (PreparedStatement s = preparar(c, "select primeira_medicao_em from janela_monitoramento where id = ?", janela);
             ResultSet r = s.executeQuery()) {
            r.next();
            Timestamp valor = r.getTimestamp(1);
            return valor == null ? null : valor.toInstant();
        }
    }

    private long id(Connection c, String sql, Object... args) throws SQLException {
        try (PreparedStatement s = preparar(c, sql, args); ResultSet r = s.executeQuery()) {
            r.next();
            return r.getLong(1);
        }
    }

    private void executar(Connection c, String sql, Object... args) throws SQLException {
        try (PreparedStatement s = preparar(c, sql, args)) {
            s.executeUpdate();
        }
    }

    private PreparedStatement preparar(Connection c, String sql, Object... args) throws SQLException {
        PreparedStatement s = c.prepareStatement(sql);
        for (int i = 0; i < args.length; i++) s.setObject(i + 1, args[i]);
        return s;
    }
}
