package br.com.inframonitor.monitoring.observacao;

import br.com.inframonitor.incidente.repository.IncidenteRepository;
import br.com.inframonitor.relatorio.entity.JanelaMonitoramento;
import br.com.inframonitor.relatorio.repository.JanelaMonitoramentoRepository;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.Optional;

/**
 * Desde quando as medicoes de um monitor podem sustentar uma ocorrencia nova (incidente ou
 * episodio de latencia). Medicao anterior a este instante ja foi lida por outra coisa: pela
 * observacao anterior a uma manutencao, ou pelo incidente que acabou de ser fechado.
 *
 * <p>Nao e a janela_monitoramento sozinha: o fechamento manual nao pode fechar e reabrir
 * janela, porque o SQL de disponibilidade comeca cada janela na primeira medicao dentro dela
 * (greatest(j.inicio_em, j.primeira_medicao_em)) e cada fechamento encolheria o denominador
 * do SLA por um periodo que continuou observado.
 */
@Component
public class InicioDaObservacao {
    private final JanelaMonitoramentoRepository janelaRepository;
    private final IncidenteRepository incidenteRepository;

    public InicioDaObservacao(JanelaMonitoramentoRepository janelaRepository, IncidenteRepository incidenteRepository) {
        this.janelaRepository = janelaRepository;
        this.incidenteRepository = incidenteRepository;
    }

    /** Vazio quando o monitor nao esta sendo observado (sem janela aberta). */
    public Optional<Instant> doMonitor(Long monitorId) {
        Optional<JanelaMonitoramento> janela = janelaRepository.aberta(monitorId);
        if (janela.isEmpty()) {
            return Optional.empty();
        }
        Instant inicioDaJanela = janela.get().getInicioEm();
        return Optional.of(incidenteRepository.ultimoFechamentoRegistrado(monitorId)
                .filter(fechamento -> fechamento.isAfter(inicioDaJanela))
                .orElse(inicioDaJanela));
    }
}
