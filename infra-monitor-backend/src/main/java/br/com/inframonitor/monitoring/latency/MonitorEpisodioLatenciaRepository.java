package br.com.inframonitor.monitoring.latency;

import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface MonitorEpisodioLatenciaRepository extends JpaRepository<MonitorEpisodioLatencia, Long> {

    @EntityGraph(attributePaths = {"monitor", "monitor.equipamento", "monitor.equipamento.unidade"})
    Optional<MonitorEpisodioLatencia> findFirstByMonitorIdAndEncerradoEmIsNull(Long monitorId);
}
