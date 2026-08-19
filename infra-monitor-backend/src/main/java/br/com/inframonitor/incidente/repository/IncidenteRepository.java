package br.com.inframonitor.incidente.repository;

import br.com.inframonitor.incidente.entity.Incidente;
import br.com.inframonitor.incidente.entity.StatusIncidente;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;

import java.util.Optional;

public interface IncidenteRepository extends JpaRepository<Incidente, Long>, JpaSpecificationExecutor<Incidente> {

    boolean existsByMonitorId(Long monitorId);

    boolean existsByMonitorIdAndStatus(Long monitorId, StatusIncidente status);

    @Override
    @EntityGraph(attributePaths = {"monitor", "monitor.equipamento", "monitor.equipamento.unidade"})
    Optional<Incidente> findById(Long id);

    @Override
    @EntityGraph(attributePaths = {"monitor", "monitor.equipamento", "monitor.equipamento.unidade"})
    Page<Incidente> findAll(Specification<Incidente> specification, Pageable pageable);

    @EntityGraph(attributePaths = {"monitor", "monitor.equipamento", "monitor.equipamento.unidade"})
    Optional<Incidente> findFirstByMonitorIdAndStatusOrderByIniciadoEmDescIdDesc(Long monitorId, StatusIncidente status);
}
