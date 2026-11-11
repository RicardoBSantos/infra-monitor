package br.com.inframonitor.auth;
import org.springframework.http.ResponseCookie; import org.springframework.stereotype.Component; import java.time.Duration; import java.time.Instant;
/** Cookie do refresh token: HttpOnly, SameSite=Strict, Path restrito ao /auth, sem Domain. So o Secure e configuravel. */
@Component public class SessaoCookie { public static final String NOME="inframonitor_refresh"; public static final String PATH="/api/v1/auth"; private final SessaoProperties props;
 public SessaoCookie(SessaoProperties props){this.props=props;}
 public ResponseCookie emitir(SessaoUsuarioService.SessaoCriada s){ return montar(s.token(),Math.max(0,Duration.between(Instant.now(),s.expiraEm()).toSeconds())); }
 public ResponseCookie apagar(){ return montar("",0); }
 private ResponseCookie montar(String valor,long maxAge){ return ResponseCookie.from(NOME,valor).httpOnly(true).secure(props.cookieSecure()).sameSite("Strict").path(PATH).maxAge(maxAge).build(); }
}
