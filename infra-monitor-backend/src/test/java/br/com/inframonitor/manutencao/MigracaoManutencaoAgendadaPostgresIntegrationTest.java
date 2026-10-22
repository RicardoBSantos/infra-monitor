package br.com.inframonitor.manutencao;

import br.com.inframonitor.testsupport.RequerDocker;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;

import java.sql.Timestamp;
import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * V21: cada CHECK e a FK de equipamento ligado a manutencao precisam recusar o que dizem
 * recusar. Requer Docker. Sem Docker disponivel o teste e ignorado, nunca falha.
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
class MigracaoManutencaoAgendadaPostgresIntegrationTest {

    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");
    private static final Instant INICIO = Instant.parse("2026-11-01T08:00:00Z");
    private static final Instant FIM = INICIO.plusSeconds(3600);

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        POSTGRES.start();
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @Autowired private JdbcTemplate jdbc;

    private long usuarioId;
    private long unidadeId;

    @BeforeEach
    void limparBanco() {
        jdbc.execute("truncate table manutencao_agendada_equipamento, manutencao_agendada, janela_monitoramento, "
                + "medicao, notificacao, monitor_episodio_latencia, incidente, monitor, equipamento, "
                + "tipo_equipamento, unidade, usuarios restart identity cascade");
        usuarioId = jdbc.queryForObject("insert into usuarios (nome, email, senha_hash, papel, ativo, "
                + "troca_senha_obrigatoria) values ('Operador', 'operador@migracao.test', 'hash-irrelevante', "
                + "'OPERADOR', true, false) returning id", Long.class);
        unidadeId = jdbc.queryForObject(
                "insert into unidade (nome, sigla, ativo) values ('Centro', 'CTR', true) returning id", Long.class);
    }

    @Test
    void manualSemEfetivoERecusado() {
        long e = equipamento(false);
        assertThatThrownBy(() -> jdbc.update("update equipamento set manutencao_manual = true where id = ?", e))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("ck_equipamento_manutencao_manual_efetiva");
    }

    @Test
    void efetivoSemManualEPermitido() { // o caso "so janela"
        long e = equipamento(false);
        jdbc.update("update equipamento set em_manutencao = true where id = ?", e);
        assertThat(jdbc.queryForObject("select em_manutencao from equipamento where id = ?", Boolean.class, e)).isTrue();
        assertThat(jdbc.queryForObject("select manutencao_manual from equipamento where id = ?", Boolean.class, e))
                .isFalse();
    }

    @Test
    void equipamentoNovoNasceSemManual() {
        long e = equipamento(false);
        assertThat(jdbc.queryForObject("select manutencao_manual from equipamento where id = ?", Boolean.class, e))
                .isFalse();
    }

    @Test
    void ativaSemCarimboERecusada() {
        assertThatThrownBy(() -> inserir("ATIVA", INICIO, FIM, "motivo", null, null, null, null))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("ck_manutencao_agendada_coerente");
    }

    @Test
    void canceladaSemAutorERecusada() {
        assertThatThrownBy(() -> inserir("CANCELADA", INICIO, FIM, "motivo", null, null, INICIO.minusSeconds(60), null))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("ck_manutencao_agendada_coerente");
    }

    @Test
    void periodoInvertidoERecusado() {
        assertThatThrownBy(() -> inserir("AGENDADA", FIM, INICIO, "motivo", null, null, null, null))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("ck_manutencao_agendada_periodo");
    }

    @Test
    void motivoEmBrancoERecusado() {
        assertThatThrownBy(() -> inserir("AGENDADA", INICIO, FIM, "   ", null, null, null, null))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("ck_manutencao_agendada_motivo");
    }

    @Test
    void ativacaoAntesDoPrevistoERecusada() {
        assertThatThrownBy(() -> inserir("ATIVA", INICIO, FIM, "motivo", INICIO.minusSeconds(1), null, null, null))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("ck_manutencao_agendada_ativacao");
    }

    @Test
    void encerradorSoEmConcluida() {
        assertThatThrownBy(() -> inserir("ATIVA", INICIO, FIM, "motivo", INICIO, usuarioId, null, null))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("ck_manutencao_agendada_encerrador");
    }

