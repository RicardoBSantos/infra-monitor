package br.com.inframonitor.security;

import br.com.inframonitor.usuario.entity.Papel;
import br.com.inframonitor.usuario.entity.Usuario;
import io.jsonwebtoken.ExpiredJwtException;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.junit.jupiter.api.Test;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Date;

import static org.assertj.core.api.Assertions.*;

class JwtServiceTest {
    private static final String SECRET = "test-only-secret-that-is-at-least-32-bytes-long";

    @Test
    void geraTokenValidoComClaimsMinimosESubjectDoUsuario() {
        JwtService service = new JwtService(new JwtProperties(SECRET, "infra-monitor-test", 15));
        Usuario usuario = new Usuario("Admin", "admin@empresa.com", "hash", Papel.ADMIN, false);
        setId(usuario, 42L);
        String token = service.gerar(usuario);
        assertThat(service.extrairUsuarioId(token)).isEqualTo(42L);
        assertThat(service.expiresIn()).isEqualTo(900);
    }

    @Test
    void rejeitaTokenMalformadoEAssinadoComOutraChave() {
        JwtService service = new JwtService(new JwtProperties(SECRET, "infra-monitor-test", 15));
        assertThatThrownBy(() -> service.extrairUsuarioId("nao-e-um-jwt")).isInstanceOf(JwtException.class);
        JwtService outro = new JwtService(new JwtProperties("another-test-secret-that-is-at-least-32-bytes", "infra-monitor-test", 15));
        Usuario usuario = new Usuario("Admin", "admin@empresa.com", "hash", Papel.ADMIN, false); setId(usuario, 1L);
        assertThatThrownBy(() -> outro.extrairUsuarioId(service.gerar(usuario))).isInstanceOf(JwtException.class);
    }

    @Test
    void rejeitaTokenExpiradoEDeOutroEmissor() {
        JwtService service = new JwtService(new JwtProperties(SECRET, "infra-monitor-test", 15));
        SecretKey key = Keys.hmacShaKeyFor(SECRET.getBytes(StandardCharsets.UTF_8));
        Instant emitido = Instant.now().minus(Duration.ofMinutes(30));
        String expirado = Jwts.builder().issuer("infra-monitor-test").subject("1").claim("role", "ADMIN")
                .issuedAt(Date.from(emitido)).expiration(Date.from(emitido.plus(Duration.ofMinutes(15))))
                .signWith(key, Jwts.SIG.HS256).compact();
        assertThatThrownBy(() -> service.extrairUsuarioId(expirado)).isInstanceOf(ExpiredJwtException.class);
        String outroEmissor = Jwts.builder().issuer("outro-emissor").subject("1").claim("role", "ADMIN")
                .issuedAt(new Date()).expiration(Date.from(Instant.now().plus(Duration.ofMinutes(15))))
                .signWith(key, Jwts.SIG.HS256).compact();
        assertThatThrownBy(() -> service.extrairUsuarioId(outroEmissor)).isInstanceOf(JwtException.class);
    }

    private static void setId(Usuario usuario, Long id) {
        try { var field = Usuario.class.getDeclaredField("id"); field.setAccessible(true); field.set(usuario, id); }
        catch (ReflectiveOperationException e) { throw new AssertionError(e); }
    }
}
