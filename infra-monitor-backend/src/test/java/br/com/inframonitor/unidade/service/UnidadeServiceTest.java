package br.com.inframonitor.unidade.service;

import br.com.inframonitor.common.exception.ConflitoException;
import br.com.inframonitor.common.exception.RecursoNaoEncontradoException;
import br.com.inframonitor.equipamento.repository.EquipamentoRepository;
import br.com.inframonitor.manutencao.repository.ManutencaoAgendadaRepository;
import br.com.inframonitor.unidade.dto.ConexaoUnidadeRequest;
import br.com.inframonitor.unidade.dto.CreateUnidadeRequest;
import br.com.inframonitor.unidade.dto.UpdateUnidadeRequest;
import br.com.inframonitor.unidade.entity.Unidade;
import br.com.inframonitor.unidade.repository.UnidadeRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.math.BigDecimal;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class UnidadeServiceTest {

    @Mock
    private UnidadeRepository unidadeRepository;

    @Mock
    private EquipamentoRepository equipamentoRepository;

    @Mock
    private ManutencaoAgendadaRepository manutencaoRepository;

    @InjectMocks
    private UnidadeService unidadeService;

    @Test
    void criaUnidadeAtivaComNomeNormalizado() {
        when(unidadeRepository.save(any(Unidade.class))).thenAnswer(invocation -> invocation.getArgument(0));

        var resposta = unidadeService.criar(new CreateUnidadeRequest("  Matriz  ", "  MTZ  ", "Unidade principal", " 2800308 ", null, null, null, null, null));

        ArgumentCaptor<Unidade> captor = ArgumentCaptor.forClass(Unidade.class);
        verify(unidadeRepository).save(captor.capture());
        assertThat(captor.getValue().getNome()).isEqualTo("Matriz");
        assertThat(captor.getValue().getSigla()).isEqualTo("MTZ");
        assertThat(captor.getValue().getCodigoIbge()).isEqualTo("2800308");
        assertThat(captor.getValue().isAtivo()).isTrue();
        assertThat(resposta.nome()).isEqualTo("Matriz");
        assertThat(resposta.codigoIbge()).isEqualTo("2800308");
    }

    @Test
    void persisteCamposDeLocalizacaoNormalizados() {
        when(unidadeRepository.save(any(Unidade.class))).thenAnswer(invocation -> invocation.getArgument(0));

        var resposta = unidadeService.criar(new CreateUnidadeRequest("Matriz", "MTZ", null, null,
                "  Av. Central, 100  ", "  Aracaju  ", " se ",
                new BigDecimal("-10.947200"), new BigDecimal("-37.073500")));

        ArgumentCaptor<Unidade> captor = ArgumentCaptor.forClass(Unidade.class);
        verify(unidadeRepository).save(captor.capture());
        assertThat(captor.getValue().getEndereco()).isEqualTo("Av. Central, 100");
        assertThat(captor.getValue().getCidade()).isEqualTo("Aracaju");
        assertThat(captor.getValue().getUf()).isEqualTo("SE");
        assertThat(captor.getValue().getLatitude()).isEqualByComparingTo("-10.947200");
        assertThat(resposta.uf()).isEqualTo("SE");
        assertThat(resposta.longitude()).isEqualByComparingTo("-37.073500");
    }

    @Test
    void trataTextoEmBrancoDeLocalizacaoComoAusente() {
        when(unidadeRepository.save(any(Unidade.class))).thenAnswer(invocation -> invocation.getArgument(0));

        unidadeService.criar(new CreateUnidadeRequest("Matriz", "MTZ", null, null,
                "   ", "", "  ", null, null));

        ArgumentCaptor<Unidade> captor = ArgumentCaptor.forClass(Unidade.class);
        verify(unidadeRepository).save(captor.capture());
        assertThat(captor.getValue().getEndereco()).isNull();
        assertThat(captor.getValue().getCidade()).isNull();
        assertThat(captor.getValue().getUf()).isNull();
    }

    @Test
    void atualizacaoSemCamposDeLocalizacaoPreservaOsValoresSalvos() {
        Unidade existente = new Unidade("Matriz", "MTZ", null);
        existente.setEndereco("Av. Central, 100");
        existente.setCidade("Aracaju");
        existente.setUf("SE");
        existente.setLatitude(new BigDecimal("-10.947200"));
        existente.setLongitude(new BigDecimal("-37.073500"));
        when(unidadeRepository.findById(1L)).thenReturn(Optional.of(existente));

        var resposta = unidadeService.atualizar(1L,
                new UpdateUnidadeRequest("Matriz", "MTZ", "Nova", null, null, null, null, null, null));

        assertThat(resposta.endereco()).isEqualTo("Av. Central, 100");
        assertThat(resposta.cidade()).isEqualTo("Aracaju");
        assertThat(resposta.uf()).isEqualTo("SE");
        assertThat(resposta.latitude()).isEqualByComparingTo("-10.947200");
        assertThat(resposta.longitude()).isEqualByComparingTo("-37.073500");
    }

    @Test
    void atualizacaoComTextoVazioLimpaOCampoDeLocalizacao() {
        Unidade existente = new Unidade("Matriz", "MTZ", null);
        existente.setEndereco("Av. Central, 100");
        when(unidadeRepository.findById(1L)).thenReturn(Optional.of(existente));

        var resposta = unidadeService.atualizar(1L,
                new UpdateUnidadeRequest("Matriz", "MTZ", null, null, "   ", null, null, null, null));

        assertThat(resposta.endereco()).isNull();
    }

    @Test
    void atualizacaoRejeitaCoordenadaQueFicariaPelaMetadeAposMesclagem() {
        Unidade existente = new Unidade("Matriz", "MTZ", null);
        when(unidadeRepository.findById(1L)).thenReturn(Optional.of(existente));

        assertThatThrownBy(() -> unidadeService.atualizar(1L,
                new UpdateUnidadeRequest("Matriz", "MTZ", null, null, null, null, null, new BigDecimal("-10.9472"), null)))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void impedeCriacaoComNomeDuplicado() {
        when(unidadeRepository.existsByNomeIgnoreCase("Matriz")).thenReturn(true);

        assertThatThrownBy(() -> unidadeService.criar(new CreateUnidadeRequest("Matriz", "MTZ", null, null, null, null, null, null, null)))
                .isInstanceOf(ConflitoException.class);

        verify(unidadeRepository, never()).save(any());
    }

    @Test
    void impedeCriacaoComSiglaDuplicada() {
        when(unidadeRepository.existsBySiglaIgnoreCase("MTZ")).thenReturn(true);

        assertThatThrownBy(() -> unidadeService.criar(new CreateUnidadeRequest("Matriz", "MTZ", null, null, null, null, null, null, null)))
                .isInstanceOf(ConflitoException.class)
                .hasMessage("Ja existe uma unidade com esta sigla");

        verify(unidadeRepository, never()).save(any());
    }

    @Test
    void buscaUnidadeExistenteENaoEncontrada() {
        Unidade unidade = new Unidade("Matriz", "MTZ", null);
        when(unidadeRepository.findById(1L)).thenReturn(Optional.of(unidade));

        assertThat(unidadeService.buscarPorId(1L).nome()).isEqualTo("Matriz");
        assertThat(unidadeService.buscarPorId(1L).codigoIbge()).isNull();

        assertThatThrownBy(() -> unidadeService.buscarPorId(2L))
                .isInstanceOf(RecursoNaoEncontradoException.class);
    }

    @Test
    void atualizaUnidadeEImpedeNomeDeOutraUnidade() {
        Unidade unidade = new Unidade("Matriz", "MTZ", "Anterior");
        when(unidadeRepository.findById(1L)).thenReturn(Optional.of(unidade));

        unidadeService.atualizar(1L, new UpdateUnidadeRequest("Matriz Central", "MTZ", "Nova descricao", "2800308", null, null, null, null, null));

        assertThat(unidade.getNome()).isEqualTo("Matriz Central");
        assertThat(unidade.getDescricao()).isEqualTo("Nova descricao");
        assertThat(unidade.getCodigoIbge()).isEqualTo("2800308");
        verify(unidadeRepository).existsByNomeIgnoreCase("Matriz Central");

        when(unidadeRepository.existsByNomeIgnoreCase("Filial")).thenReturn(true);
        assertThatThrownBy(() -> unidadeService.atualizar(1L, new UpdateUnidadeRequest("Filial", "FIL", null, "2800209", null, null, null, null, null)))
                .isInstanceOf(ConflitoException.class);
    }

    @Test
    void atualizaEPermiteRemoverCodigoIbge() {
        Unidade unidade = new Unidade("Matriz", "MTZ", null);
        unidade.setCodigoIbge("2800308");
        when(unidadeRepository.findById(1L)).thenReturn(Optional.of(unidade));

        unidadeService.atualizar(1L, new UpdateUnidadeRequest("Matriz", "MTZ", null, "2800209", null, null, null, null, null));
        assertThat(unidade.getCodigoIbge()).isEqualTo("2800209");

        unidadeService.atualizar(1L, new UpdateUnidadeRequest("Matriz", "MTZ", null, null, null, null, null, null, null));
        assertThat(unidade.getCodigoIbge()).isNull();
    }

    @Test
    void ativaEDesativaUnidadeDeFormaIdempotente() {
        Unidade unidade = new Unidade("Matriz", "MTZ", null);
        unidade.setAtivo(false);
        when(unidadeRepository.findById(1L)).thenReturn(Optional.of(unidade));

        unidadeService.ativar(1L);
        assertThat(unidade.isAtivo()).isTrue();

        unidadeService.desativar(1L);
        unidadeService.desativar(1L);
        assertThat(unidade.isAtivo()).isFalse();
    }

    @Test
    void excluiUnidadeExistente() {
        Unidade unidade = new Unidade("Matriz", "MTZ", null);
        when(unidadeRepository.findById(1L)).thenReturn(Optional.of(unidade));

        unidadeService.excluir(1L);

        verify(unidadeRepository).delete(eq(unidade));
    }

    @Test
    void impedeExcluirUnidadeComEquipamentosAssociados() {
        Unidade unidade = new Unidade("Matriz", "MTZ", null);
        when(unidadeRepository.findById(1L)).thenReturn(Optional.of(unidade));
        when(equipamentoRepository.existsByUnidadeId(1L)).thenReturn(true);

        assertThatThrownBy(() -> unidadeService.excluir(1L))
                .isInstanceOf(ConflitoException.class)
                .hasMessageContaining("equipamentos associados");
        verify(unidadeRepository, never()).delete(any());
    }

    @Test
    void conectaUnidadeAoHub() {
        Unidade filial = new Unidade("Filial", "FIL", null);
        when(unidadeRepository.findById(2L)).thenReturn(Optional.of(filial));
        when(unidadeRepository.existsById(1L)).thenReturn(true);
        when(unidadeRepository.findById(1L)).thenReturn(Optional.of(new Unidade("Sede", "SED", null)));

        var resposta = unidadeService.definirConexao(2L, new ConexaoUnidadeRequest(1L));

        assertThat(filial.getConectaAUnidadeId()).isEqualTo(1L);
        assertThat(resposta.conectaAUnidadeId()).isEqualTo(1L);
    }

    @Test
    void recusaConexaoDaUnidadeConsigoMesma() {
        when(unidadeRepository.findById(1L)).thenReturn(Optional.of(new Unidade("Sede", "SED", null)));

        assertThatThrownBy(() -> unidadeService.definirConexao(1L, new ConexaoUnidadeRequest(1L)))
                .isInstanceOf(ConflitoException.class)
                .hasMessageContaining("si mesma");
    }

    @Test
    void recusaConexaoParaUnidadeInexistente() {
        when(unidadeRepository.findById(2L)).thenReturn(Optional.of(new Unidade("Filial", "FIL", null)));
        when(unidadeRepository.existsById(9L)).thenReturn(false);

        assertThatThrownBy(() -> unidadeService.definirConexao(2L, new ConexaoUnidadeRequest(9L)))
                .isInstanceOf(RecursoNaoEncontradoException.class);
    }

    /** A -> B ja existe; conectar B -> A fecharia o ciclo, e nenhuma constraint do banco pega isso. */
    @Test
    void recusaConexaoQueFechaCiclo() {
        Unidade sede = new Unidade("Sede", "SED", null);
        Unidade filial = new Unidade("Filial", "FIL", null);
        filial.setConectaAUnidadeId(1L);

        when(unidadeRepository.findById(1L)).thenReturn(Optional.of(sede));
        when(unidadeRepository.existsById(2L)).thenReturn(true);
        when(unidadeRepository.findById(2L)).thenReturn(Optional.of(filial));

        assertThatThrownBy(() -> unidadeService.definirConexao(1L, new ConexaoUnidadeRequest(2L)))
                .isInstanceOf(ConflitoException.class)
                .hasMessageContaining("ciclo");
        assertThat(sede.getConectaAUnidadeId()).isNull();
    }

    @Test
    void desconectaUnidadeEEIdempotente() {
        Unidade filial = new Unidade("Filial", "FIL", null);
        filial.setConectaAUnidadeId(1L);
        when(unidadeRepository.findById(2L)).thenReturn(Optional.of(filial));

        unidadeService.removerConexao(2L);
        var resposta = unidadeService.removerConexao(2L);

        assertThat(filial.getConectaAUnidadeId()).isNull();
        assertThat(resposta.conectaAUnidadeId()).isNull();
    }

    @Test
    void impedeExcluirUnidadeComOutrasConectadasAEla() {
        Unidade sede = new Unidade("Sede", "SED", null);
        when(unidadeRepository.findById(1L)).thenReturn(Optional.of(sede));
        when(equipamentoRepository.existsByUnidadeId(1L)).thenReturn(false);
        when(unidadeRepository.existsByConectaAUnidadeId(1L)).thenReturn(true);

        assertThatThrownBy(() -> unidadeService.excluir(1L))
                .isInstanceOf(ConflitoException.class)
                .hasMessageContaining("unidades conectadas");
        verify(unidadeRepository, never()).delete(any());
    }
}
