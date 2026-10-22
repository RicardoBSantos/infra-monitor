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
import br.com.inframonitor.usuario.repository.UsuarioRepository;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.Optional;

@Service
@Transactional(readOnly = true)
public class IncidenteService {

    private static final String MENSAGEM_INCIDENTE_ABERTO = "Nao e possivel abrir outro incidente porque ja existe um incidente aberto para este monitor";
    private static final String MENSAGEM_MONITOR_INATIVO = "Nao e possivel abrir incidente porque o monitor esta inativo";
    private static final String MENSAGEM_EQUIPAMENTO_INATIVO = "Nao e possivel abrir incidente porque o equipamento esta inativo";
    private static final String MENSAGEM_EQUIPAMENTO_EM_MANUTENCAO = "Nao e possivel abrir incidente porque o equipamento esta em manutencao";

    private final IncidenteRepository incidenteRepository;
    private final MonitorRepository monitorRepository;
    private final NotificacaoService notificacaoService;
    private final UsuarioRepository usuarioRepository;

    public IncidenteService(IncidenteRepository incidenteRepository, MonitorRepository monitorRepository,
                            NotificacaoService notificacaoService, UsuarioRepository usuarioRepository) {
        this.incidenteRepository = incidenteRepository;
        this.monitorRepository = monitorRepository;
        this.notificacaoService = notificacaoService;
        this.usuarioRepository = usuarioRepository;
    }

