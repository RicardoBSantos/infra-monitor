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

public interface MonitorRepository extends JpaRepository<Monitor, Long>, JpaSpecificationExecutor<Monitor> {
    boolean existsByEquipamentoId(Long equipamentoId);

    @Override @EntityGraph(attributePaths = {"equipamento", "equipamento.unidade"})
    Optional<Monitor> findById(Long id);

    @Override @EntityGraph(attributePaths = {"equipamento", "equipamento.unidade"})
    Page<Monitor> findAll(Specification<Monitor> specification, Pageable pageable);

    /**
     * Busca os dados necessarios para o agendamento e a ultima medicao em uma
     * unica consulta. O engine filtra o intervalo em memoria, sem N+1.
     */
    @Query("""
            select new br.com.inframonitor.monitoring.execution.MonitorCandidate(
                m.id, m.tipo, m.intervaloSegundos, m.timeoutMs, e.ip, max(md.executadoEm))
            from Monitor m
            join m.equipamento e
            left join Medicao md on md.monitor = m
            where m.ativo = true and e.ativo = true
            group by m.id, m.tipo, m.intervaloSegundos, m.timeoutMs, e.ip
            """)
    java.util.List<MonitorCandidate> findActiveExecutionCandidates();
}
