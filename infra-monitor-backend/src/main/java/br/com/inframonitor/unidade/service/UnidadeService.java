package br.com.inframonitor.unidade.service;

import br.com.inframonitor.common.exception.ConflitoException;
import br.com.inframonitor.common.exception.RecursoNaoEncontradoException;
import br.com.inframonitor.equipamento.repository.EquipamentoRepository;
import br.com.inframonitor.unidade.dto.CreateUnidadeRequest;
import br.com.inframonitor.unidade.dto.UnidadeResponse;
import br.com.inframonitor.unidade.dto.UpdateUnidadeRequest;
import br.com.inframonitor.unidade.entity.Unidade;
import br.com.inframonitor.unidade.repository.UnidadeRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
@Transactional(readOnly = true)
public class UnidadeService {

    private final UnidadeRepository unidadeRepository;
    private final EquipamentoRepository equipamentoRepository;

    public UnidadeService(UnidadeRepository unidadeRepository, EquipamentoRepository equipamentoRepository) {
        this.unidadeRepository = unidadeRepository;
        this.equipamentoRepository = equipamentoRepository;
    }

    @Transactional
    public UnidadeResponse criar(CreateUnidadeRequest requisicao) {
        String nome = normalizarNome(requisicao.nome());
        String sigla = normalizarSigla(requisicao.sigla());
        validarNomeDisponivel(nome);
        validarSiglaDisponivel(sigla);

        Unidade unidade = new Unidade(nome, sigla, requisicao.descricao());
        unidade.setCodigoIbge(normalizarCodigoIbge(requisicao.codigoIbge()));
        unidade = unidadeRepository.save(unidade);
        return paraResposta(unidade);
    }

    public UnidadeResponse buscarPorId(Long id) {
        return paraResposta(obterEntidade(id));
    }

    public List<UnidadeResponse> listar(Boolean ativo) {
        List<Unidade> unidades = ativo == null
                ? unidadeRepository.findAllByOrderByNomeAsc()
                : unidadeRepository.findAllByAtivoOrderByNomeAsc(ativo);
        return unidades.stream().map(this::paraResposta).toList();
    }

    @Transactional
    public UnidadeResponse atualizar(Long id, UpdateUnidadeRequest requisicao) {
        Unidade unidade = obterEntidade(id);
        String nome = normalizarNome(requisicao.nome());
        String sigla = normalizarSigla(requisicao.sigla());

        if (!unidade.getNome().equalsIgnoreCase(nome)) {
            validarNomeDisponivel(nome);
            unidade.setNome(nome);
        }
        if (!unidade.getSigla().equalsIgnoreCase(sigla)) {
            validarSiglaDisponivel(sigla);
            unidade.setSigla(sigla);
        }
        unidade.setDescricao(requisicao.descricao());
        unidade.setCodigoIbge(normalizarCodigoIbge(requisicao.codigoIbge()));
        return paraResposta(unidade);
    }

    @Transactional
    public UnidadeResponse ativar(Long id) {
        Unidade unidade = obterEntidade(id);
        unidade.setAtivo(true);
        return paraResposta(unidade);
    }

    @Transactional
    public UnidadeResponse desativar(Long id) {
        Unidade unidade = obterEntidade(id);
        unidade.setAtivo(false);
        return paraResposta(unidade);
    }

    @Transactional
    public void excluir(Long id) {
        Unidade unidade = obterEntidade(id);
        if (equipamentoRepository.existsByUnidadeId(id)) {
            throw new ConflitoException("Nao e possivel excluir a unidade porque existem equipamentos associados");
        }
        unidadeRepository.delete(unidade);
    }

    private Unidade obterEntidade(Long id) {
        return unidadeRepository.findById(id)
                .orElseThrow(() -> new RecursoNaoEncontradoException("Unidade nao encontrada"));
    }

    private void validarNomeDisponivel(String nome) {
        if (unidadeRepository.existsByNomeIgnoreCase(nome)) {
            throw new ConflitoException("Ja existe uma unidade com este nome");
        }
    }

    private void validarSiglaDisponivel(String sigla) {
        if (unidadeRepository.existsBySiglaIgnoreCase(sigla)) {
            throw new ConflitoException("Ja existe uma unidade com esta sigla");
        }
    }

    private String normalizarNome(String nome) {
        return nome.trim();
    }

    private String normalizarSigla(String sigla) {
        return sigla.trim();
    }

    private String normalizarCodigoIbge(String codigoIbge) {
        return codigoIbge == null ? null : codigoIbge.trim();
    }

    private UnidadeResponse paraResposta(Unidade unidade) {
        return new UnidadeResponse(
                unidade.getId(),
                unidade.getNome(),
                unidade.getSigla(),
                unidade.getDescricao(),
                unidade.getCodigoIbge(),
                unidade.isAtivo(),
                unidade.getCreatedAt(),
                unidade.getUpdatedAt());
    }
}
