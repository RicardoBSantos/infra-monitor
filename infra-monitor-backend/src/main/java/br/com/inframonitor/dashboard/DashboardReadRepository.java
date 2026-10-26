package br.com.inframonitor.dashboard;

import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Repository;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

/** PostgreSQL read projections used by dashboard aggregates, without loading inventories to count them. */
@Repository
public class DashboardReadRepository {
    private final EntityManager entityManager;

    public DashboardReadRepository(EntityManager entityManager) { this.entityManager = entityManager; }

    private static final String ESTADOS = """
            with ultima_medicao as (
                select distinct on (monitor_id) monitor_id, id, latencia_ms, executado_em from medicao
                order by monitor_id, executado_em desc, id desc
            ), monitor_estado as (
                select m.id, m.equipamento_id, m.ativo,
                    case when not m.ativo then 'DESABILITADO'
                         when i.id is not null and e.ativo and not e.em_manutencao then 'INDISPONIVEL'
                         when um.id is null then 'SEM_DADOS'
                         when um.latencia_ms is not null and um.latencia_ms > ?1 then 'DEGRADADO'
                         else 'DISPONIVEL' end as status,
                    -- Incidente de monitor desativado ou de equipamento inativo/em manutencao e orfao:
                    -- continua na lista de incidentes, mas nao e leitura operacional.
                    -- Mesma regra em DashboardService.operacional (incidentesAbertos por equipamento).
                    case when i.id is not null and m.ativo and e.ativo and not e.em_manutencao then 1 else 0 end as incidente_aberto,
                    um.latencia_ms, um.executado_em, um.id as medicao_id
                from monitor m
                join equipamento e on e.id = m.equipamento_id
                left join ultima_medicao um on um.monitor_id = m.id
                left join incidente i on i.monitor_id = m.id and i.status in ('ABERTO', 'RECONHECIDO')
            ), equipamento_estado as (
                select e.id, e.unidade_id, e.ativo,
                    case when not e.ativo then 'DESABILITADO'
                         when e.em_manutencao then 'EM_MANUTENCAO'
                         when count(me.id) filter (where me.ativo) = 0 then 'SEM_MONITORAMENTO'
                         when count(me.id) filter (where me.ativo and me.status = 'INDISPONIVEL') > 0 then 'INDISPONIVEL'
                         when count(me.id) filter (where me.ativo) = count(me.id) filter (where me.ativo and me.status = 'SEM_DADOS') then 'SEM_DADOS'
                         when count(me.id) filter (where me.ativo and me.status = 'DEGRADADO') > 0 then 'DEGRADADO'
                         else 'DISPONIVEL' end as status
                from equipamento e left join monitor_estado me on me.equipamento_id = e.id
                group by e.id, e.unidade_id, e.ativo, e.em_manutencao
            )
            """;

    public DashboardCounts resumo(int limiarLatenciaDegradadaMs) {
        Object[] r = (Object[]) entityManager.createNativeQuery(ESTADOS + """
                select
                    (select count(*) from unidade),
                    count(*), count(*) filter (where ee.ativo),
                    count(*) filter (where ee.status = 'DISPONIVEL'),
                    count(*) filter (where ee.status = 'DEGRADADO'),
                    count(*) filter (where ee.status = 'INDISPONIVEL'),
                    count(*) filter (where ee.status = 'SEM_DADOS'),
                    count(*) filter (where ee.status = 'SEM_MONITORAMENTO'),
                    count(*) filter (where ee.status = 'EM_MANUTENCAO'),
                    (select count(*) from monitor),
                    (select count(*) from monitor_estado where ativo),
                    (select count(*) from monitor_estado where status = 'DISPONIVEL'),
                    (select count(*) from monitor_estado where status = 'DEGRADADO'),
                    (select count(*) from monitor_estado where status = 'INDISPONIVEL'),
                    (select count(*) from monitor_estado where status = 'SEM_DADOS'),
                    (select coalesce(sum(incidente_aberto), 0) from monitor_estado)
                from equipamento_estado ee
                """).setParameter(1, limiarLatenciaDegradadaMs).getSingleResult();
        return new DashboardCounts(longValue(r[0]), longValue(r[1]), longValue(r[2]), longValue(r[3]),
                longValue(r[4]), longValue(r[5]), longValue(r[6]), longValue(r[7]), longValue(r[8]),
                longValue(r[9]), longValue(r[10]), longValue(r[11]), longValue(r[12]), longValue(r[13]),
                longValue(r[14]), longValue(r[15]));
    }

