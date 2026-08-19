package br.com.inframonitor.dashboard.dto;

import java.time.Instant;

public record DashboardResumoResponse(Unidades unidades, Equipamentos equipamentos, Monitores monitores,
                                      Incidentes incidentes, Instant geradoEm) {
    public record Unidades(long total) { }
    public record Equipamentos(long total, long ativos, long disponiveis, long indisponiveis, long semDados,
                               long semMonitoramento) { }
    public record Monitores(long total, long ativos, long disponiveis, long indisponiveis, long semDados) { }
    public record Incidentes(long abertos) { }
}
