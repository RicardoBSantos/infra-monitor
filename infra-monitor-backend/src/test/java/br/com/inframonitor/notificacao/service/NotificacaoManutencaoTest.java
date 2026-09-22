package br.com.inframonitor.notificacao.service;

import br.com.inframonitor.incidente.entity.Incidente;
import br.com.inframonitor.incidente.repository.IncidenteRepository;
import br.com.inframonitor.monitoring.latency.MonitorEpisodioLatencia;
import br.com.inframonitor.monitoring.latency.MonitorEpisodioLatenciaRepository;
import br.com.inframonitor.notificacao.entity.StatusNotificacao;
import br.com.inframonitor.notificacao.entity.TipoEventoNotificacao;
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
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Prova a matriz de decisao de {@link NotificacaoService#tratarEncerramentoPorManutencao}
 * pelo estado da notificacao de ABERTURA, nunca pelo tipo de evento. Contra Postgres real
 * porque cancelarPendentesDoIncidente/DoEpisodio sao @Query de UPDATE: um repositorio
 * mockado nao provaria que o CAS contra PENDENTE funciona nem que as CHECKs da V19
 * aceitam os dois tipos novos.
 */
@SpringBootTest(properties = {
        "app.auth.jwt.secret=test-only-jwt-secret-with-at-least-32-bytes",
        "app.auth.jwt.issuer=infra-monitor-test",
        "app.auth.jwt.access-token-minutes=15",
        "monitoring.engine.enabled=false",
        "notification.telegram.enabled=false",
        "notification.dispatcher.enabled=false"
})
class NotificacaoManutencaoTest {

    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");
    private static final Instant T0 = Instant.parse("2026-09-01T08:00:00Z");

    @Autowired private JdbcTemplate jdbc;
    @Autowired private NotificacaoService notificacaoService;
    @Autowired private IncidenteRepository incidenteRepository;
    @Autowired private MonitorEpisodioLatenciaRepository episodioRepository;
    @Autowired private jakarta.persistence.EntityManager entityManager;

    private long incidenteId;
    private long episodioId;

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

        long tipo = insert("insert into tipo_equipamento (nome, ativo) values ('Switch', true) returning id");
        long unidade = insert("insert into unidade (nome, sigla, ativo) values ('Centro', 'CTR', true) returning id");
        long equipamento = insert("insert into equipamento (unidade_id, tipo_equipamento_id, nome, ip_address, ativo, "
                + "em_manutencao) values (?, ?, 'SW-CORE', '10.0.0.10', true, true) returning id", unidade, tipo);
        long monitorId = insert("insert into monitor (equipamento_id, tipo, nome, intervalo_segundos, timeout_ms, ativo, "
                + "falhas_para_incidente, sucessos_para_recovery) "
                + "values (?, 'ICMP', 'ICMP CORE', 60, 2000, true, 3, 2) returning id", equipamento);
        incidenteId = insert("insert into incidente (monitor_id, status, iniciado_em, motivo) "
                + "values (?, 'ABERTO', ?, 'Indisponibilidade') returning id", monitorId, Timestamp.from(T0));
        episodioId = insert("insert into monitor_episodio_latencia (monitor_id, iniciado_em, limiar_ms) "
                + "values (?, ?, 200) returning id", monitorId, Timestamp.from(T0));
    }

    @Test
    void aberturaPendenteECanceladaESemAvisoDeEncerramento() {
        inserirNotificacao(incidenteId, null, TipoEventoNotificacao.INCIDENTE_ABERTO, StatusNotificacao.PENDENTE);

        notificacaoService.tratarEncerramentoPorManutencao(incidente());

        assertThat(statusDa(TipoEventoNotificacao.INCIDENTE_ABERTO)).isEqualTo(StatusNotificacao.CANCELADA);
        assertThat(existe(TipoEventoNotificacao.INCIDENTE_ENCERRADO_MANUTENCAO)).isFalse();
    }

    @Test
    void aberturaEnviadaGeraAvisoDeEncerramentoComTextoProprio() {
        inserirNotificacao(incidenteId, null, TipoEventoNotificacao.INCIDENTE_ABERTO, StatusNotificacao.ENVIADA);

        notificacaoService.tratarEncerramentoPorManutencao(incidente());

        assertThat(statusDa(TipoEventoNotificacao.INCIDENTE_ABERTO)).isEqualTo(StatusNotificacao.ENVIADA);
        String mensagem = mensagemDe(TipoEventoNotificacao.INCIDENTE_ENCERRADO_MANUTENCAO);
        assertThat(mensagem).contains("Incidente encerrado: equipamento entrou em manutenção");
        // Nunca o texto nem o tipo de "resolvido".
        assertThat(mensagem).doesNotContainIgnoringCase("recuperacao");
        assertThat(mensagem).doesNotContainIgnoringCase("resolvido");
        assertThat(existe(TipoEventoNotificacao.INCIDENTE_FECHADO)).isFalse();
    }

    @Test
    void aberturaEnviandoNaoECanceladaEGeraAviso() {
        // ENVIANDO: a chamada ao Telegram pode estar em voo. Tratamos como "vai
        // sair", entao o grupo precisa do encerramento. Marcar CANCELADA em cima de
        // algo possivelmente enviado seria mentira num campo auditado.
        inserirNotificacao(incidenteId, null, TipoEventoNotificacao.INCIDENTE_ABERTO, StatusNotificacao.ENVIANDO);

        notificacaoService.tratarEncerramentoPorManutencao(incidente());

        assertThat(statusDa(TipoEventoNotificacao.INCIDENTE_ABERTO)).isEqualTo(StatusNotificacao.ENVIANDO);
        assertThat(existe(TipoEventoNotificacao.INCIDENTE_ENCERRADO_MANUTENCAO)).isTrue();
    }

    @Test
    void aberturaEmFalhaNaoGeraAviso() {
        // FALHA: a mensagem nao chegou ao grupo; um encerramento sozinho seria ruido.
        inserirNotificacao(incidenteId, null, TipoEventoNotificacao.INCIDENTE_ABERTO, StatusNotificacao.FALHA);

        notificacaoService.tratarEncerramentoPorManutencao(incidente());

        assertThat(statusDa(TipoEventoNotificacao.INCIDENTE_ABERTO)).isEqualTo(StatusNotificacao.FALHA);
        assertThat(existe(TipoEventoNotificacao.INCIDENTE_ENCERRADO_MANUTENCAO)).isFalse();
    }

    @Test
    void episodioSegueAMesmaMatriz() {
        // LATENCIA_ALTA ENVIADA -> LATENCIA_ENCERRADA_MANUTENCAO criada
        inserirNotificacao(null, episodioId, TipoEventoNotificacao.LATENCIA_ALTA, StatusNotificacao.ENVIADA);

        notificacaoService.tratarEncerramentoPorManutencao(episodio());

        assertThat(statusDoEpisodio(TipoEventoNotificacao.LATENCIA_ALTA)).isEqualTo(StatusNotificacao.ENVIADA);
        assertThat(existeDoEpisodio(TipoEventoNotificacao.LATENCIA_ENCERRADA_MANUTENCAO)).isTrue();

        // LATENCIA_ALTA PENDENTE -> CANCELADA, nenhum aviso
        long outroMonitor = insert("insert into monitor (equipamento_id, tipo, nome, intervalo_segundos, "
                + "timeout_ms, ativo, falhas_para_incidente, sucessos_para_recovery) "
                + "values ((select equipamento_id from monitor where id = (select monitor_id from "
                + "monitor_episodio_latencia where id = ?)), 'ICMP', 'ICMP CORE 2', 60, 2000, true, 3, 2) returning id",
                episodioId);
        long outroEpisodioId = insert("insert into monitor_episodio_latencia (monitor_id, iniciado_em, limiar_ms) "
                + "values (?, ?, 200) returning id", outroMonitor, Timestamp.from(T0));
        inserirNotificacao(null, outroEpisodioId, TipoEventoNotificacao.LATENCIA_ALTA, StatusNotificacao.PENDENTE);

        notificacaoService.tratarEncerramentoPorManutencao(episodioRepository.findById(outroEpisodioId).orElseThrow());

        assertThat(statusDoEpisodio(outroEpisodioId, TipoEventoNotificacao.LATENCIA_ALTA))
                .isEqualTo(StatusNotificacao.CANCELADA);
        assertThat(existeDoEpisodio(outroEpisodioId, TipoEventoNotificacao.LATENCIA_ENCERRADA_MANUTENCAO)).isFalse();
    }

    @Test
    void cancelarRecusaNotificacaoQueNaoEstaPendente() {
        long id = inserirNotificacao(incidenteId, null, TipoEventoNotificacao.INCIDENTE_ABERTO,
                StatusNotificacao.ENVIADA);

        br.com.inframonitor.notificacao.entity.Notificacao notificacao =
                entityManager.find(br.com.inframonitor.notificacao.entity.Notificacao.class, id);

        assertThatThrownBy(notificacao::cancelar).isInstanceOf(IllegalStateException.class);
    }

    private Incidente incidente() {
        return incidenteRepository.findById(incidenteId).orElseThrow();
    }

    private MonitorEpisodioLatencia episodio() {
        return episodioRepository.findById(episodioId).orElseThrow();
    }

    private long inserirNotificacao(Long incidenteIdRef, Long episodioIdRef, TipoEventoNotificacao tipoEvento,
                                     StatusNotificacao status) {
        // ck_notificacao_enviado_em (V9) exige enviado_em preenchido quando o status e ENVIADA.
        Timestamp enviadoEm = status == StatusNotificacao.ENVIADA ? Timestamp.from(T0) : null;
        return insert("insert into notificacao (incidente_id, episodio_latencia_id, canal, tipo_evento, status, "
                + "tentativas, mensagem, enviado_em, created_at, updated_at) values (?, ?, 'TELEGRAM', ?, ?, 0, 'x', "
                + "?, ?, ?) returning id", incidenteIdRef, episodioIdRef, tipoEvento.name(), status.name(),
                enviadoEm, Timestamp.from(T0), Timestamp.from(T0));
    }

    private StatusNotificacao statusDa(TipoEventoNotificacao tipoEvento) {
        return StatusNotificacao.valueOf(jdbc.queryForObject(
                "select status from notificacao where incidente_id = ? and tipo_evento = ?", String.class,
                incidenteId, tipoEvento.name()));
    }

    private StatusNotificacao statusDoEpisodio(TipoEventoNotificacao tipoEvento) {
        return statusDoEpisodio(episodioId, tipoEvento);
    }

    private StatusNotificacao statusDoEpisodio(long episodioIdRef, TipoEventoNotificacao tipoEvento) {
        return StatusNotificacao.valueOf(jdbc.queryForObject(
                "select status from notificacao where episodio_latencia_id = ? and tipo_evento = ?", String.class,
                episodioIdRef, tipoEvento.name()));
    }

    private boolean existe(TipoEventoNotificacao tipoEvento) {
        List<Long> ids = jdbc.queryForList(
                "select id from notificacao where incidente_id = ? and tipo_evento = ?", Long.class,
                incidenteId, tipoEvento.name());
        return !ids.isEmpty();
    }

    private boolean existeDoEpisodio(TipoEventoNotificacao tipoEvento) {
        return existeDoEpisodio(episodioId, tipoEvento);
    }

    private boolean existeDoEpisodio(long episodioIdRef, TipoEventoNotificacao tipoEvento) {
        List<Long> ids = jdbc.queryForList(
                "select id from notificacao where episodio_latencia_id = ? and tipo_evento = ?", Long.class,
                episodioIdRef, tipoEvento.name());
        return !ids.isEmpty();
    }

    private String mensagemDe(TipoEventoNotificacao tipoEvento) {
        return jdbc.queryForObject("select mensagem from notificacao where incidente_id = ? and tipo_evento = ?",
                String.class, incidenteId, tipoEvento.name());
    }

    private long insert(String sql, Object... args) {
        return jdbc.queryForObject(sql, Long.class, args);
    }
}
