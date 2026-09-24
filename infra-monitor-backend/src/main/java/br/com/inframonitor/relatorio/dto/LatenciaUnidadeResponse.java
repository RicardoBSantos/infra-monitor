package br.com.inframonitor.relatorio.dto;
import java.math.BigDecimal;
import java.time.Instant;
/** Latencia ICMP agregada por unidade. Sem campos de monitor ou equipamento: a agregacao ja consumiu esse nivel. */
public record LatenciaUnidadeResponse(Long unidadeId, String unidadeNome, Instant inicio, Instant fim,
        Integer minLatenciaMs, BigDecimal avgLatenciaMs, Integer maxLatenciaMs, long count) { }
