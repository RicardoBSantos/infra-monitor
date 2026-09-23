package br.com.inframonitor.incidente.dto;

import br.com.inframonitor.incidente.entity.MotivoEncerramentoIncidente;
import br.com.inframonitor.incidente.entity.StatusIncidente;

import java.time.Instant;

/**
 * {@code reconhecidoEm} e {@code reconhecidoPorNome} vem preenchidos a partir do
 * reconhecimento e sobrevivem ao fechamento — um incidente FECHADO que passou por
 * RECONHECIDO mantem a trilha de quem assumiu.
 *
 * <p>{@code fechadoPorNome} nulo num incidente FECHADO significa fechamento
 * automatico pelo motor, nao ausencia de dado: so o caminho humano tem autor.
 *
 * <p>{@code motivoEncerramento} nulo e valor legitimo: incidente fechado antes da
 * V19, nao classificavel. Distingue os tres caminhos de encerramento — recuperacao
 * do motor, fechamento manual e entrada em manutencao — pois a duracao de um
 * incidente encerrado por manutencao termina no clique, nao numa recuperacao medida.
 */
public record IncidenteResponse(Long id, StatusIncidente status, Instant iniciadoEm,
                                Instant encerradoEm, String motivo, String observacao,
                                Instant reconhecidoEm, String reconhecidoPorNome, String fechadoPorNome,
                                MonitorIncidenteResponse monitor, Instant createdAt, Instant updatedAt,
                                MotivoEncerramentoIncidente motivoEncerramento) {
}
