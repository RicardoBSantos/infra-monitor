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
import java.util.Collection;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

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

    @Query("""
            select md from Medicao md join fetch md.monitor m
            where m.id in :monitorIds
              and not exists (
                select 1 from Medicao posterior
                where posterior.monitor = m
                  and (posterior.executadoEm > md.executadoEm
                    or (posterior.executadoEm = md.executadoEm and posterior.id > md.id))
              )
            """)
    List<Medicao> findLatestByMonitorIds(@Param("monitorIds") Collection<Long> monitorIds);
}
