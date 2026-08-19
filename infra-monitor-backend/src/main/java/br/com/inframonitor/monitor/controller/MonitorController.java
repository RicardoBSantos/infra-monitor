package br.com.inframonitor.monitor.controller;

import br.com.inframonitor.monitor.dto.CreateMonitorRequest;
import br.com.inframonitor.monitor.dto.MonitorResponse;
import br.com.inframonitor.monitor.dto.UpdateMonitorRequest;
import br.com.inframonitor.monitor.entity.TipoMonitor;
import br.com.inframonitor.monitor.service.MonitorService;
import br.com.inframonitor.common.api.PaginaResposta;
import br.com.inframonitor.common.api.Paginacao;
import jakarta.validation.Valid;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.support.ServletUriComponentsBuilder;

import java.net.URI;
import java.util.Set;

@RestController
@RequestMapping("/api/v1/monitores")
public class MonitorController {
    private static final Set<String> CAMPOS_ORDENAVEIS = Set.of("id", "nome", "tipo", "intervaloSegundos", "timeoutMs", "ativo", "createdAt", "updatedAt");
    private final MonitorService monitorService;
    public MonitorController(MonitorService monitorService) { this.monitorService = monitorService; }

    @PostMapping
    public ResponseEntity<MonitorResponse> criar(@Valid @RequestBody CreateMonitorRequest requisicao) {
        MonitorResponse resposta = monitorService.criar(requisicao);
        URI location = ServletUriComponentsBuilder.fromCurrentRequest().path("/{id}").buildAndExpand(resposta.id()).toUri();
        return ResponseEntity.status(HttpStatus.CREATED).header(HttpHeaders.LOCATION, location.toString()).body(resposta);
    }
    @GetMapping("/{id}") public MonitorResponse buscarPorId(@PathVariable Long id) { return monitorService.buscarPorId(id); }
    @GetMapping
    public PaginaResposta<MonitorResponse> listar(@RequestParam(required = false) Long equipamentoId,
                                         @RequestParam(required = false) TipoMonitor tipo,
                                         @RequestParam(required = false) Boolean ativo,
                                         @PageableDefault(size = 20, sort = "nome") Pageable pageable) {
        return PaginaResposta.de(monitorService.listar(equipamentoId, tipo, ativo,
                Paginacao.limitarESanitizar(pageable, CAMPOS_ORDENAVEIS)));
    }
    @PutMapping("/{id}") public MonitorResponse atualizar(@PathVariable Long id, @Valid @RequestBody UpdateMonitorRequest requisicao) { return monitorService.atualizar(id, requisicao); }
    @PatchMapping("/{id}/ativar") public MonitorResponse ativar(@PathVariable Long id) { return monitorService.ativar(id); }
    @PatchMapping("/{id}/desativar") public MonitorResponse desativar(@PathVariable Long id) { return monitorService.desativar(id); }
    @DeleteMapping("/{id}") public ResponseEntity<Void> excluir(@PathVariable Long id) { monitorService.excluir(id); return ResponseEntity.noContent().build(); }
}
