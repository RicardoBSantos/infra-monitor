package br.com.inframonitor.notificacao;

import br.com.inframonitor.notificacao.dto.NotificacaoResponse;
import br.com.inframonitor.notificacao.service.NotificacaoService;
import br.com.inframonitor.relatorio.dto.HistoricoNotificacaoResponse;
import br.com.inframonitor.relatorio.service.RelatorioService;
import br.com.inframonitor.testsupport.RequerDocker;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.domain.PageRequest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * F3, listagem e historico de notificacoes ancoradas em janela agendada ou em sessao do botao
 * manual: o que a tela le (origem, unidade, equipamento) e o que o relatorio devolve quando
 * {@code incidente_id} e nulo. O CSV e o PDF ficam nas suites proprias de exportacao.
 *
 * <p>Requer Docker. Sem Docker disponivel o teste e ignorado, nunca falha.
 */
@RequerDocker
@SpringBootTest(properties = {
        "app.auth.jwt.secret=test-only-jwt-secret-with-at-least-32-bytes",
        "app.auth.jwt.issuer=infra-monitor-test",
        "monitoring.engine.enabled=false",
        "notification.telegram.enabled=false",
        "notification.dispatcher.enabled=false"
})
class NotificacaoListagemManutencaoPostgresIntegrationTest {

    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        POSTGRES.start();
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
    }

    private static final String MSG_ANCORA =
            "informe apenas uma ancora: incidenteId, episodioLatenciaId, manutencaoId ou manutencaoManualId";

    @Autowired private JdbcTemplate jdbc;
    @Autowired private NotificacaoService notificacaoService;
    @Autowired private RelatorioService relatorioService;

    private Instant agora;
    private long janela;
    private long sessao;
    private long equipamento;
    private long nJanela;
    private long nManual;
    private long nIncidente;

    @BeforeEach
    void montarCenario() {
        jdbc.execute("truncate table manutencao_manual, manutencao_agendada_alteracao, manutencao_agendada_equipamento, "
                + "manutencao_agendada, janela_monitoramento, medicao, notificacao, monitor_episodio_latencia, "
                + "incidente, monitor, equipamento, tipo_equipamento, unidade, usuarios restart identity cascade");
        agora = Instant.now().truncatedTo(ChronoUnit.MILLIS);
        long usuario = insert("insert into usuarios (nome, email, senha_hash, papel, ativo, troca_senha_obrigatoria) "
                + "values ('Operador', 'operador@lista.test', 'hash', 'OPERADOR', true, false) returning id");
        long tipo = insert("insert into tipo_equipamento (nome, ativo) values ('Switch', true) returning id");
        long unidade = insert("insert into unidade (nome, sigla, ativo) values ('Sesc Centro', 'CTR', true) returning id");
        equipamento = insert("insert into equipamento (unidade_id, tipo_equipamento_id, nome, ativo) "
                + "values (?, ?, 'SW-01', true) returning id", unidade, tipo);
        janela = insert("insert into manutencao_agendada (unidade_id, escopo, inicio_previsto, fim_previsto, motivo, "
                + "status, criado_por_id) values (?, 'UNIDADE', ?, ?, 'Teste', 'AGENDADA', ?) returning id",
                unidade, Timestamp.from(agora.plusSeconds(3600)), Timestamp.from(agora.plusSeconds(7200)), usuario);
        sessao = insert("insert into manutencao_manual (equipamento_id, iniciada_em, iniciada_por_id) "
                + "values (?, ?, ?) returning id", equipamento, Timestamp.from(agora), usuario);
        long monitor = insert("insert into monitor (equipamento_id, tipo, nome, intervalo_segundos, timeout_ms, ativo, "
                + "falhas_para_incidente, sucessos_para_recovery) values (?, 'ICMP', 'ICMP', 60, 2000, true, 3, 2) "
                + "returning id", equipamento);
        long incidente = insert("insert into incidente (monitor_id, status, iniciado_em, motivo) "
                + "values (?, 'ABERTO', ?, 'Teste') returning id", monitor, Timestamp.from(agora));
        nJanela = insert("insert into notificacao (manutencao_agendada_id, canal, tipo_evento, status, tentativas, "
                + "mensagem, created_at, updated_at) values (?, 'TELEGRAM', 'MANUTENCAO_INICIADA', 'PENDENTE', 0, 'm', "
                + "now(), now()) returning id", janela);
        nManual = insert("insert into notificacao (manutencao_manual_id, canal, tipo_evento, status, tentativas, "
                + "mensagem, created_at, updated_at) values (?, 'TELEGRAM', 'MANUTENCAO_MANUAL_INICIADA', 'FALHA', 1, 'm', "
                + "now(), now()) returning id", sessao);
        nIncidente = insert("insert into notificacao (incidente_id, canal, tipo_evento, status, tentativas, mensagem, "
                + "created_at, updated_at) values (?, 'TELEGRAM', 'INCIDENTE_ABERTO', 'PENDENTE', 0, 'm', now(), now()) "
                + "returning id", incidente);
    }

    @Test
    void notificacaoDeJanelaTrazOrigemEUnidadeSemEquipamentoNemMonitor() {
        NotificacaoResponse r = notificacaoService.buscarPorId(nJanela);

        assertThat(r.manutencao()).isNotNull();
        assertThat(r.manutencao().id()).isEqualTo(janela);
        assertThat(r.manutencao().unidadeNome()).isEqualTo("Sesc Centro");
        assertThat(r.manutencaoManual()).isNull();
        assertThat(r.incidente()).isNull();
        assertThat(r.episodioLatencia()).isNull();
        assertThat(r.unidadeNome()).isEqualTo("Sesc Centro");
        assertThat(r.equipamentoNome()).isNull();
        assertThat(r.monitorNome()).isNull();
    }

    @Test
    void notificacaoManualTrazEquipamentoEUnidade() {
        NotificacaoResponse r = notificacaoService.buscarPorId(nManual);

        assertThat(r.manutencaoManual()).isNotNull();
        assertThat(r.manutencaoManual().id()).isEqualTo(sessao);
        assertThat(r.manutencaoManual().equipamentoId()).isEqualTo(equipamento);
        assertThat(r.manutencaoManual().equipamentoNome()).isEqualTo("SW-01");
        assertThat(r.manutencao()).isNull();
        assertThat(r.equipamentoNome()).isEqualTo("SW-01");
        assertThat(r.unidadeNome()).isEqualTo("Sesc Centro");
        assertThat(r.monitorNome()).isNull();
    }

    @Test
    void notificacaoDeIncidenteSeguePreenchendoMonitorEAsNovasAncorasFicamNulas() {
        NotificacaoResponse r = notificacaoService.buscarPorId(nIncidente);

        assertThat(r.incidente()).isNotNull();
        assertThat(r.manutencao()).isNull();
        assertThat(r.manutencaoManual()).isNull();
        assertThat(r.monitorNome()).isEqualTo("ICMP");
        assertThat(r.equipamentoNome()).isEqualTo("SW-01");
        assertThat(r.unidadeNome()).isEqualTo("Sesc Centro");
    }

    @Test
    void filtraPorManutencaoIdEPorManutencaoManualId() {
        var pagina = PageRequest.of(0, 20);

        List<Long> daJanela = notificacaoService.listar(null, null, janela, null, null, null, null, null, null, pagina)
                .map(NotificacaoResponse::id).getContent();
        List<Long> doBotao = notificacaoService.listar(null, null, null, sessao, null, null, null, null, null, pagina)
                .map(NotificacaoResponse::id).getContent();
        long semFiltro = notificacaoService.listar(null, null, null, null, null, null, null, null, null, pagina)
                .getTotalElements();

        assertThat(daJanela).containsExactly(nJanela);
        assertThat(doBotao).containsExactly(nManual);
        assertThat(semFiltro).isEqualTo(3);
        assertThat(notificacaoService.listar(null, null, janela + 1000, null, null, null, null, null, null, pagina)
                .getTotalElements()).isZero();
    }

    @Test
    void maisDeUmaAncoraNoFiltroEhRecusadaComAMensagemCombinada() {
        var pagina = PageRequest.of(0, 20);

        assertThatThrownBy(() -> notificacaoService.listar(null, null, janela, sessao, null, null, null, null, null, pagina))
                .isInstanceOf(IllegalArgumentException.class).hasMessage(MSG_ANCORA);
        assertThatThrownBy(() -> notificacaoService.listar(1L, null, janela, null, null, null, null, null, null, pagina))
                .isInstanceOf(IllegalArgumentException.class).hasMessage(MSG_ANCORA);
    }

    @Test
    void historicoTrazAsDuasColunasNovasEIncidenteNuloNaoViraZero() {
        Instant inicio = agora.minus(1, ChronoUnit.HOURS);
        Instant fim = agora.plus(1, ChronoUnit.HOURS);

        List<HistoricoNotificacaoResponse> itens =
                relatorioService.notificacoes(inicio, fim, null, null, null, null, 0, 20, "createdAt,desc").content();

        assertThat(itens).hasSize(3);
        HistoricoNotificacaoResponse daJanela = porId(itens, nJanela);
        HistoricoNotificacaoResponse doBotao = porId(itens, nManual);
        HistoricoNotificacaoResponse deIncidente = porId(itens, nIncidente);
        assertThat(daJanela.manutencaoId()).isEqualTo(janela);
        assertThat(daJanela.manutencaoManualId()).isNull();
        assertThat(daJanela.incidenteId()).isNull();
        assertThat(doBotao.manutencaoManualId()).isEqualTo(sessao);
        assertThat(doBotao.manutencaoId()).isNull();
        assertThat(doBotao.incidenteId()).isNull();
        assertThat(deIncidente.incidenteId()).isNotNull();
        assertThat(deIncidente.manutencaoId()).isNull();
        assertThat(deIncidente.manutencaoManualId()).isNull();
    }

    private static HistoricoNotificacaoResponse porId(List<HistoricoNotificacaoResponse> itens, long id) {
        return itens.stream().filter(i -> i.notificacaoId() == id).findFirst().orElseThrow();
    }

    private long insert(String sql, Object... args) {
        Long id = jdbc.queryForObject(sql, Long.class, args);
        assertThat(id).isNotNull();
        return id;
    }
}
