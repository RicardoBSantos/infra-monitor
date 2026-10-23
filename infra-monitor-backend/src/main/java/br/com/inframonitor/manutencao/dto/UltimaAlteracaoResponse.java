package br.com.inframonitor.manutencao.dto;

import br.com.inframonitor.equipamento.dto.ReferenciaResponse;
import br.com.inframonitor.manutencao.entity.TipoAlteracao;

import java.time.Instant;

public record UltimaAlteracaoResponse(TipoAlteracao tipo, ReferenciaResponse por, Instant em) {
}
