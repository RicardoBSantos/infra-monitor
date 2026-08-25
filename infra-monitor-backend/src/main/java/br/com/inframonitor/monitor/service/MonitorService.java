package br.com.inframonitor.monitor.service;

import br.com.inframonitor.common.exception.ConflitoException;
import br.com.inframonitor.common.exception.RecursoNaoEncontradoException;
import br.com.inframonitor.equipamento.dto.ReferenciaResponse;
import br.com.inframonitor.equipamento.entity.Equipamento;
import br.com.inframonitor.equipamento.repository.EquipamentoRepository;
import br.com.inframonitor.medicao.repository.MedicaoRepository;
import br.com.inframonitor.incidente.repository.IncidenteRepository;
import br.com.inframonitor.monitor.dto.CreateMonitorRequest;
import br.com.inframonitor.monitor.dto.MonitorResponse;
import br.com.inframonitor.monitor.dto.UpdateMonitorRequest;
import br.com.inframonitor.monitor.entity.Monitor;
import br.com.inframonitor.monitor.entity.TipoMonitor;
import br.com.inframonitor.monitor.repository.MonitorRepository;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Objects;

@Service
@Transactional(readOnly = true)
public class MonitorService {
    private final MonitorRepository monitorRepository;
    private final EquipamentoRepository equipamentoRepository;
    private final MedicaoRepository medicaoRepository;
    private final IncidenteRepository incidenteRepository;

    public MonitorService(MonitorRepository monitorRepository, EquipamentoRepository equipamentoRepository,
                          MedicaoRepository medicaoRepository, IncidenteRepository incidenteRepository) {
        this.monitorRepository = monitorRepository;
        this.equipamentoRepository = equipamentoRepository;
        this.medicaoRepository = medicaoRepository;
        this.incidenteRepository = incidenteRepository;
    }

    @Transactional
    public MonitorResponse criar(CreateMonitorRequest requisicao) {
        validarIntervaloTimeout(requisicao.intervaloSegundos(), requisicao.timeoutMs());
        Equipamento equipamento = obterEquipamentoAtivo(requisicao.equipamentoId());
        return paraResposta(monitorRepository.save(new Monitor(equipamento, requisicao.tipo(), normalizarNome(requisicao.nome()),
                requisicao.intervaloSegundos(), requisicao.timeoutMs(),
                valorOuDefault(requisicao.falhasParaIncidente(), Monitor.DEFAULT_FALHAS_PARA_INCIDENTE),
                valorOuDefault(requisicao.sucessosParaRecovery(), Monitor.DEFAULT_SUCESSOS_PARA_RECOVERY))));
    }

    public MonitorResponse buscarPorId(Long id) { return paraResposta(obterMonitor(id)); }

    public Page<MonitorResponse> listar(Long equipamentoId, TipoMonitor tipo, Boolean ativo, Pageable pageable) {
        Specification<Monitor> filtro = Specification.allOf(
                equipamentoId == null ? null : (root, query, cb) -> cb.equal(root.get("equipamento").get("id"), equipamentoId),
                tipo == null ? null : (root, query, cb) -> cb.equal(root.get("tipo"), tipo),
                ativo == null ? null : (root, query, cb) -> cb.equal(root.get("ativo"), ativo));
        return monitorRepository.findAll(filtro, pageable).map(this::paraResposta);
    }

    @Transactional
    public MonitorResponse atualizar(Long id, UpdateMonitorRequest requisicao) {
        validarIntervaloTimeout(requisicao.intervaloSegundos(), requisicao.timeoutMs());
        Monitor monitor = obterMonitor(id);
        if (!Objects.equals(monitor.getEquipamento().getId(), requisicao.equipamentoId())) {
            monitor.setEquipamento(obterEquipamentoAtivo(requisicao.equipamentoId()));
        }
        monitor.setTipo(requisicao.tipo());
        monitor.setNome(normalizarNome(requisicao.nome()));
        monitor.setIntervaloSegundos(requisicao.intervaloSegundos());
        monitor.setTimeoutMs(requisicao.timeoutMs());
        if (requisicao.falhasParaIncidente() != null) {
            monitor.setFalhasParaIncidente(requisicao.falhasParaIncidente());
        }
        if (requisicao.sucessosParaRecovery() != null) {
            monitor.setSucessosParaRecovery(requisicao.sucessosParaRecovery());
        }
        return paraResposta(monitor);
    }

    @Transactional
    public MonitorResponse ativar(Long id) {
        Monitor monitor = obterMonitor(id);
        if (!monitor.getEquipamento().isAtivo()) {
            throw new ConflitoException("Nao e possivel ativar o monitor porque o equipamento esta inativo");
        }
        validarIntervaloTimeout(monitor.getIntervaloSegundos(), monitor.getTimeoutMs());
        monitor.setAtivo(true);
        return paraResposta(monitor);
    }

    @Transactional
    public MonitorResponse desativar(Long id) {
        Monitor monitor = obterMonitor(id);
        monitor.setAtivo(false);
        return paraResposta(monitor);
    }

    @Transactional
    public void excluir(Long id) {
        Monitor monitor = obterMonitor(id);
        if (medicaoRepository.existsByMonitorId(id)) {
            throw new ConflitoException("Nao e possivel excluir o monitor porque existem medicoes associadas");
        }
        if (incidenteRepository.existsByMonitorId(id)) {
            throw new ConflitoException("Nao e possivel excluir o monitor porque existem incidentes associados");
        }
        monitorRepository.delete(monitor);
    }

    private Monitor obterMonitor(Long id) {
        return monitorRepository.findById(id).orElseThrow(() -> new RecursoNaoEncontradoException("Monitor nao encontrado"));
    }

    private Equipamento obterEquipamentoAtivo(Long id) {
        Equipamento equipamento = equipamentoRepository.findById(id)
                .orElseThrow(() -> new RecursoNaoEncontradoException("Equipamento nao encontrado"));
        if (!equipamento.isAtivo()) throw new ConflitoException("Nao e possivel vincular monitor a um equipamento inativo");
        return equipamento;
    }

    private void validarIntervaloTimeout(int intervaloSegundos, int timeoutMs) {
        if (timeoutMs >= intervaloSegundos * 1000L) {
            throw new IllegalArgumentException("timeoutMs deve ser menor que intervaloSegundos em milissegundos");
        }
    }

    private String normalizarNome(String nome) { return nome.trim(); }
    private int valorOuDefault(Integer valor, int valorPadrao) { return valor == null ? valorPadrao : valor; }

    private MonitorResponse paraResposta(Monitor monitor) {
        Equipamento equipamento = monitor.getEquipamento();
        return new MonitorResponse(monitor.getId(), monitor.getNome(), monitor.getTipo(), monitor.getIntervaloSegundos(),
                monitor.getTimeoutMs(), monitor.getFalhasParaIncidente(), monitor.getSucessosParaRecovery(), monitor.isAtivo(), new ReferenciaResponse(equipamento.getId(), equipamento.getNome()),
                monitor.getCreatedAt(), monitor.getUpdatedAt());
    }
}
