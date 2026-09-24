package br.com.inframonitor.dashboard;

import java.util.Collection;

/** Regras puras de leitura; o Incident Engine e a fonte de indisponibilidade. */
public final class OperationalStatusResolver {
    private OperationalStatusResolver() { }

    public static StatusOperacionalMonitor monitor(boolean ativo, boolean possuiIncidenteAberto, boolean possuiMedicao) {
        return monitor(ativo, possuiIncidenteAberto, possuiMedicao, null, null);
    }

    /**
     * Degradacao e leitura de latencia da ultima medicao, nao de indisponibilidade:
     * acima do limiar o monitor responde, mas responde mal.
     */
    public static StatusOperacionalMonitor monitor(boolean ativo, boolean possuiIncidenteAberto, boolean possuiMedicao,
                                                     Integer ultimaLatenciaMs, Integer limiarDegradadoMs) {
        if (!ativo) return StatusOperacionalMonitor.DESABILITADO;
        if (possuiIncidenteAberto) return StatusOperacionalMonitor.INDISPONIVEL;
        if (!possuiMedicao) return StatusOperacionalMonitor.SEM_DADOS;
        if (degradado(ultimaLatenciaMs, limiarDegradadoMs)) return StatusOperacionalMonitor.DEGRADADO;
        return StatusOperacionalMonitor.DISPONIVEL;
    }

    public static boolean degradado(Integer latenciaMs, Integer limiarMs) {
        return latenciaMs != null && limiarMs != null && latenciaMs > limiarMs;
    }

    public static StatusOperacionalEquipamento equipamento(boolean ativo,
                                                             Collection<StatusOperacionalMonitor> statusMonitores) {
        return equipamento(ativo, false, statusMonitores);
    }

    /** Manutencao planejada suprime a leitura operacional: o equipamento nao conta como indisponivel. */
    public static StatusOperacionalEquipamento equipamento(boolean ativo, boolean emManutencao,
                                                             Collection<StatusOperacionalMonitor> statusMonitores) {
        if (!ativo) return StatusOperacionalEquipamento.DESABILITADO;
        if (emManutencao) return StatusOperacionalEquipamento.EM_MANUTENCAO;
        var ativos = statusMonitores.stream().filter(s -> s != StatusOperacionalMonitor.DESABILITADO).toList();
        if (ativos.isEmpty()) return StatusOperacionalEquipamento.SEM_MONITORAMENTO;
        if (ativos.contains(StatusOperacionalMonitor.INDISPONIVEL)) return StatusOperacionalEquipamento.INDISPONIVEL;
        if (ativos.stream().allMatch(s -> s == StatusOperacionalMonitor.SEM_DADOS)) return StatusOperacionalEquipamento.SEM_DADOS;
        if (ativos.contains(StatusOperacionalMonitor.DEGRADADO)) return StatusOperacionalEquipamento.DEGRADADO;
        return StatusOperacionalEquipamento.DISPONIVEL;
    }

    /**
     * Precedencia da unidade, do mais grave ao menos grave:
     * SEM_EQUIPAMENTOS -> INDISPONIVEL (todos os monitorados offline) -> DEGRADADA (offline parcial ou
     * latencia acima do limiar) -> SEM_DADOS -> EM_MANUTENCAO -> DISPONIVEL.
     *
     * <p>Manutencao nunca ganha de degradado nem de offline: equipamento em manutencao e excluido da
     * leitura operacional, entao a unidade so reporta EM_MANUTENCAO quando nao sobra nenhum equipamento
     * monitorado para observar. EM_MANUTENCAO combinado com algum SEM_DADOS resolve para SEM_DADOS —
     * manutencao e ausencia deliberada de leitura, SEM_DADOS e ausencia inesperada, e e ela que exige acao.
     * Manutencao parcial nao tem estado proprio; o contador equipamentosEmManutencao do payload cobre isso.
     */
    public static StatusOperacionalUnidade unidade(Collection<StatusOperacionalEquipamento> statusEquipamentos) {
        var ativos = statusEquipamentos.stream().filter(s -> s != StatusOperacionalEquipamento.DESABILITADO).toList();
        if (ativos.isEmpty()) return StatusOperacionalUnidade.SEM_EQUIPAMENTOS;
        var monitorados = ativos.stream().filter(s -> s != StatusOperacionalEquipamento.SEM_MONITORAMENTO
                && s != StatusOperacionalEquipamento.EM_MANUTENCAO).toList();
        if (monitorados.isEmpty()) {
            return ativos.contains(StatusOperacionalEquipamento.EM_MANUTENCAO)
                    ? StatusOperacionalUnidade.EM_MANUTENCAO : StatusOperacionalUnidade.SEM_DADOS;
        }
        if (monitorados.stream().allMatch(s -> s == StatusOperacionalEquipamento.INDISPONIVEL)) return StatusOperacionalUnidade.INDISPONIVEL;
        // Indisponibilidade parcial e latencia acima do limiar convergem para o mesmo estado da unidade.
        if (monitorados.contains(StatusOperacionalEquipamento.INDISPONIVEL)) return StatusOperacionalUnidade.DEGRADADA;
        if (monitorados.stream().allMatch(s -> s == StatusOperacionalEquipamento.SEM_DADOS)) return StatusOperacionalUnidade.SEM_DADOS;
        if (monitorados.contains(StatusOperacionalEquipamento.DEGRADADO)) return StatusOperacionalUnidade.DEGRADADA;
        return StatusOperacionalUnidade.DISPONIVEL;
    }
}
