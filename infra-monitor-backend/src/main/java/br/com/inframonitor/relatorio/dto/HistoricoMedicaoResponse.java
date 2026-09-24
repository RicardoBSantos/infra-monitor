package br.com.inframonitor.relatorio.dto;
import java.time.Instant;
public record HistoricoMedicaoResponse(Long medicaoId, Long unidadeId, String unidadeNome, Long equipamentoId,
        String equipamentoNome, Long monitorId, String monitorNome, String tipoMonitor, String status,
        Integer latenciaMs, Instant executadoEm) { }
