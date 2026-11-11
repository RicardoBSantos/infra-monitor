package br.com.inframonitor.auth;

import br.com.inframonitor.testsupport.LimpezaBanco;
import br.com.inframonitor.testsupport.RequerDocker;
import br.com.inframonitor.usuario.dto.ResetSenhaRequest;
import br.com.inframonitor.usuario.dto.TrocaSenhaRequest;
import br.com.inframonitor.usuario.entity.Papel;
import br.com.inframonitor.usuario.entity.Usuario;
import br.com.inframonitor.usuario.repository.UsuarioRepository;
import br.com.inframonitor.usuario.service.UsuarioService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.containers.PostgreSQLContainer;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Refresh e logout por cookie httpOnly, por HTTP real. O cookie e extraido do Set-Cookie e reenviado
 * a mao no header Cookie (o HttpClient nao guarda cookie Secure em http://localhost).
 *
 * <p>Requer Docker. Sem Docker disponivel o teste e ignorado, nunca falha.
 */
@RequerDocker
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "app.auth.jwt.secret=test-only-jwt-secret-with-at-least-32-bytes",
        "app.auth.jwt.issuer=infra-monitor-sessao-http-test",
        "monitoring.engine.enabled=false", "notification.telegram.enabled=false",
        "notification.dispatcher.enabled=false", "manutencao.agendada.enabled=false"
})
class SessaoHttpIntegrationTest {

    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");
    private static final String SENHA = "senha-sessao-http-segura";
    private static final String NOVA_SENHA = "senha-nova-sessao-http-segura";
    private static final Pattern TOKEN = Pattern.compile("\"accessToken\"\\s*:\\s*\"([^\"]+)\"");
    private static final Pattern MAX_AGE = Pattern.compile("Max-Age=(\\d+)");

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
    @Autowired UsuarioService usuarioService;
    @Autowired SessaoUsuarioService sessoes;
    @Autowired PasswordEncoder encoder;
    @Autowired PlatformTransactionManager tm;

    private long admin;

    @BeforeEach
    void preparar() {
        LimpezaBanco.limpar(jdbc);
        admin = usuario("admin@sessao-http.test", Papel.ADMIN);
    }

    @Test
    void loginEmiteCookieRestrito() {
        Resposta r = login("admin@sessao-http.test", SENHA);
        assertThat(r.status()).isEqualTo(200);
        assertThat(r.body()).contains("\"accessToken\"", "\"expiresIn\"", "\"usuario\"");
        String c = r.setCookie();
        assertThat(c).isNotNull().startsWith("inframonitor_refresh=").contains("HttpOnly", "Secure", "SameSite=Strict",
                "Path=/api/v1/auth").doesNotContain("Domain");
        assertThat(maxAge(c)).isBetween(36000L - 60, 36000L + 60);
        assertThat(cookie(c)).hasSize(43);
    }

    @Test
    void refreshComCookieDevolveTokenQueAutentica() {
        String cookie = cookie(login("admin@sessao-http.test", SENHA).setCookie());
        Resposta r = post("/refresh", cookie, true);
        assertThat(r.status()).isEqualTo(200);
        assertThat(r.body()).contains("\"expiresIn\"", "\"email\":\"admin@sessao-http.test\"");
        assertThat(r.setCookie()).isNull();
        Resposta me = get("/api/v1/auth/me", token(r.body()), null);
        assertThat(me.status()).isEqualTo(200);
        assertThat(me.body()).contains("\"email\":\"admin@sessao-http.test\"");
    }

    @Test
    void refreshSemCabecalhoE403ESemCookieE204() {
        String cookie = cookie(login("admin@sessao-http.test", SENHA).setCookie());
        Resposta semCabecalho = post("/refresh", cookie, false);
        assertThat(semCabecalho.status()).isEqualTo(403);
        assertThat(semCabecalho.body()).contains("\"code\":\"FORBIDDEN\"", "\"path\":\"/api/v1/auth/refresh\"");
        Resposta logoutSemCabecalho = post("/logout", cookie, false);
        assertThat(logoutSemCabecalho.status()).isEqualTo(403);
        assertThat(logoutSemCabecalho.body()).contains("\"code\":\"FORBIDDEN\"");
        assertThat(post("/refresh", cookie, true).status()).isEqualTo(200);

        Resposta semCookie = post("/refresh", null, true);
        assertThat(semCookie.status()).isEqualTo(204);
        assertThat(semCookie.body()).isEmpty();
        assertThat(semCookie.setCookie()).startsWith("inframonitor_refresh=;").contains("Max-Age=0", "Path=/api/v1/auth");
        assertThat(post("/refresh", "cookie-inventado", true).status()).isEqualTo(204);
    }

