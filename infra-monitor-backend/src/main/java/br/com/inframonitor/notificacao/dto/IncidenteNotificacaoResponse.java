package br.com.inframonitor.notificacao.dto;

import br.com.inframonitor.incidente.entity.StatusIncidente;

public record IncidenteNotificacaoResponse(Long id, StatusIncidente status) {
}
