package br.com.inframonitor.incidente.repository;

import br.com.inframonitor.incidente.entity.Incidente;
import br.com.inframonitor.incidente.entity.StatusIncidente;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Query;

import java.util.Optional;
import java.util.Collection;
import java.util.List;

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

    @EntityGraph(attributePaths = "monitor")
    List<Incidente> findByMonitorIdInAndStatus(Collection<Long> monitorIds, StatusIncidente status);
    @Query("select i from Incidente i where i.monitor.id in :ids and i.iniciadoEm < :fim and (i.encerradoEm is null or i.encerradoEm > :inicio)") List<Incidente> noPeriodo(@org.springframework.data.repository.query.Param("ids") Collection<Long> ids,@org.springframework.data.repository.query.Param("inicio") java.time.Instant inicio,@org.springframework.data.repository.query.Param("fim") java.time.Instant fim);
}
