package br.com.inframonitor.medicao.retencao;

import java.time.Instant;

public class DetailedHistoryUnavailableException extends RuntimeException {
    public DetailedHistoryUnavailableException(Instant availableFrom) {
        super("Historico detalhado completo disponivel a partir de " + availableFrom
                + ". Informe inicio igual ou posterior a esse instante.");
    }
}
