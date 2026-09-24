package br.com.inframonitor.monitoring.latency;

import br.com.inframonitor.equipamento.entity.Equipamento;
import br.com.inframonitor.incidente.entity.Incidente;
import br.com.inframonitor.incidente.entity.StatusIncidente;
import br.com.inframonitor.incidente.repository.IncidenteRepository;
import br.com.inframonitor.medicao.entity.Medicao;
import br.com.inframonitor.medicao.entity.StatusMedicao;
import br.com.inframonitor.medicao.repository.MedicaoRepository;
import br.com.inframonitor.monitor.entity.Monitor;
import br.com.inframonitor.monitor.entity.TipoMonitor;
import br.com.inframonitor.monitoring.config.LimiteDeEsperaPorLock;
import br.com.inframonitor.notificacao.service.NotificacaoService;
import br.com.inframonitor.tipoequipamento.entity.TipoEquipamento;
import br.com.inframonitor.unidade.entity.Unidade;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.Pageable;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class LatencyEpisodeProcessorTest {
    private static final Instant T0 = Instant.parse("2026-08-19T12:00:00Z");
    private static final int LIMIAR = 250;
    private static final int CICLOS = 2;

    @Mock private MedicaoRepository medicaoRepository;
    @Mock private IncidenteRepository incidenteRepository;
    @Mock private MonitorEpisodioLatenciaRepository episodioRepository;
    @Mock private NotificacaoService notificacaoService;

    private LatencyEpisodeProcessor processor() {
        return new LatencyEpisodeProcessor(medicaoRepository, incidenteRepository, episodioRepository,
                notificacaoService, LIMIAR, CICLOS, mock(LimiteDeEsperaPorLock.class));
    }

    @Test void abreEpisodioNoSegundoCicloAcimaDoLimiarComInicioNaPrimeiraDegradada() {
        Monitor monitor = monitor();
        Medicao primeira = medicao(monitor, 1L, StatusMedicao.SUCESSO, 300, T0);
        Medicao segunda = medicao(monitor, 2L, StatusMedicao.SUCESSO, 310, T0.plusSeconds(60));
        prepararAtual(segunda);
        // Primeira chamada (checagem no topo de process()) sem episodio aberto; segunda
        // chamada (releitura apos o INSERT condicional) devolve o episodio recem-criado.
        when(episodioRepository.findFirstByMonitorIdAndEncerradoEmIsNull(1L))
                .thenReturn(Optional.empty(), Optional.of(episodio(monitor)));
        when(episodioRepository.inserirSeElegivel(eq(1L), eq(T0), eq(LIMIAR), any())).thenReturn(1);
        when(medicaoRepository.findByMonitorIdOrderByExecutadoEmDescIdDesc(eq(1L), any(Pageable.class)))
                .thenReturn(List.of(segunda, primeira));

        processor().process(segunda);

        verify(episodioRepository).inserirSeElegivel(eq(1L), eq(T0), eq(LIMIAR), any());
        ArgumentCaptor<MonitorEpisodioLatencia> aberto = ArgumentCaptor.forClass(MonitorEpisodioLatencia.class);
        verify(notificacaoService).criarParaLatenciaAlta(aberto.capture());
        assertThat(aberto.getValue().getIniciadoEm()).isEqualTo(T0);
        assertThat(aberto.getValue().getLimiarMs()).isEqualTo(LIMIAR);
    }

    @Test void umUnicoCicloAcimaDoLimiarNaoAbreEpisodio() {
        Monitor monitor = monitor();
        Medicao atual = medicao(monitor, 2L, StatusMedicao.SUCESSO, 300, T0.plusSeconds(60));
        prepararAtual(atual);
        semEpisodioAberto();
        when(medicaoRepository.findByMonitorIdOrderByExecutadoEmDescIdDesc(eq(1L), any(Pageable.class)))
                .thenReturn(List.of(atual, medicao(monitor, 1L, StatusMedicao.SUCESSO, 100, T0)));

        processor().process(atual);

        verify(episodioRepository, never()).inserirSeElegivel(any(), any(), anyInt(), any());
        verify(notificacaoService, never()).criarParaLatenciaAlta(any());
    }

    @Test void falhaNaJanelaInterrompeSequenciaEnaoAbreEpisodio() {
        Monitor monitor = monitor();
        Medicao atual = medicao(monitor, 2L, StatusMedicao.SUCESSO, 300, T0.plusSeconds(60));
        prepararAtual(atual);
        semEpisodioAberto();
        // Medicao em FALHA nao tem latencia: nao conta como ciclo degradado.
        when(medicaoRepository.findByMonitorIdOrderByExecutadoEmDescIdDesc(eq(1L), any(Pageable.class)))
                .thenReturn(List.of(atual, medicao(monitor, 1L, StatusMedicao.FALHA, null, T0)));

        processor().process(atual);

        verify(episodioRepository, never()).inserirSeElegivel(any(), any(), anyInt(), any());
    }

    @Test void episodioAbertoNormalizaNoSegundoCicloDentroDoLimiar() {
        Monitor monitor = monitor();
        MonitorEpisodioLatencia episodio = episodio(monitor);
        Medicao primeira = medicao(monitor, 3L, StatusMedicao.SUCESSO, 100, T0.plusSeconds(120));
        Medicao atual = medicao(monitor, 4L, StatusMedicao.SUCESSO, 90, T0.plusSeconds(180));
        prepararAtual(atual);
        when(episodioRepository.findFirstByMonitorIdAndEncerradoEmIsNull(1L)).thenReturn(Optional.of(episodio));
        when(medicaoRepository.findByMonitorIdOrderByExecutadoEmDescIdDesc(eq(1L), any(Pageable.class)))
                .thenReturn(List.of(atual, primeira));

        processor().process(atual);

        assertThat(episodio.getEncerradoEm()).isEqualTo(atual.getExecutadoEm());
        verify(notificacaoService).criarParaLatenciaNormalizada(episodio);
    }

    @Test void incidenteAbertoEncerraEpisodioEmSilencio() {
        Monitor monitor = monitor();
        MonitorEpisodioLatencia episodio = episodio(monitor);
        Medicao atual = medicao(monitor, 5L, StatusMedicao.FALHA, null, T0.plusSeconds(240));
        when(medicaoRepository.findFirstByMonitorIdOrderByExecutadoEmDescIdDesc(1L)).thenReturn(Optional.of(atual));
        when(episodioRepository.findFirstByMonitorIdAndEncerradoEmIsNull(1L)).thenReturn(Optional.of(episodio));
        when(incidenteRepository.findFirstByMonitorIdAndStatusInOrderByIniciadoEmDescIdDesc(1L, StatusIncidente.EM_ABERTO))
                .thenReturn(Optional.of(incidente(monitor)));

        processor().process(atual);

        assertThat(episodio.getEncerradoEm()).isEqualTo(atual.getExecutadoEm());
        // Nao normalizou, piorou: nenhuma notificacao de latencia deve sair.
        verify(notificacaoService, never()).criarParaLatenciaNormalizada(any());
        verify(notificacaoService, never()).criarParaLatenciaAlta(any());
    }

    @Test void medicaoAtrasadaNaoAlteraEpisodio() {
        Monitor monitor = monitor();
        Medicao atrasada = medicao(monitor, 1L, StatusMedicao.SUCESSO, 300, T0);
        Medicao maisRecente = medicao(monitor, 2L, StatusMedicao.SUCESSO, 300, T0.plusSeconds(60));
        when(medicaoRepository.findFirstByMonitorIdOrderByExecutadoEmDescIdDesc(1L)).thenReturn(Optional.of(maisRecente));

        processor().process(atrasada);

        verify(episodioRepository, never()).findFirstByMonitorIdAndEncerradoEmIsNull(any());
        verify(episodioRepository, never()).saveAndFlush(any());
    }

    private void prepararAtual(Medicao atual) {
        when(medicaoRepository.findFirstByMonitorIdOrderByExecutadoEmDescIdDesc(1L)).thenReturn(Optional.of(atual));
        when(incidenteRepository.findFirstByMonitorIdAndStatusInOrderByIniciadoEmDescIdDesc(1L, StatusIncidente.EM_ABERTO))
                .thenReturn(Optional.empty());
    }

    private void semEpisodioAberto() {
        when(episodioRepository.findFirstByMonitorIdAndEncerradoEmIsNull(1L)).thenReturn(Optional.empty());
    }

    private Monitor monitor() {
        Equipamento equipamento = new Equipamento(new Unidade("Matriz", "MTZ", null), new TipoEquipamento("Switch", null), "SW", null, null, null, null, null);
        Monitor monitor = new Monitor(equipamento, TipoMonitor.ICMP, "ICMP", 60, 2000, 3, 2);
        ReflectionTestUtils.setField(monitor, "id", 1L);
        return monitor;
    }

    private Medicao medicao(Monitor monitor, Long id, StatusMedicao status, Integer latenciaMs, Instant quando) {
        Medicao medicao = new Medicao(monitor, status, latenciaMs, null, quando);
        ReflectionTestUtils.setField(medicao, "id", id);
        return medicao;
    }

    private MonitorEpisodioLatencia episodio(Monitor monitor) {
        MonitorEpisodioLatencia episodio = new MonitorEpisodioLatencia(monitor, T0, LIMIAR);
        ReflectionTestUtils.setField(episodio, "id", 20L);
        return episodio;
    }

    private Incidente incidente(Monitor monitor) {
        Incidente incidente = new Incidente(monitor, T0, "motivo", null);
        ReflectionTestUtils.setField(incidente, "id", 10L);
        return incidente;
    }
}
