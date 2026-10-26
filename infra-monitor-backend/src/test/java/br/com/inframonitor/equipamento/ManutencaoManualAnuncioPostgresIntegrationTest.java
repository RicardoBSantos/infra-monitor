package br.com.inframonitor.equipamento;

import br.com.inframonitor.common.exception.RecursoNaoEncontradoException;
import br.com.inframonitor.equipamento.dto.ManutencaoManualResponse;
import br.com.inframonitor.equipamento.repository.SessaoManutencaoManual;
import br.com.inframonitor.equipamento.service.EquipamentoService;
import br.com.inframonitor.equipamento.service.EstadoManutencaoEquipamento;
import br.com.inframonitor.notificacao.service.NotificacaoMessageBuilder;
import br.com.inframonitor.testsupport.RequerDocker;
import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.testcontainers.containers.PostgreSQLContainer;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.reset;

/**
 * Sessao do botao manual (V23): anuncio de inicio e fim no Telegram, autor do encerramento, recusa de
 * exclusao com historico e endpoint de historico. Os textos sao conferidos pelas linhas-chave do desenho
 * (secao 3); a ordem pelos ids da fila.
 *
 * <p>Requer Docker. Sem Docker disponivel o teste e ignorado, nunca falha.
 */
@RequerDocker
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "app.auth.jwt.secret=test-only-jwt-secret-with-at-least-32-bytes",
        "app.auth.jwt.issuer=infra-monitor-manual-anuncio-test",
        "monitoring.engine.enabled=false",
        "notification.telegram.enabled=false",
        "notification.dispatcher.enabled=false"
})
class ManutencaoManualAnuncioPostgresIntegrationTest {

    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");
    private static final String SENHA = "senha-manual-teste-segura";
    private static final Pattern TOKEN = Pattern.compile("\\\"accessToken\\\"\\s*:\\s*\\\"([^\\\"]+)\\\"");
    private static final String RECUSA =
            "Nao e possivel excluir o equipamento porque ele tem historico de manutencao manual";

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        POSTGRES.start();
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @LocalServerPort int port;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private EquipamentoService equipamentoService;
    @Autowired private EstadoManutencaoEquipamento estado;
    @Autowired private PasswordEncoder encoder;
    // Spies so para quebrar o texto (builder) ou a coleta (sessoes) do fim; senao delegam ao bean real.
    @MockitoSpyBean private NotificacaoMessageBuilder builder;
    @MockitoSpyBean private SessaoManutencaoManual sessoesSpy;

    private long ana;
    private long bruno;
    private long tipo;
    private long unidade;
    private long e;
    private long m;

    @BeforeEach
    void montarCenario() {
        reset(builder, sessoesSpy);
        jdbc.execute("truncate table manutencao_agendada_equipamento, manutencao_agendada, janela_monitoramento, "
                + "medicao, notificacao, monitor_episodio_latencia, incidente, monitor, manutencao_manual, "
                + "equipamento, tipo_equipamento, unidade, usuarios restart identity cascade");
        ana = usuario("Ana Operadora", "ana@manual.test");
        bruno = usuario("Bruno Operador", "bruno@manual.test");
        tipo = insert("insert into tipo_equipamento (nome, ativo) values ('Switch', true) returning id");
        unidade = insert("insert into unidade (nome, sigla, ativo) values ('Centro', 'CTR', true) returning id");
        e = insert("insert into equipamento (unidade_id, tipo_equipamento_id, nome, ip_address, ativo, em_manutencao) "
                + "values (?, ?, 'SW-CORE', '10.0.0.10', true, false) returning id", unidade, tipo);
        m = insert("insert into monitor (equipamento_id, tipo, nome, intervalo_segundos, timeout_ms, ativo, "
                + "falhas_para_incidente, sucessos_para_recovery) "
                + "values (?, 'ICMP', 'ICMP CORE', 60, 2000, true, 3, 2) returning id", e);
        insert("insert into janela_monitoramento (monitor_id, inicio_em, origem) values (?, now(), 'PRECISA') "
                + "returning id", m);
    }

