package br.com.inframonitor.notificacao.dto;

import br.com.inframonitor.notificacao.entity.CanalNotificacao;
import br.com.inframonitor.notificacao.entity.StatusNotificacao;
import br.com.inframonitor.notificacao.entity.TipoEventoNotificacao;

import java.time.Instant;

/**
 * Exatamente uma das ancoras vem preenchida: {@code incidente} para os eventos de
 * incidente, {@code episodioLatencia} para os de latencia. Equipamento e unidade sao
 * resolvidos pelo monitor de qualquer uma das duas, para que a listagem nunca dependa
 * de qual ancora a linha usa.
 */
public record NotificacaoResponse(Long id, CanalNotificacao canal, TipoEventoNotificacao tipoEvento,
                                  StatusNotificacao status, int tentativas, String mensagem, String erro,
                                  Instant enviadoEm, IncidenteNotificacaoResponse incidente,
                                  EpisodioLatenciaNotificacaoResponse episodioLatencia,
                                  String monitorNome, String equipamentoNome, String unidadeNome,
                                  Instant createdAt, Instant updatedAt) {
}
