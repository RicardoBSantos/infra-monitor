package br.com.inframonitor.equipamento.service;

import br.com.inframonitor.common.exception.ConflitoException;
import br.com.inframonitor.common.exception.RecursoNaoEncontradoException;
import br.com.inframonitor.equipamento.dto.EquipamentoResponse;
import br.com.inframonitor.equipamento.dto.CreateEquipamentoRequest;
import br.com.inframonitor.equipamento.dto.UpdateEquipamentoRequest;
import br.com.inframonitor.equipamento.entity.Equipamento;
import br.com.inframonitor.equipamento.repository.EquipamentoRepository;
import br.com.inframonitor.equipamento.validation.RegraIpv4;
import br.com.inframonitor.manutencao.repository.ManutencaoAgendadaRepository;
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
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.Optional;
import java.util.concurrent.atomic.AtomicReference;
import java.util.List;

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
    @Mock private EstadoManutencaoEquipamento estado;
    @Mock private ManutencaoAgendadaRepository manutencaoRepository;
    @InjectMocks private EquipamentoService equipamentoService;

    @Test
    void criaEquipamentoValidoComCamposNormalizados() {
        Unidade unidade = new Unidade("Matriz", "MTZ", null);
        TipoEquipamento tipo = new TipoEquipamento("Switch", null);
        relacionamentosAtivos(unidade, tipo);
        salvarEReler();

        var resposta = equipamentoService.criar(criacao("  SW-CORE-01  ", " 10.0.0.10 "));

        ArgumentCaptor<Equipamento> captor = ArgumentCaptor.forClass(Equipamento.class);
        verify(equipamentoRepository).save(captor.capture());
        verify(estado).reavaliar(captor.getValue().getId());
        assertThat(captor.getValue().getNome()).isEqualTo("SW-CORE-01");
        assertThat(captor.getValue().getIp()).isEqualTo("10.0.0.10");
        assertThat(captor.getValue().isAtivo()).isTrue();
        assertThat(resposta.unidade().nome()).isEqualTo("Matriz");
    }

    @Test
    void listaComFiltrosOpcionaisSemCombinarSpecificationsNulas() {
        when(equipamentoRepository.findAll(org.mockito.ArgumentMatchers.<Specification<Equipamento>>any(),
                org.mockito.ArgumentMatchers.<Pageable>any())).thenReturn(new PageImpl<>(List.of()));
        Pageable pagina = PageRequest.of(0, 20);

        equipamentoService.listar(null, null, null, pagina);
        equipamentoService.listar(1L, null, null, pagina);
        equipamentoService.listar(null, 2L, null, pagina);
        equipamentoService.listar(null, null, true, pagina);
        equipamentoService.listar(1L, 2L, false, pagina);

        verify(equipamentoRepository, org.mockito.Mockito.times(5)).findAll(
                org.mockito.ArgumentMatchers.<Specification<Equipamento>>any(), org.mockito.ArgumentMatchers.<Pageable>any());
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
        assertThatThrownBy(() -> equipamentoService.criar(criacao("SW-01", "010.0.0.1")))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining(RegraIpv4.ZERO_A_ESQUERDA);
        verify(equipamentoRepository, never()).save(any());
    }

    @Test
    void buscaAtualizaEPermiteManterRelacionamentosInativos() {
        Unidade unidade = new Unidade("Matriz", "MTZ", null);
        TipoEquipamento tipo = new TipoEquipamento("Switch", null);
        Equipamento equipamento = new Equipamento(unidade, tipo, "SW-01", null, null, "Antiga", null, null);
        definirId(unidade, 1L);
        definirId(tipo, 2L);
        unidade.setAtivo(false);
        tipo.setAtivo(false);
        when(equipamentoRepository.findById(1L)).thenReturn(Optional.of(equipamento));

        equipamentoService.atualizar(1L, new UpdateEquipamentoRequest(1L, 2L, "SW-01", null, null, "Nova", null, null, null, null));

        assertThat(equipamento.getDescricao()).isEqualTo("Nova");
        assertThatThrownBy(() -> equipamentoService.buscarPorId(99L)).isInstanceOf(RecursoNaoEncontradoException.class);
    }

    @Test
    void alteraRelacionamentosSomenteParaRegistrosAtivos() {
        Unidade unidadeAtual = new Unidade("Matriz", "MTZ", null);
        TipoEquipamento tipoAtual = new TipoEquipamento("Switch", null);
        Equipamento equipamento = new Equipamento(unidadeAtual, tipoAtual, "SW-01", null, null, null, null, null);
        when(equipamentoRepository.findById(1L)).thenReturn(Optional.of(equipamento));
        Unidade novaUnidade = new Unidade("Filial", "FIL", null);
        TipoEquipamento novoTipo = new TipoEquipamento("Router", null);
        when(unidadeRepository.findById(3L)).thenReturn(Optional.of(novaUnidade));
        when(tipoEquipamentoRepository.findById(4L)).thenReturn(Optional.of(novoTipo));

        equipamentoService.atualizar(1L, new UpdateEquipamentoRequest(3L, 4L, "RTR-01", null, null, null, null, null, null, null));

        assertThat(equipamento.getUnidade()).isSameAs(novaUnidade);
        assertThat(equipamento.getTipoEquipamento()).isSameAs(novoTipo);
    }

    @Test
    void ativaSomenteComDependenciasAtivasEDesativaEExclui() {
        Unidade unidade = new Unidade("Matriz", "MTZ", null);
        TipoEquipamento tipo = new TipoEquipamento("Switch", null);
        Equipamento equipamento = new Equipamento(unidade, tipo, "SW-01", null, null, null, null, null);
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
        Equipamento equipamento = new Equipamento(unidade, tipo, "SW-01", null, null, null, null, null);
        when(equipamentoRepository.findById(1L)).thenReturn(Optional.of(equipamento));
        when(monitorRepository.existsByEquipamentoId(1L)).thenReturn(true);

        assertThatThrownBy(() -> equipamentoService.excluir(1L))
                .isInstanceOf(ConflitoException.class)
                .hasMessageContaining("monitores associados");
        verify(equipamentoRepository, never()).delete(any(Equipamento.class));
    }

    @Test
    void preservaNumeroSerieNoRoundTripDeEdicao() {
        Unidade unidade = new Unidade("Matriz", "MTZ", null);
        TipoEquipamento tipo = new TipoEquipamento("Switch", null);
        definirId(unidade, 1L);
        definirId(tipo, 2L);
        Equipamento equipamento = new Equipamento(unidade, tipo, "SW-01", "10.0.0.10", "sw-core",
                "Switch core", "Rack 01", "SN-0001");
        when(equipamentoRepository.findById(1L)).thenReturn(Optional.of(equipamento));

        // Reenvio integral do que a tela carregou: nenhum campo pode se perder no caminho.
        EquipamentoResponse resposta = equipamentoService.atualizar(1L, new UpdateEquipamentoRequest(
                1L, 2L, "SW-01", "10.0.0.10", "sw-core", "Switch core", "Rack 01", "SN-0001", "Cisco", "Catalyst 9200-24T"));

        assertThat(resposta.numeroSerie()).isEqualTo("SN-0001");
        assertThat(resposta.fabricante()).isEqualTo("Cisco");
        assertThat(resposta.modelo()).isEqualTo("Catalyst 9200-24T");
        assertThat(resposta.localizacao()).isEqualTo("Rack 01");
        assertThat(resposta.descricao()).isEqualTo("Switch core");
        assertThat(resposta.hostname()).isEqualTo("sw-core");
        assertThat(resposta.ip()).isEqualTo("10.0.0.10");
    }

    @Test
    void numeroSerieFabricanteEModeloSaoOpcionaisEVazioViraNulo() {
        Unidade unidade = new Unidade("Matriz", "MTZ", null);
        TipoEquipamento tipo = new TipoEquipamento("Switch", null);
        definirId(unidade, 1L);
        definirId(tipo, 2L);
        relacionamentosAtivos(unidade, tipo);
        salvarEReler();

        EquipamentoResponse semNumero = equipamentoService.criar(new CreateEquipamentoRequest(
                1L, 2L, "SW-02", null, null, null, null, "   ", "   ", null));

        assertThat(semNumero.numeroSerie()).isNull();
        assertThat(semNumero.fabricante()).isNull();
        assertThat(semNumero.modelo()).isNull();
    }

    @Test
    void ipComEspacoUnicodeVazioViraNuloEEspacoUnicodeNasBordasEAparado() {
        Unidade unidade = new Unidade("Matriz", "MTZ", null);
        TipoEquipamento tipo = new TipoEquipamento("Switch", null);
        definirId(unidade, 1L);
        definirId(tipo, 2L);
        relacionamentosAtivos(unidade, tipo);
        salvarEReler();

        assertThat(equipamentoService.criar(criacao("SW-03", "\u2003")).ip()).isNull();
        assertThat(equipamentoService.criar(criacao("SW-04", "\u200310.0.0.1\u2003")).ip()).isEqualTo("10.0.0.1");
    }

    private CreateEquipamentoRequest criacao(String nome, String ip) {
        return new CreateEquipamentoRequest(1L, 2L, nome, ip, "sw-core", "Switch core", "Rack 01", null, null, null);
    }

    /**
     * criar reavalia a manutencao (escritor unico) e responde relendo: a reavaliacao pode
     * limpar a sessao. Aqui o mock devolve o que foi salvo, sem id, na releitura.
     */
    private void salvarEReler() {
        AtomicReference<Equipamento> salvo = new AtomicReference<>();
        when(equipamentoRepository.save(any(Equipamento.class))).thenAnswer(invocacao -> {
            salvo.set(invocacao.getArgument(0));
            return invocacao.getArgument(0);
        });
        when(equipamentoRepository.findById(org.mockito.ArgumentMatchers.<Long>isNull()))
                .thenAnswer(invocacao -> Optional.ofNullable(salvo.get()));
    }

    private void relacionamentosAtivos(Unidade unidade, TipoEquipamento tipo) {
        when(unidadeRepository.findById(1L)).thenReturn(Optional.of(unidade));
        when(tipoEquipamentoRepository.findById(2L)).thenReturn(Optional.of(tipo));
    }

    private void definirId(Object entidade, Long id) {
        ReflectionTestUtils.setField(entidade, "id", id);
    }
}