    @Test
    void iniciarCriaSessaoENotificacaoAntesDosEncerramentos() {
        long incidente = insert("insert into incidente (monitor_id, status, iniciado_em, motivo) "
                + "values (?, 'ABERTO', now() - interval '5 minutes', 'Indisponibilidade') returning id", m);
        jdbc.update("insert into notificacao (incidente_id, canal, tipo_evento, status, mensagem, enviado_em) "
                + "values (?, 'TELEGRAM', 'INCIDENTE_ABERTO', 'ENVIADA', 'abertura', now())", incidente);

        estado.iniciarManual(e, ana);

        assertThat(sessoes()).hasSize(1);
        assertThat(sessoes().get(0)).containsEntry("iniciada_por_id", ana).containsEntry("encerrada_em", null);
        long manual = idNotificacao("MANUTENCAO_MANUAL_INICIADA");
        long encerramento = idNotificacao("INCIDENTE_ENCERRADO_MANUTENCAO");
        assertThat(manual).isLessThan(encerramento);
        assertThat(mensagem("MANUTENCAO_MANUAL_INICIADA")).contains(
                "🔧 EQUIPAMENTO EM MANUTENÇÃO MANUAL — alertas suspensos",
                "Unidade: Centro", "Equipamento: SW-CORE", "IP: 10.0.0.10", "Iniciada por: Ana Operadora",
                "Sem fim previsto: volta só quando alguém encerrar.");
    }

    @Test
    void iniciarIdempotenteNaoDuplica() {
        estado.iniciarManual(e, ana);
        estado.iniciarManual(e, bruno);

        assertThat(sessoes()).hasSize(1);
        assertThat(sessoes().get(0)).containsEntry("iniciada_por_id", ana);
        assertThat(contar("MANUTENCAO_MANUAL_INICIADA")).isEqualTo(1);
    }

    @Test
    void iniciarDentroDeJanelaCitaJanela() {
        long janela = janelaAtivaDoEquipamento();
        assertThat(estado.reavaliar(e)).isTrue();   // flag efetivo ja true pela reavaliacao

        estado.iniciarManual(e, ana);

        assertThat(mensagem("MANUTENCAO_MANUAL_INICIADA"))
                .contains("Já estava na janela #" + janela, "agora não volta sozinho no fim dela.")
                .doesNotContain("Sem fim previsto");
    }

    @Test
    void encerrarGravaQuemEncerrouEDuracao() {
        estado.iniciarManual(e, ana);
        jdbc.update("update manutencao_manual set iniciada_em = now() - interval '88 minutes'");

        estado.encerrarManual(e, bruno);

        Map<String, Object> sessao = sessoes().get(0);
        assertThat(sessao.get("encerrada_por_id")).isEqualTo(bruno);
        assertThat(sessao.get("encerrada_em")).isNotNull();
        assertThat(mensagem("MANUTENCAO_MANUAL_ENCERRADA")).contains(
                "✅ MANUTENÇÃO MANUAL ENCERRADA — alertas retomados", "Equipamento: SW-CORE",
                "Período: ", "(1h 28m ", "Encerrada por: Bruno Operador");
        assertThat(flags()).containsEntry("manutencao_manual", false).containsEntry("em_manutencao", false);
    }

    @Test
    void encerrarComJanelaAtivaDizQueSegue() {
        estado.iniciarManual(e, ana);
        long janela = janelaAtivaDoEquipamento();

        estado.encerrarManual(e, ana);

        assertThat(mensagem("MANUTENCAO_MANUAL_ENCERRADA"))
                .contains("segue em manutenção pela janela #" + janela + " até ")
                .doesNotContain("alertas retomados");
        assertThat(flags()).containsEntry("em_manutencao", true).containsEntry("manutencao_manual", false);
    }

