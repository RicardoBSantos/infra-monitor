package br.com.inframonitor.security;

import br.com.inframonitor.usuario.entity.Papel;
import br.com.inframonitor.usuario.entity.Usuario;
import io.jsonwebtoken.JwtException;
import org.junit.jupiter.api.Test;

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

    private static void setId(Usuario usuario, Long id) {
        try { var field = Usuario.class.getDeclaredField("id"); field.setAccessible(true); field.set(usuario, id); }
        catch (ReflectiveOperationException e) { throw new AssertionError(e); }
    }
}
