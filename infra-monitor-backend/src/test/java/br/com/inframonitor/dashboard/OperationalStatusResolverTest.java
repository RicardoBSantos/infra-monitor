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

    @Test void marcaMonitorComoDegradadoAcimaDoLimiarDeLatencia() {
        assertThat(OperationalStatusResolver.monitor(true, false, true, 250, 250)).isEqualTo(StatusOperacionalMonitor.DISPONIVEL);
        assertThat(OperationalStatusResolver.monitor(true, false, true, 251, 250)).isEqualTo(StatusOperacionalMonitor.DEGRADADO);
        // Incidente aberto vence latencia: indisponivel nao e "lento".
        assertThat(OperationalStatusResolver.monitor(true, true, true, 900, 250)).isEqualTo(StatusOperacionalMonitor.INDISPONIVEL);
        // Medicao de falha nao tem latencia; sem incidente aberto continua disponivel.
        assertThat(OperationalStatusResolver.monitor(true, false, true, null, 250)).isEqualTo(StatusOperacionalMonitor.DISPONIVEL);
    }

    @Test void resolveStatusDeEquipamento() {
        assertThat(OperationalStatusResolver.equipamento(false, List.of(StatusOperacionalMonitor.INDISPONIVEL))).isEqualTo(StatusOperacionalEquipamento.DESABILITADO);
        assertThat(OperationalStatusResolver.equipamento(true, List.of())).isEqualTo(StatusOperacionalEquipamento.SEM_MONITORAMENTO);
        assertThat(OperationalStatusResolver.equipamento(true, List.of(StatusOperacionalMonitor.SEM_DADOS))).isEqualTo(StatusOperacionalEquipamento.SEM_DADOS);
        assertThat(OperationalStatusResolver.equipamento(true, List.of(StatusOperacionalMonitor.DISPONIVEL, StatusOperacionalMonitor.SEM_DADOS))).isEqualTo(StatusOperacionalEquipamento.DISPONIVEL);
        assertThat(OperationalStatusResolver.equipamento(true, List.of(StatusOperacionalMonitor.DISPONIVEL, StatusOperacionalMonitor.INDISPONIVEL))).isEqualTo(StatusOperacionalEquipamento.INDISPONIVEL);
        assertThat(OperationalStatusResolver.equipamento(true, List.of(StatusOperacionalMonitor.DISPONIVEL, StatusOperacionalMonitor.DEGRADADO))).isEqualTo(StatusOperacionalEquipamento.DEGRADADO);
        // Indisponibilidade tem precedencia sobre degradacao.
        assertThat(OperationalStatusResolver.equipamento(true, List.of(StatusOperacionalMonitor.DEGRADADO, StatusOperacionalMonitor.INDISPONIVEL))).isEqualTo(StatusOperacionalEquipamento.INDISPONIVEL);
        // Manutencao planejada suprime a degradacao.
        assertThat(OperationalStatusResolver.equipamento(true, true, List.of(StatusOperacionalMonitor.DEGRADADO))).isEqualTo(StatusOperacionalEquipamento.EM_MANUTENCAO);
    }

    @Test void resolveStatusDeUnidade() {
        assertThat(OperationalStatusResolver.unidade(List.of())).isEqualTo(StatusOperacionalUnidade.SEM_EQUIPAMENTOS);
        assertThat(OperationalStatusResolver.unidade(List.of(StatusOperacionalEquipamento.SEM_MONITORAMENTO))).isEqualTo(StatusOperacionalUnidade.SEM_DADOS);
        assertThat(OperationalStatusResolver.unidade(List.of(StatusOperacionalEquipamento.SEM_DADOS))).isEqualTo(StatusOperacionalUnidade.SEM_DADOS);
        assertThat(OperationalStatusResolver.unidade(List.of(StatusOperacionalEquipamento.DISPONIVEL))).isEqualTo(StatusOperacionalUnidade.DISPONIVEL);
        assertThat(OperationalStatusResolver.unidade(List.of(StatusOperacionalEquipamento.DISPONIVEL, StatusOperacionalEquipamento.INDISPONIVEL))).isEqualTo(StatusOperacionalUnidade.DEGRADADA);
        assertThat(OperationalStatusResolver.unidade(List.of(StatusOperacionalEquipamento.INDISPONIVEL))).isEqualTo(StatusOperacionalUnidade.INDISPONIVEL);
        // Latencia alta e indisponibilidade parcial convergem para DEGRADADA.
        assertThat(OperationalStatusResolver.unidade(List.of(StatusOperacionalEquipamento.DISPONIVEL, StatusOperacionalEquipamento.DEGRADADO))).isEqualTo(StatusOperacionalUnidade.DEGRADADA);
    }

    /** Manutencao nunca ganha de degradado nem de offline; so vence quando nao sobra leitura operacional. */
    @Test void resolveStatusDeUnidadeEmManutencao() {
        var manutencao = StatusOperacionalEquipamento.EM_MANUTENCAO;
        assertThat(OperationalStatusResolver.unidade(List.of(manutencao))).isEqualTo(StatusOperacionalUnidade.EM_MANUTENCAO);
        assertThat(OperationalStatusResolver.unidade(List.of(manutencao, StatusOperacionalEquipamento.SEM_MONITORAMENTO))).isEqualTo(StatusOperacionalUnidade.EM_MANUTENCAO);
        assertThat(OperationalStatusResolver.unidade(List.of(manutencao, StatusOperacionalEquipamento.DESABILITADO))).isEqualTo(StatusOperacionalUnidade.EM_MANUTENCAO);
        // SEM_DADOS ganha de manutencao: ausencia inesperada de leitura exige acao.
        assertThat(OperationalStatusResolver.unidade(List.of(manutencao, StatusOperacionalEquipamento.SEM_DADOS))).isEqualTo(StatusOperacionalUnidade.SEM_DADOS);
        // Regressao: manutencao parcial nao altera o estado derivado dos equipamentos ainda monitorados.
        assertThat(OperationalStatusResolver.unidade(List.of(manutencao, StatusOperacionalEquipamento.INDISPONIVEL))).isEqualTo(StatusOperacionalUnidade.INDISPONIVEL);
        assertThat(OperationalStatusResolver.unidade(List.of(manutencao, StatusOperacionalEquipamento.DISPONIVEL, StatusOperacionalEquipamento.INDISPONIVEL))).isEqualTo(StatusOperacionalUnidade.DEGRADADA);
        assertThat(OperationalStatusResolver.unidade(List.of(manutencao, StatusOperacionalEquipamento.DEGRADADO))).isEqualTo(StatusOperacionalUnidade.DEGRADADA);
        assertThat(OperationalStatusResolver.unidade(List.of(manutencao, StatusOperacionalEquipamento.DISPONIVEL))).isEqualTo(StatusOperacionalUnidade.DISPONIVEL);
        // Sem nenhum equipamento em manutencao o comportamento anterior permanece.
        assertThat(OperationalStatusResolver.unidade(List.of(StatusOperacionalEquipamento.SEM_MONITORAMENTO))).isEqualTo(StatusOperacionalUnidade.SEM_DADOS);
    }
}
