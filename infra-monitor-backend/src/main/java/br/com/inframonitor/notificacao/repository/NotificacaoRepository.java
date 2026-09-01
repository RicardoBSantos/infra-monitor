package br.com.inframonitor.notificacao.repository;

import br.com.inframonitor.notificacao.entity.CanalNotificacao;
import br.com.inframonitor.notificacao.entity.Notificacao;
import br.com.inframonitor.notificacao.entity.TipoEventoNotificacao;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;
import java.util.List;

public interface NotificacaoRepository extends JpaRepository<Notificacao, Long>, JpaSpecificationExecutor<Notificacao> {

    boolean existsByIncidenteIdAndCanalAndTipoEvento(Long incidenteId, CanalNotificacao canal,
                                                     TipoEventoNotificacao tipoEvento);

    boolean existsByEpisodioLatenciaIdAndCanalAndTipoEvento(Long episodioLatenciaId, CanalNotificacao canal,
                                                            TipoEventoNotificacao tipoEvento);

    @EntityGraph(attributePaths = "incidente")
    List<Notificacao> findByIncidenteId(Long incidenteId);

    @Override
    @EntityGraph(attributePaths = {"incidente", "incidente.monitor", "incidente.monitor.equipamento",
            "incidente.monitor.equipamento.unidade", "episodioLatencia", "episodioLatencia.monitor",
            "episodioLatencia.monitor.equipamento", "episodioLatencia.monitor.equipamento.unidade"})
    Optional<Notificacao> findById(Long id);

    @Override
    @EntityGraph(attributePaths = {"incidente", "incidente.monitor", "incidente.monitor.equipamento",
            "incidente.monitor.equipamento.unidade", "episodioLatencia", "episodioLatencia.monitor",
            "episodioLatencia.monitor.equipamento", "episodioLatencia.monitor.equipamento.unidade"})
    Page<Notificacao> findAll(Specification<Notificacao> specification, Pageable pageable);

    @Query("select n.id from Notificacao n where n.canal = :canal and n.status = :status "
            + "and n.tentativas < :maxAttempts and (n.proximaTentativaEm is null or n.proximaTentativaEm <= :agora) "
            + "order by n.proximaTentativaEm asc, n.createdAt asc")
    List<Long> findIdsReadyForDispatch(@Param("canal") CanalNotificacao canal,
                                       @Param("status") br.com.inframonitor.notificacao.entity.StatusNotificacao status,
                                       @Param("maxAttempts") int maxAttempts, @Param("agora") java.time.Instant agora,
                                       Pageable pageable);

    @Modifying
    @Query("update Notificacao n set n.status = br.com.inframonitor.notificacao.entity.StatusNotificacao.ENVIANDO, n.updatedAt = :agora "
            + "where n.id = :id and n.status = br.com.inframonitor.notificacao.entity.StatusNotificacao.PENDENTE")
    int reserveForDispatch(@Param("id") Long id, @Param("agora") java.time.Instant agora);

    @Modifying
    @Query("update Notificacao n set n.status = br.com.inframonitor.notificacao.entity.StatusNotificacao.PENDENTE "
            + "where n.status = br.com.inframonitor.notificacao.entity.StatusNotificacao.ENVIANDO and n.updatedAt < :limite")
    int releaseStaleSending(@Param("limite") java.time.Instant limite);
}
