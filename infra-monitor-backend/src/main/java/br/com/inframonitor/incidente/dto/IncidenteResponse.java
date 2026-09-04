package br.com.inframonitor.incidente.dto;

import br.com.inframonitor.incidente.entity.StatusIncidente;

import java.time.Instant;

/**
 * {@code reconhecidoEm} e {@code reconhecidoPorNome} vem preenchidos a partir do
 * reconhecimento e sobrevivem ao fechamento — um incidente FECHADO que passou por
 * RECONHECIDO mantem a trilha de quem assumiu.
 *
 * <p>{@code fechadoPorNome} nulo num incidente FECHADO significa fechamento
 * automatico pelo motor, nao ausencia de dado: so o caminho humano tem autor.
 */
public record IncidenteResponse(Long id, StatusIncidente status, Instant iniciadoEm,
                                Instant encerradoEm, String motivo, String observacao,
                                Instant reconhecidoEm, String reconhecidoPorNome, String fechadoPorNome,
                                MonitorIncidenteResponse monitor, Instant createdAt, Instant updatedAt) {
}