    @Test
    void excluirEquipamentoLigadoEBarradoPelaFk() {
        long e = equipamento(false);
        long m = inserir("AGENDADA", INICIO, FIM, "motivo", null, null, null, null);
        jdbc.update("insert into manutencao_agendada_equipamento (manutencao_id, equipamento_id) values (?, ?)", m, e);
        assertThatThrownBy(() -> jdbc.update("delete from equipamento where id = ?", e))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("manutencao_agendada_equipamento");
    }

    @Test
    void escopoDesconhecidoERecusado() {
        assertThatThrownBy(() -> jdbc.update("insert into manutencao_agendada (unidade_id, escopo, inicio_previsto, "
                + "fim_previsto, motivo, criado_por_id) values (?, 'TUDO', ?, ?, 'motivo', ?)",
                unidadeId, Timestamp.from(INICIO), Timestamp.from(FIM), usuarioId))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("ck_manutencao_agendada_escopo");
    }

    @Test
    void statusDesconhecidoERecusado() {
        assertThatThrownBy(() -> inserir("PAUSADA", INICIO, FIM, "motivo", null, null, null, null))
                .isInstanceOf(DataIntegrityViolationException.class)
                // O PostgreSQL avalia os CHECK em ordem alfabetica: _coerente (que tambem so aceita os 5
                // status) responde antes de _status. Basta ser recusado por um dos dois.
                .hasMessageMatching("(?s).*ck_manutencao_agendada_(status|coerente).*");
    }

    @Test
    void encerramentoAntesDaAtivacaoERecusado() {
        assertThatThrownBy(() -> jdbc.update("insert into manutencao_agendada (unidade_id, escopo, inicio_previsto, "
                + "fim_previsto, motivo, status, criado_por_id, ativada_em, encerrada_em) "
                + "values (?, 'UNIDADE', ?, ?, 'motivo', 'CONCLUIDA', ?, ?, ?)",
                unidadeId, Timestamp.from(INICIO), Timestamp.from(FIM), usuarioId,
                Timestamp.from(INICIO.plusSeconds(600)), Timestamp.from(INICIO.plusSeconds(300))))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("ck_manutencao_agendada_encerramento");
    }

    @Test
    void manutencaoCoerenteEmCadaStatusEAceita() {
        inserir("AGENDADA", INICIO, FIM, "motivo", null, null, null, null);
        inserir("ATIVA", INICIO, FIM, "motivo", INICIO, null, null, null);
        inserir("EXPIRADA", INICIO, FIM, "motivo", null, null, null, null);
        assertThat(jdbc.queryForObject("select count(*) from manutencao_agendada", Integer.class)).isEqualTo(3);
    }

    private long inserir(String status, Instant inicio, Instant fim, String motivo, Instant ativadaEm,
                         Long encerradaPorId, Instant canceladaEm, Long canceladaPorId) {
        return jdbc.queryForObject("insert into manutencao_agendada (unidade_id, escopo, inicio_previsto, "
                + "fim_previsto, motivo, status, criado_por_id, ativada_em, encerrada_por_id, cancelada_em, "
                + "cancelada_por_id) values (?, 'UNIDADE', ?, ?, ?, ?, ?, ?, ?, ?, ?) returning id", Long.class,
                unidadeId, Timestamp.from(inicio), Timestamp.from(fim), motivo, status, usuarioId,
                ts(ativadaEm), encerradaPorId, ts(canceladaEm), canceladaPorId);
    }

    private static Timestamp ts(Instant instante) {
        return instante == null ? null : Timestamp.from(instante);
    }

    private long equipamento(boolean emManutencao) {
        long tipo = jdbc.queryForObject("insert into tipo_equipamento (nome, ativo) values ('Switch', true) returning id",
                Long.class);
        return jdbc.queryForObject("insert into equipamento (unidade_id, tipo_equipamento_id, nome, ip_address, ativo, "
                + "em_manutencao) values (?, ?, 'SW-CORE', '10.0.0.10', true, ?) returning id",
                Long.class, unidadeId, tipo, emManutencao);
    }
}
