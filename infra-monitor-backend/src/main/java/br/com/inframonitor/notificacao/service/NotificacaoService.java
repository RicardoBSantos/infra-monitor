package br.com.inframonitor.notificacao.service;

import br.com.inframonitor.common.exception.RecursoNaoEncontradoException;
import br.com.inframonitor.incidente.entity.Incidente;
import br.com.inframonitor.monitor.entity.Monitor;
import br.com.inframonitor.monitoring.latency.MonitorEpisodioLatencia;
import br.com.inframonitor.notificacao.dto.EpisodioLatenciaNotificacaoResponse;
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
import java.util.ArrayList;
import java.util.List;
import java.util.function.BooleanSupplier;
import java.util.function.Supplier;

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

    @Transactional
    public void criarParaLatenciaAlta(MonitorEpisodioLatencia episodio) {
        criarPendente(episodio, TipoEventoNotificacao.LATENCIA_ALTA);
    }

    @Transactional
    public void criarParaLatenciaNormalizada(MonitorEpisodioLatencia episodio) {
        criarPendente(episodio, TipoEventoNotificacao.LATENCIA_NORMALIZADA);
    }

    private void criarPendente(Incidente incidente, TipoEventoNotificacao tipoEvento) {
        CanalNotificacao canal = CanalNotificacao.TELEGRAM;
        criarPendente(() -> notificacaoRepository.existsByIncidenteIdAndCanalAndTipoEvento(
                        incidente.getId(), canal, tipoEvento),
                () -> new Notificacao(incidente, canal, tipoEvento, messageBuilder.construir(incidente, tipoEvento)));
    }

    private void criarPendente(MonitorEpisodioLatencia episodio, TipoEventoNotificacao tipoEvento) {
        CanalNotificacao canal = CanalNotificacao.TELEGRAM;
        criarPendente(() -> notificacaoRepository.existsByEpisodioLatenciaIdAndCanalAndTipoEvento(
                        episodio.getId(), canal, tipoEvento),
                () -> new Notificacao(episodio, canal, tipoEvento, messageBuilder.construirParaEpisodio(episodio, tipoEvento)));
    }

    private void criarPendente(BooleanSupplier jaExiste, Supplier<Notificacao> nova) {
        if (jaExiste.getAsBoolean()) {
            return;
        }
        try {
            notificacaoRepository.saveAndFlush(nova.get());
        } catch (DataIntegrityViolationException ex) {
            // A constraint unica resolve a corrida concorrente; o resultado permanece idempotente.
            if (!jaExiste.getAsBoolean()) {
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
        List<Specification<Notificacao>> filtros = new ArrayList<>();
        if (incidenteId != null) filtros.add((root, query, cb) -> cb.equal(root.get("incidente").get("id"), incidenteId));
        if (status != null) filtros.add((root, query, cb) -> cb.equal(root.get("status"), status));
        if (canal != null) filtros.add((root, query, cb) -> cb.equal(root.get("canal"), canal));
        if (tipoEvento != null) filtros.add((root, query, cb) -> cb.equal(root.get("tipoEvento"), tipoEvento));
        if (inicio != null) filtros.add((root, query, cb) -> cb.greaterThanOrEqualTo(root.get("createdAt"), inicio));
        if (fim != null) filtros.add((root, query, cb) -> cb.lessThanOrEqualTo(root.get("createdAt"), fim));
        Specification<Notificacao> filtro = Specification.allOf(filtros);
        return notificacaoRepository.findAll(filtro, pageable).map(this::paraResposta);
    }

    private void validarPeriodo(Instant inicio, Instant fim) {
        if (inicio != null && fim != null && inicio.isAfter(fim)) {
            throw new IllegalArgumentException("inicio deve ser menor ou igual a fim");
        }
    }

    private NotificacaoResponse paraResposta(Notificacao notificacao) {
        Incidente incidente = notificacao.getIncidente();
        MonitorEpisodioLatencia episodio = notificacao.getEpisodioLatencia();
        // O monitor vem da ancora que estiver preenchida; a listagem nao precisa saber qual.
        Monitor monitor = incidente != null ? incidente.getMonitor()
                : episodio != null ? episodio.getMonitor() : null;
        return new NotificacaoResponse(notificacao.getId(), notificacao.getCanal(), notificacao.getTipoEvento(),
                notificacao.getStatus(), notificacao.getTentativas(), notificacao.getMensagem(), notificacao.getErro(),
                notificacao.getEnviadoEm(),
                incidente == null ? null : new IncidenteNotificacaoResponse(incidente.getId(), incidente.getStatus()),
                episodio == null ? null : new EpisodioLatenciaNotificacaoResponse(episodio.getId(),
                        episodio.getIniciadoEm(), episodio.getEncerradoEm(), episodio.getLimiarMs()),
                monitor == null ? null : monitor.getNome(),
                monitor == null ? null : monitor.getEquipamento().getNome(),
                monitor == null ? null : monitor.getEquipamento().getUnidade().getNome(),
                notificacao.getCreatedAt(), notificacao.getUpdatedAt());
    }
}