    public List<UnidadeCounts> unidades(boolean somenteAtivas, int limiarLatenciaDegradadaMs) {
        String filtro = somenteAtivas ? "where u.ativo" : "";
        @SuppressWarnings("unchecked")
        List<Object[]> rows = entityManager.createNativeQuery(ESTADOS + """
                select u.id, u.nome, u.codigo_ibge, u.ativo,
                    count(ee.id), count(ee.id) filter (where ee.ativo),
                    count(ee.id) filter (where ee.status = 'DISPONIVEL'),
                    count(ee.id) filter (where ee.status = 'DEGRADADO'),
                    count(ee.id) filter (where ee.status = 'INDISPONIVEL'),
                    count(ee.id) filter (where ee.status = 'SEM_DADOS'),
                    count(ee.id) filter (where ee.status = 'SEM_MONITORAMENTO'),
                    count(ee.id) filter (where ee.status = 'EM_MANUTENCAO'),
                    count(me.id) filter (where me.ativo),
                    count(me.id) filter (where me.status = 'INDISPONIVEL'),
                    coalesce(sum(me.incidente_aberto), 0),
                    u.latitude, u.longitude, u.conecta_a_unidade_id
                from unidade u left join equipamento_estado ee on ee.unidade_id = u.id
                left join monitor_estado me on me.equipamento_id = ee.id
                """ + filtro + " group by u.id, u.nome, u.codigo_ibge, u.ativo, u.latitude, u.longitude, u.conecta_a_unidade_id order by u.nome asc")
                .setParameter(1, limiarLatenciaDegradadaMs).getResultList();
        return rows.stream().map(this::unidade).toList();
    }

    /** Existencia barata, para quem so precisa do 404: {@link #unidade} calcula o agregado de todas as unidades. */
    public boolean existeUnidade(Long unidadeId) {
        return (Boolean) entityManager.createNativeQuery("select exists (select 1 from unidade where id = ?1)")
                .setParameter(1, unidadeId).getSingleResult();
    }

    public UnidadeCounts unidade(Long unidadeId, int limiarLatenciaDegradadaMs) {
        return unidades(false, limiarLatenciaDegradadaMs).stream().filter(u -> u.id().equals(unidadeId)).findFirst().orElse(null);
    }

    private UnidadeCounts unidade(Object[] r) {
        return new UnidadeCounts(longValue(r[0]), (String) r[1], (String) r[2], (Boolean) r[3], longValue(r[4]), longValue(r[5]),
                longValue(r[6]), longValue(r[7]), longValue(r[8]), longValue(r[9]), longValue(r[10]),
                longValue(r[11]), longValue(r[12]), longValue(r[13]), longValue(r[14]),
                decimalValue(r[15]), decimalValue(r[16]), longOrNull(r[17]));
    }

    /**
     * Inventario completo com status operacional e latencia, sem paginacao: a tela de Equipamentos
     * filtra e pagina em memoria. Reaproveita a CTE ESTADOS, que ja classifica o equipamento — a
     * formula nao e reescrita aqui.
     *
     * <p>A latencia e a da ultima medicao entre os monitores ATIVOS do equipamento, com o mesmo
     * desempate do caminho Java (executado_em desc, id da medicao desc). Latencia nula com status
     * INDISPONIVEL e o caso de timeout.
     */
    public List<EquipamentoRow> equipamentos(int limiarLatenciaDegradadaMs) {
        @SuppressWarnings("unchecked")
        List<Object[]> rows = entityManager.createNativeQuery(ESTADOS + """
                , equipamento_latencia as (
                    select distinct on (me.equipamento_id) me.equipamento_id, me.latencia_ms
                    from monitor_estado me
                    where me.ativo and me.executado_em is not null
                    order by me.equipamento_id, me.executado_em desc, me.medicao_id desc
                )
                select e.id, e.nome, t.nome, u.id, u.nome, e.hostname, e.ip_address,
                    ee.status, el.latencia_ms, e.ativo, e.localizacao, e.numero_serie, e.em_manutencao,
                    e.manutencao_manual, ja.id, ja.fim_previsto
                from equipamento e
                join equipamento_estado ee on ee.id = e.id
                join unidade u on u.id = e.unidade_id
                join tipo_equipamento t on t.id = e.tipo_equipamento_id
                left join equipamento_latencia el on el.equipamento_id = e.id
                left join lateral (
                    select ma.id, ma.fim_previsto from manutencao_agendada ma
                     where ma.status = 'ATIVA'
                       and ((ma.escopo = 'UNIDADE' and ma.unidade_id = e.unidade_id)
                         or (ma.escopo = 'EQUIPAMENTOS' and exists (
                               select 1 from manutencao_agendada_equipamento mae
                                where mae.manutencao_id = ma.id and mae.equipamento_id = e.id)))
                     order by ma.fim_previsto desc, ma.id desc limit 1
                ) ja on true
                order by e.nome asc, e.id asc
                """).setParameter(1, limiarLatenciaDegradadaMs).getResultList();
        return rows.stream().map(this::equipamento).toList();
    }

