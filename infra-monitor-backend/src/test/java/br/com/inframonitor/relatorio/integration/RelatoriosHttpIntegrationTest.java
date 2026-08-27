package br.com.inframonitor.relatorio.integration;

import br.com.inframonitor.equipamento.dto.CreateEquipamentoRequest;
import br.com.inframonitor.equipamento.entity.Equipamento;
import br.com.inframonitor.equipamento.repository.EquipamentoRepository;
import br.com.inframonitor.equipamento.service.EquipamentoService;
import br.com.inframonitor.incidente.entity.Incidente;
import br.com.inframonitor.incidente.repository.IncidenteRepository;
import br.com.inframonitor.medicao.entity.Medicao;
import br.com.inframonitor.medicao.entity.StatusMedicao;
import br.com.inframonitor.medicao.repository.MedicaoRepository;
import br.com.inframonitor.monitor.entity.Monitor;
import br.com.inframonitor.monitor.entity.TipoMonitor;
import br.com.inframonitor.monitor.repository.MonitorRepository;
import br.com.inframonitor.notificacao.entity.CanalNotificacao;
import br.com.inframonitor.notificacao.entity.Notificacao;
import br.com.inframonitor.notificacao.entity.TipoEventoNotificacao;
import br.com.inframonitor.notificacao.repository.NotificacaoRepository;
import br.com.inframonitor.relatorio.entity.JanelaMonitoramento;
import br.com.inframonitor.relatorio.entity.OrigemJanelaMonitoramento;
import br.com.inframonitor.relatorio.repository.JanelaMonitoramentoRepository;
import br.com.inframonitor.tipoequipamento.dto.CreateTipoEquipamentoRequest;
import br.com.inframonitor.tipoequipamento.service.TipoEquipamentoService;
import br.com.inframonitor.unidade.dto.CreateUnidadeRequest;
import br.com.inframonitor.unidade.service.UnidadeService;
import br.com.inframonitor.usuario.entity.Papel;
import br.com.inframonitor.usuario.entity.Usuario;
import br.com.inframonitor.usuario.repository.UsuarioRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;

import java.time.Instant;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

