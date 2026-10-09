package br.com.inframonitor.monitoring.latency.service;

import br.com.inframonitor.common.exception.RecursoNaoEncontradoException;
import br.com.inframonitor.equipamento.entity.Equipamento;
import br.com.inframonitor.monitor.entity.Monitor;
import br.com.inframonitor.monitoring.latency.MonitorEpisodioLatencia;
import br.com.inframonitor.monitoring.latency.MonitorEpisodioLatenciaRepository;
import br.com.inframonitor.monitoring.latency.dto.EpisodioLatenciaResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Leitura por id. Nao ha listagem aqui de proposito: a lista de episodios e servida
 * junto com a de incidentes por GET /dashboard/incidentes.
 */
@Service
@Transactional(readOnly = true)
public class EpisodioLatenciaService {

    private final MonitorEpisodioLatenciaRepository repository;
    /** Mesmo N que o {@code LatencyEpisodeProcessor} exige para abrir e para fechar. */
    private final int ciclos;

    public EpisodioLatenciaService(MonitorEpisodioLatenciaRepository repository,
                                   @Value("${monitoring.latencia-ciclos:2}") int ciclos) {
        this.repository = repository;
        this.ciclos = ciclos;
    }

    public EpisodioLatenciaResponse buscarPorId(Long id) {
        MonitorEpisodioLatencia episodio = repository.findById(id)
                .orElseThrow(() -> new RecursoNaoEncontradoException("Episodio de latencia nao encontrado"));
        Monitor monitor = episodio.getMonitor();
        Equipamento equipamento = monitor.getEquipamento();
        return new EpisodioLatenciaResponse(episodio.getId(), monitor.getId(), monitor.getNome(),
                equipamento.getId(), equipamento.getNome(),
                equipamento.getUnidade().getId(), equipamento.getUnidade().getNome(),
                episodio.getIniciadoEm(), episodio.getEncerradoEm(), episodio.getLimiarMs(), ciclos,
                episodio.getMotivoEncerramento());
    }
}
