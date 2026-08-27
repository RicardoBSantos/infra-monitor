package br.com.inframonitor.relatorio.pdf;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

/** Modelo imutavel e explicitamente desacoplado de entidades JPA. */
public record VisaoGeralPdfModel(
        Instant inicio,
        Instant fim,
        Instant geradoEm,
        Kpis kpis,
        List<Unidade> unidades,
        List<Equipamento> equipamentos,
        List<Latencia> latencias) {

    public VisaoGeralPdfModel {
        unidades = List.copyOf(unidades);
        equipamentos = List.copyOf(equipamentos);
        latencias = List.copyOf(latencias);
    }

    public record Kpis(long incidentesAbertos, long medicoesComFalha, long notificacoesComFalha) { }

    public record Unidade(String nome, BigDecimal disponibilidadePercentual, String estadoAnalitico,
                           long incidentes) { }

    public record Equipamento(String nome, String unidade, String monitor, BigDecimal disponibilidadePercentual,
                              String estadoAnalitico, String qualidadeJanela, long incidentes) { }

    public record Latencia(String monitor, String equipamento, String unidade, Integer minLatenciaMs,
                           BigDecimal avgLatenciaMs, Integer maxLatenciaMs, Integer p95LatenciaMs,
                           long amostras) { }
}
