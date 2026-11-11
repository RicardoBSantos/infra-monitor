package br.com.inframonitor.manutencao.service;

import org.springframework.boot.autoconfigure.condition.ConditionalOnBooleanProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Relogio do {@link ReconciliadorManutencao}, separado dele para que o bean exista sem passada
 * automatica. Sem initialDelay a primeira passada roda NA SUBIDA (MA12 depende disso); num teste
 * de integracao ela corre contra o TRUNCATE do @BeforeEach e as duas transacoes travam as mesmas
 * tabelas em ordem inversa (D-03). Por isso src/test/resources/config/application.properties
 * desliga {@code agendador-ativo}: o teste chama {@code reconciliar} quando quer a passada.
 */
@Component
@ConditionalOnBooleanProperty("manutencao.agendada.enabled")
@ConditionalOnBooleanProperty(name = "manutencao.agendada.agendador-ativo", matchIfMissing = true)
public class AgendadorReconciliacaoManutencao {

    private final ReconciliadorManutencao reconciliador;

    public AgendadorReconciliacaoManutencao(ReconciliadorManutencao reconciliador) {
        this.reconciliador = reconciliador;
    }

    @Scheduled(fixedDelayString = "${manutencao.agendada.intervalo-ms:30000}")
    public void agendado() {
        reconciliador.agendado();
    }
}
