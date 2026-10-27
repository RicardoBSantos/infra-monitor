package br.com.inframonitor.monitor.repository;

import br.com.inframonitor.monitor.entity.Monitor;
import br.com.inframonitor.monitoring.execution.MonitorCandidate;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Query;

import java.util.Optional;
import java.util.Collection;

public interface MonitorRepository extends JpaRepository<Monitor, Long>, JpaSpecificationExecutor<Monitor> {
    boolean existsByEquipamentoId(Long equipamentoId);

    @Override @EntityGraph(attributePaths = {"equipamento", "equipamento.unidade"})
    Optional<Monitor> findById(Long id);

    @Override @EntityGraph(attributePaths = {"equipamento", "equipamento.unidade"})
    Page<Monitor> findAll(Specification<Monitor> specification, Pageable pageable);

    /**
     * Busca os dados necessarios para o agendamento e a ultima medicao em uma
     * unica consulta. O engine filtra o intervalo em memoria, sem N+1.
     *
     * <p>A ultima medicao e subconsulta correlacionada com LIMIT 1 em ix_medicao_monitor_executado_em,
     * o mesmo custo do LATERAL ... LIMIT 1 da DV17: uma leitura por monitor. O left join com group by
     * que vivia aqui lia a medicao inteira a cada tick de 1 s do agendador: 0,2 s com 317 mil linhas,
     * 6,9 s com 15,9 milhoes. O "between" no lugar de "=" prende o plano ao indice composto; o motivo
     * esta em DashboardReadRepository.ESTADOS.
     */
    @Query("""
            select new br.com.inframonitor.monitoring.execution.MonitorCandidate(
                m.id, m.tipo, m.intervaloSegundos, m.timeoutMs, e.ip,
                (select md.executadoEm from Medicao md
                  where md.monitor.id between m.id and m.id
                  order by md.monitor.id, md.executadoEm desc
                  limit 1))
            from Monitor m
            join m.equipamento e
            where m.ativo = true and e.ativo = true and e.emManutencao = false
            """)
    java.util.List<MonitorCandidate> findActiveExecutionCandidates();

    @EntityGraph(attributePaths = "equipamento")
    java.util.List<Monitor> findByEquipamentoIdIn(Collection<Long> equipamentoIds);
}
