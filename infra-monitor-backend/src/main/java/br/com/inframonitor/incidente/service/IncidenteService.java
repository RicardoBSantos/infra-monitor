package br.com.inframonitor.incidente.service;

import br.com.inframonitor.common.exception.ConflitoException;
import br.com.inframonitor.common.exception.RecursoNaoEncontradoException;
import br.com.inframonitor.equipamento.entity.Equipamento;
import br.com.inframonitor.incidente.dto.CloseIncidenteRequest;
import br.com.inframonitor.incidente.dto.CreateIncidenteRequest;
import br.com.inframonitor.incidente.dto.IncidenteResponse;
import br.com.inframonitor.incidente.dto.MonitorIncidenteResponse;
import br.com.inframonitor.incidente.entity.Incidente;
import br.com.inframonitor.incidente.entity.StatusIncidente;
import br.com.inframonitor.incidente.repository.IncidenteRepository;
import br.com.inframonitor.monitor.entity.Monitor;
import br.com.inframonitor.monitor.repository.MonitorRepository;
import br.com.inframonitor.notificacao.service.NotificacaoService;
import br.com.inframonitor.usuario.entity.Usuario;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;

@Service
@Transactional(readOnly = true)
public class IncidenteService {

    private static final String MENSAGEM_INCIDENTE_ABERTO = "Nao e possivel abrir outro incidente porque ja existe um incidente aberto para este monitor";

    private final IncidenteRepository incidenteRepository;
    private final MonitorRepository monitorRepository;
    private final NotificacaoService notificacaoService;

    public IncidenteService(IncidenteRepository incidenteRepository, MonitorRepository monitorRepository,
                            NotificacaoService notificacaoService) {
        this.incidenteRepository = incidenteRepository;
        this.monitorRepository = monitorRepository;
        this.notificacaoService = notificacaoService;
    }

    @Transactional
    public IncidenteResponse criar(CreateIncidenteRequest requisicao) {
        Monitor monitor = monitorRepository.findById(requisicao.monitorId())
                .orElseThrow(() -> new RecursoNaoEncontradoException("Monitor nao encontrado"));
        if (incidenteRepository.existsByMonitorIdAndStatusIn(monitor.getId(), StatusIncidente.EM_ABERTO)) {
            throw new ConflitoException(MENSAGEM_INCIDENTE_ABERTO);
        }
        Incidente incidente = new Incidente(monitor, requisicao.iniciadoEm(), normalizar(requisicao.motivo()),
                normalizar(requisicao.observacao()));
        try {
            Incidente persistido = incidenteRepository.saveAndFlush(incidente);
            notificacaoService.criarParaIncidenteAberto(persistido);
            return paraResposta(persistido);
        } catch (DataIntegrityViolationException ex) {
            // O indice parcial e a garantia final contra duas aberturas concorrentes.
            throw new ConflitoException(MENSAGEM_INCIDENTE_ABERTO);
        }
    }

    /**
     * Entrada de dominio usada pelo Incident Engine. A verificacao de incidente
     * aberto e feita pelo processor; o indice parcial continua sendo a garantia
     * final em caso de corrida concorrente.
     */
    @Transactional
    public Incidente abrirAutomaticamente(Monitor monitor, Instant iniciadoEm, int falhasConsecutivas) {
        String motivo = "Indisponibilidade detectada automaticamente apos " + falhasConsecutivas
                + " falhas consecutivas.";
        try {
            Incidente incidente = incidenteRepository.saveAndFlush(new Incidente(monitor, iniciadoEm, motivo, null));
            notificacaoService.criarParaIncidenteAberto(incidente);
            return incidente;
        } catch (DataIntegrityViolationException ex) {
            throw new ConflitoException(MENSAGEM_INCIDENTE_ABERTO);
        }
    }

    @Transactional
    public Incidente fecharAutomaticamente(Incidente incidente, Instant encerradoEm, int sucessosConsecutivos) {
        if (incidente.getStatus() == StatusIncidente.FECHADO) {
            return incidente;
        }
        if (encerradoEm.isBefore(incidente.getIniciadoEm())) {
            throw new IllegalArgumentException("encerradoEm deve ser maior ou igual a iniciadoEm");
        }
        incidente.fechar(encerradoEm, "Recuperacao detectada automaticamente apos " + sucessosConsecutivos
                + " sucessos consecutivos.");
        Incidente fechado = incidenteRepository.saveAndFlush(incidente);
        notificacaoService.criarParaIncidenteFechado(fechado);
        return fechado;
    }

    public IncidenteResponse buscarPorId(Long id) {
        return paraResposta(obterIncidente(id));
    }

