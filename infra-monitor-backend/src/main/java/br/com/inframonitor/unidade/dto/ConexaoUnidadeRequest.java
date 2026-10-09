package br.com.inframonitor.unidade.dto;

import jakarta.validation.constraints.NotNull;

/**
 * Corpo de PUT /unidades/{id}/conexao.
 *
 * A conexao tem endpoint proprio em vez de entrar em UpdateUnidadeRequest porque no PUT da
 * unidade null significa "preserva o valor atual", e nao existe "numero vazio" equivalente a
 * string vazia. Pelo PUT seria possivel definir um hub, nunca desconectar -- a opcao "Nenhuma"
 * da tela nao gravaria, em silencio. Desconectar e DELETE no mesmo recurso.
 */
public record ConexaoUnidadeRequest(@NotNull Long conectaAUnidadeId) {
}
