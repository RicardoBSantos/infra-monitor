-- Oraculo congelado: ESTADOS de DashboardReadRepository antes da DV19 (distinct on sobre a medicao inteira).
-- Nao editar: os testes de equivalencia e de leitura limitada comparam a versao atual com esta.
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
