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

    /**
     * Ultima medicao de cada monitor pedido, com o desempate de sempre (executado_em desc, id desc).
     *
     * <p>Uma busca por monitor no indice {@code ix_medicao_monitor_executado_em}, via LATERAL ... LIMIT 1:
     * o custo e O(monitores), nao O(medicoes). A versao anterior, um NOT EXISTS em JPQL, virava
     * Parallel Hash Anti Join sobre a tabela inteira (606 ms com 317 mil linhas) e, com 20 chamadas
     * simultaneas, os hashes paralelos estouravam o /dev/shm de 64 MB do PostgreSQL em Docker
     * ("could not resize shared memory segment") — o 500 da DV17. O monitor volta como proxy LAZY:
     * quem chama so le o id dele, o que nao dispara consulta. O "between" no lugar de "=" prende o
     * plano ao indice composto mesmo para monitor inativo ha meses; o motivo esta em
     * DashboardReadRepository.ESTADOS.
     */
    @Query(nativeQuery = true, value = """
            select md.* from monitor alvo
            cross join lateral (
                select m.* from medicao m
                where m.monitor_id between alvo.id and alvo.id
                order by m.monitor_id, m.executado_em desc, m.id desc
                limit 1
            ) md
            where alvo.id in (:monitorIds)
            """)
    List<Medicao> findLatestByMonitorIds(@Param("monitorIds") Collection<Long> monitorIds);
    @Query("select md from Medicao md where md.monitor.id in :ids and md.executadoEm >= :inicio and md.executadoEm < :fim") List<Medicao> noPeriodo(@Param("ids") Collection<Long> ids,@Param("inicio") java.time.Instant inicio,@Param("fim") java.time.Instant fim);
}
