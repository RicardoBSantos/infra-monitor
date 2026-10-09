package br.com.inframonitor.equipamento.service;

import br.com.inframonitor.common.exception.ConflitoException;
import br.com.inframonitor.common.exception.RecursoNaoEncontradoException;
import br.com.inframonitor.equipamento.dto.CreateEquipamentoRequest;
import br.com.inframonitor.equipamento.dto.EquipamentoResponse;
import br.com.inframonitor.equipamento.dto.ReferenciaResponse;
import br.com.inframonitor.equipamento.dto.UpdateEquipamentoRequest;
import br.com.inframonitor.equipamento.entity.Equipamento;
import br.com.inframonitor.equipamento.repository.EquipamentoRepository;
import br.com.inframonitor.incidente.entity.Incidente;
import br.com.inframonitor.incidente.entity.MotivoEncerramentoIncidente;
import br.com.inframonitor.incidente.repository.IncidenteRepository;
import br.com.inframonitor.monitor.repository.MonitorRepository;
import br.com.inframonitor.monitoring.latency.MonitorEpisodioLatencia;
import br.com.inframonitor.monitoring.latency.MonitorEpisodioLatenciaRepository;
import br.com.inframonitor.monitoring.latency.MotivoEncerramentoEpisodio;
import br.com.inframonitor.notificacao.service.NotificacaoService;
import br.com.inframonitor.tipoequipamento.entity.TipoEquipamento;
import br.com.inframonitor.tipoequipamento.repository.TipoEquipamentoRepository;
import br.com.inframonitor.unidade.entity.Unidade;
import br.com.inframonitor.unidade.repository.UnidadeRepository;
import br.com.inframonitor.usuario.entity.Usuario;
import br.com.inframonitor.usuario.repository.UsuarioRepository;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.beans.factory.annotation.Autowired;
import br.com.inframonitor.relatorio.service.CicloJanelaMonitoramentoService;

import java.time.Instant;
import java.util.List;
import java.util.Objects;

@Service
@Transactional(readOnly = true)
public class EquipamentoService {

    private final EquipamentoRepository equipamentoRepository;
    private final UnidadeRepository unidadeRepository;
    private final TipoEquipamentoRepository tipoEquipamentoRepository;
    private final MonitorRepository monitorRepository;
    private final CicloJanelaMonitoramentoService cicloJanela;
    private final IncidenteRepository incidenteRepository;
    private final MonitorEpisodioLatenciaRepository episodioRepository;
    private final NotificacaoService notificacaoService;
    private final UsuarioRepository usuarioRepository;

    @Autowired
    public EquipamentoService(EquipamentoRepository equipamentoRepository, UnidadeRepository unidadeRepository,
                              TipoEquipamentoRepository tipoEquipamentoRepository, MonitorRepository monitorRepository,
                              CicloJanelaMonitoramentoService cicloJanela, IncidenteRepository incidenteRepository,
                              MonitorEpisodioLatenciaRepository episodioRepository, NotificacaoService notificacaoService,
                              UsuarioRepository usuarioRepository) {
        this.equipamentoRepository = equipamentoRepository;
        this.unidadeRepository = unidadeRepository;
        this.tipoEquipamentoRepository = tipoEquipamentoRepository;
        this.monitorRepository = monitorRepository;
        this.cicloJanela = cicloJanela;
        this.incidenteRepository = incidenteRepository;
        this.episodioRepository = episodioRepository;
        this.notificacaoService = notificacaoService;
        this.usuarioRepository = usuarioRepository;
    }

