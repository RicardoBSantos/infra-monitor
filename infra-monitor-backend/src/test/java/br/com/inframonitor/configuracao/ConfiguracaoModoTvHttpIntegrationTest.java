package br.com.inframonitor.configuracao;

import br.com.inframonitor.testsupport.LimpezaBanco;
import br.com.inframonitor.testsupport.RequerDocker;
import br.com.inframonitor.usuario.entity.Papel;
import br.com.inframonitor.usuario.entity.Usuario;
import br.com.inframonitor.usuario.repository.UsuarioRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * GET/PUT de /api/v1/configuracoes/modo-tv por HTTP real, com login real.
 *
 * <p>Requer Docker. Sem Docker disponivel o teste e ignorado, nunca falha.
 */
@RequerDocker
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "app.auth.jwt.secret=test-only-jwt-secret-with-at-least-32-bytes",
        "app.auth.jwt.issuer=infra-monitor-modo-tv-http-test",
        "monitoring.engine.enabled=false", "notification.telegram.enabled=false",
        "notification.dispatcher.enabled=false", "manutencao.agendada.enabled=false"
})
class ConfiguracaoModoTvHttpIntegrationTest {

    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");
    private static final String SENHA = "senha-modo-tv-http-segura";
    private static final String URL = "/api/v1/configuracoes/modo-tv";
    private static final ObjectMapper JSON = new ObjectMapper();

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

    private String admin;
    private String operador;
    private String visualizador;

    @BeforeEach
    void preparar() {
        LimpezaBanco.limpar(jdbc);
        usuario("admin@modo-tv.test", Papel.ADMIN);
        usuario("operador@modo-tv.test", Papel.OPERADOR);
        usuario("visualizador@modo-tv.test", Papel.VISUALIZADOR);
        admin = login("admin@modo-tv.test");
        operador = login("operador@modo-tv.test");
        visualizador = login("visualizador@modo-tv.test");
    }

    /** O teste de tabela ausente derruba as tabelas; recria pelo SQL da propria V27 para os demais. */
    @AfterEach
    void recriarTabelas() throws IOException {
        Integer existe = jdbc.queryForObject("select count(*) from pg_tables where tablename = 'configuracao_modo_tv'", Integer.class);
        if (existe != null && existe == 0) {
            String sql = new ClassPathResource("db/migration/V27__create_configuracao_modo_tv.sql")
                    .getContentAsString(StandardCharsets.UTF_8);
            jdbc.execute(sql);
        }
    }

    @Test
    void getSemLinhaDevolvePadroes() {
        Resposta r = chamar("GET", visualizador, null);
        assertThat(r.status()).isEqualTo(200);
        JsonNode j = r.json();
        assertThat(j.get("persistida").asBoolean()).isFalse();
        assertThat(j.get("ativo").asBoolean()).isTrue();
        assertThat(j.get("intervaloAtualizacaoSegundos").asInt()).isEqualTo(60);
        assertThat(j.get("atualizadoEm").isNull()).isTrue();
        assertThat(telas(j)).containsExactly("MAPA:1:60", "PAINEL:2:60", "INCIDENTES:3:60", "RELATORIOS:4:60");
    }

    @Test
    void operadorEVisualizadorNaoEscrevem() {
        assertThat(chamar("PUT", operador, "{\"ativo\":false}").status()).isEqualTo(403);
        assertThat(chamar("PUT", visualizador, "{\"ativo\":false}").status()).isEqualTo(403);
        assertThat(jdbc.queryForObject("select count(*) from configuracao_modo_tv", Integer.class)).isZero();
    }

    @Test
    void primeiroPutAplicaSobrePadroes() {
        Resposta r = chamar("PUT", admin, "{\"intervaloAtualizacaoSegundos\":120}");
        assertThat(r.status()).isEqualTo(200);
        JsonNode j = r.json();
        assertThat(j.get("persistida").asBoolean()).isTrue();
        assertThat(j.get("intervaloAtualizacaoSegundos").asInt()).isEqualTo(120);
        assertThat(j.get("ativo").asBoolean()).isTrue();
        assertThat(j.get("atualizadoEm").isNull()).isFalse();
        assertThat(telas(j)).containsExactly("MAPA:1:60", "PAINEL:2:60", "INCIDENTES:3:60", "RELATORIOS:4:60");
        assertThat(jdbc.queryForObject("select count(*) from configuracao_modo_tv", Integer.class)).isEqualTo(1);
        assertThat(jdbc.queryForObject("select atualizado_por from configuracao_modo_tv", Long.class)).isNotNull();
    }

    @Test
    void putVazioPreservaTudo() {
        chamar("PUT", admin, "{\"ativo\":false,\"intervaloAtualizacaoSegundos\":90,\"telas\":["
                + "{\"tela\":\"RELATORIOS\",\"duracaoSegundos\":30},{\"tela\":\"MAPA\",\"duracaoSegundos\":45}]}");
        JsonNode antes = chamar("GET", visualizador, null).json();
        assertThat(antes.get("ativo").asBoolean()).isFalse();
        assertThat(antes.get("intervaloAtualizacaoSegundos").asInt()).isEqualTo(90);
        assertThat(telas(antes)).containsExactly("RELATORIOS:1:30", "MAPA:2:45");

        for (String corpo : List.of("{}", "{\"ativo\":null,\"telas\":null,\"intervaloAtualizacaoSegundos\":null}")) {
            Resposta r = chamar("PUT", admin, corpo);
            assertThat(r.status()).as(corpo).isEqualTo(200);
            JsonNode depois = r.json();
            assertThat(depois.get("ativo").asBoolean()).as(corpo).isFalse();
            assertThat(depois.get("intervaloAtualizacaoSegundos").asInt()).as(corpo).isEqualTo(90);
            assertThat(telas(depois)).as(corpo).containsExactly("RELATORIOS:1:30", "MAPA:2:45");
            assertThat(depois.get("persistida").asBoolean()).isTrue();
        }
    }

