package br.com.inframonitor.notificacao.repository;

import br.com.inframonitor.notificacao.entity.CanalNotificacao;
import br.com.inframonitor.notificacao.entity.Notificacao;
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

    /**
     * Insercao idempotente da notificacao pendente. O ON CONFLICT DO NOTHING deixa a
     * unicidade inteiramente para o banco: nao ha SELECT previo, nao ha excecao a
     * absorver, e duas transacoes concorrentes convergem para uma unica linha.
     *
     * <p>Sem alvo de conflito, de proposito. As duas constraints unicas
     * (uq_notificacao_incidente_canal_evento e uq_notificacao_episodio_canal_evento) sao
     * mutuamente exclusivas por linha, entao nomear uma obrigaria a bifurcar o SQL por
     * ancora. CHECK e FK continuam estourando normalmente: DO NOTHING so ignora conflito
     * de indice unico, e o unico outro indice unico e a PK, inalcancavel com id IDENTITY.
     *
     * <p>Os CAST existem porque uma das duas ancoras e sempre nula e o driver nao infere
     * o tipo de um parametro nulo em query nativa.
     *
     * <p>created_at/updated_at vem da aplicacao, e nao do DEFAULT CURRENT_TIMESTAMP, para
     * manter o relogio onde o @PrePersist da entidade o tinha: CURRENT_TIMESTAMP e o
     * instante de inicio da transacao, nao o da insercao.
     *
     * @return 1 quando inseriu, 0 quando a notificacao ja existia.
     */
    @Modifying
    @Query(value = """
            INSERT INTO notificacao (incidente_id, episodio_latencia_id, canal, tipo_evento, status,
                                     tentativas, mensagem, created_at, updated_at)
            VALUES (CAST(:incidenteId AS BIGINT), CAST(:episodioLatenciaId AS BIGINT), :canal, :tipoEvento,
                    'PENDENTE', 0, :mensagem, :agora, :agora)
            ON CONFLICT DO NOTHING
            """, nativeQuery = true)
    int inserirPendenteSeAusente(@Param("incidenteId") Long incidenteId,
                                 @Param("episodioLatenciaId") Long episodioLatenciaId,
                                 @Param("canal") String canal,
                                 @Param("tipoEvento") String tipoEvento,
                                 @Param("mensagem") String mensagem,
                                 @Param("agora") java.time.Instant agora);

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

    /**
     * CAS contra PENDENTE, mesmo idioma de reserveForDispatch. As duas instrucoes
     * disputam a mesma linha e o Postgres serializa:
     * - cancelamento primeiro: reserveForDispatch encontra CANCELADA, atualiza 0, o
     *   dispatcher desiste;
     * - reserva primeiro: a linha ja e ENVIANDO, o cancelamento atualiza 0 e a
     *   mensagem sai. Aceito e deliberado.
     *
     * <p>Escopo por incidente e nao por tipo de evento: na pratica so existe um
     * INCIDENTE_ABERTO pendente, mas amarrar a regra a uma enumeracao que a V15 ja
     * mostrou que cresce e' criar um bug futuro.
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("update Notificacao n set n.status = br.com.inframonitor.notificacao.entity.StatusNotificacao.CANCELADA, "
            + "n.updatedAt = :agora where n.incidente.id = :incidenteId "
            + "and n.status = br.com.inframonitor.notificacao.entity.StatusNotificacao.PENDENTE")
    int cancelarPendentesDoIncidente(@Param("incidenteId") Long incidenteId, @Param("agora") java.time.Instant agora);

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("update Notificacao n set n.status = br.com.inframonitor.notificacao.entity.StatusNotificacao.CANCELADA, "
            + "n.updatedAt = :agora where n.episodioLatencia.id = :episodioId "
            + "and n.status = br.com.inframonitor.notificacao.entity.StatusNotificacao.PENDENTE")
    int cancelarPendentesDoEpisodio(@Param("episodioId") Long episodioId, @Param("agora") java.time.Instant agora);

    /** ENVIANDO ou ENVIADA: a mensagem saiu, ou esta saindo. So nesses casos o grupo
     *  precisa do aviso de encerramento. */
    @Query("select count(n) > 0 from Notificacao n where n.incidente.id = :incidenteId "
            + "and n.tipoEvento = br.com.inframonitor.notificacao.entity.TipoEventoNotificacao.INCIDENTE_ABERTO "
            + "and n.status in (br.com.inframonitor.notificacao.entity.StatusNotificacao.ENVIANDO, "
            + "br.com.inframonitor.notificacao.entity.StatusNotificacao.ENVIADA)")
    boolean existeAberturaJaDespachada(@Param("incidenteId") Long incidenteId);

    @Query("select count(n) > 0 from Notificacao n where n.episodioLatencia.id = :episodioId "
            + "and n.tipoEvento = br.com.inframonitor.notificacao.entity.TipoEventoNotificacao.LATENCIA_ALTA "
            + "and n.status in (br.com.inframonitor.notificacao.entity.StatusNotificacao.ENVIANDO, "
            + "br.com.inframonitor.notificacao.entity.StatusNotificacao.ENVIADA)")
    boolean existeAberturaJaDespachadaDoEpisodio(@Param("episodioId") Long episodioId);
}