    @Transactional
    public EquipamentoResponse criar(CreateEquipamentoRequest requisicao) {
        Unidade unidade = obterUnidadeAtiva(requisicao.unidadeId());
        TipoEquipamento tipo = obterTipoAtivo(requisicao.tipoEquipamentoId());
        Equipamento equipamento = new Equipamento(unidade, tipo, normalizarObrigatorio(requisicao.nome()),
                normalizarIp(requisicao.ip()), normalizarOpcional(requisicao.hostname()), requisicao.descricao(),
                normalizarOpcional(requisicao.localizacao()), normalizarOpcional(requisicao.numeroSerie()));
        equipamento.setFabricante(normalizarOpcional(requisicao.fabricante()));
        equipamento.setModelo(normalizarOpcional(requisicao.modelo()));
        return paraResposta(equipamentoRepository.save(equipamento));
    }

    public EquipamentoResponse buscarPorId(Long id) {
        return paraResposta(obterEquipamento(id));
    }

    public Page<EquipamentoResponse> listar(Long unidadeId, Long tipoEquipamentoId, Boolean ativo, Pageable pageable) {
        Specification<Equipamento> filtro = Specification.unrestricted();
        if (unidadeId != null) {
            filtro = filtro.and((root, query, cb) -> cb.equal(root.get("unidade").get("id"), unidadeId));
        }
        if (tipoEquipamentoId != null) {
            filtro = filtro.and((root, query, cb) -> cb.equal(root.get("tipoEquipamento").get("id"), tipoEquipamentoId));
        }
        if (ativo != null) {
            filtro = filtro.and((root, query, cb) -> cb.equal(root.get("ativo"), ativo));
        }
        return equipamentoRepository.findAll(filtro, pageable).map(this::paraResposta);
    }

    @Transactional
    public EquipamentoResponse atualizar(Long id, UpdateEquipamentoRequest requisicao) {
        Equipamento equipamento = obterEquipamento(id);
        if (!Objects.equals(equipamento.getUnidade().getId(), requisicao.unidadeId())) {
            equipamento.setUnidade(obterUnidadeAtiva(requisicao.unidadeId()));
        }
        if (!Objects.equals(equipamento.getTipoEquipamento().getId(), requisicao.tipoEquipamentoId())) {
            equipamento.setTipoEquipamento(obterTipoAtivo(requisicao.tipoEquipamentoId()));
        }
        equipamento.setNome(normalizarObrigatorio(requisicao.nome()));
        equipamento.setIp(normalizarIp(requisicao.ip()));
        equipamento.setHostname(normalizarOpcional(requisicao.hostname()));
        equipamento.setDescricao(requisicao.descricao());
        equipamento.setLocalizacao(normalizarOpcional(requisicao.localizacao()));
        equipamento.setNumeroSerie(normalizarOpcional(requisicao.numeroSerie()));
        equipamento.setFabricante(normalizarOpcional(requisicao.fabricante()));
        equipamento.setModelo(normalizarOpcional(requisicao.modelo()));
        return paraResposta(equipamento);
    }

    @Transactional
    public EquipamentoResponse ativar(Long id) {
        Equipamento equipamento = obterEquipamento(id);
        if (!equipamento.getUnidade().isAtivo()) {
            throw new ConflitoException("Nao e possivel ativar o equipamento porque a unidade esta inativa");
        }
        if (!equipamento.getTipoEquipamento().isAtivo()) {
            throw new ConflitoException("Nao e possivel ativar o equipamento porque o tipo de equipamento esta inativo");
        }
        equipamento.setAtivo(true);
        if (cicloJanela != null) cicloJanela.abrirEquipamento(id);
        return paraResposta(equipamento);
    }

