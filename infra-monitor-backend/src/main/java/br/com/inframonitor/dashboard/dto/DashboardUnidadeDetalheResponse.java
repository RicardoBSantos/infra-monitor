package br.com.inframonitor.dashboard.dto;

import br.com.inframonitor.dashboard.StatusOperacionalUnidade;

public record DashboardUnidadeDetalheResponse(Long id, String nome, String codigoIbge, boolean ativo, StatusOperacionalUnidade status,
                                              Equipamentos equipamentos, Monitores monitores, long incidentesAbertos) {
    public record Equipamentos(long total, long ativos, long disponiveis, long degradados, long indisponiveis,
                               long semDados, long semMonitoramento, long emManutencao) { }
    public record Monitores(long ativos, long indisponiveis) { }
}
