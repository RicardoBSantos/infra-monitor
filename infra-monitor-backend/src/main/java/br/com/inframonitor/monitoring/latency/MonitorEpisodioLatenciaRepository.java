package br.com.inframonitor.monitoring.latency;

import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

public interface MonitorEpisodioLatenciaRepository extends JpaRepository<MonitorEpisodioLatencia, Long> {

    @Override
    @EntityGraph(attributePaths = {"monitor", "monitor.equipamento", "monitor.equipamento.unidade"})
    Optional<MonitorEpisodioLatencia> findById(Long id);

    @EntityGraph(attributePaths = {"monitor", "monitor.equipamento", "monitor.equipamento.unidade"})
    Optional<MonitorEpisodioLatencia> findFirstByMonitorIdAndEncerradoEmIsNull(Long monitorId);

    /**
     * Irmao de IncidenteRepository.inserirSeElegivel para o episodio de latencia:
     * mesmo predicado de elegibilidade, mesmo ON CONFLICT DO NOTHING absorvendo
     * uq_monitor_episodio_latencia_aberto. Retorno 0 tem o mesmo significado triplo
     * e a mesma consequencia — nenhuma notificacao nasce.
     *
     * <p>{@code FOR UPDATE OF e}: mesmo buraco e mesma correcao de
     * IncidenteRepository.inserirSeElegivel — ver o comentario la para a mecanica
     * completa e o argumento de ausencia de deadlock (mesma ordem de lock
     * equipamento-antes-de-incidente/episodio nas duas transacoes).
     */
    @Modifying
    @Query(value = """
            INSERT INTO monitor_episodio_latencia (monitor_id, iniciado_em, limiar_ms, created_at, updated_at)
            SELECT m.id, :iniciadoEm, :limiarMs, :agora, :agora
              FROM monitor m JOIN equipamento e ON e.id = m.equipamento_id
             WHERE m.id = :monitorId AND m.ativo AND e.ativo AND e.em_manutencao = false
             FOR UPDATE OF e
            ON CONFLICT DO NOTHING
            """, nativeQuery = true)
    int inserirSeElegivel(@Param("monitorId") Long monitorId, @Param("iniciadoEm") Instant iniciadoEm,
                          @Param("limiarMs") int limiarMs, @Param("agora") Instant agora);

    // Irmao de IncidenteRepository.abertosDoEquipamento: grafo minimo de proposito. O
    // chamador so usa esta lista para extrair ids ANTES do bulk update; ver o
    // comentario la para o porque de nao widenar aqui.
    @EntityGraph(attributePaths = "monitor")
    @Query("select e from MonitorEpisodioLatencia e where e.monitor.equipamento.id = :equipamentoId "
            + "and e.encerradoEm is null")
    List<MonitorEpisodioLatencia> abertosDoEquipamento(@Param("equipamentoId") Long equipamentoId);

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("update MonitorEpisodioLatencia e set e.encerradoEm = :agora, "
            + "e.motivoEncerramento = br.com.inframonitor.monitoring.latency.MotivoEncerramentoEpisodio.MANUTENCAO, "
            + "e.updatedAt = :agora "
            + "where e.monitor.equipamento.id = :equipamentoId and e.encerradoEm is null")
    int encerrarPorManutencao(@Param("equipamentoId") Long equipamentoId, @Param("agora") Instant agora);

    /**
     * Normalizacao como CAS: 0 linhas quando a manutencao (ou outro ciclo) encerrou o episodio
     * entre a leitura do processor e aqui. So colunas de encerramento — o saveAndFlush da
     * entidade lida antes regravava a linha inteira por cima de um encerramento commitado.
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("update MonitorEpisodioLatencia e set e.encerradoEm = :encerradoEm, "
            + "e.motivoEncerramento = br.com.inframonitor.monitoring.latency.MotivoEncerramentoEpisodio.NORMALIZACAO, "
            + "e.updatedAt = :agora where e.id = :id and e.encerradoEm is null")
    int encerrarPorNormalizacaoSeAberto(@Param("id") Long id, @Param("encerradoEm") Instant encerradoEm,
                                        @Param("agora") Instant agora);

    /**
     * Releitura pos-bulk-update, irma de IncidenteRepository.findAllById. Sem isto a
     * mensagem de encerramento do episodio saira com "Fim: null" — encerrarPorManutencao
     * e clearAutomatically, e nao repropaga para as instancias ja carregadas em
     * abertosDoEquipamento.
     */
    @Override
    @EntityGraph(attributePaths = {"monitor", "monitor.equipamento", "monitor.equipamento.unidade"})
    List<MonitorEpisodioLatencia> findAllById(Iterable<Long> ids);
}