    /**
     * MA31, correcao de 2026-10-26: texto do fim quebrado nao pode desfazer o encerramento (o equipamento
     * ficaria em manutencao com os alertas suprimidos). O fim entra com o texto de reserva, o inicio
     * pendente e cancelado e o ERROR fica no log.
     */
    @Test
    void encerrarManualComTextoQuebradoUsaReserva() {
        estado.iniciarManual(e, ana);
        doThrow(new IllegalStateException("texto quebrado")).when(builder)
                .construirManualEncerrada(any(), any(), any(), anyBoolean(), any(), any());

        List<ILoggingEvent> erros = capturarErros(() -> estado.encerrarManual(e, bruno));

        assertThat(flags()).containsEntry("manutencao_manual", false).containsEntry("em_manutencao", false);
        assertThat(sessoes().get(0).get("encerrada_por_id")).isEqualTo(bruno);
        assertThat(contar("MANUTENCAO_MANUAL_ENCERRADA")).isEqualTo(1);
        assertThat(mensagem("MANUTENCAO_MANUAL_ENCERRADA")).isEqualTo(reserva("SW-CORE"));
        assertThat(statusDe("MANUTENCAO_MANUAL_INICIADA")).isEqualTo("CANCELADA");
        assertThat(erros).anySatisfy(ev -> {
            assertThat(ev.getFormattedMessage()).contains("reserva");
            assertThat(ev.getThrowableProxy()).isNotNull();
        });
    }

    /** Coleta quebrada antes do nome: o equipamento aparece pelo id. */
    @Test
    void encerrarManualComColetaQuebradaUsaReservaComId() {
        estado.iniciarManual(e, ana);
        doThrow(new IllegalStateException("coleta quebrada")).when(sessoesSpy).dados(anyLong());

        List<ILoggingEvent> erros = capturarErros(() -> estado.encerrarManual(e, bruno));

        assertThat(flags()).containsEntry("manutencao_manual", false).containsEntry("em_manutencao", false);
        assertThat(mensagem("MANUTENCAO_MANUAL_ENCERRADA")).isEqualTo(reserva("#" + e));
        assertThat(statusDe("MANUTENCAO_MANUAL_INICIADA")).isEqualTo("CANCELADA");
        assertThat(erros).anySatisfy(ev -> assertThat(ev.getFormattedMessage()).contains("equipamento " + e)
                .contains("reserva"));
    }

    @Test
    void encerrarSemSessaoAbertaNaoNotifica() {
        jdbc.update("update equipamento set manutencao_manual = true, em_manutencao = true where id = ?", e);

        estado.encerrarManual(e, ana);

        assertThat(flags()).containsEntry("manutencao_manual", false);
        assertThat(contar("MANUTENCAO_MANUAL_ENCERRADA")).isZero();
        assertThat(sessoes()).isEmpty();
    }

    @Test
    void encerrarLegadoSemInicio() {
        jdbc.update("update equipamento set manutencao_manual = true, em_manutencao = true where id = ?", e);
        jdbc.update("insert into manutencao_manual (equipamento_id) values (?)", e);

        estado.encerrarManual(e, bruno);

        Map<String, Object> sessao = sessoes().get(0);
        assertThat(sessao.get("iniciada_em")).isNull();
        assertThat(sessao.get("encerrada_por_id")).isEqualTo(bruno);
        assertThat(mensagem("MANUTENCAO_MANUAL_ENCERRADA"))
                .contains("Período: início não registrado (anterior ao histórico) → ", "Encerrada por: Bruno Operador");
    }

