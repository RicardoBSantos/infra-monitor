package br.com.inframonitor.incidente.controller;

import br.com.inframonitor.incidente.dto.CloseIncidenteRequest;
import br.com.inframonitor.incidente.dto.CreateIncidenteRequest;
import br.com.inframonitor.incidente.dto.IncidenteResponse;
import br.com.inframonitor.incidente.entity.StatusIncidente;
import br.com.inframonitor.incidente.service.IncidenteService;
import jakarta.validation.Valid;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.support.ServletUriComponentsBuilder;

import java.net.URI;
import java.time.Instant;

@RestController
@RequestMapping("/api/v1/incidentes")
public class IncidenteController {

    private static final int TAMANHO_MAXIMO_PAGINA = 100;
    private final IncidenteService incidenteService;

    public IncidenteController(IncidenteService incidenteService) {
        this.incidenteService = incidenteService;
    }

    @PostMapping
    public ResponseEntity<IncidenteResponse> criar(@Valid @RequestBody CreateIncidenteRequest requisicao) {
        IncidenteResponse resposta = incidenteService.criar(requisicao);
        URI location = ServletUriComponentsBuilder.fromCurrentRequest().path("/{id}")
                .buildAndExpand(resposta.id()).toUri();
        return ResponseEntity.status(HttpStatus.CREATED).header(HttpHeaders.LOCATION, location.toString()).body(resposta);
    }

    @GetMapping("/{id}")
    public IncidenteResponse buscarPorId(@PathVariable Long id) {
        return incidenteService.buscarPorId(id);
    }

    @GetMapping
    public Page<IncidenteResponse> listar(@RequestParam(required = false) Long monitorId,
                                           @RequestParam(required = false) Long equipamentoId,
                                           @RequestParam(required = false) Long unidadeId,
                                           @RequestParam(required = false) StatusIncidente status,
                                           @RequestParam(required = false) Instant inicio,
                                           @RequestParam(required = false) Instant fim,
                                           @PageableDefault(size = 20, sort = {"iniciadoEm", "id"}, direction = Sort.Direction.DESC)
                                           Pageable pageable) {
        Pageable limitado = pageable.getPageSize() > TAMANHO_MAXIMO_PAGINA
                ? PageRequest.of(pageable.getPageNumber(), TAMANHO_MAXIMO_PAGINA, pageable.getSort())
                : pageable;
        return incidenteService.listar(monitorId, equipamentoId, unidadeId, status, inicio, fim, limitado);
    }

    @PatchMapping("/{id}/fechar")
    public IncidenteResponse fechar(@PathVariable Long id, @Valid @RequestBody CloseIncidenteRequest requisicao) {
        return incidenteService.fechar(id, requisicao);
    }
}
