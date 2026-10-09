package br.com.inframonitor.notificacao.dto;

import java.time.Instant;

public record EpisodioLatenciaNotificacaoResponse(Long id, Instant iniciadoEm, Instant encerradoEm, int limiarMs) {
}