    public Page<IncidenteResponse> listar(Long monitorId, Long equipamentoId, Long unidadeId, StatusIncidente status,
                                           Instant inicio, Instant fim, Pageable pageable) {
        validarPeriodo(inicio, fim);
        Specification<Incidente> filtro = Specification.unrestricted();
        if (monitorId != null) {
            filtro = filtro.and((root, query, cb) -> cb.equal(root.get("monitor").get("id"), monitorId));
        }
        if (equipamentoId != null) {
            filtro = filtro.and((root, query, cb) -> cb.equal(root.get("monitor").get("equipamento").get("id"), equipamentoId));
        }
        if (unidadeId != null) {
            filtro = filtro.and((root, query, cb) -> cb.equal(root.get("monitor").get("equipamento").get("unidade").get("id"), unidadeId));
        }
        if (status != null) {
            filtro = filtro.and((root, query, cb) -> cb.equal(root.get("status"), status));
        }
        if (inicio != null) {
            filtro = filtro.and((root, query, cb) -> cb.greaterThanOrEqualTo(root.get("iniciadoEm"), inicio));
        }
        if (fim != null) {
            filtro = filtro.and((root, query, cb) -> cb.lessThanOrEqualTo(root.get("iniciadoEm"), fim));
        }
        return incidenteRepository.findAll(filtro, pageable).map(this::paraResposta);
    }

    @Transactional
    public IncidenteResponse fechar(Long id, CloseIncidenteRequest requisicao) {
        Incidente incidente = obterIncidente(id);
        if (incidente.getStatus() == StatusIncidente.FECHADO) {
            return paraResposta(incidente);
        }
        if (requisicao.encerradoEm().isBefore(incidente.getIniciadoEm())) {
            throw new IllegalArgumentException("encerradoEm deve ser maior ou igual a iniciadoEm");
        }
        incidente.fechar(requisicao.encerradoEm(), normalizar(requisicao.observacao()));
        Incidente fechado = incidenteRepository.saveAndFlush(incidente);
        notificacaoService.criarParaIncidenteFechado(fechado);
        return paraResposta(fechado);
    }

    /**
     * Reconhecer nao e idempotente, ao contrario de fechar: reconhecer duas vezes e
     * 409. Fechar tem um caminho automatico concorrente e um 409 ali seria ruido;
     * reconhecer so tem caminho humano, e o segundo clique significa que o estado
     * mudou por baixo de quem esta olhando a tela.
     */
    @Transactional
    public IncidenteResponse reconhecer(Long id, Usuario usuario) {
        Incidente incidente = obterIncidente(id);
        if (incidenteRepository.reconhecerSeAberto(id, usuario, Instant.now()) == 0) {
            // Ou ja estava reconhecido, ou o motor fechou entre o SELECT e o UPDATE.
            Incidente atual = obterIncidente(id);
            throw new ConflitoException(atual.getStatus() == StatusIncidente.FECHADO
                    ? "O incidente ja foi fechado e nao pode mais ser reconhecido"
                    : "O incidente ja foi reconhecido");
        }
        // O bulk update nao atualiza a instancia carregada; releitura para responder.
        return paraResposta(obterIncidente(incidente.getId()));
    }

    private Incidente obterIncidente(Long id) {
        return incidenteRepository.findById(id)
                .orElseThrow(() -> new RecursoNaoEncontradoException("Incidente nao encontrado"));
    }

    private void validarPeriodo(Instant inicio, Instant fim) {
        if (inicio != null && fim != null && inicio.isAfter(fim)) {
            throw new IllegalArgumentException("inicio deve ser menor ou igual a fim");
        }
    }

    private String normalizar(String valor) {
        if (valor == null) return null;
        String normalizado = valor.trim();
        return normalizado.isEmpty() ? null : normalizado;
    }

    private IncidenteResponse paraResposta(Incidente incidente) {
        Monitor monitor = incidente.getMonitor();
        Equipamento equipamento = monitor.getEquipamento();
        return new IncidenteResponse(incidente.getId(), incidente.getStatus(), incidente.getIniciadoEm(),
                incidente.getEncerradoEm(), incidente.getMotivo(), incidente.getObservacao(),
                incidente.getReconhecidoEm(),
                incidente.getReconhecidoPor() == null ? null : incidente.getReconhecidoPor().getNome(),
                new MonitorIncidenteResponse(monitor.getId(), monitor.getNome(), monitor.getTipo(),
                        equipamento.getId(), equipamento.getNome(), equipamento.getUnidade().getId(),
                        equipamento.getUnidade().getNome()),
                incidente.getCreatedAt(), incidente.getUpdatedAt());
    }
}
