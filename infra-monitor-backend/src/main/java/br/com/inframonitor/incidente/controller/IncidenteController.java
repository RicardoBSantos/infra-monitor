package br.com.inframonitor.incidente.controller;

import br.com.inframonitor.incidente.dto.CloseIncidenteRequest;
import br.com.inframonitor.incidente.dto.CreateIncidenteRequest;
import br.com.inframonitor.incidente.dto.IncidenteResponse;
import br.com.inframonitor.incidente.entity.StatusIncidente;
import br.com.inframonitor.incidente.service.IncidenteService;
import br.com.inframonitor.common.api.PaginaResposta;
import br.com.inframonitor.common.api.Paginacao;
import br.com.inframonitor.security.UsuarioPrincipal;
import jakarta.validation.Valid;
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
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.servlet.support.ServletUriComponentsBuilder;

import java.net.URI;
import java.time.Instant;
import java.util.Set;

@RestController
@RequestMapping("/api/v1/incidentes")
public class IncidenteController {

    private static final Set<String> CAMPOS_ORDENAVEIS = Set.of("id", "status", "iniciadoEm", "encerradoEm", "createdAt", "updatedAt");
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
    public PaginaResposta<IncidenteResponse> listar(@RequestParam(required = false) Long monitorId,
                                           @RequestParam(required = false) Long equipamentoId,
                                           @RequestParam(required = false) Long unidadeId,
                                           @RequestParam(required = false) StatusIncidente status,
                                           @RequestParam(required = false) Instant inicio,
                                           @RequestParam(required = false) Instant fim,
                                           @PageableDefault(size = 20, sort = {"iniciadoEm", "id"}, direction = Sort.Direction.DESC)
                                           Pageable pageable) {
        return PaginaResposta.de(incidenteService.listar(monitorId, equipamentoId, unidadeId, status, inicio, fim,
                Paginacao.limitarESanitizar(pageable, CAMPOS_ORDENAVEIS)));
    }

    /**
     * Sem corpo: reconhecer e "eu vi". Quem e quando saem do servidor, nunca do cliente.
     *
     * <p>O tipo do parametro e {@link UsuarioPrincipal} porque e isso que o
     * JwtAuthenticationFilter poe no contexto. Pedir a entidade {@code Usuario} aqui nao
     * da erro: o resolvedor injeta null em silencio, e o autor nulo so estoura la no
     * banco, contra ck_incidente_reconhecimento_par.
     */
    @PatchMapping("/{id}/reconhecer")
    public IncidenteResponse reconhecer(@PathVariable Long id,
                                       @AuthenticationPrincipal UsuarioPrincipal principal) {
        return incidenteService.reconhecer(id, principal.id());
    }

    /** Fechamento humano: o autor vai para fechado_por. O do motor nao passa por aqui. */
    @PatchMapping("/{id}/fechar")
    public IncidenteResponse fechar(@PathVariable Long id, @Valid @RequestBody CloseIncidenteRequest requisicao,
                                    @AuthenticationPrincipal UsuarioPrincipal principal) {
        return incidenteService.fechar(id, requisicao, principal.id());
    }
}
