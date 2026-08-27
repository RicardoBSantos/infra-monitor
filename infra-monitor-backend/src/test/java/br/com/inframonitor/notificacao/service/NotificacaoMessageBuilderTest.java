package br.com.inframonitor.notificacao.service;

import br.com.inframonitor.equipamento.entity.Equipamento;
import br.com.inframonitor.incidente.entity.Incidente;
import br.com.inframonitor.monitor.entity.Monitor;
import br.com.inframonitor.monitor.entity.TipoMonitor;
import br.com.inframonitor.notificacao.entity.TipoEventoNotificacao;
import br.com.inframonitor.tipoequipamento.entity.TipoEquipamento;
import br.com.inframonitor.unidade.entity.Unidade;
import org.junit.jupiter.api.Test;

import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;

class NotificacaoMessageBuilderTest {
    private final NotificacaoMessageBuilder builder = new NotificacaoMessageBuilder();

    @Test
    void montaMensagemDeAberturaComDadosReaisEMotivo() {
        String message = builder.construir(incidente(), TipoEventoNotificacao.INCIDENTE_ABERTO);
        assertThat(message).contains("INCIDENTE ABERTO", "Unidade: Matriz", "Equipamento: SW-01",
                "Monitor: ICMP principal", "Motivo: indisponibilidade");
    }

    @Test
    void montaMensagemDeFechamentoComDuracaoDosTimestamps() {
        Incidente incidente = incidente();
        incidente.fechar(Instant.parse("2026-08-19T13:02:03Z"), null);
        String message = builder.construir(incidente, TipoEventoNotificacao.INCIDENTE_FECHADO);
        assertThat(message).contains("INCIDENTE ENCERRADO", "Fim: 2026-08-19T13:02:03Z", "Duracao: 1h 2m 3s");
    }

    private Incidente incidente() {
        Unidade unidade = new Unidade("Matriz", "MTZ", null);
        Equipamento equipamento = new Equipamento(unidade, new TipoEquipamento("Switch", null), "SW-01", null, null, null, null);
        Monitor monitor = new Monitor(equipamento, TipoMonitor.ICMP, "ICMP principal", 60, 2_000);
        return new Incidente(monitor, Instant.parse("2026-08-19T12:00:00Z"), "indisponibilidade", null);
    }
}
