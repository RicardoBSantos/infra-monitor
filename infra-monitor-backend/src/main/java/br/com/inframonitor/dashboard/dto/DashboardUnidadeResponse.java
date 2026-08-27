package br.com.inframonitor.dashboard.dto;

import br.com.inframonitor.dashboard.StatusOperacionalUnidade;

public record DashboardUnidadeResponse(Long id, String nome, String codigoIbge, boolean ativo, StatusOperacionalUnidade status,
                                       long equipamentosTotal, long equipamentosAtivos, long equipamentosDisponiveis,
                                       long equipamentosDegradados, long equipamentosIndisponiveis, long equipamentosSemDados,
                                       long equipamentosSemMonitoramento, long equipamentosEmManutencao,
                                       long incidentesAbertos) { }
