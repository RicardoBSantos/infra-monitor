package br.com.inframonitor.dashboard;

import br.com.inframonitor.dashboard.dto.DashboardEquipamentoResponse;
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

import java.util.List;
import java.util.Set;

@RestController
@RequestMapping("/api/v1/dashboard")
public class DashboardController {
    private static final Set<String> CAMPOS_ORDENAVEIS = Set.of("id", "nome", "ip", "localizacao", "ativo", "createdAt", "updatedAt");
    private final DashboardService service;
    public DashboardController(DashboardService service) { this.service = service; }

    @GetMapping("/resumo") public DashboardResumoResponse resumo() { return service.resumo(); }
    @GetMapping("/unidades") public List<DashboardUnidadeResponse> unidades() { return service.unidades(); }
    @GetMapping("/unidades/{id}") public DashboardUnidadeDetalheResponse unidade(@PathVariable Long id) { return service.unidade(id); }

    @GetMapping("/unidades/{id}/equipamentos")
    public PaginaResposta<DashboardEquipamentoResponse> equipamentos(@PathVariable Long id,
            @RequestParam(required = false) Long tipoEquipamentoId, @RequestParam(required = false) Boolean ativo,
            @PageableDefault(size = 20, sort = "nome") Pageable pageable) {
        return PaginaResposta.de(service.equipamentosDaUnidade(id, tipoEquipamentoId, ativo,
                Paginacao.limitarESanitizar(pageable, CAMPOS_ORDENAVEIS)));
    }
}
