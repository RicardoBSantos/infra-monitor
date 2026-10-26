package br.com.inframonitor.manutencao.controller;

import br.com.inframonitor.common.api.PaginaResposta;
import br.com.inframonitor.manutencao.dto.AlterarFimRequest;
import br.com.inframonitor.manutencao.dto.CriarManutencaoRequest;
import br.com.inframonitor.manutencao.dto.EditarManutencaoRequest;
import br.com.inframonitor.manutencao.dto.ManutencaoResponse;
import br.com.inframonitor.manutencao.dto.ParametrosManutencaoResponse;
import br.com.inframonitor.manutencao.service.ManutencaoAgendadaService;
import br.com.inframonitor.security.UsuarioPrincipal;
import jakarta.validation.Valid;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
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

// O principal e UsuarioPrincipal, nao Usuario: o tipo errado injeta null em silencio e so
// estoura no banco.
@RestController
@RequestMapping("/api/v1/manutencoes")
public class ManutencaoAgendadaController {

    private final ManutencaoAgendadaService service;

    public ManutencaoAgendadaController(ManutencaoAgendadaService service) {
        this.service = service;
    }

    @GetMapping
    public PaginaResposta<ManutencaoResponse> listar(@RequestParam(defaultValue = "VIGENTES") String situacao,
                                                     @RequestParam(defaultValue = "") String busca,
                                                     @RequestParam(required = false) Long unidadeId,
                                                     @PageableDefault(size = 20) Pageable pageable) {
        return PaginaResposta.de(service.listar(situacao, busca, unidadeId, pageable));
    }

    @GetMapping("/{id}")
    public ManutencaoResponse obter(@PathVariable Long id) {
        return service.obterPorId(id);
    }

    @PutMapping("/{id}")
    public ManutencaoResponse editar(@PathVariable Long id, @Valid @RequestBody EditarManutencaoRequest requisicao,
                                     @AuthenticationPrincipal UsuarioPrincipal principal) {
        return service.editar(id, requisicao, principal.id());
    }

    @PatchMapping("/{id}/fim")
    public ManutencaoResponse alterarFim(@PathVariable Long id, @Valid @RequestBody AlterarFimRequest requisicao,
                                         @AuthenticationPrincipal UsuarioPrincipal principal) {
        return service.alterarFim(id, requisicao, principal.id());
    }

    @GetMapping("/parametros")
    public ParametrosManutencaoResponse parametros() {
        return service.parametros();
    }

    @PostMapping
    public ResponseEntity<ManutencaoResponse> criar(@Valid @RequestBody CriarManutencaoRequest requisicao,
                                                    @AuthenticationPrincipal UsuarioPrincipal principal) {
        ManutencaoResponse resposta = service.criar(requisicao, principal.id());
        URI location = ServletUriComponentsBuilder.fromCurrentRequest().path("/{id}")
                .buildAndExpand(resposta.id()).toUri();
        return ResponseEntity.status(HttpStatus.CREATED).header(HttpHeaders.LOCATION, location.toString()).body(resposta);
    }

    @PatchMapping("/{id}/cancelar")
    public ManutencaoResponse cancelar(@PathVariable Long id, @AuthenticationPrincipal UsuarioPrincipal principal) {
        return service.cancelar(id, principal.id());
    }

    @PatchMapping("/{id}/encerrar")
    public ManutencaoResponse encerrar(@PathVariable Long id, @AuthenticationPrincipal UsuarioPrincipal principal) {
        return service.encerrar(id, principal.id());
    }
}
