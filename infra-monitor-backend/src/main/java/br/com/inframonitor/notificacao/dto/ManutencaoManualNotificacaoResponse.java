package br.com.inframonitor.notificacao.dto;

/** Sessao do botao manual que originou o aviso. */
public record ManutencaoManualNotificacaoResponse(Long id, Long equipamentoId, String equipamentoNome) {
}
