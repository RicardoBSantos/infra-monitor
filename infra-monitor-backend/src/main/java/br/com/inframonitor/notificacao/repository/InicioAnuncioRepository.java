package br.com.inframonitor.notificacao.repository;

import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Destino do aviso de INICIO de uma manutencao (janela ou sessao do botao) quando o aviso de
 * FIM vai ser escrito (MA32). SQL puro, na transacao do chamador.
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
            RETURNING tentativas""";

    private static final String EM_FALHA = """
            SELECT EXISTS (SELECT 1 FROM notificacao
                            WHERE %s = :id AND tipo_evento = '%s' AND status = 'FALHA')""";

    private final NamedParameterJdbcTemplate jdbc;

    public InicioAnuncioRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** Vazio quando o inicio nao estava PENDENTE (ja saiu, esta saindo, falhou ou nao existe). */
    public Optional<Integer> cancelarInicioDaJanela(long janelaId, Instant agora) {
        return cancelar("manutencao_agendada_id", "MANUTENCAO_INICIADA", janelaId, agora);
    }

    public Optional<Integer> cancelarInicioDaSessao(long sessaoId, Instant agora) {
        return cancelar("manutencao_manual_id", "MANUTENCAO_MANUAL_INICIADA", sessaoId, agora);
    }

    /** FALHA e terminal: lida depois do UPDATE nao muda mais. */
    public boolean inicioEmFalhaDaJanela(long janelaId) {
        return emFalha("manutencao_agendada_id", "MANUTENCAO_INICIADA", janelaId);
    }

    public boolean inicioEmFalhaDaSessao(long sessaoId) {
        return emFalha("manutencao_manual_id", "MANUTENCAO_MANUAL_INICIADA", sessaoId);
    }

    private Optional<Integer> cancelar(String coluna, String tipoEvento, long id, Instant agora) {
        List<Integer> tentativas = jdbc.queryForList(CANCELAR.formatted(coluna, tipoEvento),
                new MapSqlParameterSource("id", id).addValue("agora", Timestamp.from(agora)), Integer.class);
        return tentativas.stream().findFirst();
    }

    private boolean emFalha(String coluna, String tipoEvento, long id) {
        return Boolean.TRUE.equals(jdbc.queryForObject(EM_FALHA.formatted(coluna, tipoEvento),
                Map.of("id", id), Boolean.class));
    }
}
