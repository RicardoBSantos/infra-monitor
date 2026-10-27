package br.com.inframonitor.equipamento.repository;

import br.com.inframonitor.equipamento.dto.ManutencaoManualResponse;
import br.com.inframonitor.equipamento.dto.ReferenciaResponse;
import br.com.inframonitor.notificacao.service.DadosAnuncio;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Sessoes do botao manual (tabela manutencao_manual). As escritas rodam sob o lock do equipamento
 * ({@code EstadoManutencaoEquipamento}); o indice unico parcial e a segunda guarda de "uma aberta por equipamento".
 */
@Repository
public class SessaoManutencaoManual {

    private final NamedParameterJdbcTemplate jdbc;

    public SessaoManutencaoManual(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public long abrir(long equipamentoId, long usuarioId, Instant agora) {
        return jdbc.queryForObject("""
                INSERT INTO manutencao_manual (equipamento_id, iniciada_em, iniciada_por_id)
                VALUES (:e, :agora, :u) RETURNING id""",
                new MapSqlParameterSource("e", equipamentoId).addValue("u", usuarioId)
                        .addValue("agora", Timestamp.from(agora)), Long.class);
    }

    /** Fecha a sessao aberta do equipamento; vazio se nao ha (defensivo: o backfill cobre as antigas). */
    public Optional<Long> fecharAberta(long equipamentoId, long usuarioId, Instant agora) {
        return jdbc.queryForList("""
                UPDATE manutencao_manual SET encerrada_em = :agora, encerrada_por_id = :u
                 WHERE equipamento_id = :e AND encerrada_em IS NULL RETURNING id""",
                new MapSqlParameterSource("e", equipamentoId).addValue("u", usuarioId)
                        .addValue("agora", Timestamp.from(agora)), Long.class).stream().findFirst();
    }

    public Optional<DadosAnuncio.Manual> dados(long sessaoId) {
        return jdbc.query("""
                SELECT mm.id, u.nome AS unidade_nome, e.nome AS equipamento_nome, e.ip_address,
                       mm.iniciada_em, us.nome AS iniciada_por_nome
                  FROM manutencao_manual mm
                  JOIN equipamento e ON e.id = mm.equipamento_id
                  JOIN unidade u ON u.id = e.unidade_id
                  LEFT JOIN usuarios us ON us.id = mm.iniciada_por_id
                 WHERE mm.id = :id""", Map.of("id", sessaoId), (rs, i) -> new DadosAnuncio.Manual(
                rs.getLong("id"), rs.getString("unidade_nome"), rs.getString("equipamento_nome"),
                rs.getString("ip_address"), instante(rs, "iniciada_em"), rs.getString("iniciada_por_nome")))
                .stream().findFirst();
    }

    public boolean existeHistorico(long equipamentoId) {
        return Boolean.TRUE.equals(jdbc.queryForObject(
                "SELECT EXISTS (SELECT 1 FROM manutencao_manual WHERE equipamento_id = :e)",
                Map.of("e", equipamentoId), Boolean.class));
    }

    /** Mais recente primeiro por id: o instante de inicio e nulo no backfill, o id nunca. */
    public Page<ManutencaoManualResponse> listar(long equipamentoId, Pageable pageable) {
        Long total = jdbc.queryForObject("SELECT count(*) FROM manutencao_manual WHERE equipamento_id = :e",
                Map.of("e", equipamentoId), Long.class);
        List<ManutencaoManualResponse> linhas = jdbc.query("""
                SELECT mm.id, mm.iniciada_em, mm.iniciada_por_id, ui.nome AS iniciada_por_nome,
                       mm.encerrada_em, mm.encerrada_por_id, ue.nome AS encerrada_por_nome
                  FROM manutencao_manual mm
                  LEFT JOIN usuarios ui ON ui.id = mm.iniciada_por_id
                  LEFT JOIN usuarios ue ON ue.id = mm.encerrada_por_id
                 WHERE mm.equipamento_id = :e
                 ORDER BY mm.id DESC LIMIT :limite OFFSET :deslocamento""",
                new MapSqlParameterSource("e", equipamentoId).addValue("limite", pageable.getPageSize())
                        .addValue("deslocamento", pageable.getOffset()), (rs, i) -> resposta(rs));
        return new PageImpl<>(linhas, pageable, total == null ? 0 : total);
    }

    private static ManutencaoManualResponse resposta(ResultSet rs) throws SQLException {
        Instant iniciadaEm = instante(rs, "iniciada_em");
        Instant encerradaEm = instante(rs, "encerrada_em");
        Long duracao = iniciadaEm != null && encerradaEm != null
                ? Duration.between(iniciadaEm, encerradaEm).toSeconds() : null;
        return new ManutencaoManualResponse(rs.getLong("id"), iniciadaEm,
                referencia(rs, "iniciada_por_id", "iniciada_por_nome"), encerradaEm,
                referencia(rs, "encerrada_por_id", "encerrada_por_nome"), duracao);
    }

    private static ReferenciaResponse referencia(ResultSet rs, String colunaId, String colunaNome) throws SQLException {
        long id = rs.getLong(colunaId);
        return rs.wasNull() ? null : new ReferenciaResponse(id, rs.getString(colunaNome));
    }

    private static Instant instante(ResultSet rs, String coluna) throws SQLException {
        Timestamp valor = rs.getTimestamp(coluna);
        return valor == null ? null : valor.toInstant();
    }
}
