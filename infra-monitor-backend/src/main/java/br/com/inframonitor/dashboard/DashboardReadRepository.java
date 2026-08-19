package br.com.inframonitor.dashboard;

import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Repository;

import java.util.List;

/** PostgreSQL read projections used by dashboard aggregates, without loading inventories to count them. */
@Repository
public class DashboardReadRepository {
    private final EntityManager entityManager;

    public DashboardReadRepository(EntityManager entityManager) { this.entityManager = entityManager; }

    private static final String ESTADOS = """
            with ultima_medicao as (
                select distinct on (monitor_id) monitor_id, id from medicao
                order by monitor_id, executado_em desc, id desc
            ), monitor_estado as (
                select m.id, m.equipamento_id, m.ativo,
                    case when not m.ativo then 'DESABILITADO'
                         when i.id is not null then 'INDISPONIVEL'
                         when um.id is null then 'SEM_DADOS'
                         else 'DISPONIVEL' end as status,
                    case when i.id is null then 0 else 1 end as incidente_aberto
                from monitor m
                left join ultima_medicao um on um.monitor_id = m.id
                left join incidente i on i.monitor_id = m.id and i.status = 'ABERTO'
            ), equipamento_estado as (
                select e.id, e.unidade_id, e.ativo,
                    case when not e.ativo then 'DESABILITADO'
                         when count(me.id) filter (where me.ativo) = 0 then 'SEM_MONITORAMENTO'
                         when count(me.id) filter (where me.ativo and me.status = 'INDISPONIVEL') > 0 then 'INDISPONIVEL'
                         when count(me.id) filter (where me.ativo) = count(me.id) filter (where me.ativo and me.status = 'SEM_DADOS') then 'SEM_DADOS'
                         else 'DISPONIVEL' end as status
                from equipamento e left join monitor_estado me on me.equipamento_id = e.id
                group by e.id, e.unidade_id, e.ativo
            )
            """;

    public DashboardCounts resumo() {
        Object[] r = (Object[]) entityManager.createNativeQuery(ESTADOS + """
                select
                    (select count(*) from unidade),
                    count(*), count(*) filter (where ee.ativo),
                    count(*) filter (where ee.status = 'DISPONIVEL'),
                    count(*) filter (where ee.status = 'INDISPONIVEL'),
                    count(*) filter (where ee.status = 'SEM_DADOS'),
                    count(*) filter (where ee.status = 'SEM_MONITORAMENTO'),
                    (select count(*) from monitor),
                    (select count(*) from monitor_estado where ativo),
                    (select count(*) from monitor_estado where status = 'DISPONIVEL'),
                    (select count(*) from monitor_estado where status = 'INDISPONIVEL'),
                    (select count(*) from monitor_estado where status = 'SEM_DADOS'),
                    (select count(*) from incidente where status = 'ABERTO')
                from equipamento_estado ee
                """).getSingleResult();
        return new DashboardCounts(longValue(r[0]), longValue(r[1]), longValue(r[2]), longValue(r[3]),
                longValue(r[4]), longValue(r[5]), longValue(r[6]), longValue(r[7]), longValue(r[8]),
                longValue(r[9]), longValue(r[10]), longValue(r[11]), longValue(r[12]));
    }

    public List<UnidadeCounts> unidades(boolean somenteAtivas) {
        String filtro = somenteAtivas ? "where u.ativo" : "";
        @SuppressWarnings("unchecked")
        List<Object[]> rows = entityManager.createNativeQuery(ESTADOS + """
                select u.id, u.nome, u.ativo,
                    count(ee.id), count(ee.id) filter (where ee.ativo),
                    count(ee.id) filter (where ee.status = 'DISPONIVEL'),
                    count(ee.id) filter (where ee.status = 'INDISPONIVEL'),
                    count(ee.id) filter (where ee.status = 'SEM_DADOS'),
                    count(ee.id) filter (where ee.status = 'SEM_MONITORAMENTO'),
                    count(me.id) filter (where me.ativo),
                    count(me.id) filter (where me.status = 'INDISPONIVEL'),
                    coalesce(sum(me.incidente_aberto), 0)
                from unidade u left join equipamento_estado ee on ee.unidade_id = u.id
                left join monitor_estado me on me.equipamento_id = ee.id
                """ + filtro + " group by u.id, u.nome, u.ativo order by u.nome asc").getResultList();
        return rows.stream().map(this::unidade).toList();
    }

    public UnidadeCounts unidade(Long unidadeId) {
        return unidades(false).stream().filter(u -> u.id().equals(unidadeId)).findFirst().orElse(null);
    }

    private UnidadeCounts unidade(Object[] r) {
        return new UnidadeCounts(longValue(r[0]), (String) r[1], (Boolean) r[2], longValue(r[3]), longValue(r[4]),
                longValue(r[5]), longValue(r[6]), longValue(r[7]), longValue(r[8]), longValue(r[9]),
                longValue(r[10]), longValue(r[11]));
    }

    private long longValue(Object value) { return ((Number) value).longValue(); }

    public record DashboardCounts(long unidadesTotal, long equipamentosTotal, long equipamentosAtivos,
                                  long equipamentosDisponiveis, long equipamentosIndisponiveis,
                                  long equipamentosSemDados, long equipamentosSemMonitoramento,
                                  long monitoresTotal, long monitoresAtivos, long monitoresDisponiveis,
                                  long monitoresIndisponiveis, long monitoresSemDados, long incidentesAbertos) { }
    public record UnidadeCounts(Long id, String nome, boolean ativo, long equipamentosTotal, long equipamentosAtivos,
                                long equipamentosDisponiveis, long equipamentosIndisponiveis,
                                long equipamentosSemDados, long equipamentosSemMonitoramento,
                                long monitoresAtivos, long monitoresIndisponiveis, long incidentesAbertos) { }
}
