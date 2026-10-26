package br.com.inframonitor.notificacao.service;

import br.com.inframonitor.common.exception.RecursoNaoEncontradoException;
import br.com.inframonitor.incidente.entity.Incidente;
import br.com.inframonitor.equipamento.entity.Equipamento;
import br.com.inframonitor.equipamento.entity.ManutencaoManual;
import br.com.inframonitor.manutencao.entity.ManutencaoAgendada;
import br.com.inframonitor.monitor.entity.Monitor;
import br.com.inframonitor.unidade.entity.Unidade;
import br.com.inframonitor.monitoring.latency.MonitorEpisodioLatencia;
import br.com.inframonitor.notificacao.dto.EpisodioLatenciaNotificacaoResponse;
import br.com.inframonitor.notificacao.dto.IncidenteNotificacaoResponse;
import br.com.inframonitor.notificacao.dto.ManutencaoManualNotificacaoResponse;
import br.com.inframonitor.notificacao.dto.ManutencaoNotificacaoResponse;
import br.com.inframonitor.notificacao.dto.NotificacaoResponse;
import br.com.inframonitor.notificacao.entity.CanalNotificacao;
import br.com.inframonitor.notificacao.entity.Notificacao;
import br.com.inframonitor.notificacao.entity.StatusNotificacao;
import br.com.inframonitor.notificacao.entity.TipoEventoNotificacao;
import br.com.inframonitor.notificacao.repository.InicioAnuncioRepository;
import br.com.inframonitor.notificacao.repository.NotificacaoRepository;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.function.BooleanSupplier;
import java.util.stream.Stream;

@Service
@Transactional(readOnly = true)
public class NotificacaoService {

    private final NotificacaoRepository notificacaoRepository;
    private final NotificacaoMessageBuilder messageBuilder;
    private final InicioAnuncioRepository inicioAnuncioRepository;

    public NotificacaoService(NotificacaoRepository notificacaoRepository, NotificacaoMessageBuilder messageBuilder,
                              InicioAnuncioRepository inicioAnuncioRepository) {
        this.notificacaoRepository = notificacaoRepository;
        this.messageBuilder = messageBuilder;
        this.inicioAnuncioRepository = inicioAnuncioRepository;
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
     * `agora` vem de {@code EfeitosManutencao.aplicarEntrada}, nao de um novo
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
        notificacaoRepository.inserirPendenteSeAusente(incidente.getId(), null, null, null, canal.name(), tipoEvento.name(),
                messageBuilder.construir(incidente, tipoEvento), agora);
    }

    private void criarPendente(MonitorEpisodioLatencia episodio, TipoEventoNotificacao tipoEvento) {
        criarPendente(episodio, tipoEvento, Instant.now());
    }

    private void criarPendente(MonitorEpisodioLatencia episodio, TipoEventoNotificacao tipoEvento, Instant agora) {
        CanalNotificacao canal = CanalNotificacao.TELEGRAM;
        notificacaoRepository.inserirPendenteSeAusente(null, episodio.getId(), null, null, canal.name(), tipoEvento.name(),
                messageBuilder.construirParaEpisodio(episodio, tipoEvento), agora);
    }

    // Anuncios de manutencao (F3). Todos entram na transacao do chamador (CAS da janela ou lock do
    // equipamento, MA31) e usam o ON CONFLICT DO NOTHING: repetir o evento nao gera segunda linha.

    @Transactional
    public void criarParaManutencaoIniciada(DadosAnuncio.Janela j, Instant ativadaEm, boolean atrasado) {
        inserirDaJanela(j.id(), TipoEventoNotificacao.MANUTENCAO_INICIADA,
                messageBuilder.construirInicioJanela(j, ativadaEm, atrasado), ativadaEm);
    }

