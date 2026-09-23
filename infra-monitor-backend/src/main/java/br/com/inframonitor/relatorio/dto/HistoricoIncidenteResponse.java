package br.com.inframonitor.relatorio.dto;
import java.time.Instant;
public record HistoricoIncidenteResponse(Long incidenteId, Long unidadeId, String unidadeNome, Long equipamentoId,
        String equipamentoNome, Long monitorId, String monitorNome, String tipoMonitor, String status,
        Instant iniciadoEm, Instant encerradoEm, long duracaoSegundosNoPeriodo, String motivo, String observacao,
        String motivoEncerramento) { }
