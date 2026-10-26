package br.com.inframonitor.manutencao;

import br.com.inframonitor.testsupport.RequerDocker;
import br.com.inframonitor.usuario.entity.Papel;
import br.com.inframonitor.usuario.entity.Usuario;
import br.com.inframonitor.usuario.repository.UsuarioRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Papeis em /api/v1/manutencoes (P-09) e contrato JSON consumido pelo front, por HTTP com JWT
 * real. O agendador fica desligado (padrao): o POST do OPERADOR passa da seguranca e para no
 * 409 do servico, o que prova que nao foi barrado com 403.
 *
 * <p>Requer Docker. Sem Docker disponivel o teste e ignorado, nunca falha.
 */
@RequerDocker
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "app.auth.jwt.secret=test-only-jwt-secret-with-at-least-32-bytes",
        "app.auth.jwt.issuer=infra-monitor-http-test",
        "monitoring.engine.enabled=false", "notification.telegram.enabled=false",
        "notification.dispatcher.enabled=false", "manutencao.agendada.enabled=false"
})
class ManutencaoAgendadaHttpSecurityIntegrationTest {

    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");
    private static final String SENHA = "senha-http-teste-segura";
    private static final Pattern TOKEN = Pattern.compile("\"accessToken\"\\s*:\\s*\"([^\"]+)\"");

