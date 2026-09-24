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
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

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

    /**
     * Matriz por estado da notificacao de ABERTURA, nao por tipo de evento:
     * PENDENTE  -> cancela, nenhum aviso (a mensagem nunca saiu)
     * ENVIANDO  -> intocada, cria aviso (tratamos como "vai sair")
     * ENVIADA   -> intocada, cria aviso
     * FALHA     -> intocada, nenhum aviso (nao chegou ao grupo)
     * inexistente -> nada
     */
    /**
     * `agora` vem de {@code EquipamentoService.entrarEmManutencao}, nao de um novo
     * {@code Instant.now()} aqui: a transacao inteira se define como "um instante so", e
     * `incidente.encerrado_em`/`episodio.encerrado_em` ja foram gravados com esse mesmo
     * `agora` pelos bulk updates que rodam antes desta chamada. Um relogio proprio deixaria
     * `notificacao.updated_at` alguns milissegundos depois do encerramento dentro da mesma
     * transacao.
     */
    @Transactional
    public void tratarEncerramentoPorManutencao(Incidente incidente, Instant agora) {
        boolean despachada = notificacaoRepository.existeAberturaJaDespachada(incidente.getId());
        notificacaoRepository.cancelarPendentesDoIncidente(incidente.getId(), agora);
        if (despachada) {
            criarPendente(incidente, TipoEventoNotificacao.INCIDENTE_ENCERRADO_MANUTENCAO, agora);
        }
    }

    @Transactional
    public void tratarEncerramentoPorManutencao(MonitorEpisodioLatencia episodio, Instant agora) {
        boolean despachada = notificacaoRepository.existeAberturaJaDespachadaDoEpisodio(episodio.getId());
        notificacaoRepository.cancelarPendentesDoEpisodio(episodio.getId(), agora);
        if (despachada) {
            criarPendente(episodio, TipoEventoNotificacao.LATENCIA_ENCERRADA_MANUTENCAO, agora);
        }
    }

    /**
     * A idempotencia mora no ON CONFLICT DO NOTHING de
     * {@link NotificacaoRepository#inserirPendenteSeAusente}, nao aqui. O par
     * SELECT-de-verificacao + catch de DataIntegrityViolationException que existia antes
     * nao funcionava na corrida que dizia cobrir: a violacao de constraint deixa a sessao
     * do Hibernate inconsistente, e absorver a excecao apenas adia o estouro, que vem
     * depois como {@code org.hibernate.AssertionFailure: Entry for instance of
     * Notificacao has a null identifier}. Verificado em
     * NotificacaoConcorrenciaPostgresIntegrationTest.
     */
    private void criarPendente(Incidente incidente, TipoEventoNotificacao tipoEvento) {
        criarPendente(incidente, tipoEvento, Instant.now());
    }

    private void criarPendente(Incidente incidente, TipoEventoNotificacao tipoEvento, Instant agora) {
        CanalNotificacao canal = CanalNotificacao.TELEGRAM;
        notificacaoRepository.inserirPendenteSeAusente(incidente.getId(), null, canal.name(), tipoEvento.name(),
                messageBuilder.construir(incidente, tipoEvento), agora);
    }

    private void criarPendente(MonitorEpisodioLatencia episodio, TipoEventoNotificacao tipoEvento) {
        criarPendente(episodio, tipoEvento, Instant.now());
    }

    private void criarPendente(MonitorEpisodioLatencia episodio, TipoEventoNotificacao tipoEvento, Instant agora) {
        CanalNotificacao canal = CanalNotificacao.TELEGRAM;
        notificacaoRepository.inserirPendenteSeAusente(null, episodio.getId(), canal.name(), tipoEvento.name(),
                messageBuilder.construirParaEpisodio(episodio, tipoEvento), agora);
    }

    public NotificacaoResponse buscarPorId(Long id) {
        return paraResposta(notificacaoRepository.findById(id)
                .orElseThrow(() -> new RecursoNaoEncontradoException("Notificacao nao encontrada")));
    }

    public Page<NotificacaoResponse> listar(Long incidenteId, Long episodioLatenciaId, StatusNotificacao status, CanalNotificacao canal,
                                             TipoEventoNotificacao tipoEvento, Instant inicio, Instant fim,
                                             Pageable pageable) {
        validarPeriodo(inicio, fim);
        // As duas ancoras sao mutuamente exclusivas por ck_notificacao_ancora_exclusiva:
        // filtrar pelas duas juntas nunca casaria e mascararia um erro de chamada.
        if (incidenteId != null && episodioLatenciaId != null) {
            throw new IllegalArgumentException("informe incidenteId ou episodioLatenciaId, nunca os dois");
        }
        List<Specification<Notificacao>> filtros = new ArrayList<>();
        if (incidenteId != null) filtros.add((root, query, cb) -> cb.equal(root.get("incidente").get("id"), incidenteId));
        if (episodioLatenciaId != null) filtros.add((root, query, cb) -> cb.equal(root.get("episodioLatencia").get("id"), episodioLatenciaId));
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
