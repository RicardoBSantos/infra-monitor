package br.com.inframonitor.medicao.controller;

import br.com.inframonitor.medicao.dto.CreateMedicaoRequest;
import br.com.inframonitor.medicao.dto.MedicaoResponse;
import br.com.inframonitor.medicao.entity.StatusMedicao;
import br.com.inframonitor.medicao.service.MedicaoService;
import br.com.inframonitor.common.api.PaginaResposta;
import br.com.inframonitor.common.api.Paginacao;
import jakarta.validation.Valid;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.support.ServletUriComponentsBuilder;

import java.net.URI;
import java.time.Instant;
import java.util.Set;

@RestController
@RequestMapping("/api/v1/medicoes")
public class MedicaoController {

    private static final Set<String> CAMPOS_ORDENAVEIS = Set.of("id", "status", "latenciaMs", "executadoEm", "createdAt");
    private final MedicaoService medicaoService;

    public MedicaoController(MedicaoService medicaoService) {
        this.medicaoService = medicaoService;
    }

    @PostMapping
    public ResponseEntity<MedicaoResponse> criar(@Valid @RequestBody CreateMedicaoRequest requisicao) {
        MedicaoResponse resposta = medicaoService.criar(requisicao);
        URI location = ServletUriComponentsBuilder.fromCurrentRequest().path("/{id}")
                .buildAndExpand(resposta.id()).toUri();
        return ResponseEntity.status(HttpStatus.CREATED).header(HttpHeaders.LOCATION, location.toString()).body(resposta);
    }

    @GetMapping("/{id}")
    public MedicaoResponse buscarPorId(@PathVariable Long id) {
        return medicaoService.buscarPorId(id);
    }

    @GetMapping
    public PaginaResposta<MedicaoResponse> listar(@RequestParam(required = false) Long monitorId,
                                         @RequestParam(required = false) StatusMedicao status,
                                         @RequestParam(required = false) Instant inicio,
                                         @RequestParam(required = false) Instant fim,
                                         @PageableDefault(size = 50, sort = {"executadoEm", "id"}, direction = Sort.Direction.DESC)
                                         Pageable pageable) {
        return PaginaResposta.de(medicaoService.listar(monitorId, status, inicio, fim,
                Paginacao.limitarESanitizar(pageable, CAMPOS_ORDENAVEIS)));
    }
}
