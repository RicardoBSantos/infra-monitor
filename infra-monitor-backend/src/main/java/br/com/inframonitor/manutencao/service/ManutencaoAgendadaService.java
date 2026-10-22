package br.com.inframonitor.manutencao.service;

import br.com.inframonitor.common.api.Paginacao;
import br.com.inframonitor.common.exception.ConflitoException;
import br.com.inframonitor.common.exception.RecursoNaoEncontradoException;
import br.com.inframonitor.equipamento.dto.ReferenciaResponse;
import br.com.inframonitor.equipamento.entity.Equipamento;
import br.com.inframonitor.equipamento.repository.EquipamentoRepository;
import br.com.inframonitor.equipamento.service.EstadoManutencaoEquipamento;
import br.com.inframonitor.manutencao.config.ManutencaoAgendadaProperties;
import br.com.inframonitor.manutencao.dto.CriarManutencaoRequest;
import br.com.inframonitor.manutencao.dto.ManutencaoResponse;
import br.com.inframonitor.manutencao.dto.ParametrosManutencaoResponse;
import br.com.inframonitor.manutencao.entity.EscopoManutencao;
import br.com.inframonitor.manutencao.entity.ManutencaoAgendada;
import br.com.inframonitor.manutencao.entity.SituacaoManutencao;
import br.com.inframonitor.manutencao.repository.CoberturaManutencao;
import br.com.inframonitor.manutencao.repository.ManutencaoAgendadaRepository;
import br.com.inframonitor.unidade.entity.Unidade;
import br.com.inframonitor.unidade.repository.UnidadeRepository;
import br.com.inframonitor.usuario.entity.Usuario;
import br.com.inframonitor.usuario.repository.UsuarioRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Duration;
import java.time.Instant;
import java.util.Comparator;
import java.util.EnumSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/**
 * Janelas de manutencao agendadas. Sem @Transactional nos metodos de proposito: a mudanca de
 * situacao (CAS) commita numa transacao propria e so DEPOIS cada equipamento coberto e
 * reavaliado na sua, em ordem de id, como no reconciliador. Reavaliar dentro da transacao do
 * CAS faria o lock do equipamento enxergar uma janela ainda nao commitada para os outros.
 */
@Service
public class ManutencaoAgendadaService {

    static final String MSG_DESLIGADO = "Agendamento de manutencao desligado neste servidor: nenhuma janela seria "
            + "ativada. Para ligar, defina MANUTENCAO_AGENDADA_ENABLED=true nas variaveis de ambiente do servico do "
            + "backend e reinicie-o. Enquanto isso, use \"Iniciar manutencao\" no equipamento.";
    /** Folga para o relogio do navegador e o tempo de preencher o formulario com inicio "agora". */
    static final Duration TOLERANCIA_PASSADO = Duration.ofMinutes(5);

    private static final Logger log = LoggerFactory.getLogger(ManutencaoAgendadaService.class);
    private static final Set<SituacaoManutencao> VIGENTES = EnumSet.of(SituacaoManutencao.AGENDADA,
            SituacaoManutencao.ATIVA);
    private static final Set<SituacaoManutencao> HISTORICO = EnumSet.complementOf(EnumSet.copyOf(VIGENTES));

    private final ManutencaoAgendadaRepository repositorio;
    private final CoberturaManutencao cobertura;
    private final EstadoManutencaoEquipamento estado;
    private final UnidadeRepository unidades;
    private final EquipamentoRepository equipamentos;
    private final UsuarioRepository usuarios;
    private final ManutencaoAgendadaProperties propriedades;
    private final TransactionTemplate transacao;
    private final TransactionTemplate leitura;

    public ManutencaoAgendadaService(ManutencaoAgendadaRepository repositorio, CoberturaManutencao cobertura,
                                     EstadoManutencaoEquipamento estado, UnidadeRepository unidades,
                                     EquipamentoRepository equipamentos, UsuarioRepository usuarios,
                                     ManutencaoAgendadaProperties propriedades,
                                     PlatformTransactionManager transactionManager) {
        this.repositorio = repositorio;
        this.cobertura = cobertura;
        this.estado = estado;
        this.unidades = unidades;
        this.equipamentos = equipamentos;
        this.usuarios = usuarios;
        this.propriedades = propriedades;
        this.transacao = new TransactionTemplate(transactionManager);
        this.leitura = new TransactionTemplate(transactionManager);
        this.leitura.setReadOnly(true);
    }