    @Transactional
    public void criarParaManutencaoEncerrada(DadosAnuncio.Janela j, Instant ativadaEm, Instant encerradaEm,
                                             DadosAnuncio.Termino t, List<DadosAnuncio.Seguinte> seguem) {
        // A ORDEM IMPORTA (A4): primeiro o UPDATE que cancela o inicio PENDENTE, e so se ele nao
        // cancelou nada se le o FALHA. Decidir por uma leitura anterior ao UPDATE deixaria o
        // dispatcher reservar e enviar o inicio entre a leitura e o cancelamento, e o fim sairia
        // sem o "registro completo" mesmo com o inicio nunca entregue (ou o contrario).
        DadosAnuncio.EntregaInicio entrega = resolverEntrega(
                inicioAnuncioRepository.cancelarInicioDaJanela(j.id(), encerradaEm),
                () -> inicioAnuncioRepository.inicioEmFalhaDaJanela(j.id()));
        inserirDaJanela(j.id(), TipoEventoNotificacao.MANUTENCAO_ENCERRADA,
                messageBuilder.construirFimJanela(j, ativadaEm, encerradaEm, t, seguem, entrega), encerradaEm);
    }

    /** Sem unicidade: o indice parcial exclui este tipo, cada alteracao de fim gera uma linha. */
    @Transactional
    public void criarParaManutencaoFimAlterado(DadosAnuncio.Janela j, Instant fimAnterior, Instant fimNovo,
                                               String autorNome, Instant agora) {
        inserirDaJanela(j.id(), TipoEventoNotificacao.MANUTENCAO_FIM_ALTERADO,
                messageBuilder.construirFimAlterado(j, fimAnterior, fimNovo, autorNome), agora);
    }

    @Transactional
    public void criarParaManualIniciada(DadosAnuncio.Manual m, boolean jaEmManutencao,
                                        DadosAnuncio.JanelaVigente janela, Instant agora) {
        inserirDaSessao(m.sessaoId(), TipoEventoNotificacao.MANUTENCAO_MANUAL_INICIADA,
                messageBuilder.construirManualIniciada(m, jaEmManutencao, janela), agora);
    }

    @Transactional
    public void criarParaManualEncerrada(DadosAnuncio.Manual m, Instant encerradaEm, String encerradaPorNome,
                                         boolean segue, DadosAnuncio.JanelaVigente janela) {
        // Mesma ordem protegida de criarParaManutencaoEncerrada: cancelar primeiro, ler FALHA depois.
        DadosAnuncio.EntregaInicio entrega = resolverEntrega(
                inicioAnuncioRepository.cancelarInicioDaSessao(m.sessaoId(), encerradaEm),
                () -> inicioAnuncioRepository.inicioEmFalhaDaSessao(m.sessaoId()));
        inserirDaSessao(m.sessaoId(), TipoEventoNotificacao.MANUTENCAO_MANUAL_ENCERRADA,
                messageBuilder.construirManualEncerrada(m, encerradaEm, encerradaPorNome, segue, janela, entrega),
                encerradaEm);
    }

    /**
     * Cancelou sem tentativas e sem marca de erro: o inicio nunca saiu. Cancelou com tentativas (retry) ou
     * com marca de erro (ENVIANDO vencido devolvido a PENDENTE): o Telegram pode ter recebido. Nao cancelou: FALHA tambem e ambigua
     * (timeout); ENVIANDO, ENVIADA ou inexistente seguem como fim normal.
     */
    private DadosAnuncio.EntregaInicio resolverEntrega(Optional<InicioAnuncioRepository.InicioCancelado> cancelado,
                                                       BooleanSupplier inicioEmFalha) {
        if (cancelado.isPresent()) {
            return cancelado.get().certamenteNaoEntregue()
                    ? DadosAnuncio.EntregaInicio.NAO_ENTREGUE : DadosAnuncio.EntregaInicio.TALVEZ_ENTREGUE;
        }
        return inicioEmFalha.getAsBoolean()
                ? DadosAnuncio.EntregaInicio.TALVEZ_ENTREGUE : DadosAnuncio.EntregaInicio.ENTREGUE;
    }

    private void inserirDaJanela(long janelaId, TipoEventoNotificacao tipo, String mensagem, Instant agora) {
        notificacaoRepository.inserirPendenteSeAusente(null, null, janelaId, null,
                CanalNotificacao.TELEGRAM.name(), tipo.name(), mensagem, agora);
    }

