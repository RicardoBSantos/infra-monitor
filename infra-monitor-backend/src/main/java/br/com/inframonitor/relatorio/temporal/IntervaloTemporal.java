package br.com.inframonitor.relatorio.temporal;
import java.time.Instant;
public record IntervaloTemporal(Instant inicio, Instant fim) { public IntervaloTemporal { if(!inicio.isBefore(fim)) throw new IllegalArgumentException("Intervalo deve ser [inicio, fim) nao vazio"); } }
