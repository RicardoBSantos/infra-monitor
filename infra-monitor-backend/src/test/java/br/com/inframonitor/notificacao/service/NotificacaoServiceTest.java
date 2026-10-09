package br.com.inframonitor.notificacao.service;

import br.com.inframonitor.common.exception.RecursoNaoEncontradoException;
import br.com.inframonitor.equipamento.entity.Equipamento;
import br.com.inframonitor.incidente.entity.Incidente;
import br.com.inframonitor.incidente.entity.StatusIncidente;
import br.com.inframonitor.monitor.entity.Monitor;
import br.com.inframonitor.monitor.entity.TipoMonitor;
import br.com.inframonitor.monitoring.latency.MonitorEpisodioLatencia;
import br.com.inframonitor.notificacao.entity.CanalNotificacao;
import br.com.inframonitor.notificacao.entity.Notificacao;
import br.com.inframonitor.notificacao.entity.StatusNotificacao;
import br.com.inframonitor.notificacao.entity.TipoEventoNotificacao;
import br.com.inframonitor.notificacao.repository.NotificacaoRepository;
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

@ExtendWith(MockitoExtension.class)
class NotificacaoServiceTest {
    private static final Instant INICIO = Instant.parse("2026-08-19T12:00:00Z");

    @Mock private NotificacaoRepository notificacaoRepository;
    @Mock private NotificacaoMessageBuilder messageBuilder;
    @InjectMocks private NotificacaoService notificacaoService;

    @Test
    void criaNotificacoesPendentesParaAberturaEFechamento() {
        Incidente incidente = incidente();
        when(messageBuilder.construir(any(), any())).thenReturn("snapshot");

        notificacaoService.criarParaIncidenteAberto(incidente);
        notificacaoService.criarParaIncidenteFechado(incidente);

        ArgumentCaptor<String> tipoEvento = ArgumentCaptor.forClass(String.class);
        verify(notificacaoRepository, org.mockito.Mockito.times(2)).inserirPendenteSeAusente(
                org.mockito.ArgumentMatchers.eq(10L), org.mockito.ArgumentMatchers.isNull(),
                org.mockito.ArgumentMatchers.eq(CanalNotificacao.TELEGRAM.name()), tipoEvento.capture(),
                org.mockito.ArgumentMatchers.eq("snapshot"), any(Instant.class));
        assertThat(tipoEvento.getAllValues()).containsExactly(
                TipoEventoNotificacao.INCIDENTE_ABERTO.name(), TipoEventoNotificacao.INCIDENTE_FECHADO.name());
    }

    @Test
    void eventoDeLatenciaUsaAAncoraDoEpisodioEDeixaOIncidenteNulo() {
        MonitorEpisodioLatencia episodio = episodio();
        when(messageBuilder.construirParaEpisodio(any(), any())).thenReturn("latencia");

        notificacaoService.criarParaLatenciaAlta(episodio);
        notificacaoService.criarParaLatenciaNormalizada(episodio);

        ArgumentCaptor<String> tipoEvento = ArgumentCaptor.forClass(String.class);
        verify(notificacaoRepository, org.mockito.Mockito.times(2)).inserirPendenteSeAusente(
                org.mockito.ArgumentMatchers.isNull(), org.mockito.ArgumentMatchers.eq(77L),
                org.mockito.ArgumentMatchers.eq(CanalNotificacao.TELEGRAM.name()), tipoEvento.capture(),
                org.mockito.ArgumentMatchers.eq("latencia"), any(Instant.class));
        assertThat(tipoEvento.getAllValues()).containsExactly(
                TipoEventoNotificacao.LATENCIA_ALTA.name(), TipoEventoNotificacao.LATENCIA_NORMALIZADA.name());
    }

    @Test
    void buscaEListaComFiltrosEValidaPeriodo() {
        Notificacao notificacao = new Notificacao(incidente(), CanalNotificacao.TELEGRAM,
                TipoEventoNotificacao.INCIDENTE_ABERTO, "snapshot");
        ReflectionTestUtils.setField(notificacao, "id", 100L);
        when(notificacaoRepository.findById(100L)).thenReturn(Optional.of(notificacao));
        when(notificacaoRepository.findAll(org.mockito.ArgumentMatchers.<Specification<Notificacao>>any(),
                org.mockito.ArgumentMatchers.<Pageable>any()))
                .thenReturn(new PageImpl<>(List.of(notificacao)));

        assertThat(notificacaoService.buscarPorId(100L).incidente().id()).isEqualTo(10L);
        assertThat(notificacaoService.listar(10L, null, StatusNotificacao.PENDENTE, CanalNotificacao.TELEGRAM,
                TipoEventoNotificacao.INCIDENTE_ABERTO, INICIO, INICIO.plusSeconds(60), PageRequest.of(0, 20))
                .getContent()).hasSize(1);
        assertThatThrownBy(() -> notificacaoService.buscarPorId(99L)).isInstanceOf(RecursoNaoEncontradoException.class);
        assertThatThrownBy(() -> notificacaoService.listar(null, null, null, null, null, INICIO.plusSeconds(1), INICIO,
                PageRequest.of(0, 20))).isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void listaSemFiltrosEPorCadaFiltroOpcional() {
        when(notificacaoRepository.findAll(org.mockito.ArgumentMatchers.<Specification<Notificacao>>any(),
                org.mockito.ArgumentMatchers.<Pageable>any())).thenReturn(new PageImpl<>(List.of()));
        Pageable pagina = PageRequest.of(0, 20);

        notificacaoService.listar(null, null, null, null, null, null, null, pagina);
        notificacaoService.listar(10L, null, null, null, null, null, null, pagina);
        notificacaoService.listar(null, 33L, null, null, null, null, null, pagina);
        notificacaoService.listar(null, null, StatusNotificacao.PENDENTE, CanalNotificacao.TELEGRAM,
                TipoEventoNotificacao.INCIDENTE_ABERTO, INICIO, INICIO.plusSeconds(60), pagina);

        // As duas ancoras sao mutuamente exclusivas no schema; pedir as duas e erro de chamada.
        assertThatThrownBy(() -> notificacaoService.listar(10L, 33L, null, null, null, null, null, pagina))
                .isInstanceOf(IllegalArgumentException.class);
    }

    private Incidente incidente() {
        Unidade unidade = new Unidade("Matriz", "MTZ", null);
        Equipamento equipamento = new Equipamento(unidade, new TipoEquipamento("Switch", null), "SW-01", "10.0.0.10", null, null, null, null);
        Monitor monitor = new Monitor(equipamento, TipoMonitor.ICMP, "ICMP principal", 60, 2000);
        Incidente incidente = new Incidente(monitor, INICIO, "motivo", null);
        ReflectionTestUtils.setField(incidente, "id", 10L);
        return incidente;
    }

    private MonitorEpisodioLatencia episodio() {
        Unidade unidade = new Unidade("Matriz", "MTZ", null);
        Equipamento equipamento = new Equipamento(unidade, new TipoEquipamento("Switch", null), "SW-01", "10.0.0.10", null, null, null, null);
        Monitor monitor = new Monitor(equipamento, TipoMonitor.ICMP, "ICMP principal", 60, 2000);
        MonitorEpisodioLatencia episodio = new MonitorEpisodioLatencia(monitor, INICIO, 250);
        ReflectionTestUtils.setField(episodio, "id", 77L);
        return episodio;
    }
}
