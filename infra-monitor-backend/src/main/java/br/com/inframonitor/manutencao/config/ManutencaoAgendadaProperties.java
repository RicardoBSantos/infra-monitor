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
    public void setDuracaoMaxima(Duration duracaoMaxima) { this.duracaoMaxima = duracaoMaxima; }
}
