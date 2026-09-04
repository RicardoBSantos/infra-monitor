package br.com.inframonitor.monitoring.incident;

import br.com.inframonitor.common.exception.ConflitoException;
import br.com.inframonitor.incidente.entity.Incidente;
import br.com.inframonitor.incidente.entity.StatusIncidente;
import br.com.inframonitor.incidente.repository.IncidenteRepository;
import br.com.inframonitor.incidente.service.IncidenteService;
import br.com.inframonitor.medicao.entity.Medicao;
import br.com.inframonitor.medicao.entity.StatusMedicao;
import br.com.inframonitor.medicao.repository.MedicaoRepository;
import br.com.inframonitor.monitor.entity.Monitor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Optional;

/** Interpreta somente a cauda recente e cronologicamente atual das medicoes de um monitor. */
@Component
public class IncidentProcessor {
    private static final Logger log = LoggerFactory.getLogger(IncidentProcessor.class);

    private final MedicaoRepository medicaoRepository;
    private final IncidenteRepository incidenteRepository;
    private final IncidenteService incidenteService;

    public IncidentProcessor(MedicaoRepository medicaoRepository, IncidenteRepository incidenteRepository,
                             IncidenteService incidenteService) {
        this.medicaoRepository = medicaoRepository;
        this.incidenteRepository = incidenteRepository;
        this.incidenteService = incidenteService;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void process(Medicao medicaoPersistida) {
        Long monitorId = medicaoPersistida.getMonitor().getId();
        Optional<Medicao> ultima = medicaoRepository.findFirstByMonitorIdOrderByExecutadoEmDescIdDesc(monitorId);
        if (ultima.isEmpty() || !ultima.get().getId().equals(medicaoPersistida.getId())) {
            log.debug("Ignoring delayed measurement {} for incident processing", medicaoPersistida.getId());
            return;
        }

        Monitor monitor = medicaoPersistida.getMonitor();
        Optional<Incidente> incidenteAberto = incidenteRepository
                .findFirstByMonitorIdAndStatusInOrderByIniciadoEmDescIdDesc(monitorId, StatusIncidente.EM_ABERTO);
        if (incidenteAberto.isPresent()) {
            processarRecovery(monitor, incidenteAberto.get(), medicaoPersistida);
        } else {
            processarAbertura(monitor, medicaoPersistida);
        }
    }

    private void processarAbertura(Monitor monitor, Medicao atual) {
        int threshold = monitor.getFalhasParaIncidente();
        List<Medicao> medicoes = ultimasMedicoes(monitor.getId(), threshold);
        if (!sequenciaCompleta(medicoes, threshold, StatusMedicao.FALHA)) {
            log.debug("Failure threshold not reached for monitor {}", monitor.getId());
            return;
        }
        // A lista esta DESC; a ultima posicao e a primeira falha da sequencia.
        try {
            Incidente incidente = incidenteService.abrirAutomaticamente(monitor,
                    medicoes.get(medicoes.size() - 1).getExecutadoEm(), threshold);
            log.info("Incident {} opened automatically for monitor {}", incidente.getId(), monitor.getId());
        } catch (ConflitoException ex) {
            log.warn("Concurrent incident opening for monitor {} was resolved by another processing", monitor.getId());
        }
    }

    private void processarRecovery(Monitor monitor, Incidente incidente, Medicao atual) {
        int threshold = monitor.getSucessosParaRecovery();
        List<Medicao> medicoes = ultimasMedicoes(monitor.getId(), threshold);
        if (!sequenciaCompleta(medicoes, threshold, StatusMedicao.SUCESSO)
                || medicoes.stream().anyMatch(m -> m.getExecutadoEm().isBefore(incidente.getIniciadoEm()))) {
            log.debug("Recovery threshold not reached for monitor {}", monitor.getId());
            return;
        }
        Incidente fechado = incidenteService.fecharAutomaticamente(incidente, atual.getExecutadoEm(), threshold);
        log.info("Incident {} closed automatically for monitor {}", fechado.getId(), monitor.getId());
    }

    private List<Medicao> ultimasMedicoes(Long monitorId, int quantidade) {
        return medicaoRepository.findByMonitorIdOrderByExecutadoEmDescIdDesc(monitorId, PageRequest.of(0, quantidade));
    }

    private boolean sequenciaCompleta(List<Medicao> medicoes, int quantidade, StatusMedicao status) {
        return medicoes.size() == quantidade && medicoes.stream().allMatch(m -> m.getStatus() == status);
    }
}
