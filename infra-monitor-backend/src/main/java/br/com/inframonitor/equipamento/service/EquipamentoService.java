package br.com.inframonitor.equipamento.service;

import br.com.inframonitor.common.exception.ConflitoException;
import br.com.inframonitor.common.exception.RecursoNaoEncontradoException;
import br.com.inframonitor.equipamento.dto.CreateEquipamentoRequest;
import br.com.inframonitor.equipamento.dto.EquipamentoResponse;
import br.com.inframonitor.equipamento.dto.ManutencaoManualResponse;
import br.com.inframonitor.equipamento.dto.ReferenciaResponse;
import br.com.inframonitor.equipamento.dto.UpdateEquipamentoRequest;
import br.com.inframonitor.equipamento.entity.Equipamento;
import br.com.inframonitor.equipamento.repository.EquipamentoRepository;
import br.com.inframonitor.equipamento.repository.SessaoManutencaoManual;
import br.com.inframonitor.equipamento.validation.RegraIpv4;
import br.com.inframonitor.manutencao.repository.ManutencaoAgendadaRepository;
import br.com.inframonitor.monitor.repository.MonitorRepository;
import br.com.inframonitor.tipoequipamento.entity.TipoEquipamento;
import br.com.inframonitor.tipoequipamento.repository.TipoEquipamentoRepository;
import br.com.inframonitor.unidade.entity.Unidade;
import br.com.inframonitor.unidade.repository.UnidadeRepository;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.beans.factory.annotation.Autowired;
import br.com.inframonitor.relatorio.service.CicloJanelaMonitoramentoService;

import java.util.Objects;

@Service
@Transactional(readOnly = true)
public class EquipamentoService {

    private final EquipamentoRepository equipamentoRepository;
    private final UnidadeRepository unidadeRepository;
    private final TipoEquipamentoRepository tipoEquipamentoRepository;
    private final MonitorRepository monitorRepository;
    private final CicloJanelaMonitoramentoService cicloJanela;
    private final EstadoManutencaoEquipamento estado;
    private final ManutencaoAgendadaRepository manutencaoRepository;
    private final SessaoManutencaoManual sessoesManuais;

    @Autowired
    public EquipamentoService(EquipamentoRepository equipamentoRepository, UnidadeRepository unidadeRepository,
                              TipoEquipamentoRepository tipoEquipamentoRepository, MonitorRepository monitorRepository,
                              CicloJanelaMonitoramentoService cicloJanela, EstadoManutencaoEquipamento estado,
                              ManutencaoAgendadaRepository manutencaoRepository,
                              SessaoManutencaoManual sessoesManuais) {
        this.equipamentoRepository = equipamentoRepository;
        this.unidadeRepository = unidadeRepository;
        this.tipoEquipamentoRepository = tipoEquipamentoRepository;
        this.monitorRepository = monitorRepository;
        this.cicloJanela = cicloJanela;
        this.estado = estado;
        this.manutencaoRepository = manutencaoRepository;
        this.sessoesManuais = sessoesManuais;
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
        Equipamento salvo = equipamentoRepository.save(equipamento);
        // Janela de escopo UNIDADE ja ATIVA cobre o equipamento novo (MA05): sem isto, um
        // monitor criado antes do proximo tick do reconciliador abriria janela de SLA. Flush
        // antes: o lock e a cobertura sao SQL e precisam ver a linha.
        equipamentoRepository.flush();
        estado.reavaliar(salvo.getId());
        return paraResposta(obterEquipamento(salvo.getId()));
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
        Long unidadeAnterior = equipamento.getUnidade().getId();
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
        if (!Objects.equals(unidadeAnterior, equipamento.getUnidade().getId())) {
            // Mudar de unidade entra ou sai de janela de escopo UNIDADE (MA05); escopo
            // EQUIPAMENTOS segue o id e nao muda. A cobertura le a unidade no banco: flush antes.
            equipamentoRepository.flush();
            estado.reavaliar(id);
            return paraResposta(obterEquipamento(id));
        }
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
     * Botao manual: liga manutencao_manual e, se o equipamento ainda nao estava em
     * manutencao efetiva, roda os efeitos de entrada. Ordem (flag primeiro), lock e
     * idempotencia vivem em {@link EstadoManutencaoEquipamento}.
     */
    @Transactional
    public EquipamentoResponse entrarEmManutencao(Long id, Long usuarioId) {
        estado.iniciarManual(id, usuarioId);
        return paraResposta(obterEquipamento(id));
    }

    /**
     * Botao manual: desliga manutencao_manual e reavalia. Com janela ATIVA cobrindo, o
     * equipamento continua em manutencao (tabela 4.1 do desenho) e nenhum efeito de saida
     * roda; a resposta diz isso pelos dois flags.
     */
    @Transactional
    public EquipamentoResponse sairDeManutencao(Long id, Long usuarioId) {
        estado.encerrarManual(id, usuarioId);
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
        // A FK (ON DELETE RESTRICT) barraria como erro de integridade; janela encerrada tambem
        // conta: e historico de quem esteve em manutencao.
        if (manutencaoRepository.equipamentoConstaEmJanela(id)) {
            throw new ConflitoException("Nao e possivel excluir o equipamento porque ele consta em janelas de manutencao");
        }
        // Mesma razao: a FK das sessoes manuais (e das notificacoes delas) e RESTRICT, e a sessao e historico.
        if (sessoesManuais.existeHistorico(id)) {
            throw new ConflitoException("Nao e possivel excluir o equipamento porque ele tem historico de manutencao manual");
        }
        equipamentoRepository.delete(equipamento);
    }

    public Page<ManutencaoManualResponse> historicoManutencaoManual(Long id, Pageable pageable) {
        obterEquipamento(id);   // 404 se nao existe
        return sessoesManuais.listar(id, pageable);
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
        String normalizado = valor.strip();
        return normalizado.isEmpty() ? null : normalizado;
    }

    /** Defesa para chamador sem @Valid; a mesma regra do DTO (RegraIpv4). */
    private String normalizarIp(String ip) {
        String normalizado = normalizarOpcional(ip);
        if (normalizado == null) return null;
        String motivo = RegraIpv4.motivoDeRecusa(normalizado);
        if (motivo != null) throw new IllegalArgumentException("IP invalido: " + motivo);
        return normalizado;
    }

    private EquipamentoResponse paraResposta(Equipamento equipamento) {
        return new EquipamentoResponse(equipamento.getId(), equipamento.getNome(), equipamento.getIp(),
                equipamento.getHostname(), equipamento.getDescricao(),                 equipamento.getLocalizacao(), equipamento.getNumeroSerie(), equipamento.getFabricante(), equipamento.getModelo(), equipamento.isAtivo(), equipamento.isEmManutencao(),
                equipamento.isManutencaoManual(),
                new ReferenciaResponse(equipamento.getUnidade().getId(), equipamento.getUnidade().getNome()),
                new ReferenciaResponse(equipamento.getTipoEquipamento().getId(), equipamento.getTipoEquipamento().getNome()),
                equipamento.getCreatedAt(), equipamento.getUpdatedAt());
    }
}
