-- Oraculo congelado: MedicaoRepository.findLatestByMonitorIds antes do "between" (com "=" o plano
-- podia varrer ix_medicao_executado_em inteiro para monitor sem medicao recente).
-- Nao editar: o teste de equivalencia compara a versao atual com esta.
select md.* from monitor alvo
cross join lateral (
    select m.* from medicao m
    where m.monitor_id = alvo.id
    order by m.executado_em desc, m.id desc
    limit 1
) md
where alvo.id in (:monitorIds)