    @Test
    void putAtivoNaoMexeNasTelas() {
        chamar("PUT", admin, "{\"ativo\":false,\"telas\":["
                + "{\"tela\":\"RELATORIOS\",\"duracaoSegundos\":30},{\"tela\":\"MAPA\",\"duracaoSegundos\":45}]}");
        Resposta r = chamar("PUT", admin, "{\"ativo\":true}");
        assertThat(r.status()).isEqualTo(200);
        assertThat(r.json().get("ativo").asBoolean()).isTrue();
        assertThat(telas(r.json())).containsExactly("RELATORIOS:1:30", "MAPA:2:45");
    }

    @Test
    void telasSubstituemLista() {
        Resposta r = chamar("PUT", admin, "{\"telas\":[{\"tela\":\"PAINEL\",\"duracaoSegundos\":20}]}");
        assertThat(r.status()).isEqualTo(200);
        assertThat(telas(r.json())).containsExactly("PAINEL:1:20");
        assertThat(telas(chamar("GET", visualizador, null).json())).containsExactly("PAINEL:1:20");
    }

    @Test
    void validacao() {
        Resposta vazia = chamar("PUT", admin, "{\"telas\":[]}");
        assertThat(vazia.status()).isEqualTo(400);
        assertThat(vazia.json().get("code").asString()).isEqualTo("VALIDATION_ERROR");

        Resposta duplicada = chamar("PUT", admin, "{\"telas\":[{\"tela\":\"MAPA\",\"duracaoSegundos\":20},"
                + "{\"tela\":\"MAPA\",\"duracaoSegundos\":30}]}");
        assertThat(duplicada.status()).isEqualTo(400);
        assertThat(duplicada.json().get("code").asString()).isEqualTo("VALIDATION_ERROR");
        assertThat(duplicada.json().get("fields").has("telasSemDuplicata")).isTrue();

        Resposta curta = chamar("PUT", admin, "{\"telas\":[{\"tela\":\"MAPA\",\"duracaoSegundos\":5}]}");
        assertThat(curta.status()).isEqualTo(400);
        assertThat(curta.json().get("code").asString()).isEqualTo("VALIDATION_ERROR");

        Resposta intervalo = chamar("PUT", admin, "{\"intervaloAtualizacaoSegundos\":10}");
        assertThat(intervalo.status()).isEqualTo(400);
        assertThat(intervalo.json().get("code").asString()).isEqualTo("VALIDATION_ERROR");

        Resposta invalida = chamar("PUT", admin, "{\"telas\":[{\"tela\":\"XPTO\",\"duracaoSegundos\":20}]}");
        assertThat(invalida.status()).isEqualTo(400);
        assertThat(invalida.json().get("code").asString()).isEqualTo("INVALID_ENUM");

        Resposta elementoNulo = chamar("PUT", admin, "{\"telas\":[null]}");
        assertThat(elementoNulo.status()).isEqualTo(400);
        assertThat(elementoNulo.json().get("code").asString()).isEqualTo("VALIDATION_ERROR");

        assertThat(jdbc.queryForObject("select count(*) from configuracao_modo_tv", Integer.class)).isZero();
    }

    @Test
    void semTabelaGetPadroesPutIndisponivel() {
        jdbc.execute("drop table configuracao_modo_tv_tela, configuracao_modo_tv");

        Resposta get = chamar("GET", visualizador, null);
        assertThat(get.status()).isEqualTo(200);
        assertThat(get.json().get("persistida").asBoolean()).isFalse();
        assertThat(telas(get.json())).containsExactly("MAPA:1:60", "PAINEL:2:60", "INCIDENTES:3:60", "RELATORIOS:4:60");

        Resposta put = chamar("PUT", admin, "{\"ativo\":false}");
        assertThat(put.status()).isEqualTo(503);
        assertThat(put.json().get("status").asInt()).isEqualTo(503);
        assertThat(put.json().get("code").asString()).isEqualTo("CONFIGURATION_UNAVAILABLE");
        assertThat(put.json().get("path").asString()).isEqualTo(URL);
    }

    private static List<String> telas(JsonNode j) {
        List<String> r = new ArrayList<>();
        j.get("telas").forEach(t -> r.add(t.get("tela").asString() + ":" + t.get("ordem").asInt() + ":" + t.get("duracaoSegundos").asInt()));
        return r;
    }

    private void usuario(String email, Papel papel) {
        usuarios.saveAndFlush(new Usuario(email, email, encoder.encode(SENHA), papel, false));
    }

    private String login(String email) {
        Resposta r = executar(HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/v1/auth/login"))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString("{\"email\":\"" + email + "\",\"senha\":\"" + SENHA + "\"}")).build());
        assertThat(r.status()).isEqualTo(200);
        return r.json().get("accessToken").asString();
    }

    private Resposta chamar(String metodo, String bearer, String corpo) {
        return executar(HttpRequest.newBuilder(URI.create("http://localhost:" + port + URL))
                .method(metodo, corpo == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(corpo))
                .header("Content-Type", "application/json").header("Authorization", "Bearer " + bearer).build());
    }

    private Resposta executar(HttpRequest request) {
        try {
            HttpResponse<String> response = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build()
                    .send(request, HttpResponse.BodyHandlers.ofString());
            return new Resposta(response.statusCode(), response.body());
        } catch (Exception e) {
            throw new AssertionError("Falha na chamada HTTP", e);
        }
    }

    private record Resposta(int status, String body) {
        JsonNode json() {
            return JSON.readTree(body);
        }
    }
}
