package br.com.inframonitor.common.api;

import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;

import java.util.Set;

/** Utilitários para o contrato de paginação público. */
public final class Paginacao {
    public static final int TAMANHO_MAXIMO = 100;

    private Paginacao() {
    }

    public static Pageable limitarESanitizar(Pageable pageable, Set<String> camposOrdenaveis) {
        pageable.getSort().forEach(ordem -> {
            if (!camposOrdenaveis.contains(ordem.getProperty())) {
                throw new IllegalArgumentException("Campo de ordenacao invalido: " + ordem.getProperty());
            }
        });
        int tamanho = Math.min(pageable.getPageSize(), TAMANHO_MAXIMO);
        return tamanho == pageable.getPageSize() ? pageable
                : PageRequest.of(pageable.getPageNumber(), tamanho, pageable.getSort());
    }
}
