package br.com.inframonitor.dashboard.dto;

import java.time.Instant;

/**
 * Linha da tela unificada de Incidentes: composicao de LEITURA sobre {@code incidente} e
 * {@code monitor_episodio_latencia}. O schema continua separado; nada aqui grava.
 *
 * <p>{@code tipo} e o discriminador da origem e {@code id} e o id na tabela de origem —
 * as duas sequencias sao independentes e colidem, entao id sozinho nao identifica linha.
 * {@code severidade} e derivada de {@code tipo}, sem coluna persistida: sai do backend
 * apenas para que filtro e ordenacao continuem server-side.
 */
public record DashboardIncidenteResponse(
        String tipo,
        Long id,
        String severidade,
        String status,
        Instant iniciadoEm,
        Instant encerradoEm,
        String motivo,
        Integer limiarMs,
        Instant reconhecidoEm,
        String reconhecidoPorNome,
        Long monitorId, String monitorNome,
        Long equipamentoId, String equipamentoNome,
        Long unidadeId, String unidadeNome,
        String notificacaoCanal,
        String notificacaoStatus,
        Instant notificacaoEnviadoEm) {
}
