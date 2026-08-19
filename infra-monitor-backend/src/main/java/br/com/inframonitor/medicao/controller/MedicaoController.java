package br.com.inframonitor.medicao.controller;

import br.com.inframonitor.medicao.dto.CreateMedicaoRequest;
import br.com.inframonitor.medicao.dto.MedicaoResponse;
import br.com.inframonitor.medicao.entity.StatusMedicao;
import br.com.inframonitor.medicao.service.MedicaoService;
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
@RequestMapping("/api/v1/medicoes")
public class MedicaoController {

    private static final int TAMANHO_MAXIMO_PAGINA = 100;
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
    public Page<MedicaoResponse> listar(@RequestParam(required = false) Long monitorId,
                                         @RequestParam(required = false) StatusMedicao status,
                                         @RequestParam(required = false) Instant inicio,
                                         @RequestParam(required = false) Instant fim,
                                         @PageableDefault(size = 50, sort = {"executadoEm", "id"}, direction = Sort.Direction.DESC)
                                         Pageable pageable) {
        Pageable limitado = pageable.getPageSize() > TAMANHO_MAXIMO_PAGINA
                ? PageRequest.of(pageable.getPageNumber(), TAMANHO_MAXIMO_PAGINA, pageable.getSort())
                : pageable;
        return medicaoService.listar(monitorId, status, inicio, fim, limitado);
    }
}
