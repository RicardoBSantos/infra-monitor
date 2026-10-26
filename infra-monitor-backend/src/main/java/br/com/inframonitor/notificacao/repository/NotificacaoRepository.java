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
     * <p>Sem alvo de conflito, de proposito. As constraints unicas, uma por ancora, sao
     * mutuamente exclusivas por linha, entao nomear uma obrigaria a bifurcar o SQL por
     * ancora. CHECK e FK continuam estourando normalmente: DO NOTHING so ignora conflito
     * de indice unico, e o unico outro indice unico e a PK, inalcancavel com id IDENTITY.
     *
     * <p>Os CAST existem porque tres das quatro ancoras sao sempre nulas e o driver nao infere
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
            INSERT INTO notificacao (incidente_id, episodio_latencia_id, manutencao_agendada_id,
                                     manutencao_manual_id, canal, tipo_evento, status,
                                     tentativas, mensagem, created_at, updated_at)
            VALUES (CAST(:incidenteId AS BIGINT), CAST(:episodioLatenciaId AS BIGINT),
                    CAST(:manutencaoAgendadaId AS BIGINT), CAST(:manutencaoManualId AS BIGINT), :canal, :tipoEvento,
                    'PENDENTE', 0, :mensagem, :agora, :agora)
            ON CONFLICT DO NOTHING
            """, nativeQuery = true)
    int inserirPendenteSeAusente(@Param("incidenteId") Long incidenteId,
                                 @Param("episodioLatenciaId") Long episodioLatenciaId,
                                 @Param("manutencaoAgendadaId") Long manutencaoAgendadaId,
                                 @Param("manutencaoManualId") Long manutencaoManualId,
                                 @Param("canal") String canal,
                                 @Param("tipoEvento") String tipoEvento,
                                 @Param("mensagem") String mensagem,
                                 @Param("agora") java.time.Instant agora);

    @EntityGraph(attributePaths = "incidente")
    List<Notificacao> findByIncidenteId(Long incidenteId);

    @Override
    @EntityGraph(attributePaths = {"incidente", "incidente.monitor", "incidente.monitor.equipamento",
            "incidente.monitor.equipamento.unidade", "episodioLatencia", "episodioLatencia.monitor",
            "episodioLatencia.monitor.equipamento", "episodioLatencia.monitor.equipamento.unidade",
            "manutencaoAgendada", "manutencaoAgendada.unidade", "manutencaoManual",
            "manutencaoManual.equipamento", "manutencaoManual.equipamento.unidade"})
    Optional<Notificacao> findById(Long id);

    @Override
    @EntityGraph(attributePaths = {"incidente", "incidente.monitor", "incidente.monitor.equipamento",
            "incidente.monitor.equipamento.unidade", "episodioLatencia", "episodioLatencia.monitor",
            "episodioLatencia.monitor.equipamento", "episodioLatencia.monitor.equipamento.unidade",
            "manutencaoAgendada", "manutencaoAgendada.unidade", "manutencaoManual",
            "manutencaoManual.equipamento", "manutencaoManual.equipamento.unidade"})
    Page<Notificacao> findAll(Specification<Notificacao> specification, Pageable pageable);

    @Query("select n.id from Notificacao n where n.canal = :canal and n.status = :status "
            + "and n.tentativas < :maxAttempts and (n.proximaTentativaEm is null or n.proximaTentativaEm <= :agora) "
            // MA33: o fim de uma ancora so fica pronto depois que o inicio dela saiu da fila (PENDENTE/ENVIANDO).
            // O proprio inicio nunca se bloqueia: p.id <> n.id e o tipo dele e o de inicio.
            + "and not exists (select 1 from Notificacao p where p.tipoEvento in "
            + "(br.com.inframonitor.notificacao.entity.TipoEventoNotificacao.MANUTENCAO_INICIADA, br.com.inframonitor.notificacao.entity.TipoEventoNotificacao.MANUTENCAO_MANUAL_INICIADA) "
            + "and p.status in (br.com.inframonitor.notificacao.entity.StatusNotificacao.PENDENTE, br.com.inframonitor.notificacao.entity.StatusNotificacao.ENVIANDO) and p.id <> n.id "
            + "and ((n.manutencaoAgendada is not null and p.manutencaoAgendada = n.manutencaoAgendada) "
            + "or (n.manutencaoManual is not null and p.manutencaoManual = n.manutencaoManual))) "
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
     *   mensagem sai. O CAS em si esta correto; o que NAO esta garantido e o aviso
     *   de encerramento que deveria acompanhar a abertura que saiu: a decisao de
     *   cria-lo vem de uma leitura anterior a este UPDATE (divida A4 em
     *   auditoria-concorrencia-ciclo-de-vida.md - o grupo pode receber a abertura e
     *   nunca o encerramento).
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