    public ManutencaoResponse criar(CriarManutencaoRequest req, Long usuarioId) {
        if (!propriedades.isEnabled()) {
            throw new ConflitoException(MSG_DESLIGADO);
        }
        Instant agora = Instant.now();
        Long id = transacao.execute(s -> repositorio.saveAndFlush(validarEMontar(req, usuarioId, agora)).getId());
        // Fora da transacao de criacao: a ativacao e a reavaliacao sao transacoes proprias,
        // como no reconciliador. Uma falha aqui deixa a janela AGENDADA, e o tick a ativa.
        // Relogio lido de novo: o agora da validacao ficou para tras durante o insert, e o CAS
        // (inicio_previsto <= agora) ja e a guarda de "devida".
        if (Boolean.TRUE.equals(transacao.execute(s -> cobertura.ativarSeDevida(id, Instant.now())))) {
            reavaliarCobertos(id);
        }
        return detalhar(id);
    }

    public ManutencaoResponse cancelar(Long id, Long usuarioId) {
        obter(id);
        if (!Boolean.TRUE.equals(transacao.execute(s -> cobertura.cancelar(id, usuarioId, Instant.now())))) {
            throw new ConflitoException(recusa("cancelar", situacaoAtual(id)));
        }
        return detalhar(id);
    }

    public ManutencaoResponse encerrar(Long id, Long usuarioId) {
        obter(id);
        if (!Boolean.TRUE.equals(transacao.execute(s -> cobertura.encerrar(id, usuarioId, Instant.now())))) {
            throw new ConflitoException(recusa("encerrar", situacaoAtual(id)));
        }
        reavaliarCobertos(id);
        return detalhar(id);
    }

    /**
     * Um equipamento por transacao, em ordem de id (mesma ordem de lock do reconciliador). A
     * situacao da janela ja esta commitada: parar no primeiro erro deixaria os demais
     * equipamentos com o flag velho, e com o agendador desligado ninguem os repararia. Por isso
     * segue ate o fim; equipamento excluido no meio do caminho nao e erro (nao ha o que
     * reavaliar), qualquer outra falha sobe depois que todos foram tentados.
     */
    private void reavaliarCobertos(long manutencaoId) {
        RuntimeException primeiraFalha = null;
        for (Long equipamentoId : cobertura.cobertosPor(manutencaoId)) {
            try {
                estado.reavaliar(equipamentoId);
            } catch (RecursoNaoEncontradoException e) {
                log.info("Janela {}: equipamento {} excluido antes da reavaliacao; ignorado",
                        manutencaoId, equipamentoId);
            } catch (RuntimeException e) {
                log.error("Janela {}: falha ao reavaliar o equipamento {}; seguindo com os demais",
                        manutencaoId, equipamentoId, e);
                if (primeiraFalha == null) {
                    primeiraFalha = e;
                }
            }
        }
        if (primeiraFalha != null) {
            throw primeiraFalha;
        }
    }

    public Page<ManutencaoResponse> listar(String situacao, String busca, Pageable pageable) {
        String filtro = situacao == null ? "VIGENTES" : situacao.strip().toUpperCase(Locale.ROOT);
        if (!filtro.equals("VIGENTES") && !filtro.equals("HISTORICO")) {
            throw new IllegalArgumentException("Situacao de listagem invalida: use VIGENTES ou HISTORICO");
        }
        // % e _ digitados sao texto, nao curinga: escapados para o ESCAPE '\' das queries.
        String texto = busca == null ? "" : busca.strip().toLowerCase(Locale.ROOT);
        String termo = "%" + texto.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%";
        // Sem Sort: a ordem esta na query.
        Pageable pagina = PageRequest.of(pageable.getPageNumber(),
                Math.min(pageable.getPageSize(), Paginacao.TAMANHO_MAXIMO));
        return leitura.execute(s -> {
            Page<ManutencaoAgendada> janelas = filtro.equals("VIGENTES")
                    ? repositorio.vigentes(VIGENTES, termo, pagina)
                    : repositorio.historico(HISTORICO, termo, pagina);
            return janelas.map(this::paraResposta);
        });
    }

    public ParametrosManutencaoResponse parametros() {
        return new ParametrosManutencaoResponse(propriedades.isEnabled(), propriedades.getDuracaoMaxima().toHours());
    }

    private ManutencaoAgendada validarEMontar(CriarManutencaoRequest req, Long usuarioId, Instant agora) {
        Unidade unidade = unidades.findById(req.unidadeId())
                .orElseThrow(() -> new RecursoNaoEncontradoException("Unidade nao encontrada"));
        if (!unidade.isAtivo()) {
            throw new ConflitoException("Nao e possivel agendar manutencao em unidade inativa");
        }
        String motivo = req.motivo() == null ? "" : req.motivo().strip();
        if (motivo.isEmpty()) {
            throw new IllegalArgumentException("Informe o motivo da manutencao");
        }
        if (!req.fimPrevisto().isAfter(req.inicioPrevisto())) {
            throw new IllegalArgumentException("O fim da janela deve ser depois do inicio");
        }
        if (req.inicioPrevisto().isBefore(agora.minus(TOLERANCIA_PASSADO))) {
            throw new IllegalArgumentException("Nao e possivel agendar manutencao com inicio no passado");
        }
        Duration maxima = propriedades.getDuracaoMaxima();
        if (Duration.between(req.inicioPrevisto(), req.fimPrevisto()).compareTo(maxima) > 0) {
            throw new IllegalArgumentException("A janela nao pode passar de " + maxima.toHours() + " horas");
        }
        Set<Equipamento> cobertos = equipamentosDoEscopo(req, unidade);
        Usuario autor = usuarios.findById(usuarioId)
                .orElseThrow(() -> new RecursoNaoEncontradoException("Usuario nao encontrado"));
        return new ManutencaoAgendada(unidade, req.escopo(), req.inicioPrevisto(), req.fimPrevisto(), motivo, autor,
                cobertos);
    }