    private void inserirDaSessao(long sessaoId, TipoEventoNotificacao tipo, String mensagem, Instant agora) {
        notificacaoRepository.inserirPendenteSeAusente(null, null, null, sessaoId,
                CanalNotificacao.TELEGRAM.name(), tipo.name(), mensagem, agora);
    }

    public NotificacaoResponse buscarPorId(Long id) {
        return paraResposta(notificacaoRepository.findById(id)
                .orElseThrow(() -> new RecursoNaoEncontradoException("Notificacao nao encontrada")));
    }

    public Page<NotificacaoResponse> listar(Long incidenteId, Long episodioLatenciaId, Long manutencaoId,
                                             Long manutencaoManualId, StatusNotificacao status, CanalNotificacao canal,
                                             TipoEventoNotificacao tipoEvento, Instant inicio, Instant fim,
                                             Pageable pageable) {
        validarPeriodo(inicio, fim);
        // As ancoras sao mutuamente exclusivas por ck_notificacao_ancora_exclusiva:
        // filtrar por duas juntas nunca casaria e mascararia um erro de chamada.
        if (Stream.of(incidenteId, episodioLatenciaId, manutencaoId, manutencaoManualId)
                .filter(Objects::nonNull).count() > 1) {
            throw new IllegalArgumentException(
                    "informe apenas uma ancora: incidenteId, episodioLatenciaId, manutencaoId ou manutencaoManualId");
        }
        List<Specification<Notificacao>> filtros = new ArrayList<>();
        if (incidenteId != null) filtros.add((root, query, cb) -> cb.equal(root.get("incidente").get("id"), incidenteId));
        if (episodioLatenciaId != null) filtros.add((root, query, cb) -> cb.equal(root.get("episodioLatencia").get("id"), episodioLatenciaId));
        if (manutencaoId != null) filtros.add((root, query, cb) -> cb.equal(root.get("manutencaoAgendada").get("id"), manutencaoId));
        if (manutencaoManualId != null) filtros.add((root, query, cb) -> cb.equal(root.get("manutencaoManual").get("id"), manutencaoManualId));
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
        ManutencaoAgendada janela = notificacao.getManutencaoAgendada();
        ManutencaoManual sessao = notificacao.getManutencaoManual();
        // Monitor, equipamento e unidade vem da ancora preenchida; a listagem nao precisa saber qual.
        // Janela agendada nao tem monitor nem equipamento (so a unidade); a sessao manual tem equipamento.
        Monitor monitor = incidente != null ? incidente.getMonitor()
                : episodio != null ? episodio.getMonitor() : null;
        Equipamento equipamento = monitor != null ? monitor.getEquipamento()
                : sessao != null ? sessao.getEquipamento() : null;
        Unidade unidade = equipamento != null ? equipamento.getUnidade()
                : janela != null ? janela.getUnidade() : null;
        return new NotificacaoResponse(notificacao.getId(), notificacao.getCanal(), notificacao.getTipoEvento(),
                notificacao.getStatus(), notificacao.getTentativas(), notificacao.getMensagem(), notificacao.getErro(),
                notificacao.getEnviadoEm(),
                incidente == null ? null : new IncidenteNotificacaoResponse(incidente.getId(), incidente.getStatus()),
                episodio == null ? null : new EpisodioLatenciaNotificacaoResponse(episodio.getId(),
                        episodio.getIniciadoEm(), episodio.getEncerradoEm(), episodio.getLimiarMs()),
                janela == null ? null : new ManutencaoNotificacaoResponse(janela.getId(), janela.getUnidade().getNome()),
                sessao == null ? null : new ManutencaoManualNotificacaoResponse(sessao.getId(),
                        sessao.getEquipamento().getId(), sessao.getEquipamento().getNome()),
                monitor == null ? null : monitor.getNome(),
                equipamento == null ? null : equipamento.getNome(),
                unidade == null ? null : unidade.getNome(),
                notificacao.getCreatedAt(), notificacao.getUpdatedAt());
    }
}
