package br.com.inframonitor.equipamento;

import br.com.inframonitor.equipamento.repository.EquipamentoRepository;
import br.com.inframonitor.equipamento.repository.EquipamentoRepository.EstadoManutencaoTravado;
import br.com.inframonitor.testsupport.RequerDocker;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.containers.PostgreSQLContainer;

import java.time.Instant;
import java.util.Map;
import java.util.function.Supplier;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Contrato dos metodos nativos de manutencao do EquipamentoRepository contra PostgreSQL
 * real: a projecao de travarEstadoManutencao (alias camelCase num banco que dobra
 * identificadores nao citados para minusculas) e os CAS marcarManual, desmarcarManual e
 * trocarEmManutencao, inclusive respeitando ck_equipamento_manutencao_manual_efetiva.
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
class EstadoManutencaoRepositoryPostgresIntegrationTest {

    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");
    private static final Instant AGORA = Instant.parse("2026-11-01T08:00:00Z");

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        POSTGRES.start();
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @Autowired private JdbcTemplate jdbc;
    @Autowired private EquipamentoRepository repositorio;
    @Autowired private PlatformTransactionManager transactionManager;

    private long unidadeId;
    private long tipoId;

    @BeforeEach
    void limparBanco() {
        jdbc.execute("truncate table manutencao_agendada_equipamento, manutencao_agendada, janela_monitoramento, "
                + "medicao, notificacao, monitor_episodio_latencia, incidente, monitor, equipamento, "
                + "tipo_equipamento, unidade, usuarios restart identity cascade");
        tipoId = jdbc.queryForObject("insert into tipo_equipamento (nome, ativo) values ('Switch', true) returning id",
                Long.class);
        unidadeId = jdbc.queryForObject(
                "insert into unidade (nome, sigla, ativo) values ('Centro', 'CTR', true) returning id", Long.class);
    }

    @Test
    void travarEstadoLeAsDuasFlagsComFalseFalse() {
        long id = equipamento(false, false);
        EstadoLido estado = emTransacao(() -> lerTravado(id));
        assertThat(estado.em()).isFalse();
        assertThat(estado.manual()).isFalse();
    }

    @Test
    void travarEstadoLeAsDuasFlagsComTrueTrue() {
        long id = equipamento(true, true);
        EstadoLido estado = emTransacao(() -> lerTravado(id));
        assertThat(estado.em()).isTrue();
        assertThat(estado.manual()).isTrue();
    }

    @Test
    void travarEstadoDistingueSoJanelaDeManual() {
        long id = equipamento(true, false);
        EstadoLido estado = emTransacao(() -> lerTravado(id));
        assertThat(estado.em()).isTrue();
        assertThat(estado.manual()).isFalse();
    }

    @Test
    void travarEstadoDeEquipamentoInexistenteVoltaVazio() {
        assertThat(emTransacao(() -> repositorio.travarEstadoManutencao(999_999L))).isEmpty();
    }

    @Test
    void marcarManualEIdempotenteELigaAsDuasFlags() {
        long id = equipamento(false, false);
        assertThat(emTransacao(() -> repositorio.marcarManual(id, AGORA))).isEqualTo(1);
        assertThat(emTransacao(() -> repositorio.marcarManual(id, AGORA))).isZero();
        assertThat(flags(id)).containsEntry("manutencao_manual", true).containsEntry("em_manutencao", true);
    }

    @Test
    void marcarManualSobreSoJanelaLigaManualEMantemEfetivo() {
        long id = equipamento(true, false);
        assertThat(emTransacao(() -> repositorio.marcarManual(id, AGORA))).isEqualTo(1);
        assertThat(flags(id)).containsEntry("manutencao_manual", true).containsEntry("em_manutencao", true);
    }

    @Test
    void desmarcarManualEIdempotenteEDeixaEmManutencaoIntocado() {
        long id = equipamento(true, true);
        assertThat(emTransacao(() -> repositorio.desmarcarManual(id, AGORA))).isEqualTo(1);
        assertThat(emTransacao(() -> repositorio.desmarcarManual(id, AGORA))).isZero();
        assertThat(flags(id)).containsEntry("manutencao_manual", false).containsEntry("em_manutencao", true);
    }

    @Test
    void trocarEmManutencaoSoAplicaQuandoAnteriorCoincide() {
        long id = equipamento(false, false);
        assertThat(emTransacao(() -> repositorio.trocarEmManutencao(id, true, false, AGORA))).isZero();
        assertThat(flags(id)).containsEntry("em_manutencao", false);
        assertThat(emTransacao(() -> repositorio.trocarEmManutencao(id, false, true, AGORA))).isEqualTo(1);
        assertThat(flags(id)).containsEntry("em_manutencao", true).containsEntry("manutencao_manual", false);
    }

    @Test
    void desmarcarManualEDepoisTrocarParaFalseRespeitaOCheck() {
        long id = equipamento(true, true);
        assertThat(emTransacao(() -> repositorio.desmarcarManual(id, AGORA))).isEqualTo(1);
        assertThat(emTransacao(() -> repositorio.trocarEmManutencao(id, true, false, AGORA))).isEqualTo(1);
        assertThat(flags(id)).containsEntry("manutencao_manual", false).containsEntry("em_manutencao", false);
    }

    private record EstadoLido(boolean em, boolean manual) { }

    private EstadoLido lerTravado(long id) {
        EstadoManutencaoTravado estado = repositorio.travarEstadoManutencao(id).orElseThrow();
        return new EstadoLido(estado.getEmManutencao(), estado.getManutencaoManual());
    }

    private <T> T emTransacao(Supplier<T> acao) {
        return new TransactionTemplate(transactionManager).execute(status -> acao.get());
    }

    private Map<String, Object> flags(long id) {
        return jdbc.queryForMap("select em_manutencao, manutencao_manual from equipamento where id = ?", id);
    }

    private long equipamento(boolean emManutencao, boolean manual) {
        return jdbc.queryForObject("insert into equipamento (unidade_id, tipo_equipamento_id, nome, ip_address, ativo, "
                + "em_manutencao, manutencao_manual) values (?, ?, 'SW-CORE', '10.0.0.10', true, ?, ?) returning id",
                Long.class, unidadeId, tipoId, emManutencao, manual);
    }
}
