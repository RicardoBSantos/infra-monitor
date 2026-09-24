package br.com.inframonitor.incidente.repository;

import br.com.inframonitor.incidente.entity.Incidente;
import br.com.inframonitor.incidente.entity.StatusIncidente;
import br.com.inframonitor.usuario.entity.Usuario;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.Optional;
import java.util.Collection;
import java.util.List;

public interface IncidenteRepository extends JpaRepository<Incidente, Long>, JpaSpecificationExecutor<Incidente> {

    boolean existsByMonitorId(Long monitorId);

    // Os metodos abaixo recebem colecao de status porque a pergunta que interessa ao
    // dominio e "existe incidente em aberto?", e em aberto sao dois estados desde a
    // V16: ABERTO e RECONHECIDO. Ver StatusIncidente.EM_ABERTO.
    boolean existsByMonitorIdAndStatusIn(Long monitorId, Collection<StatusIncidente> status);

    @Override
    @EntityGraph(attributePaths = {"monitor", "monitor.equipamento", "monitor.equipamento.unidade", "reconhecidoPor", "fechadoPor"})
    Optional<Incidente> findById(Long id);

    @Override
    @EntityGraph(attributePaths = {"monitor", "monitor.equipamento", "monitor.equipamento.unidade", "reconhecidoPor", "fechadoPor"})
    Page<Incidente> findAll(Specification<Incidente> specification, Pageable pageable);

    @EntityGraph(attributePaths = {"monitor", "monitor.equipamento", "monitor.equipamento.unidade", "reconhecidoPor", "fechadoPor"})
    Optional<Incidente> findFirstByMonitorIdAndStatusInOrderByIniciadoEmDescIdDesc(Long monitorId,
            Collection<StatusIncidente> status);

    @EntityGraph(attributePaths = "monitor")
    List<Incidente> findByMonitorIdInAndStatusIn(Collection<Long> monitorIds, Collection<StatusIncidente> status);
    @Query("select i from Incidente i where i.monitor.id in :ids and i.iniciadoEm < :fim and (i.encerradoEm is null or i.encerradoEm > :inicio)") List<Incidente> noPeriodo(@Param("ids") Collection<Long> ids,@Param("inicio") java.time.Instant inicio,@Param("fim") java.time.Instant fim);

    /**
     * Compara-e-troca contra ABERTO. O motor de incidentes roda a cada ciclo de ping e
     * pode fechar este mesmo incidente enquanto o operador clica em Reconhecer; um
     * read-modify-write comum perderia esse fechamento e ressuscitaria o incidente com
     * encerrado_em de volta para NULL. Mesmo idioma de NotificacaoRepository.reserveForDispatch.
     *
     * <p>Retorna 1 quando reconheceu e 0 quando o incidente ja saiu de ABERTO. Por ser
     * bulk update, {@code @PreUpdate} nao dispara — dai updatedAt explicito no SET — e o
     * contexto de persistencia precisa ser sincronizado nas duas pontas.
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("update Incidente i set i.status = br.com.inframonitor.incidente.entity.StatusIncidente.RECONHECIDO, "
            + "i.reconhecidoEm = :agora, i.reconhecidoPor = :usuario, i.updatedAt = :agora "
            + "where i.id = :id and i.status = br.com.inframonitor.incidente.entity.StatusIncidente.ABERTO")
    int reconhecerSeAberto(@Param("id") Long id, @Param("usuario") Usuario usuario, @Param("agora") Instant agora);
}
