package br.com.inframonitor.incidente.integration;

import br.com.inframonitor.equipamento.dto.CreateEquipamentoRequest;
import br.com.inframonitor.equipamento.entity.Equipamento;
import br.com.inframonitor.equipamento.repository.EquipamentoRepository;
import br.com.inframonitor.equipamento.service.EquipamentoService;
import br.com.inframonitor.incidente.entity.Incidente;
import br.com.inframonitor.incidente.entity.StatusIncidente;
import br.com.inframonitor.incidente.repository.IncidenteRepository;
import br.com.inframonitor.incidente.service.IncidenteService;
import br.com.inframonitor.monitor.entity.Monitor;
import br.com.inframonitor.monitor.entity.TipoMonitor;
import br.com.inframonitor.monitor.repository.MonitorRepository;
import br.com.inframonitor.testsupport.RequerDocker;
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

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Instant;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Autoria das acoes humanas do incidente atravessando a cadeia real de autenticacao:
 * login de verdade, token de verdade, filtro JWT de verdade.
 *
 * <p>Existe por uma regressao concreta: o controller pedia a entidade {@code Usuario}
 * em {@code @AuthenticationPrincipal}, mas o filtro poe um {@link
 * br.com.inframonitor.security.UsuarioPrincipal} no contexto. O resolvedor injeta null
 * em silencio quando os tipos nao casam, e reconhecer chegava ao banco sem autor —
 * morrendo em ck_incidente_reconhecimento_par e devolvendo 409 a quem clicou. Nenhum
 * teste pegou porque todos mockavam o principal ou o service.
 *
 * <p>Por isso as assercoes olham a coluna, e nao so o corpo da resposta: e a coluna
 * que o CHECK do banco defende.
 */
@RequerDocker
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "app.auth.jwt.secret=test-only-jwt-secret-with-at-least-32-bytes",
        "app.auth.jwt.issuer=infra-monitor-autoria-test",
        "monitoring.engine.enabled=false", "notification.telegram.enabled=false", "notification.dispatcher.enabled=false"
})
class IncidenteAutoriaHttpIntegrationTest {

    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");
    private static final Instant INICIO = Instant.parse("2026-03-01T10:00:00Z");
    private static final String SENHA = "senha-autoria-teste-segura";
    private static final String OPERADOR = "operador@autoria.test";
    private static final Pattern TOKEN = Pattern.compile("\\\"accessToken\\\"\\s*:\\s*\\\"([^\\\"]+)\\\"");

