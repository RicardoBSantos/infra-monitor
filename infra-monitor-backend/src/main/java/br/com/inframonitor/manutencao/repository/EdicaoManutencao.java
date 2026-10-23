package br.com.inframonitor.manutencao.repository;

import br.com.inframonitor.manutencao.entity.TipoAlteracao;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.core.namedparam.SqlParameterSource;
import org.springframework.stereotype.Repository;
import tools.jackson.databind.ObjectMapper;

import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Edicao de janelas (F2). Cada operacao roda DENTRO da transacao do servico: primeiro
 * {@link #travar} (FOR UPDATE com status e versao no WHERE), depois o UPDATE com as mesmas
 * condicoes como segunda guarda. O reconciliador disputa o mesmo lock de linha; quem chega
 * depois reavalia o proprio WHERE contra a versao commitada (MA26).
 */
@Repository
public class EdicaoManutencao {

    private final NamedParameterJdbcTemplate jdbc;
    private final ObjectMapper json;

    public EdicaoManutencao(NamedParameterJdbcTemplate jdbc, ObjectMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    /** Campos editaveis, como vao para o JSONB antes/depois. Ids ordenados. */
    public record Retrato(long unidadeId, String escopo, List<Long> equipamentoIds, Instant inicioPrevisto,
                          Instant fimPrevisto, String motivo) {
        public Retrato comFim(Instant fim) {
            return new Retrato(unidadeId, escopo, equipamentoIds, inicioPrevisto, fim, motivo);
        }
    }

    public record EstadoAtual(String status, int versao) { }

    public record Ultima(long manutencaoId, TipoAlteracao tipo, long porId, String porNome, Instant em) { }

    /** Trava a linha so se ainda estiver em {@code status} e na {@code versao} lida pela tela. */
    public Optional<Retrato> travar(long id, String status, int versao) {
        List<Retrato> linhas = jdbc.query("""
                SELECT unidade_id, escopo, inicio_previsto, fim_previsto, motivo FROM manutencao_agendada
                 WHERE id = :id AND status = :status AND versao = :versao
                 FOR UPDATE""",
                Map.of("id", id, "status", status, "versao", versao),
                (rs, i) -> new Retrato(rs.getLong("unidade_id"), rs.getString("escopo"), List.of(),
                        rs.getTimestamp("inicio_previsto").toInstant(), rs.getTimestamp("fim_previsto").toInstant(),
                        rs.getString("motivo")));
        if (linhas.isEmpty()) {
            return Optional.empty();
        }
        Retrato r = linhas.get(0);
        List<Long> ids = jdbc.queryForList("SELECT equipamento_id FROM manutencao_agendada_equipamento "
                + "WHERE manutencao_id = :id ORDER BY equipamento_id", Map.of("id", id), Long.class);
        return Optional.of(new Retrato(r.unidadeId(), r.escopo(), ids, r.inicioPrevisto(), r.fimPrevisto(), r.motivo()));
    }

    /** So para escolher a mensagem de recusa depois que {@link #travar} voltou vazio. */
    public Optional<EstadoAtual> estado(long id) {
        return jdbc.query("SELECT status, versao FROM manutencao_agendada WHERE id = :id", Map.of("id", id),
                (rs, i) -> new EstadoAtual(rs.getString("status"), rs.getInt("versao"))).stream().findFirst();
    }

    public boolean gravarEdicao(long id, int versao, Retrato novo, Instant agora) {
        int linhas = jdbc.update("""
                UPDATE manutencao_agendada
                   SET unidade_id = :unidade, escopo = :escopo, inicio_previsto = :inicio, fim_previsto = :fim,
                       motivo = :motivo, versao = versao + 1, updated_at = :agora
                 WHERE id = :id AND status = 'AGENDADA' AND versao = :versao""",
                new MapSqlParameterSource().addValue("id", id).addValue("versao", versao)
                        .addValue("unidade", novo.unidadeId()).addValue("escopo", novo.escopo())
                        .addValue("inicio", ts(novo.inicioPrevisto())).addValue("fim", ts(novo.fimPrevisto()))
                        .addValue("motivo", novo.motivo()).addValue("agora", ts(agora)));
        if (linhas != 1) {
            return false;
        }
        jdbc.update("DELETE FROM manutencao_agendada_equipamento WHERE manutencao_id = :id", Map.of("id", id));
        SqlParameterSource[] ligacoes = novo.equipamentoIds().stream()
                .map(e -> new MapSqlParameterSource().addValue("id", id).addValue("e", e))
                .toArray(SqlParameterSource[]::new);
        if (ligacoes.length > 0) {
            jdbc.batchUpdate("INSERT INTO manutencao_agendada_equipamento (manutencao_id, equipamento_id) "
                    + "VALUES (:id, :e)", ligacoes);
        }
        return true;
    }

    /** Teto no WHERE (MA23): inicio_previsto >= novoFim - maxima equivale a novoFim - inicio <= maxima. */
    public boolean gravarFim(long id, int versao, Instant novoFim, Instant agora, Duration maxima) {
        return jdbc.update("""
                UPDATE manutencao_agendada SET fim_previsto = :fim, versao = versao + 1, updated_at = :agora
                 WHERE id = :id AND status = 'ATIVA' AND versao = :versao
                   AND :fim > :agora AND inicio_previsto >= :inicioMinimo""",
                new MapSqlParameterSource().addValue("id", id).addValue("versao", versao)
                        .addValue("fim", ts(novoFim)).addValue("agora", ts(agora))
                        .addValue("inicioMinimo", ts(novoFim.minus(maxima)))) == 1;
    }

    public void registrar(long id, TipoAlteracao tipo, long usuarioId, Instant agora, Retrato antes, Retrato depois) {
        jdbc.update("""
                INSERT INTO manutencao_agendada_alteracao (manutencao_id, tipo, alterado_por_id, alterado_em, antes, depois)
                VALUES (:id, :tipo, :u, :agora, CAST(:antes AS jsonb), CAST(:depois AS jsonb))""",
                new MapSqlParameterSource().addValue("id", id).addValue("tipo", tipo.name()).addValue("u", usuarioId)
                        .addValue("agora", ts(agora)).addValue("antes", json.writeValueAsString(antes))
                        .addValue("depois", json.writeValueAsString(depois)));
    }

    /** Ultima alteracao de cada janela, uma consulta por pagina. */
    public Map<Long, Ultima> ultimas(Collection<Long> ids) {
        if (ids.isEmpty()) {
            return Map.of();
        }
        Map<Long, Ultima> resultado = new LinkedHashMap<>();
        jdbc.query("""
                SELECT DISTINCT ON (a.manutencao_id) a.manutencao_id, a.tipo, a.alterado_em, u.id AS por_id, u.nome
                  FROM manutencao_agendada_alteracao a JOIN usuarios u ON u.id = a.alterado_por_id
                 WHERE a.manutencao_id IN (:ids)
                 ORDER BY a.manutencao_id, a.alterado_em DESC, a.id DESC""", Map.of("ids", ids),
                (rs, i) -> new Ultima(rs.getLong("manutencao_id"), TipoAlteracao.valueOf(rs.getString("tipo")),
                        rs.getLong("por_id"), rs.getString("nome"), rs.getTimestamp("alterado_em").toInstant()))
                .forEach(x -> resultado.put(x.manutencaoId(), x));
        return resultado;
    }

    private static Timestamp ts(Instant instante) {
        return Timestamp.from(instante);
    }
}
