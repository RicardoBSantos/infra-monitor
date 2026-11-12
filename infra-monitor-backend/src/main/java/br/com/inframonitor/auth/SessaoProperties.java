package br.com.inframonitor.auth;
import jakarta.annotation.PostConstruct; import org.springframework.boot.context.properties.ConfigurationProperties; import java.time.Duration;
@ConfigurationProperties(prefix="app.auth.sessao")
public record SessaoProperties(Duration duracao, boolean cookieSecure) {
 @PostConstruct public void validar() { if(duracao == null || duracao.compareTo(Duration.ofMinutes(1)) < 0 || duracao.compareTo(Duration.ofHours(24)) > 0) throw new IllegalStateException("JWT_REFRESH_TOKEN_DURATION deve estar entre 1 minuto e 24 horas"); }
}
