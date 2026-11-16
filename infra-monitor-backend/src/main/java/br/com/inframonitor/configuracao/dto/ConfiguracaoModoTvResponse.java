package br.com.inframonitor.configuracao.dto;

import java.time.Instant;
import java.util.List;

public record ConfiguracaoModoTvResponse(boolean ativo, int intervaloAtualizacaoSegundos,
                                         List<TelaModoTvResponse> telas, boolean persistida, Instant atualizadoEm) { }
