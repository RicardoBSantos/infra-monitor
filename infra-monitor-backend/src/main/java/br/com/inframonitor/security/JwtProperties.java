package br.com.inframonitor.security;
import jakarta.annotation.PostConstruct; import org.springframework.boot.context.properties.ConfigurationProperties; import java.nio.charset.StandardCharsets;
@ConfigurationProperties(prefix="app.auth.jwt")
public record JwtProperties(String secret, String issuer, long accessTokenMinutes) {
 @PostConstruct public void validar() { if(secret == null || secret.getBytes(StandardCharsets.UTF_8).length < 32) throw new IllegalStateException("JWT_SECRET deve ter pelo menos 32 bytes"); if(issuer == null || issuer.isBlank()) throw new IllegalStateException("JWT_ISSUER e obrigatorio"); if(accessTokenMinutes <= 0) throw new IllegalStateException("JWT_ACCESS_TOKEN_MINUTES deve ser positivo"); }
}
