package br.com.inframonitor.configuracao.dto;

import br.com.inframonitor.configuracao.TelaModoTv;

public record TelaModoTvResponse(TelaModoTv tela, int ordem, int duracaoSegundos) { }