/** HTTP contract tests against an embedded web server and an isolated PostgreSQL instance. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "app.auth.jwt.secret=test-only-jwt-secret-with-at-least-32-bytes",
        "app.auth.jwt.issuer=infra-monitor-http-test",
        "monitoring.engine.enabled=false", "notification.telegram.enabled=false", "notification.dispatcher.enabled=false"
})
class RelatoriosHttpIntegrationTest {
    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");
    private static final Instant INICIO = Instant.parse("2026-03-01T10:00:00Z");
    private static final Instant FIM = Instant.parse("2026-03-01T20:00:00Z");
    private static final String SENHA = "senha-http-teste-segura";
    private static final Pattern TOKEN = Pattern.compile("\\\"accessToken\\\"\\s*:\\s*\\\"([^\\\"]+)\\\"");

    @DynamicPropertySource static void db(DynamicPropertyRegistry r) {
        POSTGRES.start(); r.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        r.add("spring.datasource.username", POSTGRES::getUsername); r.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @LocalServerPort int port;
    @Autowired JdbcTemplate jdbc;
    @Autowired UnidadeService unidades;
    @Autowired TipoEquipamentoService tipos;
    @Autowired EquipamentoService equipamentoService;
    @Autowired EquipamentoRepository equipamentos;
    @Autowired MonitorRepository monitores;
    @Autowired JanelaMonitoramentoRepository janelas;
    @Autowired MedicaoRepository medicoes;
    @Autowired IncidenteRepository incidentes;
    @Autowired NotificacaoRepository notificacoes;
    @Autowired UsuarioRepository usuarios;
    @Autowired PasswordEncoder encoder;
    private Long unidadeA, unidadeB, equipamentoA, equipamentoB, monitorA, tipoA, incidenteA;

    @BeforeEach void preparar() {
        jdbc.execute("truncate table janela_monitoramento, medicao, incidente, notificacao, monitor, equipamento, tipo_equipamento, unidade, usuarios restart identity cascade");
        unidadeA = unidades.criar(new CreateUnidadeRequest("Unidade HTTP A", "HA", null, null)).id();
        unidadeB = unidades.criar(new CreateUnidadeRequest("Unidade HTTP B", "HB", null, null)).id();
        tipoA = tipos.criar(new CreateTipoEquipamentoRequest("Tipo HTTP A", null)).id();
        Long tipoB = tipos.criar(new CreateTipoEquipamentoRequest("Tipo HTTP B", null)).id();
        equipamentoA = equipamentoService.criar(new CreateEquipamentoRequest(unidadeA, tipoA, "Equipamento HTTP A", null, null, null, null)).id();
        equipamentoB = equipamentoService.criar(new CreateEquipamentoRequest(unidadeB, tipoB, "Equipamento HTTP B", null, null, null, null)).id();
        Monitor a = monitor(equipamentoA, "Monitor HTTP A"); Monitor b = monitor(equipamentoB, "Monitor HTTP B");
        monitorA = a.getId();
        medicao(a, INICIO.plusSeconds(60), 10); medicao(a, INICIO.plusSeconds(120), 30); medicao(b, INICIO.plusSeconds(60), 80);
        Incidente i = new Incidente(a, INICIO.plusSeconds(180), "incidente http", null); i.fechar(INICIO.plusSeconds(300), null); incidenteA = incidentes.saveAndFlush(i).getId();
        Notificacao notificacao = notificacoes.saveAndFlush(new Notificacao(incidentes.findById(incidenteA).orElseThrow(), CanalNotificacao.TELEGRAM, TipoEventoNotificacao.INCIDENTE_ABERTO, "teste"));
        jdbc.update("update notificacao set created_at=? where id=?", java.sql.Timestamp.from(INICIO.plusSeconds(240)), notificacao.getId());
        usuario("admin@http.test", Papel.ADMIN, false); usuario("operador@http.test", Papel.OPERADOR, false);
        usuario("visualizador@http.test", Papel.VISUALIZADOR, false); usuario("troca@http.test", Papel.VISUALIZADOR, true);
        usuario("inativo@http.test", Papel.VISUALIZADOR, false);
    }

    @Test void seisEndpointsRetornamEnvelopeETiposDeDto() {
        String token = login("admin@http.test");
        verificar200("/disponibilidade/equipamentos", token, "equipamentoId", "estadoAnalitico", "tempoMonitoradoSegundos", "disponibilidadePercentual", "incidentes");
        verificar200("/disponibilidade/unidades", token, "unidadeId", "equipamentosTotal", "equipamentosSemDados", "disponibilidadePercentual", "incidentes");
        verificar200("/incidentes", token, "incidenteId", "duracaoSegundosNoPeriodo");
        verificar200("/medicoes", token, "medicaoId", "executadoEm");
        verificar200("/latencia", token, "minLatenciaMs", "avgLatenciaMs", "maxLatenciaMs", "count", "p95LatenciaMs");
        verificar200("/latencia/unidades", token, "unidadeId", "unidadeNome", "minLatenciaMs", "avgLatenciaMs", "maxLatenciaMs", "count");
        // Contrato do /latencia permanece por monitor: campos de equipamento e monitor continuam presentes.
        assertThat(get("/latencia", token).body()).contains("\"monitorId\"", "\"equipamentoId\"", "\"p95LatenciaMs\"");
        // O agregado por unidade nao expoe nivel de monitor nem p95.
        assertThat(get("/latencia/unidades", token).body()).doesNotContain("\"monitorId\"", "\"equipamentoId\"", "\"p95LatenciaMs\"");
        verificar200("/notificacoes", token, "notificacaoId", "status", "canal", "tipoEvento", "tentativas", "createdAt", "enviadoEm");
        Resposta medicoesDefault = get("/medicoes", token); assertThat(medicoesDefault.body()).contains("\"size\":50");
    }

    @Test void rbacIncluiSemJwtPapeisTrocaObrigatoriaEContaDesativada() {
        assertThat(get("/medicoes", null).status()).isEqualTo(HttpStatus.UNAUTHORIZED.value());
        for (String email : new String[]{"admin@http.test", "operador@http.test", "visualizador@http.test"}) assertThat(get("/medicoes", login(email)).status()).isEqualTo(HttpStatus.OK.value());
        Resposta troca = get("/medicoes", login("troca@http.test"));
        assertThat(troca.status()).isEqualTo(HttpStatus.FORBIDDEN.value()); assertThat(troca.body()).contains("PASSWORD_CHANGE_REQUIRED");
        String tokenAntigo = login("inativo@http.test"); Usuario inativo = usuarios.findByEmailIgnoreCase("inativo@http.test").orElseThrow(); inativo.setAtivo(false); usuarios.saveAndFlush(inativo);
        assertThat(get("/medicoes", tokenAntigo).status()).isEqualTo(HttpStatus.UNAUTHORIZED.value());
    }

    @Test void periodoPaginacaoSortErrosEEnumsRespeitamContrato() {
        String token = login("admin@http.test");
        assertThat(getRaw("/medicoes?fim=" + FIM, token).status()).isEqualTo(HttpStatus.BAD_REQUEST.value());
        assertThat(getRaw("/medicoes?inicio=" + INICIO, token).status()).isEqualTo(HttpStatus.BAD_REQUEST.value());
        assertCode(getRaw("/medicoes?inicio=" + FIM + "&fim=" + INICIO, token), HttpStatus.BAD_REQUEST, "INVALID_REQUEST");
        assertThat(get("/medicoes?inicio=" + INICIO + "&fim=" + INICIO, token).status()).isEqualTo(HttpStatus.OK.value());
        assertCode(getRaw("/medicoes?inicio=" + INICIO + "&fim=" + FIM.plusSeconds(32L * 86400), token), HttpStatus.BAD_REQUEST, "INVALID_REQUEST");
        assertCode(getRaw("/latencia?inicio=" + INICIO + "&fim=" + FIM.plusSeconds(91L * 86400), token), HttpStatus.BAD_REQUEST, "INVALID_REQUEST");
        assertCode(getRaw("/incidentes?inicio=" + INICIO + "&fim=" + FIM.plusSeconds(366L * 86400), token), HttpStatus.BAD_REQUEST, "INVALID_REQUEST");
        assertCode(getRaw("/disponibilidade/equipamentos?inicio=" + INICIO + "&fim=" + FIM.plusSeconds(366L * 86400), token), HttpStatus.BAD_REQUEST, "INVALID_REQUEST");
        assertCode(getRaw("/notificacoes?inicio=" + INICIO + "&fim=" + FIM.plusSeconds(366L * 86400), token), HttpStatus.BAD_REQUEST, "INVALID_REQUEST");
        assertThat(get("/medicoes?size=150", token).body()).contains("\"size\":100");
        assertCode(get("/medicoes?page=-1", token), HttpStatus.BAD_REQUEST, "INVALID_REQUEST"); assertThat(get("/medicoes?size=0", token).status()).isEqualTo(HttpStatus.BAD_REQUEST.value());
        for (String sort : new String[]{"disponibilidadePercentual,asc", "disponibilidadePercentual,desc"}) assertThat(get("/disponibilidade/equipamentos?sort=" + sort, token).status()).isEqualTo(HttpStatus.OK.value());
        assertThat(get("/latencia?sort=avgLatenciaMs,desc", token).status()).isEqualTo(HttpStatus.OK.value());
        assertThat(get("/latencia/unidades?sort=avgLatenciaMs,desc", token).status()).isEqualTo(HttpStatus.OK.value());
        assertThat(get("/latencia/unidades", token).body()).contains("\"size\":20");
        // Sort por campo de monitor nao existe no agregado por unidade.
        for (String sort : new String[]{"monitorNome,asc", "equipamentoNome,asc", "p95LatenciaMs,desc"}) assertCode(get("/latencia/unidades?sort=" + sort, token), HttpStatus.BAD_REQUEST, "INVALID_REQUEST");
        assertThat(get("/notificacoes?sort=createdAt,desc", token).status()).isEqualTo(HttpStatus.OK.value());
        for (String sort : new String[]{"senhaHash,asc", "disponibilidadePercentual,sideways", "nome%20desc%3B%20drop%20table%20usuarios,asc"}) assertCode(get("/medicoes?sort=" + sort, token), HttpStatus.BAD_REQUEST, "INVALID_REQUEST");
        assertThat(get("/medicoes", token).status()).isEqualTo(HttpStatus.OK.value());
        for (String query : new String[]{"status=INVALIDO", "canal=INVALIDO", "tipoEvento=INVALIDO"}) assertCode(get("/notificacoes?" + query, token), HttpStatus.BAD_REQUEST, "INVALID_ENUM");
    }

    @Test void idsHierarquiaEFiltrosSaoValidadosNoHttp() {
        String token = login("admin@http.test");
        for (String query : new String[]{"unidadeId=999999", "equipamentoId=999999", "monitorId=999999", "tipoEquipamentoId=999999"}) assertCode(get("/disponibilidade/equipamentos?" + query, token), HttpStatus.NOT_FOUND, "RESOURCE_NOT_FOUND");
        assertCode(get("/notificacoes?incidenteId=999999", token), HttpStatus.NOT_FOUND, "RESOURCE_NOT_FOUND");
        assertCode(get("/medicoes?unidadeId=" + unidadeA + "&equipamentoId=" + equipamentoB, token), HttpStatus.BAD_REQUEST, "INVALID_REQUEST");
        assertCode(get("/medicoes?equipamentoId=" + equipamentoB + "&monitorId=" + monitorA, token), HttpStatus.BAD_REQUEST, "INVALID_REQUEST");
        assertCode(get("/medicoes?unidadeId=" + unidadeB + "&monitorId=" + monitorA, token), HttpStatus.BAD_REQUEST, "INVALID_REQUEST");
        assertCode(get("/disponibilidade/equipamentos?equipamentoId=" + equipamentoA + "&tipoEquipamentoId=" + (tipoA + 1), token), HttpStatus.BAD_REQUEST, "INVALID_REQUEST");
        assertThat(get("/disponibilidade/equipamentos?unidadeId=" + unidadeA + "&equipamentoId=" + equipamentoA + "&monitorId=" + monitorA + "&tipoEquipamentoId=" + tipoA, token).body()).contains("\"monitorId\":" + monitorA);
        assertThat(get("/disponibilidade/unidades?unidadeId=" + unidadeA, token).body()).contains("\"unidadeId\":" + unidadeA);
        assertThat(get("/incidentes?unidadeId=" + unidadeA + "&equipamentoId=" + equipamentoA + "&monitorId=" + monitorA + "&status=FECHADO", token).body()).contains("\"incidenteId\":" + incidenteA);
        assertThat(get("/medicoes?unidadeId=" + unidadeA + "&equipamentoId=" + equipamentoA + "&monitorId=" + monitorA + "&status=SUCESSO", token).status()).isEqualTo(HttpStatus.OK.value());
        assertThat(get("/latencia?unidadeId=" + unidadeA + "&equipamentoId=" + equipamentoA + "&monitorId=" + monitorA, token).status()).isEqualTo(HttpStatus.OK.value());
        assertThat(get("/notificacoes?incidenteId=" + incidenteA + "&status=PENDENTE&canal=TELEGRAM&tipoEvento=INCIDENTE_ABERTO", token).status()).isEqualTo(HttpStatus.OK.value());
    }

    private void verificar200(String endpoint, String token, String... fields) { Resposta r = get(endpoint, token); assertThat(r.status()).isEqualTo(HttpStatus.OK.value()); assertThat(r.body()).contains("\"content\"", "\"page\"", "\"size\"", "\"totalElements\"", "\"totalPages\"", "\"first\"", "\"last\""); for (String field : fields) assertThat(r.body()).contains("\"" + field + "\""); }
    private Resposta get(String endpoint, String token) { return getRaw(endpoint + (endpoint.contains("?") ? "&" : "?") + "inicio=" + INICIO + "&fim=" + FIM, token); }
    private Resposta getRaw(String endpoint, String token) { HttpRequest.Builder request = HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/v1/relatorios" + endpoint)).GET(); if (token != null) request.header("Authorization", "Bearer " + token); return executar(request.build()); }
    private String login(String email) { Resposta r = executar(HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/v1/auth/login")).header("Content-Type", "application/json").POST(HttpRequest.BodyPublishers.ofString("{\"email\":\"" + email + "\",\"senha\":\"" + SENHA + "\"}")).build()); assertThat(r.status()).isEqualTo(HttpStatus.OK.value()); Matcher m = TOKEN.matcher(r.body()); assertThat(m.find()).isTrue(); return m.group(1); }
    private Resposta executar(HttpRequest request) { try { HttpResponse<String> response = HttpClient.newHttpClient().send(request, HttpResponse.BodyHandlers.ofString()); return new Resposta(response.statusCode(), response.body()); } catch (Exception e) { throw new AssertionError("Falha na chamada HTTP", e); } }
    private void assertCode(Resposta r, HttpStatus status, String code) { assertThat(r.status()).isEqualTo(status.value()); assertThat(r.body()).contains("\"code\":\"" + code + "\""); }
    private void usuario(String email, Papel papel, boolean troca) { usuarios.saveAndFlush(new Usuario(email, email, encoder.encode(SENHA), papel, troca)); }
    private Monitor monitor(Long equipamentoId, String nome) { Equipamento e = equipamentos.findById(equipamentoId).orElseThrow(); Monitor m = monitores.saveAndFlush(new Monitor(e, TipoMonitor.ICMP, nome, 60, 1000)); JanelaMonitoramento j = new JanelaMonitoramento(m, INICIO, OrigemJanelaMonitoramento.PRECISA); j.fechar(FIM); janelas.saveAndFlush(j); return m; }
    private void medicao(Monitor monitor, Instant when, int latency) { medicoes.saveAndFlush(new Medicao(monitor, StatusMedicao.SUCESSO, latency, null, when)); }
    private record Resposta(int status, String body) { }
}
