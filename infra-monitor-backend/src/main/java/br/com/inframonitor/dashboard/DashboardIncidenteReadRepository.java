package br.com.inframonitor.dashboard;

import br.com.inframonitor.common.api.PaginaResposta;
import br.com.inframonitor.dashboard.dto.DashboardIncidenteContadoresResponse;
import br.com.inframonitor.dashboard.dto.DashboardIncidenteResponse;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.List;

/**
 * Projecao de leitura da tela unificada de Incidentes. Une incidente e episodio de
 * latencia num vocabulario so; as duas tabelas continuam dominios distintos no banco.
 */
@Repository
public class DashboardIncidenteReadRepository {

    /**
     * O CASE do braco de latencia normaliza encerrado_em em ABERTO/FECHADO, o mesmo
     * vocabulario do incidente. Por isso o filtro das quatro abas vira uma igualdade
     * simples em vez de tres regras compostas — e por isso episodio nunca cai em
     * RECONHECIDO: ele se fecha sozinho, sem intervencao humana.
     *
     * <p>A notificacao vem por LATERAL com LIMIT 1, nao por LEFT JOIN direto: um
     * incidente fechado tem INCIDENTE_ABERTO e INCIDENTE_FECHADO, e o join simples
     * duplicaria a linha e inflaria o count da paginacao.
     */
    private static final String EVENTO = """
            with evento as (
                select 'INCIDENTE'::text tipo, i.id, 'ALTA'::text severidade, i.status,
                       i.iniciado_em, i.encerrado_em, i.motivo, null::integer limiar_ms,
                       i.reconhecido_em, ru.nome reconhecido_por_nome, i.motivo_encerramento,
                       m.id monitor_id, m.nome monitor_nome,
                       e.id equipamento_id, e.nome equipamento_nome,
                       u.id unidade_id, u.nome unidade_nome,
                       n.canal notificacao_canal, n.status notificacao_status,
                       n.enviado_em notificacao_enviado_em
                  from incidente i
                  join monitor m on m.id = i.monitor_id
                  join equipamento e on e.id = m.equipamento_id
                  join unidade u on u.id = e.unidade_id
                  left join usuarios ru on ru.id = i.reconhecido_por
                  left join lateral (
                      select nn.canal, nn.status, nn.enviado_em from notificacao nn
                       where nn.incidente_id = i.id
                       order by nn.created_at desc, nn.id desc limit 1) n on true
                union all
                select 'LATENCIA'::text, ep.id, 'MEDIA'::text,
                       case when ep.encerrado_em is null then 'ABERTO' else 'FECHADO' end,
                       ep.iniciado_em, ep.encerrado_em, null::varchar, ep.limiar_ms,
                       null::timestamptz, null::varchar, null::varchar,
                       m.id, m.nome, e.id, e.nome, u.id, u.nome,
                       n.canal, n.status, n.enviado_em
                  from monitor_episodio_latencia ep
                  join monitor m on m.id = ep.monitor_id
                  join equipamento e on e.id = m.equipamento_id
                  join unidade u on u.id = e.unidade_id
                  left join lateral (
                      select nn.canal, nn.status, nn.enviado_em from notificacao nn
                       where nn.episodio_latencia_id = ep.id
                       order by nn.created_at desc, nn.id desc limit 1) n on true
            )
            """;

    /**
     * Periodo por sobreposicao, nao por iniciado_em dentro da janela: numa tela
     * operacional "o que estava acontecendo neste periodo" precisa continuar mostrando
     * o incidente aberto ha tres dias quando o filtro e hoje. Mesma semantica de
     * /relatorios/incidentes.
     */
    private static final String FILTROS = """
             where (cast(:unidadeId as bigint) is null or unidade_id = :unidadeId)
               and (cast(:severidade as varchar) is null or severidade = :severidade)
               and (cast(:inicio as timestamptz) is null
                    or (iniciado_em < :fim and (encerrado_em is null or encerrado_em >= :inicio)))
            """;

    private static final RowMapper<DashboardIncidenteResponse> MAPPER = (r, n) -> new DashboardIncidenteResponse(
            r.getString("tipo"), r.getLong("id"), r.getString("severidade"), r.getString("status"),
            instant(r, "iniciado_em"), instant(r, "encerrado_em"), r.getString("motivo"),
            (Integer) r.getObject("limiar_ms"), instant(r, "reconhecido_em"), r.getString("reconhecido_por_nome"),
            r.getString("motivo_encerramento"),
            r.getLong("monitor_id"), r.getString("monitor_nome"),
            r.getLong("equipamento_id"), r.getString("equipamento_nome"),
            r.getLong("unidade_id"), r.getString("unidade_nome"),
            r.getString("notificacao_canal"), r.getString("notificacao_status"),
            instant(r, "notificacao_enviado_em"));

    private final NamedParameterJdbcTemplate jdbc;

    public DashboardIncidenteReadRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public PaginaResposta<DashboardIncidenteResponse> listar(Long unidadeId, String severidade, String status,
            Instant inicio, Instant fim, int page, int size, String ordenacao) {
        MapSqlParameterSource p = params(unidadeId, severidade, inicio, fim).addValue("status", status);
        String sql = EVENTO + "select * from evento" + FILTROS
                + " and (cast(:status as varchar) is null or status = :status)";
        Long total = jdbc.queryForObject("select count(*) from (" + sql + ") evento_count", p, Long.class);
        long totalElements = total == null ? 0L : total;
        // Desempate obrigatorio: as duas tabelas podem compartilhar iniciado_em e sem
        // ordem determinista a paginacao repete e pula linhas.
        List<DashboardIncidenteResponse> linhas = jdbc.query(
                sql + " order by " + ordenacao + ", tipo asc, id desc limit :limit offset :offset",
                p.addValue("limit", size).addValue("offset", (long) page * size), MAPPER);
        int pages = (int) ((totalElements + size - 1) / size);
        return new PaginaResposta<>(linhas, page, size, totalElements, pages, page == 0, page >= pages - 1);
    }

    public DashboardIncidenteContadoresResponse contadores(Long unidadeId, String severidade,
            Instant inicio, Instant fim) {
        String sql = EVENTO + """
                select count(*) filter (where status = 'ABERTO') abertos,
                       count(*) filter (where status = 'RECONHECIDO') reconhecidos,
                       count(*) filter (where status = 'FECHADO') resolvidos,
                       count(*) todos
                  from evento
                """ + FILTROS;
        return jdbc.queryForObject(sql, params(unidadeId, severidade, inicio, fim),
                (r, n) -> new DashboardIncidenteContadoresResponse(r.getLong("abertos"), r.getLong("reconhecidos"),
                        r.getLong("resolvidos"), r.getLong("todos")));
    }

    private MapSqlParameterSource params(Long unidadeId, String severidade, Instant inicio, Instant fim) {
        return new MapSqlParameterSource()
                .addValue("unidadeId", unidadeId)
                .addValue("severidade", severidade)
                .addValue("inicio", inicio == null ? null : Timestamp.from(inicio))
                .addValue("fim", fim == null ? null : Timestamp.from(fim));
    }

    private static Instant instant(ResultSet row, String coluna) throws SQLException {
        OffsetDateTime valor = row.getObject(coluna, OffsetDateTime.class);
        return valor == null ? null : valor.toInstant();
    }
}
