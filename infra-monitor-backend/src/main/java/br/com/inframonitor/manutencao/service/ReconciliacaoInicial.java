package br.com.inframonitor.manutencao.service;

import br.com.inframonitor.manutencao.config.ManutencaoAgendadaProperties;
import org.springframework.stereotype.Component;

import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Sinal de que a primeira passada do reconciliador ja rodou depois do boot (MA12): antes dela,
 * em_manutencao pode estar defasado (janela que venceu com o processo parado) e o motor nao
 * deve pingar. Com o reconciliador desligado ninguem faria a passada, entao nasce pronta.
 */
@Component
public class ReconciliacaoInicial {

    private final AtomicBoolean pronta;

    public ReconciliacaoInicial(ManutencaoAgendadaProperties propriedades) {
        this.pronta = new AtomicBoolean(!propriedades.isEnabled());
    }

    public boolean pronta() {
        return pronta.get();
    }

    public void marcarPronta() {
        pronta.set(true);
    }
}
