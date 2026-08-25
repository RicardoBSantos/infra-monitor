package br.com.inframonitor.dashboard;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class OperationalStatusResolverTest {
    @Test void resolveStatusDeMonitorComPrecedenciaEConfiandoNoIncidente() {
        assertThat(OperationalStatusResolver.monitor(false, true, true)).isEqualTo(StatusOperacionalMonitor.DESABILITADO);
        assertThat(OperationalStatusResolver.monitor(true, false, false)).isEqualTo(StatusOperacionalMonitor.SEM_DADOS);
        assertThat(OperationalStatusResolver.monitor(true, true, true)).isEqualTo(StatusOperacionalMonitor.INDISPONIVEL);
        // Uma FALHA isolada ainda possui medicao; sem incidente aberto, nao e indisponibilidade.
        assertThat(OperationalStatusResolver.monitor(true, false, true)).isEqualTo(StatusOperacionalMonitor.DISPONIVEL);
    }

    @Test void resolveStatusDeEquipamento() {
        assertThat(OperationalStatusResolver.equipamento(false, List.of(StatusOperacionalMonitor.INDISPONIVEL))).isEqualTo(StatusOperacionalEquipamento.DESABILITADO);
        assertThat(OperationalStatusResolver.equipamento(true, List.of())).isEqualTo(StatusOperacionalEquipamento.SEM_MONITORAMENTO);
        assertThat(OperationalStatusResolver.equipamento(true, List.of(StatusOperacionalMonitor.SEM_DADOS))).isEqualTo(StatusOperacionalEquipamento.SEM_DADOS);
        assertThat(OperationalStatusResolver.equipamento(true, List.of(StatusOperacionalMonitor.DISPONIVEL, StatusOperacionalMonitor.SEM_DADOS))).isEqualTo(StatusOperacionalEquipamento.DISPONIVEL);
        assertThat(OperationalStatusResolver.equipamento(true, List.of(StatusOperacionalMonitor.DISPONIVEL, StatusOperacionalMonitor.INDISPONIVEL))).isEqualTo(StatusOperacionalEquipamento.INDISPONIVEL);
    }

    @Test void resolveStatusDeUnidade() {
        assertThat(OperationalStatusResolver.unidade(List.of())).isEqualTo(StatusOperacionalUnidade.SEM_EQUIPAMENTOS);
        assertThat(OperationalStatusResolver.unidade(List.of(StatusOperacionalEquipamento.SEM_MONITORAMENTO))).isEqualTo(StatusOperacionalUnidade.SEM_DADOS);
        assertThat(OperationalStatusResolver.unidade(List.of(StatusOperacionalEquipamento.SEM_DADOS))).isEqualTo(StatusOperacionalUnidade.SEM_DADOS);
        assertThat(OperationalStatusResolver.unidade(List.of(StatusOperacionalEquipamento.DISPONIVEL))).isEqualTo(StatusOperacionalUnidade.DISPONIVEL);
        assertThat(OperationalStatusResolver.unidade(List.of(StatusOperacionalEquipamento.DISPONIVEL, StatusOperacionalEquipamento.INDISPONIVEL))).isEqualTo(StatusOperacionalUnidade.DEGRADADA);
        assertThat(OperationalStatusResolver.unidade(List.of(StatusOperacionalEquipamento.INDISPONIVEL))).isEqualTo(StatusOperacionalUnidade.INDISPONIVEL);
    }
}
