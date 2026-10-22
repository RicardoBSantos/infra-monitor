package br.com.inframonitor.manutencao.dto;

/** O front desabilita o agendamento e limita a duracao com estes valores do servidor. */
public record ParametrosManutencaoResponse(boolean agendadorLigado, long duracaoMaximaHoras) {
}
