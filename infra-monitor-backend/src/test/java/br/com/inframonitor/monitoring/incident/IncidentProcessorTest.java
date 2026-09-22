package br.com.inframonitor.monitoring.incident;

import br.com.inframonitor.equipamento.entity.Equipamento;
import br.com.inframonitor.incidente.entity.Incidente;
import br.com.inframonitor.incidente.entity.StatusIncidente;
import br.com.inframonitor.incidente.repository.IncidenteRepository;
import br.com.inframonitor.incidente.service.IncidenteService;
import br.com.inframonitor.medicao.entity.Medicao;
import br.com.inframonitor.medicao.entity.StatusMedicao;
import br.com.inframonitor.medicao.repository.MedicaoRepository;
import br.com.inframonitor.monitor.entity.Monitor;
import br.com.inframonitor.monitor.entity.TipoMonitor;
import br.com.inframonitor.tipoequipamento.entity.TipoEquipamento;
import br.com.inframonitor.unidade.entity.Unidade;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.Pageable;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class IncidentProcessorTest {
    private static final Instant T0 = Instant.parse("2026-08-19T12:00:00Z");

    @Mock private MedicaoRepository medicaoRepository;
    @Mock private IncidenteRepository incidenteRepository;
    @Mock private IncidenteService incidenteService;
    @InjectMocks private IncidentProcessor processor;

    @Test void abreSomenteNaTerceiraFalhaConsecutivaComInicioCorreto() {
        Monitor monitor = monitor(3, 2);
        Medicao primeira = medicao(monitor, 1L, StatusMedicao.FALHA, T0);
        Medicao segunda = medicao(monitor, 2L, StatusMedicao.FALHA, T0.plusSeconds(60));
        Medicao terceira = medicao(monitor, 3L, StatusMedicao.FALHA, T0.plusSeconds(120));
        prepararAtual(terceira);
        when(medicaoRepository.findByMonitorIdOrderByExecutadoEmDescIdDesc(eq(1L), any(Pageable.class)))
                .thenReturn(List.of(terceira, segunda, primeira));
        when(incidenteService.abrirAutomaticamente(any(), any(), eq(3))).thenReturn(Optional.of(incidente(monitor)));

        processor.process(terceira);

        ArgumentCaptor<Instant> inicio = ArgumentCaptor.forClass(Instant.class);
        verify(incidenteService).abrirAutomaticamente(eq(monitor), inicio.capture(), eq(3));
        assertThat(inicio.getValue()).isEqualTo(T0);
    }

    @Test void naoAbreComHistoricoInsuficienteOuSequenciaInterrompida() {
        Monitor monitor = monitor(3, 2);
        Medicao atual = medicao(monitor, 3L, StatusMedicao.FALHA, T0.plusSeconds(120));
        prepararAtual(atual);
        when(medicaoRepository.findByMonitorIdOrderByExecutadoEmDescIdDesc(eq(1L), any(Pageable.class)))
                .thenReturn(List.of(atual, medicao(monitor, 2L, StatusMedicao.SUCESSO, T0.plusSeconds(60)),
                        medicao(monitor, 1L, StatusMedicao.FALHA, T0)));

        processor.process(atual);

        verify(incidenteService, never()).abrirAutomaticamente(any(), any(), any(Integer.class));
    }

    @Test void thresholdUmAbreImediatamente() {
        Monitor monitor = monitor(1, 2);
        Medicao falha = medicao(monitor, 1L, StatusMedicao.FALHA, T0);
        prepararAtual(falha);
        when(medicaoRepository.findByMonitorIdOrderByExecutadoEmDescIdDesc(eq(1L), any(Pageable.class))).thenReturn(List.of(falha));
        when(incidenteService.abrirAutomaticamente(any(), any(), eq(1))).thenReturn(Optional.of(incidente(monitor)));

        processor.process(falha);

        verify(incidenteService).abrirAutomaticamente(monitor, T0, 1);
    }

    @Test void incidenteAbertoFechaSomenteNoSegundoSucessoEUsaUltimoInstante() {
        Monitor monitor = monitor(3, 2);
        Incidente incidente = incidente(monitor);
        Medicao primeiro = medicao(monitor, 4L, StatusMedicao.SUCESSO, T0.plusSeconds(180));
        Medicao ultimo = medicao(monitor, 5L, StatusMedicao.SUCESSO, T0.plusSeconds(240));
        prepararAtual(ultimo);
        when(incidenteRepository.findFirstByMonitorIdAndStatusInOrderByIniciadoEmDescIdDesc(1L, StatusIncidente.EM_ABERTO))
                .thenReturn(Optional.of(incidente));
        when(medicaoRepository.findByMonitorIdOrderByExecutadoEmDescIdDesc(eq(1L), any(Pageable.class))).thenReturn(List.of(ultimo, primeiro));
        when(incidenteService.fecharAutomaticamente(any(), any(), eq(2))).thenReturn(incidente);

        processor.process(ultimo);

        verify(incidenteService).fecharAutomaticamente(incidente, ultimo.getExecutadoEm(), 2);
    }

    @Test void recoveryInterrompidoNaoFechaEThresholdUmFechaImediatamente() {
        Monitor monitor = monitor(3, 2);
        Incidente incidente = incidente(monitor);
        Medicao atual = medicao(monitor, 3L, StatusMedicao.SUCESSO, T0.plusSeconds(120));
        prepararAtual(atual);
        when(incidenteRepository.findFirstByMonitorIdAndStatusInOrderByIniciadoEmDescIdDesc(1L, StatusIncidente.EM_ABERTO)).thenReturn(Optional.of(incidente));
        when(medicaoRepository.findByMonitorIdOrderByExecutadoEmDescIdDesc(eq(1L), any(Pageable.class)))
                .thenReturn(List.of(atual, medicao(monitor, 2L, StatusMedicao.FALHA, T0.plusSeconds(60))));
        processor.process(atual);
        verify(incidenteService, never()).fecharAutomaticamente(any(), any(), any(Integer.class));

        monitor.setSucessosParaRecovery(1);
        when(medicaoRepository.findByMonitorIdOrderByExecutadoEmDescIdDesc(eq(1L), any(Pageable.class))).thenReturn(List.of(atual));
        when(incidenteService.fecharAutomaticamente(any(), any(), eq(1))).thenReturn(incidente);
        processor.process(atual);
        verify(incidenteService).fecharAutomaticamente(incidente, atual.getExecutadoEm(), 1);
    }

    @Test void medicaoAtrasadaNaoAlteraIncidente() {
        Monitor monitor = monitor(1, 1);
        Medicao atrasada = medicao(monitor, 1L, StatusMedicao.FALHA, T0);
        Medicao maisRecente = medicao(monitor, 2L, StatusMedicao.SUCESSO, T0.plusSeconds(60));
        when(medicaoRepository.findFirstByMonitorIdOrderByExecutadoEmDescIdDesc(1L)).thenReturn(Optional.of(maisRecente));

        processor.process(atrasada);

        verify(incidenteRepository, never()).findFirstByMonitorIdAndStatusInOrderByIniciadoEmDescIdDesc(any(), any());
        verify(incidenteService, never()).abrirAutomaticamente(any(), any(), any(Integer.class));
    }

    @Test void incidenteAbertoNaoDuplicaEUmNovoCicloPodeAbrirOutro() {
        Monitor monitor = monitor(1, 1);
        Medicao falha = medicao(monitor, 2L, StatusMedicao.FALHA, T0.plusSeconds(60));
        prepararAtual(falha);
        when(incidenteRepository.findFirstByMonitorIdAndStatusInOrderByIniciadoEmDescIdDesc(1L, StatusIncidente.EM_ABERTO))
                .thenReturn(Optional.of(incidente(monitor)));
        when(medicaoRepository.findByMonitorIdOrderByExecutadoEmDescIdDesc(eq(1L), any(Pageable.class))).thenReturn(List.of(falha));

        processor.process(falha);
        verify(incidenteService, never()).abrirAutomaticamente(any(), any(), any(Integer.class));

        when(incidenteRepository.findFirstByMonitorIdAndStatusInOrderByIniciadoEmDescIdDesc(1L, StatusIncidente.EM_ABERTO))
                .thenReturn(Optional.empty());
        when(incidenteService.abrirAutomaticamente(any(), any(), eq(1))).thenReturn(Optional.of(incidente(monitor)));
        processor.process(falha);
        verify(incidenteService).abrirAutomaticamente(monitor, falha.getExecutadoEm(), 1);
    }

    private void prepararAtual(Medicao atual) {
        when(medicaoRepository.findFirstByMonitorIdOrderByExecutadoEmDescIdDesc(1L)).thenReturn(Optional.of(atual));
        when(incidenteRepository.findFirstByMonitorIdAndStatusInOrderByIniciadoEmDescIdDesc(1L, StatusIncidente.EM_ABERTO)).thenReturn(Optional.empty());
    }
    private Monitor monitor(int falhas, int sucessos) {
        Equipamento equipamento = new Equipamento(new Unidade("Matriz", "MTZ", null), new TipoEquipamento("Switch", null), "SW", null, null, null, null, null);
        Monitor monitor = new Monitor(equipamento, TipoMonitor.ICMP, "ICMP", 60, 2000, falhas, sucessos);
        ReflectionTestUtils.setField(monitor, "id", 1L);
        return monitor;
    }
    private Medicao medicao(Monitor monitor, Long id, StatusMedicao status, Instant quando) {
        Medicao medicao = new Medicao(monitor, status, null, null, quando);
        ReflectionTestUtils.setField(medicao, "id", id);
        return medicao;
    }
    private Incidente incidente(Monitor monitor) {
        Incidente incidente = new Incidente(monitor, T0, "motivo", null);
        ReflectionTestUtils.setField(incidente, "id", 10L);
        return incidente;
    }
}
