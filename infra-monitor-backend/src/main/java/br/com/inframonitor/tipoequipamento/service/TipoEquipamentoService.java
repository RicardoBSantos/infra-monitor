package br.com.inframonitor.tipoequipamento.service;

import br.com.inframonitor.common.exception.ConflitoException;
import br.com.inframonitor.common.exception.RecursoNaoEncontradoException;
import br.com.inframonitor.equipamento.repository.EquipamentoRepository;
import br.com.inframonitor.tipoequipamento.dto.CreateTipoEquipamentoRequest;
import br.com.inframonitor.tipoequipamento.dto.TipoEquipamentoResponse;
import br.com.inframonitor.tipoequipamento.dto.UpdateTipoEquipamentoRequest;
import br.com.inframonitor.tipoequipamento.entity.TipoEquipamento;
import br.com.inframonitor.tipoequipamento.repository.TipoEquipamentoRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
@Transactional(readOnly = true)
public class TipoEquipamentoService {

    private final TipoEquipamentoRepository tipoEquipamentoRepository;
    private final EquipamentoRepository equipamentoRepository;

    public TipoEquipamentoService(TipoEquipamentoRepository tipoEquipamentoRepository,
                                  EquipamentoRepository equipamentoRepository) {
        this.tipoEquipamentoRepository = tipoEquipamentoRepository;
        this.equipamentoRepository = equipamentoRepository;
    }

    @Transactional
    public TipoEquipamentoResponse criar(CreateTipoEquipamentoRequest requisicao) {
        String nome = normalizarNome(requisicao.nome());
        validarNomeDisponivel(nome);
        return paraResposta(tipoEquipamentoRepository.save(new TipoEquipamento(nome, requisicao.descricao())));
    }

    public TipoEquipamentoResponse buscarPorId(Long id) {
        return paraResposta(obterEntidade(id));
    }

    public List<TipoEquipamentoResponse> listar(Boolean ativo) {
        List<TipoEquipamento> tipos = ativo == null
                ? tipoEquipamentoRepository.findAllByOrderByNomeAsc()
                : tipoEquipamentoRepository.findAllByAtivoOrderByNomeAsc(ativo);
        return tipos.stream().map(this::paraResposta).toList();
    }

    @Transactional
    public TipoEquipamentoResponse atualizar(Long id, UpdateTipoEquipamentoRequest requisicao) {
        TipoEquipamento tipoEquipamento = obterEntidade(id);
        String nome = normalizarNome(requisicao.nome());
        if (!tipoEquipamento.getNome().equalsIgnoreCase(nome)) {
            validarNomeDisponivel(nome);
            tipoEquipamento.setNome(nome);
        }
        tipoEquipamento.setDescricao(requisicao.descricao());
        return paraResposta(tipoEquipamento);
    }

    @Transactional
    public TipoEquipamentoResponse ativar(Long id) {
        TipoEquipamento tipoEquipamento = obterEntidade(id);
        tipoEquipamento.setAtivo(true);
        return paraResposta(tipoEquipamento);
    }

    @Transactional
    public TipoEquipamentoResponse desativar(Long id) {
        TipoEquipamento tipoEquipamento = obterEntidade(id);
        tipoEquipamento.setAtivo(false);
        return paraResposta(tipoEquipamento);
    }

    @Transactional
    public void excluir(Long id) {
        TipoEquipamento tipoEquipamento = obterEntidade(id);
        if (equipamentoRepository.existsByTipoEquipamentoId(id)) {
            throw new ConflitoException("Nao e possivel excluir o tipo de equipamento porque existem equipamentos associados");
        }
        tipoEquipamentoRepository.delete(tipoEquipamento);
    }

    private TipoEquipamento obterEntidade(Long id) {
        return tipoEquipamentoRepository.findById(id)
                .orElseThrow(() -> new RecursoNaoEncontradoException("Tipo de equipamento nao encontrado"));
    }

    private void validarNomeDisponivel(String nome) {
        if (tipoEquipamentoRepository.existsByNomeIgnoreCase(nome)) {
            throw new ConflitoException("Ja existe um tipo de equipamento com este nome");
        }
    }

    private String normalizarNome(String nome) {
        return nome.trim();
    }

    private TipoEquipamentoResponse paraResposta(TipoEquipamento tipoEquipamento) {
        return new TipoEquipamentoResponse(
                tipoEquipamento.getId(), tipoEquipamento.getNome(), tipoEquipamento.getDescricao(),
                tipoEquipamento.isAtivo(), tipoEquipamento.getCreatedAt(), tipoEquipamento.getUpdatedAt());
    }
}
