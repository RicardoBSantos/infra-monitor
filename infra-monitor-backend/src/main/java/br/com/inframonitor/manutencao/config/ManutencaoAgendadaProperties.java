package br.com.inframonitor.manutencao.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

@ConfigurationProperties("manutencao.agendada")
public class ManutencaoAgendadaProperties {
    private boolean enabled;
    private long intervaloMs = 30_000;
    private Duration duracaoMaxima = Duration.ofHours(72);
    public boolean isEnabled() { return enabled; }
    public void setEnabled(boolean enabled) { this.enabled = enabled; }
    public long getIntervaloMs() { return intervaloMs; }
    public void setIntervaloMs(long intervaloMs) { this.intervaloMs = intervaloMs; }
    public Duration getDuracaoMaxima() { return duracaoMaxima; }

    /**
     * Horas inteiras e positivas: a mensagem de recusa e /parametros falam em horas, e 90m
     * viraria "1 hora" na tela com o servidor aceitando 1h30. Falha no boot, nao na criacao.
     */
    public void setDuracaoMaxima(Duration duracaoMaxima) {
        if (duracaoMaxima == null || duracaoMaxima.isZero() || duracaoMaxima.isNegative()
                || !duracaoMaxima.equals(Duration.ofHours(duracaoMaxima.toHours()))) {
            throw new IllegalArgumentException("MANUTENCAO_AGENDADA_DURACAO_MAXIMA (manutencao.agendada.duracao-maxima) "
                    + "deve ser um numero inteiro e positivo de horas, como 72h ou 5d; recebido: " + duracaoMaxima);
        }
        this.duracaoMaxima = duracaoMaxima;
    }
}
