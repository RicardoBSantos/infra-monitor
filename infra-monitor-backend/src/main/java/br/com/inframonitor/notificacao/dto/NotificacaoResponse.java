package br.com.inframonitor.notificacao.dto;

import br.com.inframonitor.notificacao.entity.CanalNotificacao;
import br.com.inframonitor.notificacao.entity.StatusNotificacao;
import br.com.inframonitor.notificacao.entity.TipoEventoNotificacao;

import java.time.Instant;

public record NotificacaoResponse(Long id, CanalNotificacao canal, TipoEventoNotificacao tipoEvento,
                                  StatusNotificacao status, int tentativas, String mensagem, String erro,
                                  Instant enviadoEm, IncidenteNotificacaoResponse incidente,
                                  Instant createdAt, Instant updatedAt) {
}
