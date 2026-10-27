package br.com.inframonitor.notificacao.dto;

/** Janela de manutencao agendada que originou o aviso; o nome da unidade evita uma segunda consulta na tela. */
public record ManutencaoNotificacaoResponse(Long id, String unidadeNome) {
}
