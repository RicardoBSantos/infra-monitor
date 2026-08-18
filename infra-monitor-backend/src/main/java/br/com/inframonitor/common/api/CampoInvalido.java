package br.com.inframonitor.common.api;

/**
 * Detalhe de um campo reprovado na validacao da requisicao.
 */
public record CampoInvalido(String campo, String mensagem) {
}
