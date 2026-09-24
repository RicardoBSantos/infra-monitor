package br.com.inframonitor.unidade.controller;

import br.com.inframonitor.unidade.dto.ConexaoUnidadeRequest;
import br.com.inframonitor.unidade.dto.CreateUnidadeRequest;
import br.com.inframonitor.unidade.dto.UnidadeResponse;
import br.com.inframonitor.unidade.dto.UpdateUnidadeRequest;
import br.com.inframonitor.unidade.service.UnidadeService;
import jakarta.validation.Valid;
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
import java.util.List;

@RestController
@RequestMapping("/api/v1/unidades")
public class UnidadeController {

    private final UnidadeService unidadeService;

    public UnidadeController(UnidadeService unidadeService) {
        this.unidadeService = unidadeService;
    }

    @PostMapping
    public ResponseEntity<UnidadeResponse> criar(@Valid @RequestBody CreateUnidadeRequest requisicao) {
        UnidadeResponse resposta = unidadeService.criar(requisicao);
        URI location = ServletUriComponentsBuilder.fromCurrentRequest()
                .path("/{id}")
                .buildAndExpand(resposta.id())
                .toUri();
        return ResponseEntity.status(HttpStatus.CREATED)
                .header(HttpHeaders.LOCATION, location.toString())
                .body(resposta);
    }

    @GetMapping("/{id}")
    public UnidadeResponse buscarPorId(@PathVariable Long id) {
        return unidadeService.buscarPorId(id);
    }

    @GetMapping
    public List<UnidadeResponse> listar(@RequestParam(required = false) Boolean ativo) {
        return unidadeService.listar(ativo);
    }

    @PutMapping("/{id}")
    public UnidadeResponse atualizar(@PathVariable Long id,
                                     @Valid @RequestBody UpdateUnidadeRequest requisicao) {
        return unidadeService.atualizar(id, requisicao);
    }

    @PutMapping("/{id}/conexao")
    public UnidadeResponse definirConexao(@PathVariable Long id,
                                          @Valid @RequestBody ConexaoUnidadeRequest requisicao) {
        return unidadeService.definirConexao(id, requisicao);
    }

    @DeleteMapping("/{id}/conexao")
    public UnidadeResponse removerConexao(@PathVariable Long id) {
        return unidadeService.removerConexao(id);
    }

    @PatchMapping("/{id}/ativar")
    public UnidadeResponse ativar(@PathVariable Long id) {
        return unidadeService.ativar(id);
    }

    @PatchMapping("/{id}/desativar")
    public UnidadeResponse desativar(@PathVariable Long id) {
        return unidadeService.desativar(id);
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> excluir(@PathVariable Long id) {
        unidadeService.excluir(id);
        return ResponseEntity.noContent().build();
    }
}