    /**
     * Entrada em manutencao: flag, fechamento, janela, notificacao — numa transacao so.
     *
     * <p>A ordem importa e e' esta: o flag vem PRIMEIRO. Qualquer processor a caminho
     * encontra em_manutencao = true e nao abre nada (a guarda vive no WHERE do INSERT
     * condicional de incidente e de episodio); qualquer um que tenha aberto ANTES do
     * flag e' fechado pelo passo 2. A ordem inversa deixaria uma janela em que o
     * processor abre depois do fechamento.
     *
     * <p>O CAS do passo 1 torna a operacao idempotente: retorno 0 significa que outro
     * operador ganhou, e nenhum efeito colateral roda duas vezes.
     */
    @Transactional
    public EquipamentoResponse entrarEmManutencao(Long id, Long usuarioId) {
        Instant agora = Instant.now();
        // 1. flag, com CAS
        if (equipamentoRepository.marcarEmManutencaoSeNaoEstiver(id, agora) == 0) {
            return paraResposta(obterEquipamento(id));
        }
        // 2. incidentes em aberto: os ids sao lidos ANTES do bulk update, porque depois
        //    dele eles ja nao satisfazem o filtro e a notificacao precisa saber quais
        //    eram.
        List<Long> incidentesAfetadosIds = incidenteRepository.abertosDoEquipamento(id).stream()
                .map(Incidente::getId).toList();
        incidenteRepository.fecharPorManutencao(id, autor(usuarioId), agora);
        // 3. episodios de latencia em aberto
        List<Long> episodiosAfetadosIds = episodioRepository.abertosDoEquipamento(id).stream()
                .map(MonitorEpisodioLatencia::getId).toList();
        episodioRepository.encerrarPorManutencao(id, agora);
        // 4. janelas: sem isto o SLA continua descontando o periodo de manutencao
        cicloJanela.fecharEquipamento(id);
        // 5. notificacoes: cancela a abertura pendente, avisa o encerramento quando a
        //    abertura ja foi despachada. RELEITURA por id, e nao os objetos capturados
        //    no passo 2/3: fecharPorManutencao/encerrarPorManutencao sao bulk update
        //    (clearAutomatically) e nao repropagam para instancias Java ja carregadas
        //    — a mesma licao que fez IncidenteService.reconhecer reler antes de
        //    responder. Sem reler, NotificacaoMessageBuilder monta a mensagem com
        //    encerradoEm ainda nulo ("Fim: null"), porque os objetos antigos continuam
        //    com status ABERTO e encerradoEm nulo em memoria.
        //    So notifica o que ESTA manutencao fechou: um id lido no passo 2 pode ter
        //    sido fechado pelo motor (fecharAutomaticamente, CAS) antes do bulk update,
        //    que entao o pula; notificar esse incidente somaria INCIDENTE_ENCERRADO_MANUTENCAO
        //    ao INCIDENTE_FECHADO do motor.
        incidenteRepository.findAllById(incidentesAfetadosIds).stream()
                .filter(incidente -> incidente.getMotivoEncerramento() == MotivoEncerramentoIncidente.MANUTENCAO)
                .forEach(incidente -> notificacaoService.tratarEncerramentoPorManutencao(incidente, agora));
        //    Mesmo filtro dos incidentes: um episodio lido no passo 3 pode ter sido normalizado
        //    pelo motor (CAS) antes do bulk update, que entao o pula.
        episodioRepository.findAllById(episodiosAfetadosIds).stream()
                .filter(episodio -> episodio.getMotivoEncerramento() == MotivoEncerramentoEpisodio.MANUTENCAO)
                .forEach(episodio -> notificacaoService.tratarEncerramentoPorManutencao(episodio, agora));
        return paraResposta(obterEquipamento(id));
    }

    /**
     * Saida: desmarca e REAVALIA o predicado inteiro da janela, e nao so' a manutencao.
     * As linhas 4, 6 e 8 da matriz da B.5 sao alcancaveis porque entrar em manutencao
     * nao valida ativo: sair nao pode presumir que o equipamento esta ativo.
     */
    @Transactional
    public EquipamentoResponse sairDeManutencao(Long id) {
        Equipamento equipamento = obterEquipamento(id);
        if (equipamentoRepository.desmarcarManutencaoSeEstiver(id, Instant.now()) == 0) {
            return paraResposta(equipamento);
        }
        cicloJanela.abrirEquipamento(id);
        return paraResposta(obterEquipamento(id));
    }

