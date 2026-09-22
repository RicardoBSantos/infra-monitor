package br.com.inframonitor.incidente.entity;

import br.com.inframonitor.equipamento.entity.Equipamento;
import br.com.inframonitor.monitor.entity.Monitor;
import br.com.inframonitor.monitor.entity.TipoMonitor;
import br.com.inframonitor.tipoequipamento.entity.TipoEquipamento;
import br.com.inframonitor.unidade.entity.Unidade;
import org.junit.jupiter.api.Test;

import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;

class IncidenteTest {

    @Test
    void fecharExigeMotivoDeEncerramentoEOGrava() {
        Incidente incidente = new Incidente(monitor(), Instant.parse("2026-09-22T10:00:00Z"), "motivo de abertura", null);

        incidente.fechar(Instant.parse("2026-09-22T10:30:00Z"), null, null,
                MotivoEncerramentoIncidente.MANUTENCAO);

        assertThat(incidente.getStatus()).isEqualTo(StatusIncidente.FECHADO);
        assertThat(incidente.getMotivoEncerramento()).isEqualTo(MotivoEncerramentoIncidente.MANUTENCAO);
        // O motivo de ABERTURA nao e sobrescrito: sao perguntas diferentes.
        assertThat(incidente.getMotivo()).isEqualTo("motivo de abertura");
    }

    private Monitor monitor() {
        Unidade unidade = new Unidade("Matriz", "MTZ", null);
        Equipamento equipamento = new Equipamento(unidade, new TipoEquipamento("Switch", null), "SW-01", null, null, null, null, null);
        return new Monitor(equipamento, TipoMonitor.ICMP, "ICMP principal", 60, 2000);
    }
}