    @Test
    void excluirComHistoricoManualRecusaComMensagem() {
        long semMonitor = insert("insert into equipamento (unidade_id, tipo_equipamento_id, nome, ativo) "
                + "values (?, ?, 'SW-LIVRE', true) returning id", unidade, tipo);
        estado.iniciarManual(semMonitor, ana);
        estado.encerrarManual(semMonitor, ana);

        Resposta r = http("DELETE", "/api/v1/equipamentos/" + semMonitor, login("ana@manual.test"));

        assertThat(r.status()).isEqualTo(HttpStatus.CONFLICT.value());
        assertThat(r.body()).contains(RECUSA);
        assertThat(jdbc.queryForObject("select count(*) from equipamento where id = ?", Integer.class, semMonitor))
                .isEqualTo(1);
    }

    @Test
    void historicoPaginadoMaisRecentePrimeiro() {
        for (int i = 0; i < 3; i++) {
            Instant ini = Instant.now().minus(10 - i * 3, ChronoUnit.HOURS);
            jdbc.update("insert into manutencao_manual (equipamento_id, iniciada_em, iniciada_por_id, encerrada_em, "
                    + "encerrada_por_id) values (?, ?, ?, ?, ?)", e, Timestamp.from(ini), ana,
                    Timestamp.from(ini.plus(90, ChronoUnit.MINUTES)), bruno);
        }
        jdbc.update("update manutencao_manual set iniciada_em = null, iniciada_por_id = null where id = 1");

        var pagina = equipamentoService.historicoManutencaoManual(e, PageRequest.of(0, 2));

        assertThat(pagina.getTotalElements()).isEqualTo(3);
        assertThat(pagina.getContent()).extracting(ManutencaoManualResponse::id).containsExactly(3L, 2L);
        ManutencaoManualResponse topo = pagina.getContent().get(0);
        assertThat(topo.iniciadaPor().nome()).isEqualTo("Ana Operadora");
        assertThat(topo.encerradaPor().nome()).isEqualTo("Bruno Operador");
        assertThat(topo.duracaoSegundos()).isEqualTo(5400L);
        ManutencaoManualResponse legado = equipamentoService.historicoManutencaoManual(e, PageRequest.of(1, 2))
                .getContent().get(0);
        assertThat(legado.id()).isEqualTo(1L);
        assertThat(legado.iniciadaEm()).isNull();
        assertThat(legado.iniciadaPor()).isNull();
        assertThat(legado.duracaoSegundos()).isNull();

        Resposta http = http("GET", "/api/v1/equipamentos/" + e + "/manutencoes-manuais?page=0&size=500",
                login("ana@manual.test"));
        assertThat(http.status()).isEqualTo(HttpStatus.OK.value());
        assertThat(http.body()).contains("\"size\":50", "\"totalElements\":3");
    }

    @Test
    void historicoEquipamentoInexistente404() {
        assertThatThrownBy(() -> equipamentoService.historicoManutencaoManual(9999L, PageRequest.of(0, 5)))
                .isInstanceOf(RecursoNaoEncontradoException.class);
        assertThat(http("GET", "/api/v1/equipamentos/9999/manutencoes-manuais", login("ana@manual.test")).status())
                .isEqualTo(HttpStatus.NOT_FOUND.value());
    }

    @Test
    void encerrarUsaPrincipal() {
        String token = login("bruno@manual.test");
        assertThat(http("PATCH", "/api/v1/equipamentos/" + e + "/manutencao/iniciar", token).status()).isEqualTo(200);

        Resposta r = http("PATCH", "/api/v1/equipamentos/" + e + "/manutencao/encerrar", token);

        assertThat(r.status()).isEqualTo(HttpStatus.OK.value());
        Map<String, Object> sessao = sessoes().get(0);
        assertThat(sessao.get("iniciada_por_id")).isEqualTo(bruno);
        assertThat(sessao.get("encerrada_por_id")).isEqualTo(bruno);
        assertThat(mensagem("MANUTENCAO_MANUAL_ENCERRADA")).contains("Encerrada por: Bruno Operador");
    }

    // ---------------------------------------------------------------------------

