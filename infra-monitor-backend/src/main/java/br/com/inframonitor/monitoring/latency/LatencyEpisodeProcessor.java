package br.com.inframonitor.monitoring.latency;

import br.com.inframonitor.incidente.entity.StatusIncidente;
import br.com.inframonitor.incidente.repository.IncidenteRepository;
import br.com.inframonitor.medicao.entity.Medicao;
import br.com.inframonitor.medicao.entity.StatusMedicao;
import br.com.inframonitor.medicao.repository.MedicaoRepository;
import br.com.inframonitor.monitor.entity.Monitor;
import br.com.inframonitor.notificacao.service.NotificacaoService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Optional;
import java.util.function.Predicate;

/**
 * Abre e fecha episodios de latencia alta a partir da cauda recente das medicoes.
 *
 * <p>Deliberadamente separado do {@code IncidentProcessor}: cada um roda em sua propria
 * transacao REQUIRES_NEW, entao uma falha na avaliacao de latencia — que e acessoria —
 * nao provoca rollback da deteccao de indisponibilidade, que e o caminho critico.
 *
 * <p>Nao mantem contador: assim como o limite de falhas consecutivas do incidente, a
 * decisao le as ultimas N medicoes e exige que todas satisfacam o predicado.
 */
@Component
public class LatencyEpisodeProcessor {
    private static final Logger log = LoggerFactory.getLogger(LatencyEpisodeProcessor.class);

    private final MedicaoRepository medicaoRepository;
    private final IncidenteRepository incidenteRepository;
    private final MonitorEpisodioLatenciaRepository episodioRepository;
    private final NotificacaoService notificacaoService;
    private final int limiarMs;
    private final int ciclos;

    public LatencyEpisodeProcessor(MedicaoRepository medicaoRepository, IncidenteRepository incidenteRepository,
                                   MonitorEpisodioLatenciaRepository episodioRepository,
                                   NotificacaoService notificacaoService,
                                   @Value("${monitoring.latencia-degradada-ms:250}") int limiarMs,
                                   @Value("${monitoring.latencia-ciclos:2}") int ciclos) {
        this.medicaoRepository = medicaoRepository;
        this.incidenteRepository = incidenteRepository;
        this.episodioRepository = episodioRepository;
        this.notificacaoService = notificacaoService;
        this.limiarMs = limiarMs;
        this.ciclos = ciclos;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void process(Medicao medicaoPersistida) {
        Long monitorId = medicaoPersistida.getMonitor().getId();
        Optional<Medicao> ultima = medicaoRepository.findFirstByMonitorIdOrderByExecutadoEmDescIdDesc(monitorId);
        if (ultima.isEmpty() || !ultima.get().getId().equals(medicaoPersistida.getId())) {
            log.debug("Ignoring delayed measurement {} for latency processing", medicaoPersistida.getId());
            return;
        }

        Optional<MonitorEpisodioLatencia> episodioAberto =
                episodioRepository.findFirstByMonitorIdAndEncerradoEmIsNull(monitorId);

        // Indisponibilidade ganha de degradacao: com incidente aberto o episodio nao teria
        // como fechar sozinho (medicoes em FALHA nao tem latencia). Encerra em silencio,
        // sem LATENCIA_NORMALIZADA — nao normalizou, piorou.
        if (incidenteRepository.findFirstByMonitorIdAndStatusInOrderByIniciadoEmDescIdDesc(
                monitorId, StatusIncidente.EM_ABERTO).isPresent()) {
            episodioAberto.ifPresent(episodio -> {
                episodio.encerrar(medicaoPersistida.getExecutadoEm());
                log.info("Latency episode {} closed by incident for monitor {}", episodio.getId(), monitorId);
            });
            return;
        }

        if (episodioAberto.isPresent()) {
            processarNormalizacao(episodioAberto.get(), medicaoPersistida);
        } else {
            processarAbertura(medicaoPersistida.getMonitor(), monitorId);
        }
    }

    private void processarAbertura(Monitor monitor, Long monitorId) {
        List<Medicao> medicoes = ultimasMedicoes(monitorId);
        if (!sequenciaCompleta(medicoes, this::acimaDoLimiar)) {
            log.debug("Latency threshold not reached for monitor {}", monitorId);
            return;
        }
        // A lista esta DESC; a ultima posicao e a primeira medicao degradada da sequencia.
        MonitorEpisodioLatencia episodio = new MonitorEpisodioLatencia(monitor,
                medicoes.get(medicoes.size() - 1).getExecutadoEm(), limiarMs);
        try {
            episodioRepository.saveAndFlush(episodio);
        } catch (DataIntegrityViolationException ex) {
            // uq_monitor_episodio_latencia_aberto resolve a corrida concorrente.
            log.warn("Concurrent latency episode opening for monitor {} was resolved by another processing", monitorId);
            return;
        }
        notificacaoService.criarParaLatenciaAlta(episodio);
        log.info("Latency episode {} opened for monitor {}", episodio.getId(), monitorId);
    }

    private void processarNormalizacao(MonitorEpisodioLatencia episodio, Medicao atual) {
        Long monitorId = episodio.getMonitor().getId();
        List<Medicao> medicoes = ultimasMedicoes(monitorId);
        if (!sequenciaCompleta(medicoes, this::dentroDoLimiar)) {
            log.debug("Latency recovery not reached for monitor {}", monitorId);
            return;
        }
        episodio.encerrar(atual.getExecutadoEm());
        episodioRepository.saveAndFlush(episodio);
        notificacaoService.criarParaLatenciaNormalizada(episodio);
        log.info("Latency episode {} normalized for monitor {}", episodio.getId(), monitorId);
    }

    private List<Medicao> ultimasMedicoes(Long monitorId) {
        return medicaoRepository.findByMonitorIdOrderByExecutadoEmDescIdDesc(monitorId, PageRequest.of(0, ciclos));
    }

    private boolean sequenciaCompleta(List<Medicao> medicoes, Predicate<Medicao> criterio) {
        return medicoes.size() == ciclos && medicoes.stream().allMatch(criterio);
    }

    /** So medicao bem-sucedida tem latencia; uma FALHA na janela interrompe a sequencia. */
    private boolean acimaDoLimiar(Medicao medicao) {
        return medicao.getStatus() == StatusMedicao.SUCESSO
                && medicao.getLatenciaMs() != null && medicao.getLatenciaMs() > limiarMs;
    }

    private boolean dentroDoLimiar(Medicao medicao) {
        return medicao.getStatus() == StatusMedicao.SUCESSO
                && medicao.getLatenciaMs() != null && medicao.getLatenciaMs() <= limiarMs;
    }
}
