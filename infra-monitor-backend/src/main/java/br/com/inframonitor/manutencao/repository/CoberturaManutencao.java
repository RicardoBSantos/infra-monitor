package br.com.inframonitor.manutencao.repository;

import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@Repository
public class CoberturaManutencao {

    /**
     * Fonte unica do predicado "coberto por janela ATIVA", com alias {@code e} para equipamento.
     * Olha o STATUS, nunca o relogio: so o reconciliador consulta o relogio (MA06), e painel,
     * motor e efeitos nao podem discordar por segundos.
     */
    public static final String COBERTO_E = """
            EXISTS (SELECT 1 FROM manutencao_agendada ma
                     WHERE ma.status = 'ATIVA'
                       AND ((ma.escopo = 'UNIDADE' AND ma.unidade_id = e.unidade_id)
                         OR (ma.escopo = 'EQUIPAMENTOS' AND EXISTS (
                               SELECT 1 FROM manutencao_agendada_equipamento mae
                                WHERE mae.manutencao_id = ma.id AND mae.equipamento_id = e.id))))""";

    private final NamedParameterJdbcTemplate jdbc;

    public CoberturaManutencao(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public boolean coberto(long equipamentoId) {
        return Boolean.TRUE.equals(jdbc.queryForObject(
                "SELECT " + COBERTO_E + " FROM equipamento e WHERE e.id = :id",
                Map.of("id", equipamentoId), Boolean.class));
    }

    /** Criador da janela ATIVA de menor id que cobre o equipamento: autor da entrada pelo job (MA10). */
    public Optional<Long> autorDaCobertura(long equipamentoId) {
        List<Long> ids = jdbc.queryForList("""
                SELECT ma.criado_por_id FROM manutencao_agendada ma JOIN equipamento e ON e.id = :id
                 WHERE ma.status = 'ATIVA'
                   AND ((ma.escopo = 'UNIDADE' AND ma.unidade_id = e.unidade_id)
                     OR (ma.escopo = 'EQUIPAMENTOS' AND EXISTS (SELECT 1 FROM manutencao_agendada_equipamento mae
                          WHERE mae.manutencao_id = ma.id AND mae.equipamento_id = e.id)))
                 ORDER BY ma.id LIMIT 1""", Map.of("id", equipamentoId), Long.class);
        return ids.stream().findFirst();
    }

    /** Equipamentos cujo efetivo diverge do desejado. Ordem por id: mesma ordem de lock em todo lugar. */
    public List<Long> divergentes() {
        return jdbc.queryForList("SELECT e.id FROM equipamento e WHERE e.em_manutencao <> (e.manutencao_manual OR "
                + COBERTO_E + ") ORDER BY e.id", Map.of(), Long.class);
    }

    /** Equipamentos que a janela cobre AGORA (escopo UNIDADE e dinamico: le a unidade no momento). */
    public List<Long> cobertosPor(long manutencaoId) {
        return jdbc.queryForList("""
                SELECT e.id FROM manutencao_agendada ma JOIN equipamento e
                    ON (ma.escopo = 'UNIDADE' AND e.unidade_id = ma.unidade_id)
                    OR (ma.escopo = 'EQUIPAMENTOS' AND EXISTS (SELECT 1 FROM manutencao_agendada_equipamento mae
                         WHERE mae.manutencao_id = ma.id AND mae.equipamento_id = e.id))
                 WHERE ma.id = :id ORDER BY e.id""", Map.of("id", manutencaoId), Long.class);
    }

    // ---------------------------------------------------------------------------
    // Transicoes de situacao. Todas sao CAS no WHERE: quem perde a corrida (tick x botao,
    // dois botoes) muda zero linhas e decide o que responder. Nenhuma toca equipamento: a
    // reavaliacao dos cobertos vem depois do commit, um equipamento por transacao.
    // Todas incrementam versao (MA26): uma edicao preparada sobre a versao anterior muda zero linhas.
    // ---------------------------------------------------------------------------

    /** CAS AGENDADA -> ATIVA das devidas. Devolve as ativadas, com previsto e real (log de atraso). */
    public List<Transicao> ativarDevidas(Instant agora) {
        return jdbc.query("""
                UPDATE manutencao_agendada SET versao = versao + 1, status = 'ATIVA', ativada_em = :agora, updated_at = :agora
                 WHERE status = 'AGENDADA' AND inicio_previsto <= :agora AND fim_previsto > :agora
                RETURNING id, inicio_previsto AS previsto""", Map.of("agora", ts(agora)), Transicao.mapper(agora));
    }

    /** Mesmo CAS, restrito a uma janela (ativacao imediata na criacao). */
    public boolean ativarSeDevida(long id, Instant agora) {
        return jdbc.update("""
                UPDATE manutencao_agendada SET versao = versao + 1, status = 'ATIVA', ativada_em = :agora, updated_at = :agora
                 WHERE id = :id AND status = 'AGENDADA' AND inicio_previsto <= :agora AND fim_previsto > :agora""",
                Map.of("id", id, "agora", ts(agora))) == 1;
    }

    /** Janela inteira perdida: nunca ativou e o fim ja passou. Sem efeito nenhum (MA08). */
    public List<Transicao> expirarPerdidas(Instant agora) {
        return jdbc.query("""
                UPDATE manutencao_agendada SET versao = versao + 1, status = 'EXPIRADA', updated_at = :agora
                 WHERE status = 'AGENDADA' AND fim_previsto <= :agora
                RETURNING id, fim_previsto AS previsto""", Map.of("agora", ts(agora)), Transicao.mapper(agora));
    }

    /** CAS ATIVA -> CONCLUIDA no instante REAL, nunca no fim previsto (MA08). */
    public List<Transicao> concluirVencidas(Instant agora) {
        return jdbc.query("""
                UPDATE manutencao_agendada SET versao = versao + 1, status = 'CONCLUIDA', encerrada_em = :agora, updated_at = :agora
                 WHERE status = 'ATIVA' AND fim_previsto <= :agora
                RETURNING id, fim_previsto AS previsto""", Map.of("agora", ts(agora)), Transicao.mapper(agora));
    }

    /** CAS AGENDADA -> CANCELADA. Janela ATIVA nao se cancela: se encerra. */
    public boolean cancelar(long id, long usuarioId, Instant agora) {
        return jdbc.update("""
                UPDATE manutencao_agendada SET versao = versao + 1, status = 'CANCELADA', cancelada_em = :agora, cancelada_por_id = :u,
                       updated_at = :agora
                 WHERE id = :id AND status = 'AGENDADA'""",
                Map.of("id", id, "u", usuarioId, "agora", ts(agora))) == 1;
    }

    /** CAS ATIVA -> CONCLUIDA por pessoa (encerrada_por_id preenchido). */
    public boolean encerrar(long id, long usuarioId, Instant agora) {
        return jdbc.update("""
                UPDATE manutencao_agendada SET versao = versao + 1, status = 'CONCLUIDA', encerrada_em = :agora, encerrada_por_id = :u,
                       updated_at = :agora
                 WHERE id = :id AND status = 'ATIVA'""",
                Map.of("id", id, "u", usuarioId, "agora", ts(agora))) == 1;
    }

    private static Timestamp ts(Instant instante) {
        return Timestamp.from(instante);
    }

    /** Uma janela que mudou de situacao: instante previsto da mudanca e o real. */
    public record Transicao(long manutencaoId, Instant previsto, Instant real) {

        public Duration atraso() {
            return Duration.between(previsto, real);
        }

        static RowMapper<Transicao> mapper(Instant real) {
            return (rs, linha) -> new Transicao(rs.getLong("id"), rs.getTimestamp("previsto").toInstant(), real);
        }
    }
}
