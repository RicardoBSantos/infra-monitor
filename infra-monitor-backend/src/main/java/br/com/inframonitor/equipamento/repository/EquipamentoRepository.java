package br.com.inframonitor.equipamento.repository;

import br.com.inframonitor.equipamento.entity.Equipamento;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.Optional;
import java.util.List;

public interface EquipamentoRepository extends JpaRepository<Equipamento, Long>, JpaSpecificationExecutor<Equipamento> {

    boolean existsByUnidadeId(Long unidadeId);

    boolean existsByTipoEquipamentoId(Long tipoEquipamentoId);

    @Override
    @EntityGraph(attributePaths = {"unidade", "tipoEquipamento"})
    Optional<Equipamento> findById(Long id);

    @Override
    @EntityGraph(attributePaths = {"unidade", "tipoEquipamento"})
    Page<Equipamento> findAll(Specification<Equipamento> specification, Pageable pageable);

    @EntityGraph(attributePaths = {"unidade", "tipoEquipamento"})
    List<Equipamento> findAllByUnidadeId(Long unidadeId);

    @Override
    @EntityGraph(attributePaths = {"unidade", "tipoEquipamento"})
    List<Equipamento> findAll();

    // CAS: dois operadores clicando juntos nao rodam os efeitos colaterais duas
    // vezes. Retorno 0 = ja estava em manutencao.
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("update Equipamento e set e.emManutencao = true, e.updatedAt = :agora "
            + "where e.id = :id and e.emManutencao = false")
    int marcarEmManutencaoSeNaoEstiver(@Param("id") Long id, @Param("agora") Instant agora);

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("update Equipamento e set e.emManutencao = false, e.updatedAt = :agora "
            + "where e.id = :id and e.emManutencao = true")
    int desmarcarManutencaoSeEstiver(@Param("id") Long id, @Param("agora") Instant agora);
}
