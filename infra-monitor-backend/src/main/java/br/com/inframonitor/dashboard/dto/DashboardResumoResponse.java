package br.com.inframonitor.dashboard.dto;

import java.time.Instant;

public record DashboardResumoResponse(Unidades unidades, Equipamentos equipamentos, Monitores monitores,
                                      Incidentes incidentes, int limiarLatenciaDegradadaMs, Instant geradoEm) {
    public record Unidades(long total) { }
    public record Equipamentos(long total, long ativos, long disponiveis, long degradados, long indisponiveis,
                               long semDados, long semMonitoramento, long emManutencao) { }
    public record Monitores(long total, long ativos, long disponiveis, long degradados, long indisponiveis, long semDados) { }
    public record Incidentes(long abertos) { }
}
