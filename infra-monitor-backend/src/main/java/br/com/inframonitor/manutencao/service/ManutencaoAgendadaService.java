package br.com.inframonitor.manutencao.service;

import br.com.inframonitor.common.api.Paginacao;
import br.com.inframonitor.common.exception.ConflitoException;
import br.com.inframonitor.common.exception.RecursoNaoEncontradoException;
import br.com.inframonitor.equipamento.dto.ReferenciaResponse;
import br.com.inframonitor.equipamento.entity.Equipamento;
import br.com.inframonitor.equipamento.repository.EquipamentoRepository;
import br.com.inframonitor.equipamento.service.EstadoManutencaoEquipamento;
import br.com.inframonitor.manutencao.config.ManutencaoAgendadaProperties;
import br.com.inframonitor.manutencao.dto.AlterarFimRequest;
import br.com.inframonitor.manutencao.dto.CriarManutencaoRequest;
import br.com.inframonitor.manutencao.dto.EditarManutencaoRequest;
import br.com.inframonitor.manutencao.dto.ManutencaoResponse;
import br.com.inframonitor.manutencao.dto.ParametrosManutencaoResponse;
import br.com.inframonitor.manutencao.dto.UltimaAlteracaoResponse;
import br.com.inframonitor.manutencao.entity.EscopoManutencao;
import br.com.inframonitor.manutencao.entity.ManutencaoAgendada;
import br.com.inframonitor.manutencao.entity.SituacaoManutencao;
import br.com.inframonitor.manutencao.entity.TipoAlteracao;
import br.com.inframonitor.manutencao.repository.CoberturaManutencao;
import br.com.inframonitor.manutencao.repository.EdicaoManutencao;
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
    private final AnuncioManutencao anuncio;
    private final EstadoManutencaoEquipamento estado;
    private final UnidadeRepository unidades;
    private final EquipamentoRepository equipamentos;
    private final UsuarioRepository usuarios;
    private final ManutencaoAgendadaProperties propriedades;
    private final EdicaoManutencao edicao;
    private final TransactionTemplate transacao;
    private final TransactionTemplate leitura;

    public ManutencaoAgendadaService(ManutencaoAgendadaRepository repositorio, CoberturaManutencao cobertura,
                                     AnuncioManutencao anuncio, EstadoManutencaoEquipamento estado,
                                     UnidadeRepository unidades, EquipamentoRepository equipamentos, UsuarioRepository usuarios,
                                     ManutencaoAgendadaProperties propriedades, EdicaoManutencao edicao,
                                     PlatformTransactionManager transactionManager) {
        this.repositorio = repositorio;
        this.cobertura = cobertura;
        this.anuncio = anuncio;
        this.estado = estado;
        this.unidades = unidades;
        this.equipamentos = equipamentos;
        this.usuarios = usuarios;
        this.propriedades = propriedades;
        this.edicao = edicao;
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
        // como no reconciliador. Relogio lido de novo: o agora da validacao ficou para tras
        // durante o insert, e o CAS (inicio_previsto <= agora) ja e a guarda de "devida".
        // A janela ja esta salva: falha daqui em diante NAO pode virar erro no POST, senao o
        // operador reenvia e duplica a janela (MA18). Falha na ativacao deixa a janela AGENDADA
        // e o tick a ativa; falha na reavaliacao deixa o flag divergente e o divergentes() do
        // reconciliador repara na proxima passada (criar exige o agendador ligado). Falha ao montar o
        // anuncio cai no mesmo ramo: desfaz a ativacao com ele (MA31) e o tick ativa e anuncia.
        try {
            if (ativarEAnunciar(id)) {
                reavaliarCobertos(id);
            }
        } catch (RuntimeException e) {
            log.warn("Janela {} criada, mas a ativacao imediata falhou; o reconciliador repara na proxima passada",
                    id, e);
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
        Instant agora = Instant.now();
        Boolean encerrou = transacao.execute(s -> {
            if (!cobertura.encerrar(id, usuarioId, agora)) {
                return false;
            }
            anuncio.anunciarFim(id, agora);   // so no ramo vencedor do CAS (MA31)
            return true;
        });
        if (!Boolean.TRUE.equals(encerrou)) {
            throw new ConflitoException(recusa("encerrar", situacaoAtual(id)));
        }
        reavaliarCobertos(id);
        return detalhar(id);
    }

    /**
     * CAS AGENDADA -> ATIVA e o anuncio do inicio na mesma transacao, com o mesmo instante; os
     * cobertos sao reavaliados pelo chamador depois do commit.
     */
    private boolean ativarEAnunciar(long id) {
        Instant agora = Instant.now();
        return Boolean.TRUE.equals(transacao.execute(s -> {
            if (!cobertura.ativarSeDevida(id, agora)) {
                return false;
            }
            anuncio.anunciarInicio(id, agora, false);   // nunca "sistema esteve fora": o servidor esta no ar
            return true;
        }));
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

    public ManutencaoResponse obterPorId(Long id) {
        return detalhar(id);
    }

    /**
     * Edita uma AGENDADA (MA21). Lock e CAS na transacao (MA26); a ativacao imediata vem depois do
     * commit e so com o agendador ligado (MA25): desligado, nada ativaria uma janela que nada encerra.
     * Salvar sem mudanca devolve a janela como esta: sem UPDATE, sem versao nova e sem EDICAO.
     */
    public ManutencaoResponse editar(Long id, EditarManutencaoRequest req, Long usuarioId) {
        Instant agora = Instant.now();
        Boolean mudou = transacao.execute(s -> {
            EdicaoManutencao.Retrato antes = edicao.travar(id, SituacaoManutencao.AGENDADA.name(), req.versao())
                    .orElseThrow(() -> recusaEdicao(id, req.versao(), SituacaoManutencao.AGENDADA));
            boolean mesmaUnidade = antes.unidadeId() == req.unidadeId();
            Validado v = validar(req.unidadeId(), req.escopo(), req.equipamentoIds(), req.inicioPrevisto(),
                    req.fimPrevisto(), req.motivo(),
                    mesmaUnidade ? new LinkedHashSet<>(antes.equipamentoIds()) : Set.of(), agora);
            EdicaoManutencao.Retrato depois = new EdicaoManutencao.Retrato(v.unidade().getId(), req.escopo().name(),
                    v.equipamentos().stream().map(Equipamento::getId).sorted().toList(), req.inicioPrevisto(),
                    req.fimPrevisto(), v.motivo());
            // Nada mudou (ids ordenados dos dois lados): sem UPDATE nem EDICAO, a versao da tela segue valendo.
            if (depois.equals(antes)) {
                return false;
            }
            if (!edicao.gravarEdicao(id, req.versao(), depois, agora)) {
                throw new IllegalStateException("Janela " + id + " mudou sob lock");
            }
            edicao.registrar(id, TipoAlteracao.EDICAO, usuarioId, agora, antes, depois);
            return true;
        });
        if (Boolean.TRUE.equals(mudou) && propriedades.isEnabled()) {
            try {
                if (ativarEAnunciar(id)) {
                    reavaliarCobertos(id);
                }
            } catch (RuntimeException e) {
                log.warn("Janela {} editada, mas a ativacao imediata falhou; o reconciliador repara na proxima passada",
                        id, e);
            }
        }
        return detalhar(id);
    }

    /** Prorroga ou antecipa uma ATIVA (MA22). Teto sobre o total, tambem no WHERE (MA23). */
    public ManutencaoResponse alterarFim(Long id, AlterarFimRequest req, Long usuarioId) {
        if (!propriedades.isEnabled()) {
            throw new ConflitoException(MSG_DESLIGADO);
        }
        Instant agora = Instant.now();
        Instant novoFim = req.fimPrevisto();
        Duration maxima = propriedades.getDuracaoMaxima();
        transacao.executeWithoutResult(s -> {
            EdicaoManutencao.Retrato antes = edicao.travar(id, SituacaoManutencao.ATIVA.name(), req.versao())
                    .orElseThrow(() -> recusaEdicao(id, req.versao(), SituacaoManutencao.ATIVA));
            if (!novoFim.isAfter(agora)) {
                throw new IllegalArgumentException("O novo fim ja passou. Para terminar agora use Encerrar agora");
            }
            if (novoFim.equals(antes.fimPrevisto())) {
                throw new IllegalArgumentException("O novo fim e igual ao atual");
            }
            if (Duration.between(antes.inicioPrevisto(), novoFim).compareTo(maxima) > 0) {
                throw new IllegalArgumentException("A janela nao pode passar de " + maxima.toHours()
                        + " horas desde o inicio");
            }
            if (!edicao.gravarFim(id, req.versao(), novoFim, agora, maxima)) {
                throw new IllegalStateException("Janela " + id + " mudou sob lock");
            }
            TipoAlteracao tipo = novoFim.isAfter(antes.fimPrevisto()) ? TipoAlteracao.PRORROGACAO
                    : TipoAlteracao.ANTECIPACAO;
            edicao.registrar(id, tipo, usuarioId, agora, antes, antes.comFim(novoFim));
            anuncio.anunciarFimAlterado(id, antes.fimPrevisto(), novoFim, usuarioId, agora);
        });
        return detalhar(id);
    }

    /** Por que o lock voltou vazio: inexistente (404), outra situacao (409) ou versao velha (409). */
    private RuntimeException recusaEdicao(long id, int versao, SituacaoManutencao esperada) {
        EdicaoManutencao.EstadoAtual atual = edicao.estado(id).orElse(null);
        if (atual == null) {
            return new RecursoNaoEncontradoException("Janela de manutencao nao encontrada");
        }
        if (!atual.status().equals(esperada.name())) {
            if (esperada == SituacaoManutencao.AGENDADA) {
                return new ConflitoException("Nao e possivel editar: a janela esta " + atual.status() + "."
                        + ("ATIVA".equals(atual.status()) ? " Use Alterar fim." : ""));
            }
            return new ConflitoException("Nao e possivel alterar o fim: a janela esta " + atual.status() + "."
                    + ("CONCLUIDA".equals(atual.status()) ? " Agende uma continuacao." : ""));
        }
        return new ConflitoException("A janela foi alterada por outra pessoa. Recarregue e tente de novo.");
    }

    public Page<ManutencaoResponse> listar(String situacao, String busca, Long unidadeId, Pageable pageable) {
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
            long unidade = unidadeId == null ? 0L : unidadeId;
            Page<ManutencaoAgendada> janelas = filtro.equals("VIGENTES")
                    ? repositorio.vigentes(VIGENTES, termo, unidade, pagina)
                    : repositorio.historico(HISTORICO, termo, unidade, pagina);
            Map<Long, EdicaoManutencao.Ultima> ultimas = edicao.ultimas(
                    janelas.getContent().stream().map(ManutencaoAgendada::getId).toList());
            return janelas.map(m -> paraResposta(m, ultimas.get(m.getId())));
        });
    }

    public ParametrosManutencaoResponse parametros() {
        return new ParametrosManutencaoResponse(propriedades.isEnabled(), propriedades.getDuracaoMaxima().toHours());
    }

    /** Resultado da validacao comum a criar e editar. */
    private record Validado(Unidade unidade, Set<Equipamento> equipamentos, String motivo) { }

    private Validado validar(Long unidadeId, EscopoManutencao escopo, List<Long> equipamentoIds, Instant inicio,
                             Instant fim, String motivoBruto, Set<Long> jaVinculados, Instant agora) {
        Unidade unidade = unidades.findById(unidadeId)
                .orElseThrow(() -> new RecursoNaoEncontradoException("Unidade nao encontrada"));
        if (!unidade.isAtivo()) {
            throw new ConflitoException("Nao e possivel agendar manutencao em unidade inativa");
        }
        String motivo = motivoBruto == null ? "" : motivoBruto.strip();
        if (motivo.isEmpty()) {
            throw new IllegalArgumentException("Informe o motivo da manutencao");
        }
        if (!fim.isAfter(inicio)) {
            throw new IllegalArgumentException("O fim da janela deve ser depois do inicio");
        }
        if (inicio.isBefore(agora.minus(TOLERANCIA_PASSADO))) {
            throw new IllegalArgumentException("Nao e possivel agendar manutencao com inicio no passado");
        }
        Duration maxima = propriedades.getDuracaoMaxima();
        if (Duration.between(inicio, fim).compareTo(maxima) > 0) {
            throw new IllegalArgumentException("A janela nao pode passar de " + maxima.toHours() + " horas");
        }
        return new Validado(unidade, equipamentosDoEscopo(escopo, equipamentoIds, unidade, jaVinculados), motivo);
    }

    private ManutencaoAgendada validarEMontar(CriarManutencaoRequest req, Long usuarioId, Instant agora) {
        Validado v = validar(req.unidadeId(), req.escopo(), req.equipamentoIds(), req.inicioPrevisto(),
                req.fimPrevisto(), req.motivo(), Set.of(), agora);
        Usuario autor = usuarios.findById(usuarioId)
                .orElseThrow(() -> new RecursoNaoEncontradoException("Usuario nao encontrado"));
        return new ManutencaoAgendada(v.unidade(), req.escopo(), req.inicioPrevisto(), req.fimPrevisto(), v.motivo(),
                autor, v.equipamentos());
    }

    private Set<Equipamento> equipamentosDoEscopo(EscopoManutencao escopo, List<Long> idsBrutos, Unidade unidade,
                                                  Set<Long> jaVinculados) {
        List<Long> ids = idsBrutos == null ? List.of() : idsBrutos;
        if (escopo == EscopoManutencao.UNIDADE) {
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
            // MA21: ja vinculado e a unidade da janela nao mudou -> continua mesmo inativo ou movido.
            if (!jaVinculados.contains(id)) {
                if (!equipamento.getUnidade().getId().equals(unidade.getId())) {
                    throw new IllegalArgumentException("O equipamento " + equipamento.getNome()
                            + " nao pertence a unidade");
                }
                if (!equipamento.isAtivo()) {
                    throw new ConflitoException("Nao e possivel agendar manutencao do equipamento "
                            + equipamento.getNome() + " porque ele esta inativo");
                }
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
                .orElseThrow(() -> new RecursoNaoEncontradoException("Janela de manutencao nao encontrada")),
                edicao.ultimas(List.of(id)).get(id)));
    }

    private ManutencaoResponse paraResposta(ManutencaoAgendada m, EdicaoManutencao.Ultima ultima) {
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
                m.getCanceladaEm(), referencia(m.getCanceladaPor()), sobreposicoes,
                m.getVersao(), ultima == null ? null : new UltimaAlteracaoResponse(ultima.tipo(),
                        new ReferenciaResponse(ultima.porId(), ultima.porNome()), ultima.em()));
    }

    private static ReferenciaResponse referencia(Unidade unidade) {
        return new ReferenciaResponse(unidade.getId(), unidade.getNome());
    }

    private static ReferenciaResponse referencia(Usuario usuario) {
        return usuario == null ? null : new ReferenciaResponse(usuario.getId(), usuario.getNome());
    }
}
