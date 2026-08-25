package br.com.inframonitor.tipoequipamento.service;

import br.com.inframonitor.common.exception.ConflitoException;
import br.com.inframonitor.common.exception.RecursoNaoEncontradoException;
import br.com.inframonitor.equipamento.repository.EquipamentoRepository;
import br.com.inframonitor.tipoequipamento.dto.CreateTipoEquipamentoRequest;
import br.com.inframonitor.tipoequipamento.dto.UpdateTipoEquipamentoRequest;
import br.com.inframonitor.tipoequipamento.entity.TipoEquipamento;
import br.com.inframonitor.tipoequipamento.repository.TipoEquipamentoRepository;
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
class TipoEquipamentoServiceTest {

    @Mock
    private TipoEquipamentoRepository tipoEquipamentoRepository;

    @Mock
    private EquipamentoRepository equipamentoRepository;

    @InjectMocks
    private TipoEquipamentoService tipoEquipamentoService;

    @Test
    void criaTipoAtivoComNomeNormalizado() {
        when(tipoEquipamentoRepository.save(any(TipoEquipamento.class))).thenAnswer(invocation -> invocation.getArgument(0));

        var resposta = tipoEquipamentoService.criar(new CreateTipoEquipamentoRequest("  Switch  ", "Comutacao"));

        ArgumentCaptor<TipoEquipamento> captor = ArgumentCaptor.forClass(TipoEquipamento.class);
        verify(tipoEquipamentoRepository).save(captor.capture());
        assertThat(captor.getValue().getNome()).isEqualTo("Switch");
        assertThat(captor.getValue().isAtivo()).isTrue();
        assertThat(resposta.nome()).isEqualTo("Switch");
    }

    @Test
    void impedeCriacaoComNomeDuplicado() {
        when(tipoEquipamentoRepository.existsByNomeIgnoreCase("Switch")).thenReturn(true);

        assertThatThrownBy(() -> tipoEquipamentoService.criar(new CreateTipoEquipamentoRequest("Switch", null)))
                .isInstanceOf(ConflitoException.class);
        verify(tipoEquipamentoRepository, never()).save(any());
    }

    @Test
    void buscaTipoExistenteENaoEncontrado() {
        TipoEquipamento tipo = new TipoEquipamento("Switch", null);
        when(tipoEquipamentoRepository.findById(1L)).thenReturn(Optional.of(tipo));

        assertThat(tipoEquipamentoService.buscarPorId(1L).nome()).isEqualTo("Switch");
        assertThatThrownBy(() -> tipoEquipamentoService.buscarPorId(2L))
                .isInstanceOf(RecursoNaoEncontradoException.class);
    }

    @Test
    void atualizaTipoEMantemMesmoNomeNoProprioRegistro() {
        TipoEquipamento tipo = new TipoEquipamento("Switch", "Anterior");
        when(tipoEquipamentoRepository.findById(1L)).thenReturn(Optional.of(tipo));

        tipoEquipamentoService.atualizar(1L, new UpdateTipoEquipamentoRequest("switch", "Nova descricao"));

        assertThat(tipo.getNome()).isEqualTo("Switch");
        assertThat(tipo.getDescricao()).isEqualTo("Nova descricao");
        verify(tipoEquipamentoRepository, never()).existsByNomeIgnoreCase(any());
    }

    @Test
    void impedeAtualizacaoComNomeDeOutroTipo() {
        TipoEquipamento tipo = new TipoEquipamento("Switch", null);
        when(tipoEquipamentoRepository.findById(1L)).thenReturn(Optional.of(tipo));
        when(tipoEquipamentoRepository.existsByNomeIgnoreCase("Router")).thenReturn(true);

        assertThatThrownBy(() -> tipoEquipamentoService.atualizar(1L,
                new UpdateTipoEquipamentoRequest("Router", null))).isInstanceOf(ConflitoException.class);
    }

    @Test
    void ativaEDesativaTipoDeFormaIdempotente() {
        TipoEquipamento tipo = new TipoEquipamento("Switch", null);
        tipo.setAtivo(false);
        when(tipoEquipamentoRepository.findById(1L)).thenReturn(Optional.of(tipo));

        tipoEquipamentoService.ativar(1L);
        assertThat(tipo.isAtivo()).isTrue();
        tipoEquipamentoService.desativar(1L);
        tipoEquipamentoService.desativar(1L);
        assertThat(tipo.isAtivo()).isFalse();
    }

    @Test
    void excluiTipoExistente() {
        TipoEquipamento tipo = new TipoEquipamento("Switch", null);
        when(tipoEquipamentoRepository.findById(1L)).thenReturn(Optional.of(tipo));

        tipoEquipamentoService.excluir(1L);

        verify(tipoEquipamentoRepository).delete(eq(tipo));
    }

    @Test
    void impedeExcluirTipoComEquipamentosAssociados() {
        TipoEquipamento tipo = new TipoEquipamento("Switch", null);
        when(tipoEquipamentoRepository.findById(1L)).thenReturn(Optional.of(tipo));
        when(equipamentoRepository.existsByTipoEquipamentoId(1L)).thenReturn(true);

        assertThatThrownBy(() -> tipoEquipamentoService.excluir(1L))
                .isInstanceOf(ConflitoException.class)
                .hasMessageContaining("equipamentos associados");
        verify(tipoEquipamentoRepository, never()).delete(any());
    }
}