    @Test
    void logoutRevogaNoServidor() {
        String cookie = cookie(login("admin@sessao-http.test", SENHA).setCookie());
        Resposta logout = post("/logout", cookie, true);
        assertThat(logout.status()).isEqualTo(204);
        assertThat(logout.setCookie()).contains("Max-Age=0", "Path=/api/v1/auth", "HttpOnly");
        Resposta depois = post("/refresh", cookie, true);
        assertThat(depois.status()).isEqualTo(204);
        assertThat(depois.body()).isEmpty();
        assertThat(post("/logout", cookie, true).status()).isEqualTo(204);
        assertThat(post("/logout", null, true).status()).isEqualTo(204);
    }

    @Test
    void cookieNaoAutenticaOrestoDaApi() {
        String cookie = cookie(login("admin@sessao-http.test", SENHA).setCookie());
        assertThat(get("/api/v1/unidades", null, cookie).status()).isEqualTo(401);
        assertThat(get("/api/v1/auth/me", null, cookie).status()).isEqualTo(401);
    }

    @Test
    void desativarResetarETrocarSenhaRevogam() {
        long desativado = usuario("desativado@sessao-http.test", Papel.OPERADOR);
        long resetado = usuario("resetado@sessao-http.test", Papel.OPERADOR);
        usuario("trocou@sessao-http.test", Papel.OPERADOR);
        String tokenAdmin = token(login("admin@sessao-http.test", SENHA).body());
        String cDesativado = cookie(login("desativado@sessao-http.test", SENHA).setCookie());
        String cResetado = cookie(login("resetado@sessao-http.test", SENHA).setCookie());
        Resposta loginTrocou = login("trocou@sessao-http.test", SENHA);
        String cTrocou = cookie(loginTrocou.setCookie());

        assertThat(chamar("PATCH", "/api/v1/usuarios/" + desativado + "/desativar", tokenAdmin, null).status()).isEqualTo(200);
        assertThat(chamar("PUT", "/api/v1/usuarios/" + resetado + "/senha", tokenAdmin,
                "{\"novaSenha\":\"" + NOVA_SENHA + "\"}").status()).isEqualTo(200);
        assertThat(chamar("PUT", "/api/v1/usuarios/me/senha", token(loginTrocou.body()),
                "{\"senhaAtual\":\"" + SENHA + "\",\"novaSenha\":\"" + NOVA_SENHA + "\"}").status()).isEqualTo(204);

        assertThat(post("/refresh", cDesativado, true).status()).isEqualTo(204);
        assertThat(post("/refresh", cResetado, true).status()).isEqualTo(204);
        assertThat(post("/refresh", cTrocou, true).status()).isEqualTo(204);
        Resposta novo = login("trocou@sessao-http.test", NOVA_SENHA);
        assertThat(post("/refresh", cookie(novo.setCookie()), true).status()).isEqualTo(200);
    }

    @Test
    void refreshDeUsuarioInativoRevogaEDevolve204() {
        long id = usuario("inativo@sessao-http.test", Papel.VISUALIZADOR);
        String cookie = cookie(login("inativo@sessao-http.test", SENHA).setCookie());
        jdbc.update("update usuarios set ativo = false where id = ?", id);
        Resposta r = post("/refresh", cookie, true);
        assertThat(r.status()).isEqualTo(204);
        assertThat(r.setCookie()).contains("Max-Age=0");
        assertThat(jdbc.queryForObject("select count(*) from sessao_usuario where usuario_id = ? and revogada_em is null",
                Long.class, id)).isZero();
        jdbc.update("update usuarios set ativo = true where id = ?", id);
        assertThat(post("/refresh", cookie, true).status()).isEqualTo(204);
    }

