package br.com.inframonitor.dashboard;

import br.com.inframonitor.common.api.PaginaResposta;
import br.com.inframonitor.common.api.Paginacao;
import br.com.inframonitor.dashboard.dto.DashboardIncidenteContadoresResponse;
import br.com.inframonitor.dashboard.dto.DashboardIncidenteResponse;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.Map;
import java.util.Set;

/**
 * Valida o contrato publico da tela unificada de Incidentes antes de chegar ao SQL.
 * Fica fora de {@link DashboardService} por nao compartilhar nenhuma dependencia com ele.
 */
@Service
@Transactional(readOnly = true)
public class DashboardIncidenteService {

    private static final Set<String> SEVERIDADES = Set.of("ALTA", "MEDIA");
    private static final Set<String> STATUS = Set.of("ABERTO", "RECONHECIDO", "FECHADO");
    /** Unica origem de nome de coluna aceito na ordenacao: o valor e concatenado no SQL. */
    private static final Map<String, String> ORDENACAO = Map.of(
            "iniciadoEm", "iniciado_em",
            "severidade", "severidade",
            "status", "status",
            "unidadeNome", "unidade_nome");

    private final DashboardIncidenteReadRepository readRepository;

    public DashboardIncidenteService(DashboardIncidenteReadRepository readRepository) {
        this.readRepository = readRepository;
    }

    public PaginaResposta<DashboardIncidenteResponse> listar(Long unidadeId, String severidade, String status,
            Instant inicio, Instant fim, int page, int size, String sort) {
        return readRepository.listar(unidadeId, validar("severidade", severidade, SEVERIDADES),
                validar("status", status, STATUS), inicio, fim, pagina(page), tamanho(size),
                ordenacao(periodo(inicio, fim, sort)));
    }

    public DashboardIncidenteContadoresResponse contadores(Long unidadeId, String severidade,
            Instant inicio, Instant fim) {
        periodo(inicio, fim, null);
        return readRepository.contadores(unidadeId, validar("severidade", severidade, SEVERIDADES), inicio, fim);
    }

    private String validar(String campo, String valor, Set<String> aceitos) {
        if (valor != null && !aceitos.contains(valor)) {
            throw new IllegalArgumentException(campo + " invalido: " + valor);
        }
        return valor;
    }

    /**
     * O filtro de sobreposicao usa os dois extremos na mesma expressao; um deles sozinho
     * anularia a comparacao e sumiria com todas as linhas em vez de nao filtrar nada.
     */
    private String periodo(Instant inicio, Instant fim, String sort) {
        if ((inicio == null) != (fim == null)) {
            throw new IllegalArgumentException("inicio e fim devem ser informados juntos");
        }
        if (inicio != null && inicio.isAfter(fim)) {
            throw new IllegalArgumentException("inicio deve ser menor ou igual a fim");
        }
        return sort;
    }

    private String ordenacao(String sort) {
        String valor = sort == null || sort.isBlank() ? "iniciadoEm,desc" : sort;
        String[] partes = valor.split(",", -1);
        String coluna = ORDENACAO.get(partes[0]);
        if (coluna == null) {
            throw new IllegalArgumentException("Campo de ordenacao invalido: " + partes[0]);
        }
        boolean asc = partes.length > 1 && "asc".equalsIgnoreCase(partes[1]);
        return coluna + (asc ? " asc" : " desc");
    }

    private int pagina(int page) {
        return Math.max(page, 0);
    }

    private int tamanho(int size) {
        return Math.clamp(size, 1, Paginacao.TAMANHO_MAXIMO);
    }
}