    private EquipamentoRow equipamento(Object[] r) {
        return new EquipamentoRow(longValue(r[0]), (String) r[1], (String) r[2], longValue(r[3]), (String) r[4],
                (String) r[5], (String) r[6], StatusOperacionalEquipamento.valueOf((String) r[7]),
                r[8] == null ? null : ((Number) r[8]).intValue(), (Boolean) r[9],
                (String) r[10], (String) r[11], (Boolean) r[12],
                (Boolean) r[13], longOrNull(r[14]), instantOrNull(r[15]));
    }

    /** O driver entrega TIMESTAMPTZ de query nativa como Timestamp, OffsetDateTime ou Instant. */
    private Instant instantOrNull(Object value) {
        if (value == null) return null;
        if (value instanceof Instant i) return i;
        if (value instanceof java.sql.Timestamp t) return t.toInstant();
        if (value instanceof java.time.OffsetDateTime o) return o.toInstant();
        throw new IllegalStateException("Tipo de data inesperado: " + value.getClass());
    }

    private long longValue(Object value) { return ((Number) value).longValue(); }

    /**
     * Pai da topologia e opcional: a raiz tem {@code conecta_a_unidade_id} nulo. {@code longValue}
     * nao serve aqui — ele devolve 0 para nulo, e 0 seria lido como id de unidade existente.
     */
    private Long longOrNull(Object value) { return value == null ? null : ((Number) value).longValue(); }

    /** Coordenada e opcional no cadastro: NUMERIC nulo continua nulo, nunca vira zero. */
    private BigDecimal decimalValue(Object value) { return value == null ? null : (BigDecimal) value; }

    public record EquipamentoRow(Long id, String nome, String tipoNome, Long unidadeId, String unidadeNome,
                                 String hostname, String ip, StatusOperacionalEquipamento status,
                                 Integer latenciaMs, boolean ativo, String localizacao, String numeroSerie,
                                 boolean emManutencao, boolean manutencaoManual, Long janelaAtivaId,
                                 Instant janelaAtivaFim) { }

    public record DashboardCounts(long unidadesTotal, long equipamentosTotal, long equipamentosAtivos,
                                  long equipamentosDisponiveis, long equipamentosDegradados, long equipamentosIndisponiveis,
                                  long equipamentosSemDados, long equipamentosSemMonitoramento,
                                  long equipamentosEmManutencao, long monitoresTotal, long monitoresAtivos, long monitoresDisponiveis,
                                  long monitoresDegradados, long monitoresIndisponiveis, long monitoresSemDados,
                                  long incidentesAbertos) { }
    public record UnidadeCounts(Long id, String nome, String codigoIbge, boolean ativo, long equipamentosTotal, long equipamentosAtivos,
                                long equipamentosDisponiveis, long equipamentosDegradados, long equipamentosIndisponiveis,
                                long equipamentosSemDados, long equipamentosSemMonitoramento,
                                long equipamentosEmManutencao, long monitoresAtivos, long monitoresIndisponiveis, long incidentesAbertos,
                                BigDecimal latitude, BigDecimal longitude, Long conectaAUnidadeId) { }
}