    @Test
    void refreshesParalelosTodosPassam() throws Exception {
        String cookie = cookie(login("admin@sessao-http.test", SENHA).setCookie());
        ExecutorService pool = Executors.newFixedThreadPool(10);
        try {
            List<Future<Resposta>> futuros = new ArrayList<>();
            for (int i = 0; i < 10; i++) futuros.add(pool.submit((Callable<Resposta>) () -> post("/refresh", cookie, true)));
            for (Future<Resposta> f : futuros) {
                Resposta r = f.get(30, TimeUnit.SECONDS);
                assertThat(r.status()).isEqualTo(200);
                assertThat(token(r.body())).isNotBlank();
            }
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    void semTabelaLoginFuncionaSemCookie() {
        String cookie = cookie(login("admin@sessao-http.test", SENHA).setCookie());
        jdbc.execute("alter table sessao_usuario rename to sessao_usuario_off");
        try {
            Resposta r = login("admin@sessao-http.test", SENHA);
            assertThat(r.status()).isEqualTo(200);
            assertThat(token(r.body())).isNotBlank();
            assertThat(r.setCookie()).isNull();
            assertThat(post("/refresh", cookie, true).status()).isEqualTo(204);
            assertThat(post("/logout", cookie, true).status()).isEqualTo(204);
        } finally {
            jdbc.execute("alter table sessao_usuario_off rename to sessao_usuario");
        }
    }

    /** revogarTodas usa transacao propria: nao pode esperar a trava da linha de usuarios que a transacao de fora segura. */
    @Test
    void revogarTodasSobTravaDoUsuarioNaoTrava() throws Exception {
        long alvo = usuario("travado@sessao-http.test", Papel.OPERADOR);
        String token = sessoes.criar(alvo).orElseThrow().token();
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try {
            pool.submit(() -> new TransactionTemplate(tm).executeWithoutResult(s -> {
                usuarios.findByIdForUpdate(alvo).orElseThrow();
                sessoes.revogarTodas(alvo);
            })).get(20, TimeUnit.SECONDS);
            assertThat(sessoes.validar(token)).isEmpty();

            String t2 = sessoes.criar(alvo).orElseThrow().token();
            pool.submit(() -> usuarioService.desativar(alvo, admin)).get(20, TimeUnit.SECONDS);
            assertThat(sessoes.validar(t2)).isEmpty();
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    void semTabelaAlteracoesDeUsuarioSaoGravadas() {
        long desativado = usuario("d@sessao-http.test", Papel.OPERADOR);
        long resetado = usuario("r@sessao-http.test", Papel.OPERADOR);
        long trocou = usuario("t@sessao-http.test", Papel.OPERADOR);
        String hashResetado = senhaHash(resetado);
        String hashTrocou = senhaHash(trocou);
        jdbc.execute("alter table sessao_usuario rename to sessao_usuario_off");
        try {
            usuarioService.desativar(desativado, admin);
            usuarioService.resetarSenha(resetado, new ResetSenhaRequest(NOVA_SENHA));
            usuarioService.trocarMinhaSenha(trocou, new TrocaSenhaRequest(SENHA, NOVA_SENHA));
        } finally {
            jdbc.execute("alter table sessao_usuario_off rename to sessao_usuario");
        }
        assertThat(jdbc.queryForObject("select ativo from usuarios where id = ?", Boolean.class, desativado)).isFalse();
        assertThat(senhaHash(resetado)).isNotEqualTo(hashResetado);
        assertThat(jdbc.queryForObject("select troca_senha_obrigatoria from usuarios where id = ?", Boolean.class, resetado)).isTrue();
        assertThat(senhaHash(trocou)).isNotEqualTo(hashTrocou);
        assertThat(login("t@sessao-http.test", NOVA_SENHA).status()).isEqualTo(200);
    }

    private String senhaHash(long id) {
        return jdbc.queryForObject("select senha_hash from usuarios where id = ?", String.class, id);
    }

    private Resposta login(String email, String senha) {
        return executar(HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/v1/auth/login"))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString("{\"email\":\"" + email + "\",\"senha\":\"" + senha + "\"}"))
                .build());
    }

    private Resposta post(String caminho, String cookie, boolean comCabecalho) {
        HttpRequest.Builder b = HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/v1/auth" + caminho))
                .POST(HttpRequest.BodyPublishers.noBody());
        if (cookie != null) b.header("Cookie", "inframonitor_refresh=" + cookie);
        if (comCabecalho) b.header("X-Requested-With", "XMLHttpRequest");
        return executar(b.build());
    }

    private Resposta get(String caminho, String bearer, String cookie) {
        HttpRequest.Builder b = HttpRequest.newBuilder(URI.create("http://localhost:" + port + caminho)).GET();
        if (bearer != null) b.header("Authorization", "Bearer " + bearer);
        if (cookie != null) b.header("Cookie", "inframonitor_refresh=" + cookie).header("X-Requested-With", "XMLHttpRequest");
        return executar(b.build());
    }

    private Resposta chamar(String metodo, String caminho, String bearer, String corpo) {
        return executar(HttpRequest.newBuilder(URI.create("http://localhost:" + port + caminho))
                .method(metodo, corpo == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(corpo))
                .header("Content-Type", "application/json").header("Authorization", "Bearer " + bearer).build());
    }

    private Resposta executar(HttpRequest request) {
        try {
            HttpResponse<String> response = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build()
                    .send(request, HttpResponse.BodyHandlers.ofString());
            return new Resposta(response.statusCode(), response.body(), response.headers().firstValue("Set-Cookie").orElse(null));
        } catch (Exception e) {
            throw new AssertionError("Falha na chamada HTTP", e);
        }
    }

    private static String token(String body) {
        Matcher m = TOKEN.matcher(body);
        assertThat(m.find()).isTrue();
        return m.group(1);
    }

    private static String cookie(String setCookie) {
        assertThat(setCookie).isNotNull().startsWith("inframonitor_refresh=");
        return setCookie.substring("inframonitor_refresh=".length(), setCookie.indexOf(';'));
    }

    private static long maxAge(String setCookie) {
        Matcher m = MAX_AGE.matcher(setCookie);
        assertThat(m.find()).isTrue();
        return Long.parseLong(m.group(1));
    }

    private long usuario(String email, Papel papel) {
        return usuarios.saveAndFlush(new Usuario(email, email, encoder.encode(SENHA), papel, false)).getId();
    }

    private record Resposta(int status, String body, String setCookie) { }
}
