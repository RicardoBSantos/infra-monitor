package br.com.inframonitor.relatorio.dto;

import br.com.inframonitor.relatorio.temporal.EstadoAnalitico;
import java.math.BigDecimal;
import java.time.Instant;

public record DisponibilidadeUnidadeResponse(Long unidadeId, String unidadeNome, Instant inicio, Instant fim,
        EstadoAnalitico estadoAnalitico, long equipamentosTotal, long equipamentosMonitorados,
        long equipamentosSemMonitoramento, long equipamentosSemDados, Long tempoMonitoradoSegundos,
        Long tempoIndisponivelSegundos, Long tempoDisponivelSegundos, BigDecimal disponibilidadePercentual,
        long incidentes) { }
