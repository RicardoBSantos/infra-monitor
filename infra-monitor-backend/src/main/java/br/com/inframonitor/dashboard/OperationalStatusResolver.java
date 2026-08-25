package br.com.inframonitor.dashboard;

import java.util.Collection;

/** Regras puras de leitura; o Incident Engine e a fonte de indisponibilidade. */
public final class OperationalStatusResolver {
    private OperationalStatusResolver() { }

    public static StatusOperacionalMonitor monitor(boolean ativo, boolean possuiIncidenteAberto, boolean possuiMedicao) {
        if (!ativo) return StatusOperacionalMonitor.DESABILITADO;
        if (possuiIncidenteAberto) return StatusOperacionalMonitor.INDISPONIVEL;
        if (!possuiMedicao) return StatusOperacionalMonitor.SEM_DADOS;
        return StatusOperacionalMonitor.DISPONIVEL;
    }

    public static StatusOperacionalEquipamento equipamento(boolean ativo,
                                                             Collection<StatusOperacionalMonitor> statusMonitores) {
        if (!ativo) return StatusOperacionalEquipamento.DESABILITADO;
        var ativos = statusMonitores.stream().filter(s -> s != StatusOperacionalMonitor.DESABILITADO).toList();
        if (ativos.isEmpty()) return StatusOperacionalEquipamento.SEM_MONITORAMENTO;
        if (ativos.contains(StatusOperacionalMonitor.INDISPONIVEL)) return StatusOperacionalEquipamento.INDISPONIVEL;
        if (ativos.stream().allMatch(s -> s == StatusOperacionalMonitor.SEM_DADOS)) return StatusOperacionalEquipamento.SEM_DADOS;
        return StatusOperacionalEquipamento.DISPONIVEL;
    }

    public static StatusOperacionalUnidade unidade(Collection<StatusOperacionalEquipamento> statusEquipamentos) {
        var ativos = statusEquipamentos.stream().filter(s -> s != StatusOperacionalEquipamento.DESABILITADO).toList();
        if (ativos.isEmpty()) return StatusOperacionalUnidade.SEM_EQUIPAMENTOS;
        var monitorados = ativos.stream().filter(s -> s != StatusOperacionalEquipamento.SEM_MONITORAMENTO).toList();
        if (monitorados.isEmpty()) return StatusOperacionalUnidade.SEM_DADOS;
        if (monitorados.stream().allMatch(s -> s == StatusOperacionalEquipamento.INDISPONIVEL)) return StatusOperacionalUnidade.INDISPONIVEL;
        if (monitorados.contains(StatusOperacionalEquipamento.INDISPONIVEL)) return StatusOperacionalUnidade.DEGRADADA;
        if (monitorados.stream().allMatch(s -> s == StatusOperacionalEquipamento.SEM_DADOS)) return StatusOperacionalUnidade.SEM_DADOS;
        return StatusOperacionalUnidade.DISPONIVEL;
    }
}
