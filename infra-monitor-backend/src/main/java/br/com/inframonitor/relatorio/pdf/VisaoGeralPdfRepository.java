package br.com.inframonitor.relatorio.pdf;

import br.com.inframonitor.relatorio.service.DisponibilidadeSqlRepository;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;

/** Coleta todos os blocos globais no mesmo snapshot PostgreSQL. */
@Repository
public class VisaoGeralPdfRepository {
    static final String KPIS = """
        select
          (select count(*) from incidente i where i.status in ('ABERTO','RECONHECIDO') and i.iniciado_em<:fim
             and (i.encerrado_em is null or i.encerrado_em>=:inicio)) incidentes_abertos,
          (select count(*) from medicao md where md.status='FALHA'
             and md.executado_em>=:inicio and md.executado_em<=:fim) medicoes_falha,
          (select count(*) from notificacao n where n.status='FALHA'
             and n.created_at>=:inicio and n.created_at<=:fim) notificacoes_falha
        """;
    static final String LATENCIA = """
        select u.nome unidade_nome,e.nome equipamento_nome,m.nome monitor_nome,
               min(md.latencia_ms) min_latencia,round(avg(md.latencia_ms),2) avg_latencia,
               max(md.latencia_ms) max_latencia,
               round(percentile_cont(0.95) within group(order by md.latencia_ms)::numeric)::int p95,
               count(md.id)::bigint quantidade
          from monitor m join equipamento e on e.id=m.equipamento_id join unidade u on u.id=e.unidade_id
          left join medicao md on md.monitor_id=m.id and md.status='SUCESSO' and md.latencia_ms is not null
               and md.executado_em>=:inicio and md.executado_em<=:fim
         where m.tipo='ICMP'
         group by u.id,u.nome,e.id,e.nome,m.id,m.nome
         order by avg_latencia desc nulls last, monitor_nome asc, m.id asc
         limit 5
        """;

    private final NamedParameterJdbcTemplate jdbc;
    private final int timeoutSeconds;

    public VisaoGeralPdfRepository(NamedParameterJdbcTemplate jdbc,
            @Value("${app.reports.pdf.timeout-seconds:60}") int timeoutSeconds) {
        this.jdbc = jdbc;
        this.timeoutSeconds = Math.min(120, Math.max(1, timeoutSeconds));
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public Coleta coletar(Instant inicio, Instant fim, Instant geradoEm) {
        long started = System.nanoTime();
        MapSqlParameterSource parameters = new MapSqlParameterSource()
                .addValue("inicio", Timestamp.from(inicio)).addValue("fim", Timestamp.from(fim))
                .addValue("unidadeId", null).addValue("equipamentoId", null)
                .addValue("monitorId", null).addValue("tipoId", null);
        jdbc.queryForObject("select set_config('statement_timeout', :timeout, true)",
                new MapSqlParameterSource("timeout", timeoutSeconds + "s"), String.class);

        VisaoGeralPdfModel.Kpis kpis = jdbc.queryForObject(KPIS, parameters, (row, number) ->
                new VisaoGeralPdfModel.Kpis(row.getLong("incidentes_abertos"),
                        row.getLong("medicoes_falha"), row.getLong("notificacoes_falha")));

        List<VisaoGeralPdfModel.Unidade> unidades = jdbc.query(
                DisponibilidadeSqlRepository.BASE + " " + DisponibilidadeSqlRepository.UNIDADES + """
                     order by disponibilidade asc nulls last, unidade_nome asc, unidade_id asc limit 5
                    """, parameters, (row, number) -> new VisaoGeralPdfModel.Unidade(
                        row.getString("unidade_nome"), row.getBigDecimal("disponibilidade"), estadoUnidade(row),
                        row.getLong("incidentes")));

        List<VisaoGeralPdfModel.Equipamento> equipamentos = jdbc.query(
                DisponibilidadeSqlRepository.BASE + """
                     select * from linhas
                     order by disponibilidade asc nulls last, equipamento_nome asc, equipamento_id asc,
                              monitor_nome asc nulls last, monitor_id asc nulls last limit 5
                    """, parameters, (row, number) -> new VisaoGeralPdfModel.Equipamento(
                        row.getString("equipamento_nome"), row.getString("unidade_nome"), row.getString("monitor_nome"),
                        row.getBigDecimal("disponibilidade"), row.getString("estado"), row.getString("qualidade"),
                        row.getLong("incidentes")));

        List<VisaoGeralPdfModel.Latencia> latencias = jdbc.query(LATENCIA, parameters,
                (row, number) -> new VisaoGeralPdfModel.Latencia(row.getString("monitor_nome"),
                        row.getString("equipamento_nome"), row.getString("unidade_nome"),
                        integer(row, "min_latencia"), row.getBigDecimal("avg_latencia"),
                        integer(row, "max_latencia"), integer(row, "p95"), row.getLong("quantidade")));

        long queryMillis = (System.nanoTime() - started) / 1_000_000;
        return new Coleta(new VisaoGeralPdfModel(inicio, fim, geradoEm, kpis, unidades, equipamentos, latencias),
                queryMillis);
    }

    private static String estadoUnidade(ResultSet row) throws SQLException {
        if (row.getObject("tempo_monitorado") != null) return "CALCULADO";
        return row.getLong("equipamentos_sem_monitoramento") == row.getLong("equipamentos_total")
                ? "SEM_MONITORAMENTO" : "SEM_DADOS";
    }

    private static Integer integer(ResultSet row, String column) throws SQLException {
        Object value = row.getObject(column);
        return value == null ? null : ((Number) value).intValue();
    }

    public record Coleta(VisaoGeralPdfModel modelo, long consultasMillis) { }
}
