package br.com.inframonitor.manutencao.service;

import br.com.inframonitor.common.exception.RecursoNaoEncontradoException;
import br.com.inframonitor.equipamento.service.EstadoManutencaoEquipamento;
import br.com.inframonitor.manutencao.config.ManutencaoAgendadaProperties;
import br.com.inframonitor.manutencao.repository.CoberturaManutencao;
import br.com.inframonitor.manutencao.repository.CoberturaManutencao.Transicao;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.SortedSet;
import java.util.TreeSet;
import java.util.stream.Stream;

/**
 * Reconciliador de nivel das janelas agendadas: o unico que consulta o relogio (MA06). Cada
 * passada leva as janelas a situacao que o horario pede e os equipamentos ao estado efetivo
 * que as janelas pedem. Nao guarda nada entre passadas: um tick perdido (sistema parado,
 * reconciliador desligado) e corrigido pelo seguinte, com os instantes REAIS (MA08).
 */
@Component
@ConditionalOnProperty(prefix = "manutencao.agendada", name = "enabled", havingValue = "true")
public class ReconciliadorManutencao {

    private static final Logger log = LoggerFactory.getLogger(ReconciliadorManutencao.class);

    private final CoberturaManutencao cobertura;
    private final AnuncioManutencao anuncio;
    private final EstadoManutencaoEquipamento estado;
    private final ReconciliacaoInicial inicial;
    private final ManutencaoAgendadaProperties props;
    private final TransactionTemplate transacao;
    private final Clock clock;

    public ReconciliadorManutencao(CoberturaManutencao cobertura, AnuncioManutencao anuncio,
                                   EstadoManutencaoEquipamento estado,
                                   ReconciliacaoInicial inicial, ManutencaoAgendadaProperties props,
                                   PlatformTransactionManager transactionManager,
                                   @Qualifier("monitoringClock") Clock clock) {
        this.cobertura = cobertura;
        this.anuncio = anuncio;
        this.estado = estado;
        this.inicial = inicial;
        this.props = props;
        this.transacao = new TransactionTemplate(transactionManager);
        this.clock = clock;
    }

    /**
     * Pool de agendamento de uma thread so, dividido com motor e dispatcher: a falha e logada
     * aqui e a passada seguinte tenta de novo; nada sobe para o agendador.
     */
    @Scheduled(fixedDelayString = "${manutencao.agendada.intervalo-ms:30000}")
    public void agendado() {
        try {
            reconciliar(Instant.now(clock));
        } catch (RuntimeException e) {
            log.error("Falha na passada do reconciliador de manutencao; a proxima passada tenta de novo", e);
        }
    }

    /**
     * Uma passada. Cada transicao CAS e cada reavaliacao em transacao propria: um equipamento com
     * problema nao segura os outros, e nenhuma transacao segura dois locks de equipamento.
     * Depois de cada transicao, reavalia os cobertos POR LOCK (nao so a divergencia lida por
     * snapshot): e isso que fecha a corrida com o botao manual (Task 6, corrida 3).
     */
    public Resultado reconciliar(Instant agora) {
        try {
            // Anuncio na transacao do CAS (MA31): transicao e anuncio confirmam juntos ou nenhum. Falha ao
            // anunciar desfaz as transicoes desta transacao, e a passada seguinte tenta de novo.
            List<Transicao> ativadas = transacao.execute(s -> {
                List<Transicao> lista = cobertura.ativarDevidas(agora);
                lista.forEach(t -> anuncio.anunciarInicio(t.manutencaoId(), agora));
                return lista;
            });
            // Expirada nao anuncia (MA27): nada foi anunciado antes.
            List<Transicao> expiradas = transacao.execute(s -> cobertura.expirarPerdidas(agora));
            List<Transicao> concluidas = transacao.execute(s -> {
                List<Transicao> lista = cobertura.concluirVencidas(agora);
                lista.forEach(t -> anuncio.anunciarFim(t.manutencaoId(), agora));
                return lista;
            });
            // Expirada nao entra: nunca ativou, entao nao ha efeito a aplicar nem a desfazer.
            SortedSet<Long> alvos = new TreeSet<>();
            Stream.concat(ativadas.stream(), concluidas.stream())
                    .forEach(t -> alvos.addAll(cobertura.cobertosPor(t.manutencaoId())));
            alvos.addAll(cobertura.divergentes());
            alvos.forEach(this::reavaliar);   // ordem por id: mesma ordem de lock em todo lugar
            avisarAtrasos(ativadas, expiradas, concluidas);
            return new Resultado(ativadas, expiradas, concluidas, alvos.size());
        } finally {
            // Mesmo com falha: o motor nao pode ficar parado para sempre esperando esta passada (MA12).
            inicial.marcarPronta();
        }
    }

    /**
     * Sem relancar: a situacao da janela ja esta commitada, e o equipamento que falhou continua
     * divergente, entao a proxima passada o pega de novo por {@code divergentes()}.
     */
    private void reavaliar(Long equipamentoId) {
        try {
            estado.reavaliar(equipamentoId);
        } catch (RecursoNaoEncontradoException e) {
            log.info("Reconciliador: equipamento {} excluido antes da reavaliacao; ignorado", equipamentoId);
        } catch (RuntimeException e) {
            log.error("Reconciliador: falha ao reavaliar o equipamento {}; seguindo com os demais", equipamentoId, e);
        }
    }

    private void avisarAtrasos(List<Transicao> ativadas, List<Transicao> expiradas, List<Transicao> concluidas) {
        Duration limite = Duration.ofMillis(2 * props.getIntervaloMs());
        for (Transicao t : ativadas) {
            if (t.atraso().compareTo(limite) > 0) {
                log.warn("Janela de manutencao {} ativada com {} min de atraso: o sistema esteve fora (ou o "
                        + "reconciliador desligado) no horario previsto", t.manutencaoId(), t.atraso().toMinutes());
            }
        }
        for (Transicao t : concluidas) {
            if (t.atraso().compareTo(limite) > 0) {
                log.warn("Janela de manutencao {} concluida com {} min de atraso: o sistema esteve fora (ou o "
                        + "reconciliador desligado) no horario previsto", t.manutencaoId(), t.atraso().toMinutes());
            }
        }
        for (Transicao t : expiradas) {
            log.warn("Janela de manutencao {} expirou sem ativar: o sistema esteve fora durante a janela inteira",
                    t.manutencaoId());
        }
    }

    public record Resultado(List<Transicao> ativadas, List<Transicao> expiradas, List<Transicao> concluidas,
                            int reavaliados) {
    }
}
