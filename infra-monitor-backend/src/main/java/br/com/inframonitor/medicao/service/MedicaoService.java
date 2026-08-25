package br.com.inframonitor.medicao.service;

import br.com.inframonitor.common.exception.RecursoNaoEncontradoException;
import br.com.inframonitor.medicao.dto.CreateMedicaoRequest;
import br.com.inframonitor.medicao.dto.MedicaoResponse;
import br.com.inframonitor.medicao.dto.MonitorMedicaoResponse;
import br.com.inframonitor.medicao.entity.Medicao;
import br.com.inframonitor.medicao.entity.StatusMedicao;
import br.com.inframonitor.medicao.repository.MedicaoRepository;
import br.com.inframonitor.monitor.entity.Monitor;
import br.com.inframonitor.monitor.repository.MonitorRepository;
import br.com.inframonitor.monitoring.incident.IncidentProcessor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.annotation.Propagation;

import java.time.Instant;

@Service
@Transactional(readOnly = true)
public class MedicaoService {
    private static final Logger log = LoggerFactory.getLogger(MedicaoService.class);

    private final MedicaoRepository medicaoRepository;
    private final MonitorRepository monitorRepository;
    private final IncidentProcessor incidentProcessor;

    public MedicaoService(MedicaoRepository medicaoRepository, MonitorRepository monitorRepository,
                          IncidentProcessor incidentProcessor) {
        this.medicaoRepository = medicaoRepository;
        this.monitorRepository = monitorRepository;
        this.incidentProcessor = incidentProcessor;
    }

    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    public MedicaoResponse criar(CreateMedicaoRequest requisicao) {
        validarConsistenciaStatusLatencia(requisicao.status(), requisicao.latenciaMs());
        Monitor monitor = monitorRepository.findById(requisicao.monitorId())
                .orElseThrow(() -> new RecursoNaoEncontradoException("Monitor nao encontrado"));
        Medicao medicao = new Medicao(monitor, requisicao.status(), requisicao.latenciaMs(),
                normalizarMensagem(requisicao.mensagem()), requisicao.executadoEm());
        Medicao persistida = medicaoRepository.save(medicao);
        try {
            incidentProcessor.process(persistida);
        } catch (RuntimeException exception) {
            // A medicao e o dado primario: uma falha de interpretacao nao a invalida.
            log.error("Incident processing failed after persisting measurement {}", persistida.getId(), exception);
        }
        return paraResposta(persistida);
    }

    public MedicaoResponse buscarPorId(Long id) {
        return paraResposta(obterMedicao(id));
    }

    public Page<MedicaoResponse> listar(Long monitorId, StatusMedicao status, Instant inicio, Instant fim,
                                         Pageable pageable) {
        validarPeriodo(inicio, fim);
        Specification<Medicao> filtro = Specification.allOf(
                monitorId == null ? null : (root, query, cb) -> cb.equal(root.get("monitor").get("id"), monitorId),
                status == null ? null : (root, query, cb) -> cb.equal(root.get("status"), status),
                inicio == null ? null : (root, query, cb) -> cb.greaterThanOrEqualTo(root.get("executadoEm"), inicio),
                fim == null ? null : (root, query, cb) -> cb.lessThanOrEqualTo(root.get("executadoEm"), fim));
        return medicaoRepository.findAll(filtro, pageable).map(this::paraResposta);
    }

    private Medicao obterMedicao(Long id) {
        return medicaoRepository.findById(id)
                .orElseThrow(() -> new RecursoNaoEncontradoException("Medicao nao encontrada"));
    }

    private void validarConsistenciaStatusLatencia(StatusMedicao status, Integer latenciaMs) {
        if (latenciaMs != null && latenciaMs < 0) {
            throw new IllegalArgumentException("latenciaMs deve ser maior ou igual a zero");
        }
        if (status == StatusMedicao.FALHA && latenciaMs != null) {
            throw new IllegalArgumentException("latenciaMs deve ser nula quando o status for FALHA");
        }
    }

    private void validarPeriodo(Instant inicio, Instant fim) {
        if (inicio != null && fim != null && inicio.isAfter(fim)) {
            throw new IllegalArgumentException("inicio deve ser menor ou igual a fim");
        }
    }

    private String normalizarMensagem(String mensagem) {
        if (mensagem == null) return null;
        String normalizada = mensagem.trim();
        return normalizada.isEmpty() ? null : normalizada;
    }

    private MedicaoResponse paraResposta(Medicao medicao) {
        Monitor monitor = medicao.getMonitor();
        return new MedicaoResponse(medicao.getId(), medicao.getStatus(), medicao.getLatenciaMs(), medicao.getMensagem(),
                medicao.getExecutadoEm(), medicao.getCreatedAt(),
                new MonitorMedicaoResponse(monitor.getId(), monitor.getNome(), monitor.getTipo()));
    }
}