    @Transactional
    public IncidenteResponse criar(CreateIncidenteRequest requisicao) {
        Monitor monitor = monitorRepository.findById(requisicao.monitorId())
                .orElseThrow(() -> new RecursoNaoEncontradoException("Monitor nao encontrado"));
        // Mesmo predicado do motor (inserirSeElegivel): incidente para algo que nao esta sendo
        // observado nunca seria fechado automaticamente. O FOR UPDATE OF e serializa com
        // entrarEmManutencao — sem ele o INSERT nao commitado escapa de fecharPorManutencao (M7).
        IncidenteRepository.Elegibilidade elegibilidade = incidenteRepository
                .travarElegibilidadeParaAbertura(monitor.getId())
                .orElseThrow(() -> new RecursoNaoEncontradoException("Monitor nao encontrado"));
        if (!elegibilidade.getMonitorAtivo()) throw new ConflitoException(MENSAGEM_MONITOR_INATIVO);
        if (!elegibilidade.getEquipamentoAtivo()) throw new ConflitoException(MENSAGEM_EQUIPAMENTO_INATIVO);
        if (elegibilidade.getEmManutencao()) throw new ConflitoException(MENSAGEM_EQUIPAMENTO_EM_MANUTENCAO);
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
     * Entrada de dominio usada pelo Incident Engine.
     *
     * <p>Abertura condicional via INSERT ... SELECT ... WHERE: o WHERE carrega o
     * predicado inteiro de "este monitor deveria estar sendo observado agora"
     * (monitor ativo, equipamento ativo, equipamento fora de manutencao), e o
     * ON CONFLICT DO NOTHING absorve o indice parcial uq_incidente_monitor_aberto
     * contra a corrida concorrente. Ver IncidenteRepository.inserirSeElegivel.
     *
     * <p>Retorno vazio significa que nada foi inserido — manutencao ganhou a
     * corrida, monitor/equipamento saiu do ar, ou ja havia incidente aberto — e,
     * principalmente, que NENHUMA notificacao nasce. O caminho antigo chamava
     * notificacaoService logo depois do save, sem olhar se algo tinha sido
     * inserido; e esse o defeito que a corrida com a manutencao expunha.
     */
    @Transactional
    public Optional<Incidente> abrirAutomaticamente(Monitor monitor, Instant iniciadoEm, int falhasConsecutivas) {
        String motivo = "Indisponibilidade detectada automaticamente apos " + falhasConsecutivas
                + " falhas consecutivas.";
        if (incidenteRepository.inserirSeElegivel(monitor.getId(), iniciadoEm, motivo, Instant.now()) == 0) {
            // Manutencao ganhou a corrida, monitor/equipamento saiu do ar, ou ja havia
            // incidente aberto. Sem insercao, sem notificacao.
            return Optional.empty();
        }
        Incidente aberto = incidenteRepository
                .findFirstByMonitorIdAndStatusInOrderByIniciadoEmDescIdDesc(monitor.getId(), StatusIncidente.EM_ABERTO)
                .orElseThrow(() -> new IllegalStateException(
                        "insercao reportou 1 linha mas nenhum incidente aberto foi encontrado para o monitor "
                                + monitor.getId()));
        notificacaoService.criarParaIncidenteAberto(aberto);
        return Optional.of(aberto);
    }

    @Transactional
    public Incidente fecharAutomaticamente(Incidente incidente, Instant encerradoEm, int sucessosConsecutivos) {
        if (incidente.getStatus() == StatusIncidente.FECHADO) {
            return incidente;
        }
        if (encerradoEm.isBefore(incidente.getIniciadoEm())) {
            throw new IllegalArgumentException("encerradoEm deve ser maior ou igual a iniciadoEm");
        }
        // Sem autor: quem fechou foi o motor. E o unico caminho que deixa fechado_por nulo.
        // CAS: se a manutencao, um humano ou outro ciclo fechou entre a leitura do
        // processor e aqui, nao ha o que fechar nem o que notificar.
        String observacao = "Recuperacao detectada automaticamente apos " + sucessosConsecutivos
                + " sucessos consecutivos.";
        if (incidenteRepository.fecharAutomaticamenteSeEmAberto(incidente.getId(), encerradoEm, observacao,
                Instant.now()) == 0) {
            return obterIncidente(incidente.getId());
        }
        // O bulk update nao atualiza a instancia carregada; releitura antes de notificar,
        // senao a mensagem sai com encerradoEm nulo.
        Incidente fechado = obterIncidente(incidente.getId());
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

    /**
     * Fechamento humano: registra o autor em {@code fechado_por}, a trilha que a V17
     * criou. O id vem do principal autenticado, nunca do corpo da requisicao.
     *
     * <p>Escrita por CAS (fecharManualmenteSeEmAberto), nao por saveAndFlush: o UPDATE de
     * linha inteira regravava um fechamento do motor ou da manutencao commitado depois da
     * leitura e apagava reconhecido_* (A1 da auditoria de concorrencia).
     */
    @Transactional
    public IncidenteResponse fechar(Long id, CloseIncidenteRequest requisicao, Long usuarioId) {
        Incidente incidente = obterIncidente(id);
        if (incidente.getStatus() == StatusIncidente.FECHADO) {
            return paraResposta(incidente);
        }
        if (requisicao.encerradoEm().isBefore(incidente.getIniciadoEm())) {
            throw new IllegalArgumentException("encerradoEm deve ser maior ou igual a iniciadoEm");
        }
        // CAS: a leitura acima pode estar velha (motor, manutencao ou outro operador fecharam
        // depois dela). Quem perde devolve o estado atual, sem segunda notificacao.
        if (incidenteRepository.fecharManualmenteSeEmAberto(id, requisicao.encerradoEm(),
                normalizar(requisicao.observacao()), autor(usuarioId), Instant.now()) == 0) {
            return paraResposta(obterIncidente(id));
        }
        // O bulk update nao atualiza a instancia carregada; releitura antes de notificar.
        Incidente fechado = obterIncidente(id);
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
    public IncidenteResponse reconhecer(Long id, Long usuarioId) {
        Incidente incidente = obterIncidente(id);
        if (incidenteRepository.reconhecerSeAberto(id, autor(usuarioId), Instant.now()) == 0) {
            // Ou ja estava reconhecido, ou o motor fechou entre o SELECT e o UPDATE.
            Incidente atual = obterIncidente(id);
            throw new ConflitoException(atual.getStatus() == StatusIncidente.FECHADO
                    ? "O incidente ja foi fechado e nao pode mais ser reconhecido"
                    : "O incidente ja foi reconhecido");
        }
        // O bulk update nao atualiza a instancia carregada; releitura para responder.
        return paraResposta(obterIncidente(incidente.getId()));
    }

    /**
     * Autor humano da acao, resolvido a partir do id do principal autenticado.
     * Falha alto quando o id nao chega: gravar autor nulo violaria
     * ck_incidente_reconhecimento_par no banco e viraria um 409 sem sentido para
     * quem clicou — foi exatamente assim que reconhecer ficou quebrado.
     */
    private Usuario autor(Long usuarioId) {
        if (usuarioId == null) {
            throw new IllegalStateException("Acao exige usuario autenticado");
        }
        return usuarioRepository.findById(usuarioId)
                .orElseThrow(() -> new RecursoNaoEncontradoException("Usuario nao encontrado"));
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
                incidente.getFechadoPor() == null ? null : incidente.getFechadoPor().getNome(),
                new MonitorIncidenteResponse(monitor.getId(), monitor.getNome(), monitor.getTipo(),
                        equipamento.getId(), equipamento.getNome(), equipamento.getUnidade().getId(),
                        equipamento.getUnidade().getNome()),
                incidente.getCreatedAt(), incidente.getUpdatedAt(), incidente.getMotivoEncerramento());
    }
}