    @Transactional
    public EquipamentoResponse desativar(Long id) {
        Equipamento equipamento = obterEquipamento(id);
        equipamento.setAtivo(false);
        if (cicloJanela != null) cicloJanela.fecharEquipamento(id);
        return paraResposta(equipamento);
    }

    @Transactional
    public void excluir(Long id) {
        Equipamento equipamento = obterEquipamento(id);
        if (monitorRepository.existsByEquipamentoId(id)) {
            throw new ConflitoException("Nao e possivel excluir o equipamento porque existem monitores associados");
        }
        equipamentoRepository.delete(equipamento);
    }

    /**
     * Autor humano da acao, resolvido a partir do id do principal autenticado. Mesmo
     * padrao de IncidenteService.autor: falha alto quando o id nao chega, porque
     * gravar autor nulo mentiria sobre fechado_por (a V17 assume nulo = motor).
     */
    private Usuario autor(Long usuarioId) {
        if (usuarioId == null) {
            throw new IllegalStateException("Acao exige usuario autenticado");
        }
        return usuarioRepository.findById(usuarioId)
                .orElseThrow(() -> new RecursoNaoEncontradoException("Usuario nao encontrado"));
    }

    private Equipamento obterEquipamento(Long id) {
        return equipamentoRepository.findById(id)
                .orElseThrow(() -> new RecursoNaoEncontradoException("Equipamento nao encontrado"));
    }

    private Unidade obterUnidadeAtiva(Long id) {
        Unidade unidade = unidadeRepository.findById(id)
                .orElseThrow(() -> new RecursoNaoEncontradoException("Unidade nao encontrada"));
        if (!unidade.isAtivo()) {
            throw new ConflitoException("Nao e possivel vincular equipamento a uma unidade inativa");
        }
        return unidade;
    }

    private TipoEquipamento obterTipoAtivo(Long id) {
        TipoEquipamento tipo = tipoEquipamentoRepository.findById(id)
                .orElseThrow(() -> new RecursoNaoEncontradoException("Tipo de equipamento nao encontrado"));
        if (!tipo.isAtivo()) {
            throw new ConflitoException("Nao e possivel vincular equipamento a um tipo de equipamento inativo");
        }
        return tipo;
    }

    private String normalizarObrigatorio(String valor) { return valor.trim(); }

    private String normalizarOpcional(String valor) {
        if (valor == null) return null;
        String normalizado = valor.trim();
        return normalizado.isEmpty() ? null : normalizado;
    }

    private String normalizarIp(String ip) {
        String normalizado = normalizarOpcional(ip);
        if (normalizado == null) return null;
        String[] partes = normalizado.split("\\.", -1);
        if (partes.length != 4) throw new IllegalArgumentException("IP deve ser um endereco IPv4 valido");
        for (String parte : partes) {
            if (!parte.matches("\\d{1,3}")) throw new IllegalArgumentException("IP deve ser um endereco IPv4 valido");
            try {
                if (Integer.parseInt(parte) > 255) throw new IllegalArgumentException("IP deve ser um endereco IPv4 valido");
            } catch (NumberFormatException ex) {
                throw new IllegalArgumentException("IP deve ser um endereco IPv4 valido");
            }
        }
        return normalizado;
    }

    private EquipamentoResponse paraResposta(Equipamento equipamento) {
        return new EquipamentoResponse(equipamento.getId(), equipamento.getNome(), equipamento.getIp(),
                equipamento.getHostname(), equipamento.getDescricao(),                 equipamento.getLocalizacao(), equipamento.getNumeroSerie(), equipamento.getFabricante(), equipamento.getModelo(), equipamento.isAtivo(), equipamento.isEmManutencao(),
                new ReferenciaResponse(equipamento.getUnidade().getId(), equipamento.getUnidade().getNome()),
                new ReferenciaResponse(equipamento.getTipoEquipamento().getId(), equipamento.getTipoEquipamento().getNome()),
                equipamento.getCreatedAt(), equipamento.getUpdatedAt());
    }
}
