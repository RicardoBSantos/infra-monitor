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

    interface EstadoManutencaoTravado {
        boolean getEmManutencao();
        boolean getManutencaoManual();
    }

    // Ponto de serializacao unico de tudo que mexe em manutencao: o mesmo lock de linha que
    // IncidenteRepository.inserirSeElegivel e travarElegibilidadeParaAbertura (M7) tomam.
    // SO a linha: a cobertura por janela e lida em instrucao SEPARADA, depois do lock
    // (ver EstadoManutencaoEquipamento).
    @Query(value = "SELECT em_manutencao AS emManutencao, manutencao_manual AS manutencaoManual "
            + "FROM equipamento WHERE id = :id FOR UPDATE", nativeQuery = true)
    Optional<EstadoManutencaoTravado> travarEstadoManutencao(@Param("id") Long id);

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query(value = "UPDATE equipamento SET manutencao_manual = true, em_manutencao = true, updated_at = :agora "
            + "WHERE id = :id AND NOT manutencao_manual", nativeQuery = true)
    int marcarManual(@Param("id") Long id, @Param("agora") Instant agora);

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query(value = "UPDATE equipamento SET manutencao_manual = false, updated_at = :agora "
            + "WHERE id = :id AND manutencao_manual", nativeQuery = true)
    int desmarcarManual(@Param("id") Long id, @Param("agora") Instant agora);

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query(value = "UPDATE equipamento SET em_manutencao = :novo, updated_at = :agora "
            + "WHERE id = :id AND em_manutencao = :anterior", nativeQuery = true)
    int trocarEmManutencao(@Param("id") Long id, @Param("anterior") boolean anterior,
                           @Param("novo") boolean novo, @Param("agora") Instant agora);
}
