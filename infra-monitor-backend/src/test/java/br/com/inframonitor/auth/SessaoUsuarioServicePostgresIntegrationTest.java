package br.com.inframonitor.auth;

import br.com.inframonitor.testsupport.LimpezaBanco;
import br.com.inframonitor.testsupport.RequerDocker;
import br.com.inframonitor.usuario.entity.Papel;
import br.com.inframonitor.usuario.entity.Usuario;
import br.com.inframonitor.usuario.repository.UsuarioRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Servico de sessao persistente por JDBC contra PostgreSQL real. Requer Docker; sem Docker e ignorado.
 */
@RequerDocker
@SpringBootTest(properties = {
        "app.auth.jwt.secret=test-only-jwt-secret-with-at-least-32-bytes",
        "app.auth.jwt.issuer=infra-monitor-sessao-test",
        "monitoring.engine.enabled=false", "notification.telegram.enabled=false",
        "notification.dispatcher.enabled=false", "manutencao.agendada.enabled=false"
})
class SessaoUsuarioServicePostgresIntegrationTest {

    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");

    @DynamicPropertySource
    static void db(DynamicPropertyRegistry r) {
        POSTGRES.start();
        r.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        r.add("spring.datasource.username", POSTGRES::getUsername);
        r.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @Autowired JdbcTemplate jdbc;
    @Autowired UsuarioRepository usuarios;
    @Autowired PasswordEncoder encoder;
    @Autowired SessaoUsuarioService sessoes;

    private long usuarioA;
    private long usuarioB;

    @BeforeEach
    void preparar() {
        LimpezaBanco.limpar(jdbc);
        usuarioA = usuario("a@sessao.test");
        usuarioB = usuario("b@sessao.test");
    }

    @Test
    void criaSessaoGuardandoSoOHash() {
        SessaoUsuarioService.SessaoCriada s = sessoes.criar(usuarioA).orElseThrow();
        assertThat(s.token()).hasSize(43);
        assertThat(jdbc.queryForObject("select token_hash from sessao_usuario", String.class))
                .isEqualTo(SessaoUsuarioService.sha256Hex(s.token()));
        assertThat(jdbc.queryForObject("select count(*) from sessao_usuario where token_hash = ?", Long.class,
                s.token())).isZero();
        assertThat(s.expiraEm()).isBetween(Instant.now().plus(Duration.ofHours(10)).minus(Duration.ofMinutes(1)),
                Instant.now().plus(Duration.ofHours(10)).plus(Duration.ofMinutes(1)));
    }

    @Test
    void validaSessaoAtivaEAtualizaUltimoUso() {
        String token = sessoes.criar(usuarioA).orElseThrow().token();
        assertThat(jdbc.queryForObject("select ultimo_uso_em from sessao_usuario", Object.class)).isNull();
        assertThat(sessoes.validar(token)).isEqualTo(Optional.of(usuarioA));
        assertThat(jdbc.queryForObject("select ultimo_uso_em from sessao_usuario", Object.class)).isNotNull();
    }

    @Test
    void recusaRevogadaExpiradaEDesconhecida() {
        String revogada = sessoes.criar(usuarioA).orElseThrow().token();
        sessoes.revogar(revogada);
        assertThat(sessoes.validar(revogada)).isEmpty();

        String expirada = sessoes.criar(usuarioA).orElseThrow().token();
        jdbc.update("update sessao_usuario set expira_em = now() - interval '1 second', "
                + "criada_em = now() - interval '1 hour' where token_hash = ?", SessaoUsuarioService.sha256Hex(expirada));
        assertThat(sessoes.validar(expirada)).isEmpty();

        assertThat(sessoes.validar("token-que-nunca-existiu")).isEmpty();
        assertThat(sessoes.validar(null)).isEmpty();
        assertThat(sessoes.validar("")).isEmpty();
    }

    @Test
    void revogarTodasDerrubaSoAsDoUsuario() {
        String a1 = sessoes.criar(usuarioA).orElseThrow().token();
        String a2 = sessoes.criar(usuarioA).orElseThrow().token();
        String b1 = sessoes.criar(usuarioB).orElseThrow().token();
        sessoes.revogarTodas(usuarioA);
        assertThat(sessoes.validar(a1)).isEmpty();
        assertThat(sessoes.validar(a2)).isEmpty();
        assertThat(sessoes.validar(b1)).isEqualTo(Optional.of(usuarioB));
    }

    @Test
    void loginLimpaSessoesVencidasHaMaisDeUmDia() {
        String velha = sessoes.criar(usuarioA).orElseThrow().token();
        jdbc.update("update sessao_usuario set expira_em = now() - interval '2 days', "
                + "criada_em = now() - interval '3 days' where token_hash = ?", SessaoUsuarioService.sha256Hex(velha));
        String recente = sessoes.criar(usuarioA).orElseThrow().token();
        assertThat(jdbc.queryForObject("select count(*) from sessao_usuario where token_hash = ?", Long.class,
                SessaoUsuarioService.sha256Hex(velha))).isZero();
        assertThat(sessoes.validar(recente)).isEqualTo(Optional.of(usuarioA));
    }

    @Test
    void validacoesConcorrentesNaoSeAtrapalham() throws Exception {
        String token = sessoes.criar(usuarioA).orElseThrow().token();
        ExecutorService pool = Executors.newFixedThreadPool(10);
        try {
            List<Future<Optional<Long>>> futuros = new ArrayList<>();
            for (int i = 0; i < 10; i++) futuros.add(pool.submit((Callable<Optional<Long>>) () -> sessoes.validar(token)));
            for (Future<Optional<Long>> f : futuros) assertThat(f.get()).isEqualTo(Optional.of(usuarioA));
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    void semTabelaDegradaSemExcecao() {
        String token = sessoes.criar(usuarioA).orElseThrow().token();
        jdbc.execute("alter table sessao_usuario rename to sessao_usuario_off");
        try {
            assertThat(sessoes.criar(usuarioA)).isEmpty();
            assertThat(sessoes.validar(token)).isEmpty();
            sessoes.revogar(token);
            sessoes.revogarTodas(usuarioA);
        } finally {
            jdbc.execute("alter table sessao_usuario_off rename to sessao_usuario");
        }
    }

    private long usuario(String email) {
        return usuarios.saveAndFlush(new Usuario(email, email, encoder.encode("senha-sessao-teste"), Papel.ADMIN, false)).getId();
    }
}
