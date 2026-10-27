package br.com.inframonitor.equipamento.dto;

import java.time.Instant;

/**
 * Uma sessao do botao de manutencao manual. {@code iniciadaEm}, {@code iniciadaPor} e
 * {@code duracaoSegundos} sao nulos na sessao do backfill da V23 (anterior ao historico);
 * {@code encerradaEm} e nulo enquanto a sessao esta aberta.
 */
public record ManutencaoManualResponse(Long id, Instant iniciadaEm, ReferenciaResponse iniciadaPor,
                                       Instant encerradaEm, ReferenciaResponse encerradaPor,
                                       Long duracaoSegundos) {
}
