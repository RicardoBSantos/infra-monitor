package br.com.inframonitor.tipoequipamento.controller;

import br.com.inframonitor.tipoequipamento.dto.CreateTipoEquipamentoRequest;
import br.com.inframonitor.tipoequipamento.dto.TipoEquipamentoResponse;
import br.com.inframonitor.tipoequipamento.dto.UpdateTipoEquipamentoRequest;
import br.com.inframonitor.tipoequipamento.service.TipoEquipamentoService;
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
@RequestMapping("/api/v1/tipos-equipamento")
public class TipoEquipamentoController {

    private final TipoEquipamentoService tipoEquipamentoService;

    public TipoEquipamentoController(TipoEquipamentoService tipoEquipamentoService) {
        this.tipoEquipamentoService = tipoEquipamentoService;
    }

    @PostMapping
    public ResponseEntity<TipoEquipamentoResponse> criar(
            @Valid @RequestBody CreateTipoEquipamentoRequest requisicao) {
        TipoEquipamentoResponse resposta = tipoEquipamentoService.criar(requisicao);
        URI location = ServletUriComponentsBuilder.fromCurrentRequest().path("/{id}")
                .buildAndExpand(resposta.id()).toUri();
        return ResponseEntity.status(HttpStatus.CREATED)
                .header(HttpHeaders.LOCATION, location.toString()).body(resposta);
    }

    @GetMapping("/{id}")
    public TipoEquipamentoResponse buscarPorId(@PathVariable Long id) {
        return tipoEquipamentoService.buscarPorId(id);
    }

    @GetMapping
    public List<TipoEquipamentoResponse> listar(@RequestParam(required = false) Boolean ativo) {
        return tipoEquipamentoService.listar(ativo);
    }

    @PutMapping("/{id}")
    public TipoEquipamentoResponse atualizar(@PathVariable Long id,
                                             @Valid @RequestBody UpdateTipoEquipamentoRequest requisicao) {
        return tipoEquipamentoService.atualizar(id, requisicao);
    }

    @PatchMapping("/{id}/ativar")
    public TipoEquipamentoResponse ativar(@PathVariable Long id) {
        return tipoEquipamentoService.ativar(id);
    }

    @PatchMapping("/{id}/desativar")
    public TipoEquipamentoResponse desativar(@PathVariable Long id) {
        return tipoEquipamentoService.desativar(id);
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> excluir(@PathVariable Long id) {
        tipoEquipamentoService.excluir(id);
        return ResponseEntity.noContent().build();
    }
}
