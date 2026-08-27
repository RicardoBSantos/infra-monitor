package br.com.inframonitor.medicao.service;

import br.com.inframonitor.common.exception.RecursoNaoEncontradoException;
import br.com.inframonitor.equipamento.entity.Equipamento;
import br.com.inframonitor.medicao.dto.CreateMedicaoRequest;
import br.com.inframonitor.medicao.entity.Medicao;
import br.com.inframonitor.medicao.entity.StatusMedicao;
import br.com.inframonitor.medicao.repository.MedicaoRepository;
import br.com.inframonitor.monitor.entity.Monitor;
import br.com.inframonitor.monitor.entity.TipoMonitor;
import br.com.inframonitor.monitor.repository.MonitorRepository;
import br.com.inframonitor.monitoring.incident.IncidentProcessor;
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

import java.time.Instant;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.doThrow;

@ExtendWith(MockitoExtension.class)
class MedicaoServiceTest {

    @Mock private MedicaoRepository medicaoRepository;
    @Mock private MonitorRepository monitorRepository;
    @Mock private IncidentProcessor incidentProcessor;
    @InjectMocks private MedicaoService medicaoService;

    @Test
    void criaMedicoesDeSucessoEFalha() {
        Monitor monitor = monitor();
        when(monitorRepository.findById(1L)).thenReturn(Optional.of(monitor));
        when(medicaoRepository.save(any(Medicao.class))).thenAnswer(invocation -> invocation.getArgument(0));

        var sucesso = medicaoService.criar(requisicao(StatusMedicao.SUCESSO, 4));
        var falha = medicaoService.criar(requisicao(StatusMedicao.FALHA, null));

        assertThat(sucesso.status()).isEqualTo(StatusMedicao.SUCESSO);
        assertThat(sucesso.latenciaMs()).isEqualTo(4);
        assertThat(falha.status()).isEqualTo(StatusMedicao.FALHA);
        assertThat(falha.latenciaMs()).isNull();
        verify(incidentProcessor, org.mockito.Mockito.times(2)).process(any(Medicao.class));
    }

    @Test
    void mantemMedicaoPersistidaQuandoProcessorFalha() {
        Monitor monitor = monitor();
        when(monitorRepository.findById(1L)).thenReturn(Optional.of(monitor));
        when(medicaoRepository.save(any(Medicao.class))).thenAnswer(invocation -> invocation.getArgument(0));
        doThrow(new IllegalStateException("processor failure")).when(incidentProcessor).process(any(Medicao.class));

        var resposta = medicaoService.criar(requisicao(StatusMedicao.FALHA, null));

        assertThat(resposta.status()).isEqualTo(StatusMedicao.FALHA);
        verify(medicaoRepository).save(any(Medicao.class));
    }

    @Test
    void rejeitaMonitorInexistenteELatenciaInvalida() {
        when(monitorRepository.findById(1L)).thenReturn(Optional.empty());
        assertThatThrownBy(() -> medicaoService.criar(requisicao(StatusMedicao.SUCESSO, 4)))
                .isInstanceOf(RecursoNaoEncontradoException.class);
        assertThatThrownBy(() -> medicaoService.criar(requisicao(StatusMedicao.SUCESSO, -1)))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void rejeitaLatenciaParaFalha() {
        assertThatThrownBy(() -> medicaoService.criar(requisicao(StatusMedicao.FALHA, 4)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("FALHA");
    }

    @Test
    void buscaExistenteEInexistente() {
        Medicao medicao = new Medicao(monitor(), StatusMedicao.SUCESSO, 4, null, Instant.parse("2026-08-19T12:00:00Z"));
        definirId(medicao, 11L);
        when(medicaoRepository.findById(11L)).thenReturn(Optional.of(medicao));

        assertThat(medicaoService.buscarPorId(11L).id()).isEqualTo(11L);
        assertThatThrownBy(() -> medicaoService.buscarPorId(99L)).isInstanceOf(RecursoNaoEncontradoException.class);
    }

    @Test
    void listaComFiltrosEValidaPeriodo() {
        Medicao medicao = new Medicao(monitor(), StatusMedicao.SUCESSO, 4, null, Instant.parse("2026-08-19T12:00:00Z"));
        definirId(medicao, 11L);
        when(medicaoRepository.findAll(org.mockito.ArgumentMatchers.<Specification<Medicao>>any(),
                org.mockito.ArgumentMatchers.<Pageable>any()))
                .thenReturn(new PageImpl<>(List.of(medicao)));

        var resultado = medicaoService.listar(1L, StatusMedicao.SUCESSO,
                Instant.parse("2026-08-19T00:00:00Z"), Instant.parse("2026-08-20T00:00:00Z"), PageRequest.of(0, 50));

        assertThat(resultado.getContent()).hasSize(1);
        verify(medicaoRepository).findAll(org.mockito.ArgumentMatchers.<Specification<Medicao>>any(),
                org.mockito.ArgumentMatchers.<Pageable>any());
        assertThatThrownBy(() -> medicaoService.listar(null, null,
                Instant.parse("2026-08-20T00:00:00Z"), Instant.parse("2026-08-19T00:00:00Z"), PageRequest.of(0, 50)))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void listaComCadaFiltroOpcionalSemCombinarSpecificationsNulas() {
        when(medicaoRepository.findAll(org.mockito.ArgumentMatchers.<Specification<Medicao>>any(),
                org.mockito.ArgumentMatchers.<Pageable>any())).thenReturn(new PageImpl<>(List.of()));
        Pageable pagina = PageRequest.of(0, 50);

        medicaoService.listar(null, null, null, null, pagina);
        medicaoService.listar(1L, null, null, null, pagina);
        medicaoService.listar(null, StatusMedicao.SUCESSO, null, null, pagina);
        medicaoService.listar(null, StatusMedicao.FALHA, null, null, pagina);
        medicaoService.listar(null, null, Instant.parse("2026-08-19T00:00:00Z"), null, pagina);
        medicaoService.listar(null, null, null, Instant.parse("2026-08-20T00:00:00Z"), pagina);
    }

    private CreateMedicaoRequest requisicao(StatusMedicao status, Integer latencia) {
        return new CreateMedicaoRequest(1L, status, latencia, " resposta ", Instant.parse("2026-08-19T12:00:00Z"));
    }

    private Monitor monitor() {
        Equipamento equipamento = new Equipamento(new Unidade("Matriz", "MTZ", null),
                new TipoEquipamento("Switch", null), "SW-01", null, null, null, null);
        definirId(equipamento, 10L);
        Monitor monitor = new Monitor(equipamento, TipoMonitor.ICMP, "ICMP principal", 60, 2000);
        definirId(monitor, 1L);
        return monitor;
    }

    private void definirId(Object entidade, Long id) {
        ReflectionTestUtils.setField(entidade, "id", id);
    }
}
