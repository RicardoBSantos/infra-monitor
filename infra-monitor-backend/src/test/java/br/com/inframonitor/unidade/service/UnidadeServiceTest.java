package br.com.inframonitor.unidade.service;

import br.com.inframonitor.common.exception.ConflitoException;
import br.com.inframonitor.common.exception.RecursoNaoEncontradoException;
import br.com.inframonitor.equipamento.repository.EquipamentoRepository;
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

    @InjectMocks
    private UnidadeService unidadeService;

    @Test
    void criaUnidadeAtivaComNomeNormalizado() {
        when(unidadeRepository.save(any(Unidade.class))).thenAnswer(invocation -> invocation.getArgument(0));

        var resposta = unidadeService.criar(new CreateUnidadeRequest("  Matriz  ", "  MTZ  ", "Unidade principal", " 2800308 "));

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
    void impedeCriacaoComNomeDuplicado() {
        when(unidadeRepository.existsByNomeIgnoreCase("Matriz")).thenReturn(true);

        assertThatThrownBy(() -> unidadeService.criar(new CreateUnidadeRequest("Matriz", "MTZ", null, null)))
                .isInstanceOf(ConflitoException.class);

        verify(unidadeRepository, never()).save(any());
    }

    @Test
    void impedeCriacaoComSiglaDuplicada() {
        when(unidadeRepository.existsBySiglaIgnoreCase("MTZ")).thenReturn(true);

        assertThatThrownBy(() -> unidadeService.criar(new CreateUnidadeRequest("Matriz", "MTZ", null, null)))
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

        unidadeService.atualizar(1L, new UpdateUnidadeRequest("Matriz Central", "MTZ", "Nova descricao", "2800308"));

        assertThat(unidade.getNome()).isEqualTo("Matriz Central");
        assertThat(unidade.getDescricao()).isEqualTo("Nova descricao");
        assertThat(unidade.getCodigoIbge()).isEqualTo("2800308");
        verify(unidadeRepository).existsByNomeIgnoreCase("Matriz Central");

        when(unidadeRepository.existsByNomeIgnoreCase("Filial")).thenReturn(true);
        assertThatThrownBy(() -> unidadeService.atualizar(1L, new UpdateUnidadeRequest("Filial", "FIL", null, "2800209")))
                .isInstanceOf(ConflitoException.class);
    }

    @Test
    void atualizaEPermiteRemoverCodigoIbge() {
        Unidade unidade = new Unidade("Matriz", "MTZ", null);
        unidade.setCodigoIbge("2800308");
        when(unidadeRepository.findById(1L)).thenReturn(Optional.of(unidade));

        unidadeService.atualizar(1L, new UpdateUnidadeRequest("Matriz", "MTZ", null, "2800209"));
        assertThat(unidade.getCodigoIbge()).isEqualTo("2800209");

        unidadeService.atualizar(1L, new UpdateUnidadeRequest("Matriz", "MTZ", null, null));
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
}