    private long janelaAtivaDoEquipamento() {
        long id = insert("insert into manutencao_agendada (unidade_id, escopo, inicio_previsto, fim_previsto, motivo, "
                + "status, criado_por_id, ativada_em) values (?, 'EQUIPAMENTOS', now() - interval '10 minutes', "
                + "now() + interval '1 hour', 'Troca do switch', 'ATIVA', ?, now() - interval '10 minutes') returning id",
                unidade, ana);
        jdbc.update("insert into manutencao_agendada_equipamento values (?, ?)", id, e);
        return id;
    }

    private long usuario(String nome, String email) {
        return insert("insert into usuarios (nome, email, senha_hash, papel, ativo, troca_senha_obrigatoria) "
                + "values (?, ?, ?, 'OPERADOR', true, false) returning id", nome, email, encoder.encode(SENHA));
    }

    private List<Map<String, Object>> sessoes() {
        return jdbc.queryForList("select * from manutencao_manual order by id");
    }

    private Map<String, Object> flags() {
        return jdbc.queryForMap("select em_manutencao, manutencao_manual from equipamento where id = ?", e);
    }

    private long idNotificacao(String tipoEvento) {
        return jdbc.queryForObject("select id from notificacao where tipo_evento = ?", Long.class, tipoEvento);
    }

    private int contar(String tipoEvento) {
        return jdbc.queryForObject("select count(*) from notificacao where tipo_evento = ?", Integer.class, tipoEvento);
    }

    private String mensagem(String tipoEvento) {
        return jdbc.queryForObject("select mensagem from notificacao where tipo_evento = ?", String.class, tipoEvento);
    }

    private String statusDe(String tipoEvento) {
        return jdbc.queryForObject("select status from notificacao where tipo_evento = ?", String.class, tipoEvento);
    }

    /** Rodape no fuso padrao (America/Sao_Paulo, sem horario de verao): sempre UTC-03:00. */
    private static String reserva(String equipamento) {
        return """
                ✅ MANUTENÇÃO MANUAL ENCERRADA — alertas retomados

                Equipamento: %s
                Detalhes indisponíveis: falha ao montar a mensagem (ver o sistema).
                Horários: UTC-03:00 (America/Sao_Paulo)""".formatted(equipamento);
    }

    private List<ILoggingEvent> capturarErros(Runnable acao) {
        Logger logger = (Logger) LoggerFactory.getLogger("br.com.inframonitor");
        ListAppender<ILoggingEvent> registros = new ListAppender<>();
        registros.start();
        logger.addAppender(registros);
        try {
            acao.run();
        } finally {
            logger.detachAppender(registros);
        }
        return registros.list.stream().filter(ev -> ev.getLevel() == Level.ERROR).toList();
    }

    private long insert(String sql, Object... args) {
        return jdbc.queryForObject(sql, Long.class, args);
    }

    private String login(String email) {
        Resposta r = executar(HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/v1/auth/login"))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString("{\"email\":\"" + email + "\",\"senha\":\"" + SENHA + "\"}"))
                .build());
        assertThat(r.status()).isEqualTo(HttpStatus.OK.value());
        Matcher matcher = TOKEN.matcher(r.body());
        assertThat(matcher.find()).isTrue();
        return matcher.group(1);
    }

    private Resposta http(String metodo, String caminho, String token) {
        return executar(HttpRequest.newBuilder(URI.create("http://localhost:" + port + caminho))
                .method(metodo, HttpRequest.BodyPublishers.noBody())
                .header("Authorization", "Bearer " + token).build());
    }

    private Resposta executar(HttpRequest request) {
        try {
            HttpResponse<String> resposta = HttpClient.newHttpClient().send(request, HttpResponse.BodyHandlers.ofString());
            return new Resposta(resposta.statusCode(), resposta.body());
        } catch (Exception ex) {
            throw new AssertionError("Falha na chamada HTTP", ex);
        }
    }

    private record Resposta(int status, String body) { }
}
