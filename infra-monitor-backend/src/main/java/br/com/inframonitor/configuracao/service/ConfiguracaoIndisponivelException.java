package br.com.inframonitor.configuracao.service;

/** Tabelas da configuracao ausentes (jar novo antes da V27) ou sem privilegio. */
public class ConfiguracaoIndisponivelException extends RuntimeException {
    public ConfiguracaoIndisponivelException(Throwable causa) {
        super("Configuracao do modo TV indisponivel", causa);
    }
}
