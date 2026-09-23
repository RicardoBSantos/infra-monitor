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
 *
 * <p>{@code motivoEncerramento} so vem preenchido em linha de incidente; episodio de
 * latencia tem coluna propria no banco mas esta projecao nao a expoe ainda. Nulo e o
 * caso comum, nao excecao: incidente fechado antes da V19 nunca teve a coluna
 * classificada, e a maior parte do historico continua assim.
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
        String motivoEncerramento,
        Long monitorId, String monitorNome,
        Long equipamentoId, String equipamentoNome,
        Long unidadeId, String unidadeNome,
        String notificacaoCanal,
        String notificacaoStatus,
        Instant notificacaoEnviadoEm) {
}
