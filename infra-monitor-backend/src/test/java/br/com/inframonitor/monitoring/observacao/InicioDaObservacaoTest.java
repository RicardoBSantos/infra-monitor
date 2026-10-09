package br.com.inframonitor.monitoring.observacao;

import br.com.inframonitor.incidente.repository.IncidenteRepository;
import br.com.inframonitor.relatorio.entity.JanelaMonitoramento;
import br.com.inframonitor.relatorio.repository.JanelaMonitoramentoRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class InicioDaObservacaoTest {
    private static final Instant JANELA = Instant.parse("2026-10-08T10:00:00Z");

    @Mock JanelaMonitoramentoRepository janelaRepository;
    @Mock IncidenteRepository incidenteRepository;
    @InjectMocks InicioDaObservacao inicio;

    @Test void semJanelaAbertaDevolveVazio() {
        when(janelaRepository.aberta(1L)).thenReturn(Optional.empty());
        assertThat(inicio.doMonitor(1L)).isEmpty();
    }

    @Test void semIncidenteFechadoAncoraNaJanela() {
        JanelaMonitoramento janela = janela(JANELA);
        when(janelaRepository.aberta(1L)).thenReturn(Optional.of(janela));
        when(incidenteRepository.ultimoFechamentoRegistrado(1L)).thenReturn(Optional.empty());
        assertThat(inicio.doMonitor(1L)).contains(JANELA);
    }

    @Test void fechamentoDepoisDaJanelaVenceAJanela() {
        Instant fechamento = JANELA.plusSeconds(600);
        JanelaMonitoramento janela = janela(JANELA);
        when(janelaRepository.aberta(1L)).thenReturn(Optional.of(janela));
        when(incidenteRepository.ultimoFechamentoRegistrado(1L)).thenReturn(Optional.of(fechamento));
        assertThat(inicio.doMonitor(1L)).contains(fechamento);
    }

    @Test void fechamentoAntesDaJanelaNaoRecuaAAncora() {
        JanelaMonitoramento janela = janela(JANELA);
        when(janelaRepository.aberta(1L)).thenReturn(Optional.of(janela));
        when(incidenteRepository.ultimoFechamentoRegistrado(1L)).thenReturn(Optional.of(JANELA.minusSeconds(600)));
        assertThat(inicio.doMonitor(1L)).contains(JANELA);
    }

    private JanelaMonitoramento janela(Instant inicioEm) {
        JanelaMonitoramento janela = mock(JanelaMonitoramento.class);
        when(janela.getInicioEm()).thenReturn(inicioEm);
        return janela;
    }
}
