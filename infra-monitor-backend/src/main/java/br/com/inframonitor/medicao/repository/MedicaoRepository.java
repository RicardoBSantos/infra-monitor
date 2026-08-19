package br.com.inframonitor.medicao.repository;

import br.com.inframonitor.medicao.entity.Medicao;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;

import java.util.Optional;
import java.util.List;

public interface MedicaoRepository extends JpaRepository<Medicao, Long>, JpaSpecificationExecutor<Medicao> {

    boolean existsByMonitorId(Long monitorId);

    @Override
    @EntityGraph(attributePaths = "monitor")
    Optional<Medicao> findById(Long id);

    @Override
    @EntityGraph(attributePaths = "monitor")
    Page<Medicao> findAll(Specification<Medicao> specification, Pageable pageable);

    @EntityGraph(attributePaths = "monitor")
    Optional<Medicao> findFirstByMonitorIdOrderByExecutadoEmDescIdDesc(Long monitorId);

    List<Medicao> findByMonitorIdOrderByExecutadoEmDescIdDesc(Long monitorId, Pageable pageable);
}
