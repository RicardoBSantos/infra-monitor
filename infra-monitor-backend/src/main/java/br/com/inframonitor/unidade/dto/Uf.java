package br.com.inframonitor.unidade.dto;

import java.util.Locale;

/** Unidades federativas brasileiras aceitas no cadastro de unidade. */
public enum Uf {
    AC, AL, AP, AM, BA, CE, DF, ES, GO, MA, MT, MS, MG, PA, PB, PR, PE, PI,
    RJ, RN, RS, RO, RR, SC, SP, SE, TO;

    /** Aceita ausencia: a UF e opcional. Valores em branco equivalem a nao informada. */
    public static boolean valida(String valor) {
        if (valor == null || valor.isBlank()) {
            return true;
        }
        String sigla = valor.trim().toUpperCase(Locale.ROOT);
        for (Uf uf : values()) {
            if (uf.name().equals(sigla)) {
                return true;
            }
        }
        return false;
    }
}
