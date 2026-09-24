package br.com.inframonitor.monitoring.incident;

import br.com.inframonitor.incidente.entity.Incidente;
import br.com.inframonitor.incidente.entity.MotivoEncerramentoIncidente;
import br.com.inframonitor.incidente.entity.StatusIncidente;
import br.com.inframonitor.incidente.repository.IncidenteRepository;
import br.com.inframonitor.incidente.service.IncidenteService;
import br.com.inframonitor.medicao.entity.Medicao;
import br.com.inframonitor.medicao.entity.StatusMedicao;
import br.com.inframonitor.medicao.repository.MedicaoRepository;
import br.com.inframonitor.monitor.entity.Monitor;
import br.com.inframonitor.monitoring.config.LimiteDeEsperaPorLock;
import br.com.inframonitor.relatorio.entity.JanelaMonitoramento;
import br.com.inframonitor.relatorio.repository.JanelaMonitoramentoRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

/** Interpreta somente a cauda recente e cronologicamente atual das medicoes de um monitor. */
@Component
public class IncidentProcessor {
    private static final Logger log = LoggerFactory.getLogger(IncidentProcessor.class);

    private final MedicaoRepository medicaoRepository;
    private final IncidenteRepository incidenteRepository;
    private final IncidenteService incidenteService;
    private final JanelaMonitoramentoRepository janelaRepository;
    private final LimiteDeEsperaPorLock limiteDeEsperaPorLock;

    public IncidentProcessor(MedicaoRepository medicaoRepository, IncidenteRepository incidenteRepository,
                             IncidenteService incidenteService, JanelaMonitoramentoRepository janelaRepository,
                             LimiteDeEsperaPorLock limiteDeEsperaPorLock) {
        this.medicaoRepository = medicaoRepository;
        this.incidenteRepository = incidenteRepository;
        this.incidenteService = incidenteService;
        this.janelaRepository = janelaRepository;
        this.limiteDeEsperaPorLock = limiteDeEsperaPorLock;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void process(Medicao medicaoPersistida) {
        limiteDeEsperaPorLock.aplicarNaTransacaoCorrente();
        Long monitorId = medicaoPersistida.getMonitor().getId();
        Optional<Medicao> ultima = medicaoRepository.findFirstByMonitorIdOrderByExecutadoEmDescIdDesc(monitorId);
        if (ultima.isEmpty() || !ultima.get().getId().equals(medicaoPersistida.getId())) {
            log.debug("Ignoring delayed measurement {} for incident processing", medicaoPersistida.getId());
            return;
        }

        Monitor monitor = medicaoPersistida.getMonitor();
        Optional<Incidente> incidenteAberto = incidenteRepository
                .findFirstByMonitorIdAndStatusInOrderByIniciadoEmDescIdDesc(monitorId, StatusIncidente.EM_ABERTO);
        if (incidenteAberto.isPresent()) {
            processarRecovery(monitor, incidenteAberto.get(), medicaoPersistida);
        } else {
            processarAbertura(monitor, medicaoPersistida);
        }
    }

    private void processarAbertura(Monitor monitor, Medicao atual) {
        int threshold = monitor.getFalhasParaIncidente();
        List<Medicao> medicoes = ultimasMedicoes(monitor.getId(), threshold);
        if (!sequenciaCompleta(medicoes, threshold, StatusMedicao.FALHA)) {
            log.debug("Failure threshold not reached for monitor {}", monitor.getId());
            return;
        }
        // Espelho da guarda de processarRecovery: medicao anterior ao inicio da
        // observacao atual nao sustenta abertura. Sem isto, a cauda congelada pela
        // manutencao abre um incidente com iniciadoEm de antes dela, e dispara Telegram
        // na PRIMEIRA falha depois da saida - que pode ser o equipamento ainda subindo.
        //
        // A ancora e' a janela_monitoramento porque ela ja e' a resposta canonica do
        // projeto para "desde quando este monitor esta sendo observado", e a saida da
        // manutencao abre uma janela nova de qualquer jeito (B.5).
        Optional<JanelaMonitoramento> janela = janelaRepository.aberta(monitor.getId());
        if (janela.isEmpty()) {
            log.debug("No open monitoring window for monitor {}; opening skipped", monitor.getId());
            return;
        }
        Instant inicioDaObservacao = janela.get().getInicioEm();
        if (medicoes.stream().anyMatch(m -> m.getExecutadoEm().isBefore(inicioDaObservacao))) {
            log.debug("Failure tail predates the open window for monitor {}; opening skipped", monitor.getId());
            return;
        }
        // A lista esta DESC; a ultima posicao e a primeira falha da sequencia.
        incidenteService.abrirAutomaticamente(monitor, medicoes.get(medicoes.size() - 1).getExecutadoEm(), threshold)
                .ifPresentOrElse(
                        incidente -> log.info("Incident {} opened automatically for monitor {}",
                                incidente.getId(), monitor.getId()),
                        () -> log.debug("Incident opening skipped for monitor {}: equipment under maintenance, "
                                + "monitor inactive, or incident already open", monitor.getId()));
    }

    private void processarRecovery(Monitor monitor, Incidente incidente, Medicao atual) {
        int threshold = monitor.getSucessosParaRecovery();
        List<Medicao> medicoes = ultimasMedicoes(monitor.getId(), threshold);
        if (!sequenciaCompleta(medicoes, threshold, StatusMedicao.SUCESSO)
                || medicoes.stream().anyMatch(m -> m.getExecutadoEm().isBefore(incidente.getIniciadoEm()))) {
            log.debug("Recovery threshold not reached for monitor {}", monitor.getId());
            return;
        }
        Incidente fechado = incidenteService.fecharAutomaticamente(incidente, atual.getExecutadoEm(), threshold);
        // O CAS pode perder para outra transacao (manutencao, fechamento manual): ai o
        // incidente volta relido, ja fechado por outro motivo.
        if (fechado.getMotivoEncerramento() == MotivoEncerramentoIncidente.RECUPERACAO_AUTOMATICA) {
            log.info("Incident {} closed automatically for monitor {}", fechado.getId(), monitor.getId());
        } else {
            log.debug("Incident {} for monitor {} was already closed by another transaction",
                    fechado.getId(), monitor.getId());
        }
    }

    private List<Medicao> ultimasMedicoes(Long monitorId, int quantidade) {
        return medicaoRepository.findByMonitorIdOrderByExecutadoEmDescIdDesc(monitorId, PageRequest.of(0, quantidade));
    }

    private boolean sequenciaCompleta(List<Medicao> medicoes, int quantidade, StatusMedicao status) {
        return medicoes.size() == quantidade && medicoes.stream().allMatch(m -> m.getStatus() == status);
    }
}
