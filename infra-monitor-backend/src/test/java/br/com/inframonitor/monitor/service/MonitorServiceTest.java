package br.com.inframonitor.monitor.service;

import br.com.inframonitor.common.exception.ConflitoException;
import br.com.inframonitor.common.exception.RecursoNaoEncontradoException;
import br.com.inframonitor.equipamento.entity.Equipamento;
import br.com.inframonitor.equipamento.repository.EquipamentoRepository;
import br.com.inframonitor.medicao.repository.MedicaoRepository;
import br.com.inframonitor.incidente.repository.IncidenteRepository;
import br.com.inframonitor.monitor.dto.CreateMonitorRequest;
import br.com.inframonitor.monitor.dto.UpdateMonitorRequest;
import br.com.inframonitor.monitor.entity.Monitor;
import br.com.inframonitor.monitor.entity.TipoMonitor;
import br.com.inframonitor.monitor.repository.MonitorRepository;
import br.com.inframonitor.monitor.service.MonitorService;
import br.com.inframonitor.tipoequipamento.entity.TipoEquipamento;
import br.com.inframonitor.unidade.entity.Unidade;
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
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class MonitorServiceTest {
    @Mock private MonitorRepository monitorRepository;
    @Mock private EquipamentoRepository equipamentoRepository;
    @Mock private MedicaoRepository medicaoRepository;
    @Mock private IncidenteRepository incidenteRepository;
    @InjectMocks private MonitorService monitorService;

    @Test
    void criaMonitorValidoAtivo() {
        Equipamento equipamento = equipamento(true, 10L);
        when(equipamentoRepository.findById(10L)).thenReturn(Optional.of(equipamento));
        when(monitorRepository.save(any(Monitor.class))).thenAnswer(i -> i.getArgument(0));

        var resposta = monitorService.criar(criacao(10L, 60, 2000));

        ArgumentCaptor<Monitor> captor = ArgumentCaptor.forClass(Monitor.class);
        verify(monitorRepository).save(captor.capture());
        assertThat(captor.getValue().getNome()).isEqualTo("ICMP principal");
        assertThat(captor.getValue().getFalhasParaIncidente()).isEqualTo(Monitor.DEFAULT_FALHAS_PARA_INCIDENTE);
        assertThat(captor.getValue().getSucessosParaRecovery()).isEqualTo(Monitor.DEFAULT_SUCESSOS_PARA_RECOVERY);
        assertThat(resposta.ativo()).isTrue();
    }

    @Test
    void listaComFiltrosOpcionaisSemCombinarSpecificationsNulas() {
        when(monitorRepository.findAll(org.mockito.ArgumentMatchers.<Specification<Monitor>>any(),
                org.mockito.ArgumentMatchers.<Pageable>any())).thenReturn(new PageImpl<>(List.of()));
        Pageable pagina = PageRequest.of(0, 20);

        monitorService.listar(null, null, null, pagina);
        monitorService.listar(10L, null, null, pagina);
        monitorService.listar(null, TipoMonitor.ICMP, null, pagina);
        monitorService.listar(null, null, true, pagina);
        monitorService.listar(10L, TipoMonitor.ICMP, false, pagina);

        verify(monitorRepository, org.mockito.Mockito.times(5)).findAll(
                org.mockito.ArgumentMatchers.<Specification<Monitor>>any(), org.mockito.ArgumentMatchers.<Pageable>any());
    }

    @Test
    void rejeitaEquipamentoInexistenteOuInativoEConfiguracaoIncoerente() {
        when(equipamentoRepository.findById(10L)).thenReturn(Optional.empty());
        assertThatThrownBy(() -> monitorService.criar(criacao(10L, 60, 2000))).isInstanceOf(RecursoNaoEncontradoException.class);
        when(equipamentoRepository.findById(10L)).thenReturn(Optional.of(equipamento(false, 10L)));
        assertThatThrownBy(() -> monitorService.criar(criacao(10L, 60, 2000))).isInstanceOf(ConflitoException.class);
        assertThatThrownBy(() -> monitorService.criar(criacao(10L, 10, 10000))).isInstanceOf(IllegalArgumentException.class);
        verify(monitorRepository, never()).save(any());
    }

    @Test
    void buscaAtualizaEMantemEquipamentoAtualInativo() {
        Equipamento equipamento = equipamento(false, 10L);
        Monitor monitor = new Monitor(equipamento, TipoMonitor.ICMP, "Antigo", 60, 2000);
        definirId(monitor, 1L);
        when(monitorRepository.findById(1L)).thenReturn(Optional.of(monitor));

        monitorService.atualizar(1L, new UpdateMonitorRequest(10L, TipoMonitor.ICMP, "Novo", 30, 1000, 4, 3));

        assertThat(monitor.getNome()).isEqualTo("Novo");
        assertThat(monitor.getEquipamento()).isSameAs(equipamento);
        assertThatThrownBy(() -> monitorService.buscarPorId(2L)).isInstanceOf(RecursoNaoEncontradoException.class);
    }

    @Test
    void permiteTransferirParaAtivoEImpedeInativo() {
        Monitor monitor = new Monitor(equipamento(true, 10L), TipoMonitor.ICMP, "ICMP", 60, 2000);
        definirId(monitor, 1L);
        when(monitorRepository.findById(1L)).thenReturn(Optional.of(monitor));
        Equipamento novo = equipamento(true, 20L);
        when(equipamentoRepository.findById(20L)).thenReturn(Optional.of(novo));
        monitorService.atualizar(1L, new UpdateMonitorRequest(20L, TipoMonitor.ICMP, "ICMP", 60, 2000, 4, 3));
        assertThat(monitor.getEquipamento()).isSameAs(novo);
        when(equipamentoRepository.findById(30L)).thenReturn(Optional.of(equipamento(false, 30L)));
        assertThatThrownBy(() -> monitorService.atualizar(1L, new UpdateMonitorRequest(30L, TipoMonitor.ICMP, "ICMP", 60, 2000, 4, 3))).isInstanceOf(ConflitoException.class);
    }

    @Test
    void ativaDesativaEExclui() {
        Monitor monitor = new Monitor(equipamento(true, 10L), TipoMonitor.ICMP, "ICMP", 60, 2000);
        definirId(monitor, 1L);
        monitor.setAtivo(false);
        when(monitorRepository.findById(1L)).thenReturn(Optional.of(monitor));
        monitorService.ativar(1L);
        assertThat(monitor.isAtivo()).isTrue();
        monitorService.desativar(1L);
        assertThat(monitor.isAtivo()).isFalse();
        monitorService.excluir(1L);
        verify(monitorRepository).delete(monitor);
    }

    @Test
    void impedeExclusaoQuandoExistemMedicoes() {
        Monitor monitor = new Monitor(equipamento(true, 10L), TipoMonitor.ICMP, "ICMP", 60, 2000);
        definirId(monitor, 1L);
        when(monitorRepository.findById(1L)).thenReturn(Optional.of(monitor));
        when(medicaoRepository.existsByMonitorId(1L)).thenReturn(true);

        assertThatThrownBy(() -> monitorService.excluir(1L)).isInstanceOf(ConflitoException.class);
        verify(monitorRepository, never()).delete(monitor);
    }

    @Test
    void impedeExclusaoQuandoExistemIncidentes() {
        Monitor monitor = new Monitor(equipamento(true, 10L), TipoMonitor.ICMP, "ICMP", 60, 2000);
        definirId(monitor, 1L);
        when(monitorRepository.findById(1L)).thenReturn(Optional.of(monitor));
        when(incidenteRepository.existsByMonitorId(1L)).thenReturn(true);

        assertThatThrownBy(() -> monitorService.excluir(1L)).isInstanceOf(ConflitoException.class)
                .hasMessageContaining("incidentes");
        verify(monitorRepository, never()).delete(monitor);
    }

    @Test
    void impedeAtivacaoComEquipamentoInativo() {
        Monitor monitor = new Monitor(equipamento(false, 10L), TipoMonitor.ICMP, "ICMP", 60, 2000);
        when(monitorRepository.findById(1L)).thenReturn(Optional.of(monitor));
        assertThatThrownBy(() -> monitorService.ativar(1L)).isInstanceOf(ConflitoException.class);
    }

    private CreateMonitorRequest criacao(Long equipamentoId, int intervalo, int timeout) { return new CreateMonitorRequest(equipamentoId, TipoMonitor.ICMP, "  ICMP principal  ", intervalo, timeout, null, null); }
    private Equipamento equipamento(boolean ativo, Long id) {
        Equipamento equipamento = new Equipamento(new Unidade("Matriz", "MTZ", null), new TipoEquipamento("Switch", null), "SW-01", "10.0.0.1", null, null, null);
        equipamento.setAtivo(ativo); definirId(equipamento, id); return equipamento;
    }
    private void definirId(Object entidade, Long id) { ReflectionTestUtils.setField(entidade, "id", id); }
}
