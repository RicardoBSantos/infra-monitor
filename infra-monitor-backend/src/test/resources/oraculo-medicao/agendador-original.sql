-- Oraculo congelado: SQL equivalente ao JPQL de MonitorRepository.findActiveExecutionCandidates
-- antes da correcao (left join + max + group by: lia a medicao inteira a cada tick do agendador).
-- Nao editar: os testes de equivalencia e de leitura limitada comparam a versao atual com esta.
select m.id monitor_id, m.tipo, m.intervalo_segundos, m.timeout_ms, e.ip_address ip, max(md.executado_em) ultima_medicao_em
  from monitor m
  join equipamento e on e.id = m.equipamento_id
  left join medicao md on md.monitor_id = m.id
 where m.ativo = true and e.ativo = true and e.em_manutencao = false
 group by m.id, m.tipo, m.intervalo_segundos, m.timeout_ms, e.ip_address
