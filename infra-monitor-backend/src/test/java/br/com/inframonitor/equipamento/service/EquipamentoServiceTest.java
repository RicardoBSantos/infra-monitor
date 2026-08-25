package br.com.inframonitor.equipamento.service;

import br.com.inframonitor.common.exception.ConflitoException;
import br.com.inframonitor.common.exception.RecursoNaoEncontradoException;
import br.com.inframonitor.equipamento.dto.CreateEquipamentoRequest;
import br.com.inframonitor.equipamento.dto.UpdateEquipamentoRequest;
import br.com.inframonitor.equipamento.entity.Equipamento;
import br.com.inframonitor.equipamento.repository.EquipamentoRepository;
import br.com.inframonitor.monitor.repository.MonitorRepository;
import br.com.inframonitor.tipoequipamento.entity.TipoEquipamento;
import br.com.inframonitor.tipoequipamento.repository.TipoEquipamentoRepository;
import br.com.inframonitor.unidade.entity.Unidade;
import br.com.inframonitor.unidade.repository.UnidadeRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class EquipamentoServiceTest {

    @Mock private EquipamentoRepository equipamentoRepository;
    @Mock private UnidadeRepository unidadeRepository;
    @Mock private TipoEquipamentoRepository tipoEquipamentoRepository;
    @Mock private MonitorRepository monitorRepository;
    @InjectMocks private EquipamentoService equipamentoService;

    @Test
    void criaEquipamentoValidoComCamposNormalizados() {
        Unidade unidade = new Unidade("Matriz", "MTZ", null);
        TipoEquipamento tipo = new TipoEquipamento("Switch", null);
        relacionamentosAtivos(unidade, tipo);
        when(equipamentoRepository.save(any(Equipamento.class))).thenAnswer(invocation -> invocation.getArgument(0));

        var resposta = equipamentoService.criar(criacao("  SW-CORE-01  ", " 10.0.0.10 "));

        ArgumentCaptor<Equipamento> captor = ArgumentCaptor.forClass(Equipamento.class);
        verify(equipamentoRepository).save(captor.capture());
        assertThat(captor.getValue().getNome()).isEqualTo("SW-CORE-01");
        assertThat(captor.getValue().getIp()).isEqualTo("10.0.0.10");
        assertThat(captor.getValue().isAtivo()).isTrue();
        assertThat(resposta.unidade().nome()).isEqualTo("Matriz");
    }

    @Test
    void rejeitaUnidadeOuTipoInexistenteOuInativoNaCriacao() {
        when(unidadeRepository.findById(1L)).thenReturn(Optional.empty());
        assertThatThrownBy(() -> equipamentoService.criar(criacao("SW-01", null)))
                .isInstanceOf(RecursoNaoEncontradoException.class);

        Unidade inativa = new Unidade("Matriz", "MTZ", null);
        inativa.setAtivo(false);
        when(unidadeRepository.findById(1L)).thenReturn(Optional.of(inativa));
        assertThatThrownBy(() -> equipamentoService.criar(criacao("SW-01", null)))
                .isInstanceOf(ConflitoException.class);

        Unidade ativa = new Unidade("Matriz", "MTZ", null);
        when(unidadeRepository.findById(1L)).thenReturn(Optional.of(ativa));
        when(tipoEquipamentoRepository.findById(2L)).thenReturn(Optional.empty());
        assertThatThrownBy(() -> equipamentoService.criar(criacao("SW-01", null)))
                .isInstanceOf(RecursoNaoEncontradoException.class);

        TipoEquipamento tipoInativo = new TipoEquipamento("Switch", null);
        tipoInativo.setAtivo(false);
        when(tipoEquipamentoRepository.findById(2L)).thenReturn(Optional.of(tipoInativo));
        assertThatThrownBy(() -> equipamentoService.criar(criacao("SW-01", null)))
                .isInstanceOf(ConflitoException.class);
    }

    @Test
    void rejeitaIpInvalido() {
        Unidade unidade = new Unidade("Matriz", "MTZ", null);
        TipoEquipamento tipo = new TipoEquipamento("Switch", null);
        relacionamentosAtivos(unidade, tipo);

        assertThatThrownBy(() -> equipamentoService.criar(criacao("SW-01", "999.1.1.1")))
                .isInstanceOf(IllegalArgumentException.class);
        verify(equipamentoRepository, never()).save(any());
    }

    @Test
    void buscaAtualizaEPermiteManterRelacionamentosInativos() {
        Unidade unidade = new Unidade("Matriz", "MTZ", null);
        TipoEquipamento tipo = new TipoEquipamento("Switch", null);
        Equipamento equipamento = new Equipamento(unidade, tipo, "SW-01", null, null, "Antiga", null);
        definirId(unidade, 1L);
        definirId(tipo, 2L);
        unidade.setAtivo(false);
        tipo.setAtivo(false);
        when(equipamentoRepository.findById(1L)).thenReturn(Optional.of(equipamento));

        equipamentoService.atualizar(1L, new UpdateEquipamentoRequest(1L, 2L, "SW-01", null, null, "Nova", null));

        assertThat(equipamento.getDescricao()).isEqualTo("Nova");
        assertThatThrownBy(() -> equipamentoService.buscarPorId(99L)).isInstanceOf(RecursoNaoEncontradoException.class);
    }

    @Test
    void alteraRelacionamentosSomenteParaRegistrosAtivos() {
        Unidade unidadeAtual = new Unidade("Matriz", "MTZ", null);
        TipoEquipamento tipoAtual = new TipoEquipamento("Switch", null);
        Equipamento equipamento = new Equipamento(unidadeAtual, tipoAtual, "SW-01", null, null, null, null);
        when(equipamentoRepository.findById(1L)).thenReturn(Optional.of(equipamento));
        Unidade novaUnidade = new Unidade("Filial", "FIL", null);
        TipoEquipamento novoTipo = new TipoEquipamento("Router", null);
        when(unidadeRepository.findById(3L)).thenReturn(Optional.of(novaUnidade));
        when(tipoEquipamentoRepository.findById(4L)).thenReturn(Optional.of(novoTipo));

        equipamentoService.atualizar(1L, new UpdateEquipamentoRequest(3L, 4L, "RTR-01", null, null, null, null));

        assertThat(equipamento.getUnidade()).isSameAs(novaUnidade);
        assertThat(equipamento.getTipoEquipamento()).isSameAs(novoTipo);
    }

    @Test
    void ativaSomenteComDependenciasAtivasEDesativaEExclui() {
        Unidade unidade = new Unidade("Matriz", "MTZ", null);
        TipoEquipamento tipo = new TipoEquipamento("Switch", null);
        Equipamento equipamento = new Equipamento(unidade, tipo, "SW-01", null, null, null, null);
        equipamento.setAtivo(false);
        when(equipamentoRepository.findById(1L)).thenReturn(Optional.of(equipamento));

        equipamentoService.ativar(1L);
        assertThat(equipamento.isAtivo()).isTrue();
        unidade.setAtivo(false);
        assertThatThrownBy(() -> equipamentoService.ativar(1L)).isInstanceOf(ConflitoException.class);
        unidade.setAtivo(true);
        tipo.setAtivo(false);
        assertThatThrownBy(() -> equipamentoService.ativar(1L)).isInstanceOf(ConflitoException.class);

        equipamentoService.desativar(1L);
        equipamentoService.excluir(1L);
        verify(equipamentoRepository).delete(eq(equipamento));
    }

    @Test
    void impedeExcluirEquipamentoComMonitoresAssociados() {
        Unidade unidade = new Unidade("Matriz", "MTZ", null);
        TipoEquipamento tipo = new TipoEquipamento("Switch", null);
        Equipamento equipamento = new Equipamento(unidade, tipo, "SW-01", null, null, null, null);
        when(equipamentoRepository.findById(1L)).thenReturn(Optional.of(equipamento));
        when(monitorRepository.existsByEquipamentoId(1L)).thenReturn(true);

        assertThatThrownBy(() -> equipamentoService.excluir(1L))
                .isInstanceOf(ConflitoException.class)
                .hasMessageContaining("monitores associados");
        verify(equipamentoRepository, never()).delete(any(Equipamento.class));
    }

    private CreateEquipamentoRequest criacao(String nome, String ip) {
        return new CreateEquipamentoRequest(1L, 2L, nome, ip, "sw-core", "Switch core", "Rack 01");
    }

    private void relacionamentosAtivos(Unidade unidade, TipoEquipamento tipo) {
        when(unidadeRepository.findById(1L)).thenReturn(Optional.of(unidade));
        when(tipoEquipamentoRepository.findById(2L)).thenReturn(Optional.of(tipo));
    }

    private void definirId(Object entidade, Long id) {
        ReflectionTestUtils.setField(entidade, "id", id);
    }
}
