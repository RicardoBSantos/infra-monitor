package br.com.inframonitor.equipamento.service;

import br.com.inframonitor.incidente.entity.Incidente;
import br.com.inframonitor.incidente.entity.MotivoEncerramentoIncidente;
import br.com.inframonitor.incidente.entity.StatusIncidente;
import br.com.inframonitor.incidente.repository.IncidenteRepository;
import br.com.inframonitor.notificacao.entity.TipoEventoNotificacao;
import br.com.inframonitor.notificacao.repository.NotificacaoRepository;
import br.com.inframonitor.relatorio.repository.JanelaMonitoramentoRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Prova a transacao unica de {@link EquipamentoService#entrarEmManutencao} e
 * {@link EquipamentoService#sairDeManutencao}: flag com CAS, fechamento de incidente e
 * de episodio, fechamento/reabertura de janela e resolucao das notificacoes.
 *
 * <p>Contra Postgres real porque marcarEmManutencaoSeNaoEstiver/fecharPorManutencao sao
 * @Query de UPDATE, e sairDeManutencao precisa reavaliar o predicado inteiro da janela
 * (equipamento.ativo incluido).
 */
@SpringBootTest(properties = {
        "app.auth.jwt.secret=test-only-jwt-secret-with-at-least-32-bytes",
        "app.auth.jwt.issuer=infra-monitor-test",
        "app.auth.jwt.access-token-minutes=15",
        "monitoring.engine.enabled=false",
        "notification.telegram.enabled=false",
        "notification.dispatcher.enabled=false"
})
class EntradaEmManutencaoTest {

    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");
    private static final Instant T0 = Instant.parse("2026-09-01T08:00:00Z");

    @Autowired private JdbcTemplate jdbc;
    @Autowired private EquipamentoService equipamentoService;
    @Autowired private IncidenteRepository incidenteRepository;
    @Autowired private NotificacaoRepository notificacaoRepository;
    @Autowired private JanelaMonitoramentoRepository janelaRepository;

    private long equipamentoId;
    private long monitorId;
    private long operadorId;

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        POSTGRES.start();
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @BeforeEach
    void montarCenario() {
        jdbc.execute("truncate table janela_monitoramento, medicao, notificacao, monitor_episodio_latencia, "
                + "incidente, monitor, equipamento, tipo_equipamento, unidade, usuarios restart identity cascade");

        operadorId = insert("insert into usuarios (nome, email, senha_hash, papel, troca_senha_obrigatoria) "
                + "values ('Operador', 'operador@teste.local', 'hash', 'OPERADOR', false) returning id");
        long tipo = insert("insert into tipo_equipamento (nome, ativo) values ('Switch', true) returning id");
        long unidade = insert("insert into unidade (nome, sigla, ativo) values ('Centro', 'CTR', true) returning id");
        equipamentoId = insert("insert into equipamento (unidade_id, tipo_equipamento_id, nome, ip_address, ativo, "
                + "em_manutencao) values (?, ?, 'SW-CORE', '10.0.0.10', true, false) returning id", unidade, tipo);
        monitorId = insert("insert into monitor (equipamento_id, tipo, nome, intervalo_segundos, timeout_ms, ativo, "
                + "falhas_para_incidente, sucessos_para_recovery) "
                + "values (?, 'ICMP', 'ICMP CORE', 60, 2000, true, 3, 2) returning id", equipamentoId);
        insert("insert into janela_monitoramento (monitor_id, inicio_em, origem) values (?, ?, 'PRECISA') "
                + "returning id", monitorId, Timestamp.from(T0));
    }

    @Test
    void entrarEmManutencaoFechaIncidenteComMotivoEAutorEFechaJanela() {
        long incidenteId = abrirIncidente();
        enviarNotificacaoDeAbertura(incidenteId);

        equipamentoService.entrarEmManutencao(equipamentoId, operadorId);

        Incidente fechado = incidenteRepository.findById(incidenteId).orElseThrow();
        assertThat(fechado.getStatus()).isEqualTo(StatusIncidente.FECHADO);
        assertThat(fechado.getMotivoEncerramento()).isEqualTo(MotivoEncerramentoIncidente.MANUTENCAO);
        assertThat(fechado.getFechadoPor().getId()).isEqualTo(operadorId);
        assertThat(janelaRepository.aberta(monitorId)).isEmpty();
        assertThat(existe(incidenteId, TipoEventoNotificacao.INCIDENTE_ENCERRADO_MANUTENCAO)).isTrue();
        assertThat(existe(incidenteId, TipoEventoNotificacao.INCIDENTE_FECHADO)).isFalse();
    }

    @Test
    void entrarEmManutencaoDuasVezesRodaOsEfeitosUmaVezSo() {
        equipamentoService.entrarEmManutencao(equipamentoId, operadorId);
        long notificacoesDepoisDaPrimeira = notificacaoRepository.count();

        equipamentoService.entrarEmManutencao(equipamentoId, operadorId);

        assertThat(notificacaoRepository.count()).isEqualTo(notificacoesDepoisDaPrimeira);
    }

    @Test
    void episodioDeLatenciaAbertoEEncerradoComMotivoManutencao() {
        long episodioId = insert("insert into monitor_episodio_latencia (monitor_id, iniciado_em, limiar_ms) "
                + "values (?, ?, 200) returning id", monitorId, Timestamp.from(T0));

        equipamentoService.entrarEmManutencao(equipamentoId, operadorId);

        Timestamp encerradoEm = jdbc.queryForObject(
                "select encerrado_em from monitor_episodio_latencia where id = ?", Timestamp.class, episodioId);
        String motivo = jdbc.queryForObject(
                "select motivo_encerramento from monitor_episodio_latencia where id = ?", String.class, episodioId);
        assertThat(encerradoEm).isNotNull();
        assertThat(motivo).isEqualTo("MANUTENCAO");
    }

    @Test
    void sairDeManutencaoReabreJanelaReavaliandoOPredicado() {
        equipamentoService.entrarEmManutencao(equipamentoId, operadorId);
        equipamentoService.sairDeManutencao(equipamentoId);

        assertThat(janelaRepository.aberta(monitorId)).isPresent();
    }

    @Test
    void sairDeManutencaoDeEquipamentoINATIVONaoAbreJanela() {
        jdbc.update("update equipamento set ativo = false where id = ?", equipamentoId);

        equipamentoService.entrarEmManutencao(equipamentoId, operadorId);
        equipamentoService.sairDeManutencao(equipamentoId);

        assertThat(janelaRepository.aberta(monitorId)).isEmpty();
    }

    private long abrirIncidente() {
        return insert("insert into incidente (monitor_id, status, iniciado_em, motivo) "
                + "values (?, 'ABERTO', ?, 'Indisponibilidade') returning id", monitorId, Timestamp.from(T0));
    }

    private void enviarNotificacaoDeAbertura(long incidenteId) {
        insert("insert into notificacao (incidente_id, canal, tipo_evento, status, tentativas, mensagem, "
                + "enviado_em, created_at, updated_at) values (?, 'TELEGRAM', 'INCIDENTE_ABERTO', 'ENVIADA', 0, "
                + "'x', ?, ?, ?) returning id", incidenteId, Timestamp.from(T0), Timestamp.from(T0),
                Timestamp.from(T0));
    }

    private boolean existe(long incidenteId, TipoEventoNotificacao tipoEvento) {
        List<Long> ids = jdbc.queryForList(
                "select id from notificacao where incidente_id = ? and tipo_evento = ?", Long.class,
                incidenteId, tipoEvento.name());
        return !ids.isEmpty();
    }

    private long insert(String sql, Object... args) {
        return jdbc.queryForObject(sql, Long.class, args);
    }
}
