package br.com.inframonitor.relatorio.dto;

import br.com.inframonitor.relatorio.entity.OrigemJanelaMonitoramento;
import br.com.inframonitor.relatorio.temporal.EstadoAnalitico;
import java.math.BigDecimal;
import java.time.Instant;

public record DisponibilidadeEquipamentoResponse(Long equipamentoId, String equipamentoNome, Long unidadeId,
        String unidadeNome, Long monitorId, String monitorNome, String tipoMonitor, Instant inicio, Instant fim,
        EstadoAnalitico estadoAnalitico, OrigemJanelaMonitoramento qualidadeJanela, Long tempoMonitoradoSegundos,
        Long tempoIndisponivelSegundos, Long tempoDisponivelSegundos, BigDecimal disponibilidadePercentual,
        long incidentes) { }
