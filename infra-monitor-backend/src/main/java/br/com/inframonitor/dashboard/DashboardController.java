package br.com.inframonitor.dashboard;

import br.com.inframonitor.dashboard.dto.DashboardEquipamentoResponse;
import br.com.inframonitor.dashboard.dto.DashboardIncidenteContadoresResponse;
import br.com.inframonitor.dashboard.dto.DashboardIncidenteResponse;
import br.com.inframonitor.dashboard.dto.DashboardEquipamentoListaResponse;
import br.com.inframonitor.dashboard.dto.DashboardResumoResponse;
import br.com.inframonitor.dashboard.dto.DashboardUnidadeDetalheResponse;
import br.com.inframonitor.dashboard.dto.DashboardUnidadeResponse;
import br.com.inframonitor.common.api.PaginaResposta;
import br.com.inframonitor.common.api.Paginacao;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.List;
import java.util.Set;

@RestController
@RequestMapping("/api/v1/dashboard")
public class DashboardController {
    private static final Set<String> CAMPOS_ORDENAVEIS = Set.of("id", "nome", "ip", "localizacao", "ativo", "createdAt", "updatedAt");
    private final DashboardService service;
    private final DashboardIncidenteService incidenteService;
    public DashboardController(DashboardService service, DashboardIncidenteService incidenteService) {
        this.service = service; this.incidenteService = incidenteService;
    }

    @GetMapping("/resumo") public DashboardResumoResponse resumo() { return service.resumo(); }
    @GetMapping("/unidades") public List<DashboardUnidadeResponse> unidades() { return service.unidades(); }
    @GetMapping("/equipamentos") public List<DashboardEquipamentoListaResponse> inventario() { return service.equipamentos(); }
    @GetMapping("/unidades/{id}") public DashboardUnidadeDetalheResponse unidade(@PathVariable Long id) { return service.unidade(id); }

    /**
     * Lista unificada de incidentes e episodios de latencia. Composicao de leitura: as
     * duas tabelas permanecem dominios separados, e `tipo` diz de qual a linha veio.
     */
    @GetMapping("/incidentes")
    public PaginaResposta<DashboardIncidenteResponse> incidentes(@RequestParam(required = false) Long unidadeId,
            @RequestParam(required = false) String severidade, @RequestParam(required = false) String status,
            @RequestParam(required = false) Instant inicio, @RequestParam(required = false) Instant fim,
            @RequestParam(defaultValue = "0") int page, @RequestParam(defaultValue = "20") int size,
            @RequestParam(required = false) String sort) {
        return incidenteService.listar(unidadeId, severidade, status, inicio, fim, page, size, sort);
    }

    /** Contadores das abas: mesmos filtros da lista menos o de status. */
    @GetMapping("/incidentes/contadores")
    public DashboardIncidenteContadoresResponse incidentesContadores(@RequestParam(required = false) Long unidadeId,
            @RequestParam(required = false) String severidade,
            @RequestParam(required = false) Instant inicio, @RequestParam(required = false) Instant fim) {
        return incidenteService.contadores(unidadeId, severidade, inicio, fim);
    }

    @GetMapping("/unidades/{id}/equipamentos")
    public PaginaResposta<DashboardEquipamentoResponse> equipamentos(@PathVariable Long id,
            @RequestParam(required = false) Long tipoEquipamentoId, @RequestParam(required = false) Boolean ativo,
            @PageableDefault(size = 20, sort = "nome") Pageable pageable) {
        return PaginaResposta.de(service.equipamentosDaUnidade(id, tipoEquipamentoId, ativo,
                Paginacao.limitarESanitizar(pageable, CAMPOS_ORDENAVEIS)));
    }
}
