package br.com.inframonitor.dashboard.dto;

import br.com.inframonitor.dashboard.StatusOperacionalUnidade;

public record DashboardUnidadeDetalheResponse(Long id, String nome, boolean ativo, StatusOperacionalUnidade status,
                                              Equipamentos equipamentos, Monitores monitores, long incidentesAbertos) {
    public record Equipamentos(long total, long ativos, long disponiveis, long indisponiveis, long semDados,
                               long semMonitoramento) { }
    public record Monitores(long ativos, long indisponiveis) { }
}
