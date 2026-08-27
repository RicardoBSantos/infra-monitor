package br.com.inframonitor.dashboard.dto;

import br.com.inframonitor.dashboard.StatusOperacionalEquipamento;
import br.com.inframonitor.medicao.entity.StatusMedicao;
import java.time.Instant;

public record DashboardEquipamentoResponse(Long id, String nome, String ip, String localizacao, boolean ativo,
                                           StatusOperacionalEquipamento status, TipoEquipamento tipoEquipamento,
                                           boolean emManutencao, long monitoresAtivos, long incidentesAbertos,
                                           UltimaMedicao ultimaMedicao, String hostname) {
    public record TipoEquipamento(Long id, String nome) { }
    public record UltimaMedicao(StatusMedicao status, Integer latenciaMs, Instant executadoEm) { }
}
