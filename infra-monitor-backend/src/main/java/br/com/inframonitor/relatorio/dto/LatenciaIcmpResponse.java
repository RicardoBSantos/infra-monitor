package br.com.inframonitor.relatorio.dto;
import java.math.BigDecimal;
import java.time.Instant;
public record LatenciaIcmpResponse(Long unidadeId, String unidadeNome, Long equipamentoId, String equipamentoNome,
        Long monitorId, String monitorNome, Instant inicio, Instant fim, Integer minLatenciaMs,
        BigDecimal avgLatenciaMs, Integer maxLatenciaMs, long count, Integer p95LatenciaMs) { }
