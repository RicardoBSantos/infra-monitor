package br.com.inframonitor.common.api;

import org.springframework.data.domain.Page;

import java.util.List;

/**
 * Contrato estável para coleções paginadas da API.
 */
public record PaginaResposta<T>(List<T> content, int page, int size, long totalElements, int totalPages,
                                boolean first, boolean last) {

    public static <T> PaginaResposta<T> de(Page<T> pagina) {
        return new PaginaResposta<>(List.copyOf(pagina.getContent()), pagina.getNumber(), pagina.getSize(),
                pagina.getTotalElements(), pagina.getTotalPages(), pagina.isFirst(), pagina.isLast());
    }
}
