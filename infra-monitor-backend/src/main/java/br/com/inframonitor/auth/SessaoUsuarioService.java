package br.com.inframonitor.auth;
import org.slf4j.Logger; import org.slf4j.LoggerFactory; import org.springframework.dao.DataAccessException; import org.springframework.jdbc.BadSqlGrammarException; import org.springframework.jdbc.core.JdbcTemplate; import org.springframework.stereotype.Service; import org.springframework.transaction.PlatformTransactionManager; import org.springframework.transaction.TransactionException; import org.springframework.transaction.TransactionDefinition; import org.springframework.transaction.support.TransactionTemplate;
import java.nio.charset.StandardCharsets; import java.security.MessageDigest; import java.security.NoSuchAlgorithmException; import java.security.SecureRandom; import java.sql.SQLException; import java.sql.Timestamp; import java.time.Instant; import java.util.Base64; import java.util.HexFormat; import java.util.List; import java.util.Optional; import java.util.Set; import java.util.function.Supplier;
/** Sessao persistente (refresh token) por JDBC: sem entidade JPA, para o jar subir mesmo sem a V26. Cada operacao roda em transacao propria.
 * Tabela ausente ou sem privilegio (estrutural) vira "sem sessao"; outra falha de banco so derruba a sessao onde o usuario pediu (logout):
 * no {@link #validar} ela sobe como {@link SessaoIndisponivelException}, para o refresh responder 503 sem tocar no cookie. */
@Service public class SessaoUsuarioService { private static final Logger log=LoggerFactory.getLogger(SessaoUsuarioService.class); private static final SecureRandom RANDOM=new SecureRandom();
 /** 42P01 undefined_table, 42501 insufficient_privilege. */ private static final Set<String> ESTRUTURAIS=Set.of("42P01","42501");
 public record SessaoCriada(String token, Instant expiraEm) {}
 /** Falha transitoria do banco ao validar (pool esgotado, banco reiniciando, timeout): a sessao pode estar valida. */
 public static class SessaoIndisponivelException extends RuntimeException { public SessaoIndisponivelException(Throwable causa){super("Sessao persistente temporariamente indisponivel",causa);} }
 private final JdbcTemplate jdbc; private final SessaoProperties props; private final TransactionTemplate tx;
 public SessaoUsuarioService(JdbcTemplate jdbc,SessaoProperties props,PlatformTransactionManager tm){this.jdbc=jdbc;this.props=props;this.tx=new TransactionTemplate(tm);this.tx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);}
 /** INSERT e limpeza em transacoes separadas e curtas: a limpeza (linhas de outros usuarios) nunca fica travada enquanto o INSERT espera a FK. Qualquer falha vira vazio: o login segue sem cookie. */
 public Optional<SessaoCriada> criar(long usuarioId){ Optional<SessaoCriada> s=tolerante(Optional.empty(),()->{ byte[] b=new byte[32]; RANDOM.nextBytes(b); String token=Base64.getUrlEncoder().withoutPadding().encodeToString(b); Instant expira=Instant.now().plus(props.duracao());
  jdbc.update("insert into sessao_usuario (usuario_id, token_hash, expira_em) values (?, ?, ?)",usuarioId,sha256Hex(token),Timestamp.from(expira)); return Optional.of(new SessaoCriada(token,expira)); });
  if(s.isPresent()) tolerante(null,()->jdbc.update("delete from sessao_usuario where expira_em < now() - interval '1 day' or revogada_em < now() - interval '1 day'")); return s; }
 /** Vazio = sem sessao (inexistente, revogada, vencida ou tabela estruturalmente indisponivel). Falha transitoria lanca {@link SessaoIndisponivelException}. */
 public Optional<Long> validar(String token){ if(token==null||token.isEmpty())return Optional.empty();
  try{ return tx.execute(s->{ List<Long> ids=jdbc.queryForList("update sessao_usuario set ultimo_uso_em = now() where token_hash = ? and revogada_em is null and expira_em > now() returning usuario_id",Long.class,sha256Hex(token)); return ids.isEmpty()?Optional.<Long>empty():Optional.of(ids.get(0)); }); }
  catch(DataAccessException|TransactionException e){ if(estrutural(e)){ avisarEstrutural(e); return Optional.empty(); } log.error("Falha transitoria ao validar sessao persistente; refresh responde 503",e); throw new SessaoIndisponivelException(e); } }
 public void revogar(String token){ if(token==null||token.isEmpty())return; tolerante(null,()->jdbc.update("update sessao_usuario set revogada_em = now() where token_hash = ? and revogada_em is null",sha256Hex(token))); }
 public void revogarTodas(long usuarioId){ tolerante(null,()->jdbc.update("update sessao_usuario set revogada_em = now() where usuario_id = ? and revogada_em is null",usuarioId)); }
 public static String sha256Hex(String token){ try{ return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8))); }catch(NoSuchAlgorithmException e){ throw new IllegalStateException(e); } }
 /** Tabela ausente/sem privilegio: BadSqlGrammarException ou SQLState 42P01/42501 em qualquer ponto da cadeia de causas. */
 static boolean estrutural(Throwable e){ for(Throwable t=e;t!=null;t=t.getCause()){ if(t instanceof BadSqlGrammarException)return true; if(t instanceof SQLException q&&q.getSQLState()!=null&&ESTRUTURAIS.contains(q.getSQLState()))return true; if(t.getCause()==t)break; } return false; }
 private <T> T tolerante(T padrao,Supplier<T> acao){ try{ return tx.execute(s->acao.get()); }catch(DataAccessException|TransactionException e){ if(estrutural(e)) avisarEstrutural(e); else log.error("Falha de banco na sessao persistente; operacao ignorada",e); return padrao; } }
 /** Modo degradado esperado (jar novo sem a V26): uma linha por ocorrencia, sem stack. */
 private static void avisarEstrutural(Throwable e){ Throwable raiz=e; String estado=null; for(Throwable t=e;t!=null;t=t.getCause()){ raiz=t; if(t instanceof SQLException q&&q.getSQLState()!=null)estado=q.getSQLState(); if(t.getCause()==t)break; }
  log.warn("Sessao persistente indisponivel (V26 aplicada?): {}{}",estado==null?"":estado+" ",String.valueOf(raiz.getMessage()).replaceAll("\\s+"," ")); }
}
