package br.com.inframonitor.monitoring.latency;

import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
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
     */
    @Modifying
    @Query(value = """
            INSERT INTO monitor_episodio_latencia (monitor_id, iniciado_em, limiar_ms, created_at, updated_at)
            SELECT m.id, :iniciadoEm, :limiarMs, :agora, :agora
              FROM monitor m JOIN equipamento e ON e.id = m.equipamento_id
             WHERE m.id = :monitorId AND m.ativo AND e.ativo AND e.em_manutencao = false
            ON CONFLICT DO NOTHING
            """, nativeQuery = true)
    int inserirSeElegivel(@Param("monitorId") Long monitorId, @Param("iniciadoEm") Instant iniciadoEm,
                          @Param("limiarMs") int limiarMs, @Param("agora") Instant agora);
}