    @DynamicPropertySource
    static void db(DynamicPropertyRegistry r) {
        POSTGRES.start();
        r.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        r.add("spring.datasource.username", POSTGRES::getUsername);
        r.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @LocalServerPort int port;
    @Autowired JdbcTemplate jdbc;
    @Autowired UsuarioRepository usuarios;
    @Autowired PasswordEncoder encoder;

    private long unidadeId;
    private long janelaId;

    @BeforeEach
    void preparar() {
        jdbc.execute("truncate table manutencao_agendada_alteracao, manutencao_agendada_equipamento, manutencao_agendada, equipamento, "
                + "tipo_equipamento, unidade, usuarios restart identity cascade");
        usuario("admin@manut.test", Papel.ADMIN);
        long operador = usuario("operador@manut.test", Papel.OPERADOR);
        usuario("visualizador@manut.test", Papel.VISUALIZADOR);
        unidadeId = jdbc.queryForObject("insert into unidade (nome, sigla, ativo) values ('Centro', 'CTR', true) "
                + "returning id", Long.class);
        Instant inicio = Instant.now().plus(Duration.ofDays(1));
        janelaId = jdbc.queryForObject("insert into manutencao_agendada (unidade_id, escopo, inicio_previsto, "
                + "fim_previsto, motivo, criado_por_id) values (?, 'UNIDADE', ?, ?, 'Troca de nobreak', ?) "
                + "returning id", Long.class, unidadeId, Timestamp.from(inicio),
                Timestamp.from(inicio.plus(Duration.ofHours(1))), operador);
    }

    @Test
    void semTokenDevolve401() {
        assertThat(chamar("GET", "", null, null).status()).isEqualTo(401);
        assertThat(chamar("POST", "", null, corpo()).status()).isEqualTo(401);
    }

    @Test
    void visualizadorLeMasNaoEscreve() {
        String token = login("visualizador@manut.test");

        Resposta lista = chamar("GET", "?situacao=VIGENTES", token, null);
        assertThat(lista.status()).isEqualTo(200);
        assertThat(lista.body()).contains("\"id\":" + janelaId, "\"unidade\":{\"id\":" + unidadeId + ",\"nome\":\"Centro\"}",
                "\"escopo\":\"UNIDADE\"", "\"equipamentos\":[]", "\"inicioPrevisto\"", "\"fimPrevisto\"",
                "\"motivo\":\"Troca de nobreak\"", "\"situacao\":\"AGENDADA\"", "\"criadoPor\":{\"id\":",
                "\"ativadaEm\":null", "\"encerradaEm\":null", "\"encerradaPor\":null", "\"canceladaEm\":null",
                "\"canceladaPor\":null", "\"sobreposicoes\":[]", "\"totalElements\":1");
        assertThat(chamar("GET", "/parametros", token, null).body())
                .contains("\"agendadorLigado\":false", "\"duracaoMaximaHoras\":72");

        assertThat(chamar("POST", "", token, corpo()).status()).isEqualTo(403);
        assertThat(chamar("PATCH", "/" + janelaId + "/cancelar", token, null).status()).isEqualTo(403);
        assertThat(chamar("PATCH", "/" + janelaId + "/encerrar", token, null).status()).isEqualTo(403);
    }

    @Test
    void operadorPassaDaSegurancaECaiNoServico() {
        String token = login("operador@manut.test");

        Resposta criar = chamar("POST", "", token, corpo());
        assertThat(criar.status()).isEqualTo(409);
        assertThat(criar.body()).contains("\"code\":\"BUSINESS_CONFLICT\"", "MANUTENCAO_AGENDADA_ENABLED=true");

        Resposta cancelar = chamar("PATCH", "/" + janelaId + "/cancelar", token, null);
        assertThat(cancelar.status()).isEqualTo(200);
        assertThat(cancelar.body()).contains("\"situacao\":\"CANCELADA\"", "\"canceladaPor\":{\"id\":");

        assertThat(chamar("PATCH", "/" + janelaId + "/encerrar", token, null).status()).isEqualTo(409);
        assertThat(chamar("PATCH", "/9999/cancelar", token, null).status()).isEqualTo(404);
    }

    @Test
    void adminListaHistoricoERecusaSituacaoInvalida() {
        String token = login("admin@manut.test");

        assertThat(chamar("GET", "?situacao=HISTORICO", token, null).body()).contains("\"totalElements\":0");
        assertThat(chamar("GET", "?situacao=ATIVA", token, null).status()).isEqualTo(400);
        assertThat(chamar("GET", "?busca=nobreak", token, null).body()).contains("\"totalElements\":1");
    }

    @Test
    void corpoInvalidoDevolve400() {
        String token = login("admin@manut.test");
        String semMotivo = "{\"unidadeId\":" + unidadeId + ",\"escopo\":\"UNIDADE\",\"equipamentoIds\":[],"
                + "\"inicioPrevisto\":\"2030-01-01T10:00:00Z\",\"fimPrevisto\":\"2030-01-01T11:00:00Z\",\"motivo\":\" \"}";
        assertThat(chamar("POST", "", token, semMotivo).status()).isEqualTo(400);
    }

    @Test
    void visualizadorNaoEditaNemAlteraFimMasLePorIdEPorUnidade() {
        String token = login("visualizador@manut.test");
        assertThat(chamar("PUT", "/" + janelaId, token, corpoEdicao("Novo", 0)).status()).isEqualTo(403);
        assertThat(chamar("PATCH", "/" + janelaId + "/fim", token, corpoFim(0)).status()).isEqualTo(403);
        Resposta porId = chamar("GET", "/" + janelaId, token, null);
        assertThat(porId.status()).isEqualTo(200);
        assertThat(porId.body()).contains("\"versao\":0", "\"ultimaAlteracao\":null");
        assertThat(chamar("GET", "?unidadeId=" + unidadeId, token, null).body()).contains("\"totalElements\":1");
        assertThat(chamar("GET", "?unidadeId=" + (unidadeId + 1000), token, null).body()).contains("\"totalElements\":0");
    }

    /** MA25 por HTTP: PUT passa (agendador desligado) e registra; PATCH de fim e recusado com o 409 do MA16. */
    @Test
    void operadorEditaComAgendadorDesligadoMasNaoAlteraFim() {
        String token = login("operador@manut.test");
        Resposta put = chamar("PUT", "/" + janelaId, token, corpoEdicao("Troca de nobreak e UPS", 0));
        assertThat(put.status()).isEqualTo(200);
        assertThat(put.body()).contains("\"motivo\":\"Troca de nobreak e UPS\"", "\"versao\":1",
                "\"ultimaAlteracao\":{\"tipo\":\"EDICAO\"", "\"situacao\":\"AGENDADA\"");
        assertThat(chamar("PUT", "/" + janelaId, token, corpoEdicao("De novo", 0)).status()).isEqualTo(409);
        Resposta fim = chamar("PATCH", "/" + janelaId + "/fim", token, corpoFim(1));
        assertThat(fim.status()).isEqualTo(409);
        assertThat(fim.body()).contains("MANUTENCAO_AGENDADA_ENABLED=true");
        assertThat(chamar("GET", "/9999", token, null).status()).isEqualTo(404);
    }

    private String corpoEdicao(String motivo, int versao) {
        Instant inicio = Instant.now().plus(Duration.ofDays(1));
        return "{\"unidadeId\":" + unidadeId + ",\"escopo\":\"UNIDADE\",\"equipamentoIds\":[],"
                + "\"inicioPrevisto\":\"" + inicio + "\",\"fimPrevisto\":\"" + inicio.plus(Duration.ofHours(1))
                + "\",\"motivo\":\"" + motivo + "\",\"versao\":" + versao + "}";
    }

    private String corpoFim(int versao) {
        return "{\"fimPrevisto\":\"" + Instant.now().plus(Duration.ofDays(2)) + "\",\"versao\":" + versao + "}";
    }

    private String corpo() {
        Instant inicio = Instant.now().plus(Duration.ofHours(1));
        return "{\"unidadeId\":" + unidadeId + ",\"escopo\":\"UNIDADE\",\"equipamentoIds\":[],"
                + "\"inicioPrevisto\":\"" + inicio + "\",\"fimPrevisto\":\"" + inicio.plus(Duration.ofHours(1))
                + "\",\"motivo\":\"Troca de nobreak\"}";
    }

    private Resposta chamar(String metodo, String caminho, String token, String corpo) {
        HttpRequest.Builder request = HttpRequest.newBuilder(
                        URI.create("http://localhost:" + port + "/api/v1/manutencoes" + caminho))
                .method(metodo, corpo == null ? HttpRequest.BodyPublishers.noBody()
                        : HttpRequest.BodyPublishers.ofString(corpo))
                .header("Content-Type", "application/json");
        if (token != null) request.header("Authorization", "Bearer " + token);
        return executar(request.build());
    }

    private String login(String email) {
        Resposta r = executar(HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/v1/auth/login"))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString("{\"email\":\"" + email + "\",\"senha\":\"" + SENHA + "\"}"))
                .build());
        assertThat(r.status()).isEqualTo(200);
        Matcher m = TOKEN.matcher(r.body());
        assertThat(m.find()).isTrue();
        return m.group(1);
    }

    private Resposta executar(HttpRequest request) {
        try {
            HttpResponse<String> response = HttpClient.newHttpClient().send(request, HttpResponse.BodyHandlers.ofString());
            return new Resposta(response.statusCode(), response.body());
        } catch (Exception e) {
            throw new AssertionError("Falha na chamada HTTP", e);
        }
    }

    private long usuario(String email, Papel papel) {
        return usuarios.saveAndFlush(new Usuario(email, email, encoder.encode(SENHA), papel, false)).getId();
    }

    private record Resposta(int status, String body) { }
}