    private Set<Equipamento> equipamentosDoEscopo(CriarManutencaoRequest req, Unidade unidade) {
        List<Long> ids = req.equipamentoIds() == null ? List.of() : req.equipamentoIds();
        if (req.escopo() == EscopoManutencao.UNIDADE) {
            if (!ids.isEmpty()) {
                throw new IllegalArgumentException("Escopo UNIDADE nao recebe equipamentos");
            }
            return Set.of();
        }
        if (ids.isEmpty()) {
            throw new IllegalArgumentException("Selecione ao menos um equipamento");
        }
        if (ids.stream().anyMatch(Objects::isNull)) {   // List.of().contains(null) lancaria NPE
            throw new IllegalArgumentException("Lista de equipamentos com id nulo");
        }
        Map<Long, Equipamento> encontrados = new LinkedHashMap<>();
        equipamentos.findAllById(new LinkedHashSet<>(ids)).forEach(e -> encontrados.put(e.getId(), e));
        Set<Equipamento> resultado = new LinkedHashSet<>();
        for (Long id : new LinkedHashSet<>(ids)) {
            Equipamento equipamento = encontrados.get(id);
            if (equipamento == null) {
                throw new RecursoNaoEncontradoException("Equipamento " + id + " nao encontrado");
            }
            if (!equipamento.getUnidade().getId().equals(unidade.getId())) {
                throw new IllegalArgumentException("O equipamento " + equipamento.getNome()
                        + " nao pertence a unidade");
            }
            if (!equipamento.isAtivo()) {
                throw new ConflitoException("Nao e possivel agendar manutencao do equipamento "
                        + equipamento.getNome() + " porque ele esta inativo");
            }
            resultado.add(equipamento);
        }
        return resultado;
    }

    private void obter(Long id) {
        if (!Boolean.TRUE.equals(leitura.execute(s -> repositorio.existsById(id)))) {
            throw new RecursoNaoEncontradoException("Janela de manutencao nao encontrada");
        }
    }

    private SituacaoManutencao situacaoAtual(Long id) {
        return leitura.execute(s -> repositorio.findById(id)
                .orElseThrow(() -> new RecursoNaoEncontradoException("Janela de manutencao nao encontrada"))
                .getSituacao());
    }

    private static String recusa(String acao, SituacaoManutencao situacao) {
        String base = "Nao e possivel " + acao + ": a janela esta " + situacao + ".";
        return acao.equals("cancelar") && situacao == SituacaoManutencao.ATIVA ? base + " Use Encerrar agora." : base;
    }

    private ManutencaoResponse detalhar(Long id) {
        return leitura.execute(s -> paraResposta(repositorio.findById(id)
                .orElseThrow(() -> new RecursoNaoEncontradoException("Janela de manutencao nao encontrada"))));
    }

    private ManutencaoResponse paraResposta(ManutencaoAgendada m) {
        boolean vigente = VIGENTES.contains(m.getSituacao());
        List<Long> sobreposicoes = vigente
                ? repositorio.sobreposicoes(m.getId(), m.getUnidade().getId(), m.getEscopo().name(),
                        m.getInicioPrevisto(), m.getFimPrevisto())
                : List.of();
        List<ReferenciaResponse> cobertos = m.getEquipamentos().stream()
                .sorted(Comparator.comparing(Equipamento::getNome).thenComparing(Equipamento::getId))
                .map(e -> new ReferenciaResponse(e.getId(), e.getNome()))
                .toList();
        return new ManutencaoResponse(m.getId(), referencia(m.getUnidade()), m.getEscopo(), cobertos,
                m.getInicioPrevisto(), m.getFimPrevisto(), m.getMotivo(), m.getSituacao(),
                referencia(m.getCriadoPor()), m.getAtivadaEm(), m.getEncerradaEm(), referencia(m.getEncerradaPor()),
                m.getCanceladaEm(), referencia(m.getCanceladaPor()), sobreposicoes);
    }

    private static ReferenciaResponse referencia(Unidade unidade) {
        return new ReferenciaResponse(unidade.getId(), unidade.getNome());
    }

    private static ReferenciaResponse referencia(Usuario usuario) {
        return usuario == null ? null : new ReferenciaResponse(usuario.getId(), usuario.getNome());
    }
}
