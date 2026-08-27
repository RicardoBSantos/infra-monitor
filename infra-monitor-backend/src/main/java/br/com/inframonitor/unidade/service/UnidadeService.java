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
import java.util.Locale;

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
        unidade.setEndereco(normalizarTexto(requisicao.endereco()));
        unidade.setCidade(normalizarTexto(requisicao.cidade()));
        unidade.setUf(normalizarUf(requisicao.uf()));
        unidade.setLatitude(requisicao.latitude());
        unidade.setLongitude(requisicao.longitude());
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
        // Semantica dos campos de localizacao no PUT: ausente/null preserva o valor
        // atual; string vazia limpa (normalizarTexto devolve null). Distinguir
        // "ausente" de "null explicito" exigiria wrapper proprio de patch --
        // Optional nao serve, em Jackson 3 record ausente e null explicito
        // colapsam os dois em Optional.empty.
        //
        // TODO: DIVIDA -- latitude e longitude NAO PODEM SER LIMPAS isoladamente
        // enquanto nao houver esse wrapper. Nao existe "numero vazio" equivalente
        // a string vazia, entao null so pode significar "preserva". Consequencia
        // pratica: uma unidade que recebeu coordenadas erradas so pode ser
        // corrigida com valores novos, nunca esvaziada. Limpar exige hoje UPDATE
        // manual no banco. Custo da correcao: tipo generico de patch +
        // ValueDeserializer com getAbsentValue()/getNullValue() distintos +
        // contextualizacao por tipo interno (~120 linhas com testes).
        aplicarSePresente(requisicao.endereco(), unidade::setEndereco, this::normalizarTexto);
        aplicarSePresente(requisicao.cidade(), unidade::setCidade, this::normalizarTexto);
        aplicarSePresente(requisicao.uf(), unidade::setUf, this::normalizarUf);
        aplicarSePresente(requisicao.latitude(), unidade::setLatitude, valor -> valor);
        aplicarSePresente(requisicao.longitude(), unidade::setLongitude, valor -> valor);
        validarCoordenadasCompletas(unidade);
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

    /** Só grava quando o cliente enviou algo: omitir um campo nunca apaga o que já está salvo. */
    private <T> void aplicarSePresente(T valor, java.util.function.Consumer<T> destino, java.util.function.UnaryOperator<T> normalizador) {
        if (valor != null) {
            destino.accept(normalizador.apply(valor));
        }
    }

    /** Espelha ck_unidade_coordenadas_completas sobre o estado resultante da mesclagem. */
    private void validarCoordenadasCompletas(Unidade unidade) {
        if ((unidade.getLatitude() == null) != (unidade.getLongitude() == null)) {
            throw new IllegalArgumentException("latitude e longitude devem ser informadas juntas ou ambas omitidas");
        }
    }

    private String normalizarCodigoIbge(String codigoIbge) {
        return codigoIbge == null ? null : codigoIbge.trim();
    }

    /** Texto opcional: em branco equivale a nao informado. */
    private String normalizarTexto(String valor) {
        if (valor == null) {
            return null;
        }
        String texto = valor.trim();
        return texto.isEmpty() ? null : texto;
    }

    private String normalizarUf(String uf) {
        String texto = normalizarTexto(uf);
        return texto == null ? null : texto.toUpperCase(Locale.ROOT);
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
                unidade.getUpdatedAt(),
                unidade.getEndereco(),
                unidade.getCidade(),
                unidade.getUf(),
                unidade.getLatitude(),
                unidade.getLongitude());
    }
}
