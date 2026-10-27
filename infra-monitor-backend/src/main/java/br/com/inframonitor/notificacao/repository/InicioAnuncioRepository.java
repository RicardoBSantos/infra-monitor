package br.com.inframonitor.notificacao.repository;

import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;

/**
 * Destino do aviso de INICIO de uma manutencao (janela ou sessao do botao) quando o aviso de
 * FIM vai ser escrito (MA32), e das alteracoes de fim pendentes da janela (MA33). SQL puro, na
 * transacao do chamador.
 *
 * <p>O cancelamento devolve {@code tentativas} na mesma instrucao: quem decide o texto do fim
 * olha o resultado do UPDATE, nunca uma leitura anterior (divida A4: entre a leitura e o UPDATE
 * o dispatcher pode reservar a linha e enviar o inicio).
 */
@Repository
public class InicioAnuncioRepository {

    private static final String CANCELAR = """
            UPDATE notificacao SET status = 'CANCELADA', updated_at = :agora
             WHERE %s = :id AND tipo_evento = '%s' AND status = 'PENDENTE'
            RETURNING tentativas, erro""";

    private static final String EM_FALHA = """
            SELECT EXISTS (SELECT 1 FROM notificacao
                            WHERE %s = :id AND tipo_evento = '%s' AND status = 'FALHA')""";

    /** O que o UPDATE devolveu da linha cancelada: tentativas e a marca de erro (retry ou reserva vencida). */
    public record InicioCancelado(int tentativas, String erro) {
        /** Sem tentativa e sem marca: o inicio nunca saiu. Qualquer outra coisa pode ter chegado ao Telegram. */
        public boolean certamenteNaoEntregue() {
            return tentativas == 0 && erro == null;
        }
    }

    private final NamedParameterJdbcTemplate jdbc;

    public InicioAnuncioRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** Vazio quando o inicio nao estava PENDENTE (ja saiu, esta saindo, falhou ou nao existe). */
    public Optional<InicioCancelado> cancelarInicioDaJanela(long janelaId, Instant agora) {
        return cancelar("manutencao_agendada_id", "MANUTENCAO_INICIADA", janelaId, agora);
    }

    public Optional<InicioCancelado> cancelarInicioDaSessao(long sessaoId, Instant agora) {
        return cancelar("manutencao_manual_id", "MANUTENCAO_MANUAL_INICIADA", sessaoId, agora);
    }

    /**
     * MA33, correcao de 2026-10-26: no fim da janela, as alteracoes de fim ainda PENDENTE nao saem mais (o
     * fim ja traz o termino real). A em ENVIANDO fica intocada e a fila segura o fim ate ela sair. Nao entra
     * na decisao de entrega do inicio, que continua so no resultado de {@link #cancelarInicioDaJanela}.
     */
    public int cancelarFimAlteradoDaJanela(long janelaId, Instant agora) {
        return jdbc.update("""
                UPDATE notificacao SET status = 'CANCELADA', updated_at = :agora
                 WHERE manutencao_agendada_id = :id AND tipo_evento = 'MANUTENCAO_FIM_ALTERADO' AND status = 'PENDENTE'""",
                new MapSqlParameterSource("id", janelaId).addValue("agora", Timestamp.from(agora)));
    }

    /** FALHA e terminal: lida depois do UPDATE nao muda mais. */
    public boolean inicioEmFalhaDaJanela(long janelaId) {
        return emFalha("manutencao_agendada_id", "MANUTENCAO_INICIADA", janelaId);
    }

    public boolean inicioEmFalhaDaSessao(long sessaoId) {
        return emFalha("manutencao_manual_id", "MANUTENCAO_MANUAL_INICIADA", sessaoId);
    }

    private Optional<InicioCancelado> cancelar(String coluna, String tipoEvento, long id, Instant agora) {
        return jdbc.query(CANCELAR.formatted(coluna, tipoEvento),
                new MapSqlParameterSource("id", id).addValue("agora", Timestamp.from(agora)),
                (rs, i) -> new InicioCancelado(rs.getInt("tentativas"), rs.getString("erro"))).stream().findFirst();
    }

    private boolean emFalha(String coluna, String tipoEvento, long id) {
        return Boolean.TRUE.equals(jdbc.queryForObject(EM_FALHA.formatted(coluna, tipoEvento),
                Map.of("id", id), Boolean.class));
    }
}
