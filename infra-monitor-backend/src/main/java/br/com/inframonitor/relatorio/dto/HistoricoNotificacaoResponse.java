package br.com.inframonitor.relatorio.dto;
import java.time.Instant;
public record HistoricoNotificacaoResponse(Long notificacaoId, Long incidenteId, String canal, String tipoEvento,
        String status, int tentativas, Instant enviadoEm, String erro, Instant createdAt) { }
