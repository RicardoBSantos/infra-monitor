package br.com.inframonitor.notificacao.dto;

import br.com.inframonitor.notificacao.entity.CanalNotificacao;
import br.com.inframonitor.notificacao.entity.StatusNotificacao;
import br.com.inframonitor.notificacao.entity.TipoEventoNotificacao;

import java.time.Instant;

/**
 * Exatamente uma das ancoras vem preenchida: {@code incidente} e {@code episodioLatencia}
 * (eventos de monitor), {@code manutencao} (janela agendada) ou {@code manutencaoManual}
 * (botao manual). Monitor, equipamento e unidade sao resolvidos pela ancora presente, para que
 * a listagem nunca dependa de qual ela e: janela tem so unidade, aviso manual tem equipamento e
 * unidade, e o monitor so existe nas ancoras de monitor.
 */
public record NotificacaoResponse(Long id, CanalNotificacao canal, TipoEventoNotificacao tipoEvento,
                                  StatusNotificacao status, int tentativas, String mensagem, String erro,
                                  Instant enviadoEm, IncidenteNotificacaoResponse incidente,
                                  EpisodioLatenciaNotificacaoResponse episodioLatencia,
                                  ManutencaoNotificacaoResponse manutencao,
                                  ManutencaoManualNotificacaoResponse manutencaoManual,
                                  String monitorNome, String equipamentoNome, String unidadeNome,
                                  Instant createdAt, Instant updatedAt) {
}
