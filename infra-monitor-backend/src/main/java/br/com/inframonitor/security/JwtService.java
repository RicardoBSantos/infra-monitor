package br.com.inframonitor.security;
import br.com.inframonitor.usuario.entity.*; import io.jsonwebtoken.*; import io.jsonwebtoken.security.Keys; import javax.crypto.SecretKey; import org.springframework.stereotype.Service; import java.nio.charset.StandardCharsets; import java.time.*; import java.util.Date;
@Service public class JwtService {
 private final JwtProperties properties; private final SecretKey key;
 public JwtService(JwtProperties properties){this.properties=properties; this.key=Keys.hmacShaKeyFor(properties.secret().getBytes(StandardCharsets.UTF_8));}
 public String gerar(Usuario usuario){ Instant agora=Instant.now(), expira=agora.plus(Duration.ofMinutes(properties.accessTokenMinutes())); return Jwts.builder().issuer(properties.issuer()).subject(usuario.getId().toString()).claim("role",usuario.getPapel().name()).issuedAt(Date.from(agora)).expiration(Date.from(expira)).signWith(key,Jwts.SIG.HS256).compact(); }
 public Long extrairUsuarioId(String token){ Claims c=Jwts.parser().verifyWith(key).requireIssuer(properties.issuer()).build().parseSignedClaims(token).getPayload(); try{return Long.valueOf(c.getSubject());}catch(NumberFormatException e){throw new JwtException("subject invalido",e);} }
 public long expiresIn(){return Duration.ofMinutes(properties.accessTokenMinutes()).toSeconds();}
}
