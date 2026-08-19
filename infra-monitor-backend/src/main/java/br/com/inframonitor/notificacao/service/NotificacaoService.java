package br.com.inframonitor.notificacao.service;

import br.com.inframonitor.common.exception.RecursoNaoEncontradoException;
import br.com.inframonitor.incidente.entity.Incidente;
import br.com.inframonitor.notificacao.dto.IncidenteNotificacaoResponse;
import br.com.inframonitor.notificacao.dto.NotificacaoResponse;
import br.com.inframonitor.notificacao.entity.CanalNotificacao;
import br.com.inframonitor.notificacao.entity.Notificacao;
import br.com.inframonitor.notificacao.entity.StatusNotificacao;
import br.com.inframonitor.notificacao.entity.TipoEventoNotificacao;
import br.com.inframonitor.notificacao.repository.NotificacaoRepository;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;

@Service
@Transactional(readOnly = true)
public class NotificacaoService {

    private final NotificacaoRepository notificacaoRepository;
    private final NotificacaoMessageBuilder messageBuilder;

    public NotificacaoService(NotificacaoRepository notificacaoRepository, NotificacaoMessageBuilder messageBuilder) {
        this.notificacaoRepository = notificacaoRepository;
        this.messageBuilder = messageBuilder;
    }

    @Transactional
    public void criarParaIncidenteAberto(Incidente incidente) {
        criarPendente(incidente, TipoEventoNotificacao.INCIDENTE_ABERTO);
    }

    @Transactional
    public void criarParaIncidenteFechado(Incidente incidente) {
        criarPendente(incidente, TipoEventoNotificacao.INCIDENTE_FECHADO);
    }

    private void criarPendente(Incidente incidente, TipoEventoNotificacao tipoEvento) {
        CanalNotificacao canal = CanalNotificacao.TELEGRAM;
        if (notificacaoRepository.existsByIncidenteIdAndCanalAndTipoEvento(incidente.getId(), canal, tipoEvento)) {
            return;
        }
        Notificacao notificacao = new Notificacao(incidente, canal, tipoEvento, messageBuilder.construir(incidente, tipoEvento));
        try {
            notificacaoRepository.saveAndFlush(notificacao);
        } catch (DataIntegrityViolationException ex) {
            // A constraint unica resolve a corrida concorrente; o resultado permanece idempotente.
            if (!notificacaoRepository.existsByIncidenteIdAndCanalAndTipoEvento(incidente.getId(), canal, tipoEvento)) {
                throw ex;
            }
        }
    }

    public NotificacaoResponse buscarPorId(Long id) {
        return paraResposta(notificacaoRepository.findById(id)
                .orElseThrow(() -> new RecursoNaoEncontradoException("Notificacao nao encontrada")));
    }

    public Page<NotificacaoResponse> listar(Long incidenteId, StatusNotificacao status, CanalNotificacao canal,
                                             TipoEventoNotificacao tipoEvento, Instant inicio, Instant fim,
                                             Pageable pageable) {
        validarPeriodo(inicio, fim);
        Specification<Notificacao> filtro = Specification.allOf(
                incidenteId == null ? null : (root, query, cb) -> cb.equal(root.get("incidente").get("id"), incidenteId),
                status == null ? null : (root, query, cb) -> cb.equal(root.get("status"), status),
                canal == null ? null : (root, query, cb) -> cb.equal(root.get("canal"), canal),
                tipoEvento == null ? null : (root, query, cb) -> cb.equal(root.get("tipoEvento"), tipoEvento),
                inicio == null ? null : (root, query, cb) -> cb.greaterThanOrEqualTo(root.get("createdAt"), inicio),
                fim == null ? null : (root, query, cb) -> cb.lessThanOrEqualTo(root.get("createdAt"), fim));
        return notificacaoRepository.findAll(filtro, pageable).map(this::paraResposta);
    }

    private void validarPeriodo(Instant inicio, Instant fim) {
        if (inicio != null && fim != null && inicio.isAfter(fim)) {
            throw new IllegalArgumentException("inicio deve ser menor ou igual a fim");
        }
    }

    private NotificacaoResponse paraResposta(Notificacao notificacao) {
        Incidente incidente = notificacao.getIncidente();
        return new NotificacaoResponse(notificacao.getId(), notificacao.getCanal(), notificacao.getTipoEvento(),
                notificacao.getStatus(), notificacao.getTentativas(), notificacao.getMensagem(), notificacao.getErro(),
                notificacao.getEnviadoEm(), new IncidenteNotificacaoResponse(incidente.getId(), incidente.getStatus()),
                notificacao.getCreatedAt(), notificacao.getUpdatedAt());
    }
}
