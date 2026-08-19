package br.com.inframonitor.monitor.controller;

import br.com.inframonitor.monitor.dto.CreateMonitorRequest;
import br.com.inframonitor.monitor.dto.MonitorResponse;
import br.com.inframonitor.monitor.dto.UpdateMonitorRequest;
import br.com.inframonitor.monitor.entity.TipoMonitor;
import br.com.inframonitor.monitor.service.MonitorService;
import jakarta.validation.Valid;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
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

@RestController
@RequestMapping("/api/v1/monitores")
public class MonitorController {
    private static final int TAMANHO_MAXIMO_PAGINA = 100;
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
    public Page<MonitorResponse> listar(@RequestParam(required = false) Long equipamentoId,
                                         @RequestParam(required = false) TipoMonitor tipo,
                                         @RequestParam(required = false) Boolean ativo,
                                         @PageableDefault(size = 20, sort = "nome") Pageable pageable) {
        Pageable limitado = pageable.getPageSize() > TAMANHO_MAXIMO_PAGINA
                ? PageRequest.of(pageable.getPageNumber(), TAMANHO_MAXIMO_PAGINA, pageable.getSort()) : pageable;
        return monitorService.listar(equipamentoId, tipo, ativo, limitado);
    }
    @PutMapping("/{id}") public MonitorResponse atualizar(@PathVariable Long id, @Valid @RequestBody UpdateMonitorRequest requisicao) { return monitorService.atualizar(id, requisicao); }
    @PatchMapping("/{id}/ativar") public MonitorResponse ativar(@PathVariable Long id) { return monitorService.ativar(id); }
    @PatchMapping("/{id}/desativar") public MonitorResponse desativar(@PathVariable Long id) { return monitorService.desativar(id); }
    @DeleteMapping("/{id}") public ResponseEntity<Void> excluir(@PathVariable Long id) { monitorService.excluir(id); return ResponseEntity.noContent().build(); }
}