    @DynamicPropertySource static void db(DynamicPropertyRegistry r) {
        POSTGRES.start();
        r.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        r.add("spring.datasource.username", POSTGRES::getUsername);
        r.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @LocalServerPort int port;
    @Autowired JdbcTemplate jdbc;
    @Autowired UnidadeService unidades;
    @Autowired TipoEquipamentoService tipos;
    @Autowired EquipamentoService equipamentoService;
    @Autowired EquipamentoRepository equipamentos;
    @Autowired MonitorRepository monitores;
    @Autowired IncidenteRepository incidentes;
    @Autowired IncidenteService incidenteService;
    @Autowired UsuarioRepository usuarios;
    @Autowired PasswordEncoder encoder;

    private Long operadorId;
    private Monitor monitor;

    @BeforeEach void preparar() {
        jdbc.execute("truncate table janela_monitoramento, medicao, notificacao, monitor_episodio_latencia, "
                + "incidente, monitor, equipamento, tipo_equipamento, unidade, usuarios restart identity cascade");
        Long unidade = unidades.criar(new CreateUnidadeRequest("Unidade Autoria", "AUT", null, null, null, null, null, null, null)).id();
        Long tipo = tipos.criar(new CreateTipoEquipamentoRequest("Tipo Autoria", null)).id();
        Long equipamentoId = equipamentoService.criar(new CreateEquipamentoRequest(unidade, tipo, "Equipamento Autoria",
                null, null, null, null, null, null, null)).id();
        Equipamento equipamento = equipamentos.findById(equipamentoId).orElseThrow();
        monitor = monitores.saveAndFlush(new Monitor(equipamento, TipoMonitor.ICMP, "Monitor Autoria", 60, 1000));
        operadorId = usuarios.saveAndFlush(new Usuario("Operador Autoria", OPERADOR, encoder.encode(SENHA),
                Papel.OPERADOR, false)).getId();
    }

    @Test void reconhecerGravaAutorVindoDoTokenEBloqueiaOSegundoClique() {
        Long incidenteId = incidenteAberto();
        String token = login();

        Resposta resposta = patch("/api/v1/incidentes/" + incidenteId + "/reconhecer", null, token);

        assertThat(resposta.status()).isEqualTo(HttpStatus.OK.value());
        assertThat(resposta.body()).contains("\"status\":\"RECONHECIDO\"", "\"reconhecidoPorNome\":\"Operador Autoria\"");
        assertThat(coluna("status", incidenteId)).isEqualTo(StatusIncidente.RECONHECIDO.name());
        assertThat(coluna("reconhecido_por", incidenteId)).isEqualTo(String.valueOf(operadorId));
        assertThat(coluna("reconhecido_em", incidenteId)).isNotNull();

        // Segundo clique nao e idempotente: 409 de dominio, com codigo de negocio.
        Resposta repetido = patch("/api/v1/incidentes/" + incidenteId + "/reconhecer", null, token);
        assertThat(repetido.status()).isEqualTo(HttpStatus.CONFLICT.value());
        assertThat(repetido.body()).contains("\"code\":\"BUSINESS_CONFLICT\"").doesNotContain("DATA_INTEGRITY_VIOLATION");
    }

    @Test void fecharPelaApiGravaFechadoPorEOMotorMantemNulo() {
        Long manual = incidenteAberto();
        String token = login();

        Resposta resposta = patch("/api/v1/incidentes/" + manual + "/fechar",
                "{\"encerradoEm\":\"" + INICIO.plusSeconds(600) + "\",\"observacao\":\"resolvido em campo\"}", token);

        assertThat(resposta.status()).isEqualTo(HttpStatus.OK.value());
        assertThat(resposta.body()).contains("\"status\":\"FECHADO\"", "\"fechadoPorNome\":\"Operador Autoria\"");
        assertThat(coluna("fechado_por", manual)).isEqualTo(String.valueOf(operadorId));

        // Mesma acao pelo motor: sem autor humano, fechado_por continua nulo (V17).
        Incidente automatico = incidentes.saveAndFlush(new Incidente(monitor, INICIO.plusSeconds(900), "motor", null));
        incidenteService.fecharAutomaticamente(automatico, INICIO.plusSeconds(1200), 2);
        assertThat(coluna("status", automatico.getId())).isEqualTo(StatusIncidente.FECHADO.name());
        assertThat(coluna("fechado_por", automatico.getId())).isNull();
    }

    @Test void semTokenNenhumaDasDuasAcoesChegaAoDominio() {
        Long incidenteId = incidenteAberto();

        assertThat(patch("/api/v1/incidentes/" + incidenteId + "/reconhecer", null, null).status())
                .isEqualTo(HttpStatus.UNAUTHORIZED.value());
        assertThat(patch("/api/v1/incidentes/" + incidenteId + "/fechar",
                "{\"encerradoEm\":\"" + INICIO.plusSeconds(600) + "\"}", null).status())
                .isEqualTo(HttpStatus.UNAUTHORIZED.value());
        assertThat(coluna("status", incidenteId)).isEqualTo(StatusIncidente.ABERTO.name());
    }

    private Long incidenteAberto() {
        return incidentes.saveAndFlush(new Incidente(monitor, INICIO, "Sem resposta ICMP", null)).getId();
    }

    private String coluna(String nome, Long incidenteId) {
        return jdbc.queryForObject("select cast(" + nome + " as varchar) from incidente where id = ?",
                String.class, incidenteId);
    }

    private String login() {
        Resposta r = executar(HttpRequest.newBuilder(URI.create(url("/api/v1/auth/login")))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString("{\"email\":\"" + OPERADOR + "\",\"senha\":\"" + SENHA + "\"}"))
                .build());
        assertThat(r.status()).isEqualTo(HttpStatus.OK.value());
        Matcher m = TOKEN.matcher(r.body());
        assertThat(m.find()).isTrue();
        return m.group(1);
    }

    private Resposta patch(String caminho, String corpo, String token) {
        HttpRequest.Builder request = HttpRequest.newBuilder(URI.create(url(caminho)))
                .method("PATCH", corpo == null ? HttpRequest.BodyPublishers.noBody()
                        : HttpRequest.BodyPublishers.ofString(corpo));
        if (corpo != null) request.header("Content-Type", "application/json");
        if (token != null) request.header("Authorization", "Bearer " + token);
        return executar(request.build());
    }

    private String url(String caminho) {
        return "http://localhost:" + port + caminho;
    }

    private Resposta executar(HttpRequest request) {
        try {
            HttpResponse<String> resposta = HttpClient.newHttpClient().send(request, HttpResponse.BodyHandlers.ofString());
            return new Resposta(resposta.statusCode(), resposta.body());
        } catch (Exception e) {
            throw new AssertionError("Falha na chamada HTTP", e);
        }
    }

    private record Resposta(int status, String body) { }
}
