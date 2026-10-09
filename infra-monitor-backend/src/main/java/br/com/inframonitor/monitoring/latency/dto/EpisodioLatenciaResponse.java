package br.com.inframonitor.monitoring.latency.dto;

import br.com.inframonitor.monitoring.latency.MotivoEncerramentoEpisodio;

import java.time.Instant;

/**
 * Leitura de um episodio de latencia. {@code encerradoEm} nulo significa episodio em
 * curso — o mesmo "Aberto" do incidente, no vocabulario da tela unificada.
 *
 * <p>{@code ciclosParaEpisodio} e o N de medicoes consecutivas que abre o episodio e o N
 * que o fecha. Nao mora na tabela: e configuracao global ({@code monitoring.latencia-ciclos}),
 * lida na consulta — mesmo criterio do incidente, cujo N sai da configuracao vigente do
 * monitor e nao de uma copia gravada na linha.
 *
 * <p>{@code motivoEncerramento} nulo em episodio aberto ou encerrado antes da V19 (sem
 * backfill, ver V19).
 */
public record EpisodioLatenciaResponse(Long id,
                                       Long monitorId, String monitorNome,
                                       Long equipamentoId, String equipamentoNome,
                                       Long unidadeId, String unidadeNome,
                                       Instant iniciadoEm, Instant encerradoEm, int limiarMs,
                                       int ciclosParaEpisodio,
                                       MotivoEncerramentoEpisodio motivoEncerramento) {
}
