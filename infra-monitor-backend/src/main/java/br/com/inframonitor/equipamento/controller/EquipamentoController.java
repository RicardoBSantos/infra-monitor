package br.com.inframonitor.equipamento.controller;

import br.com.inframonitor.equipamento.dto.CreateEquipamentoRequest;
import br.com.inframonitor.equipamento.dto.EquipamentoResponse;
import br.com.inframonitor.equipamento.dto.UpdateEquipamentoRequest;
import br.com.inframonitor.equipamento.service.EquipamentoService;
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
@RequestMapping("/api/v1/equipamentos")
public class EquipamentoController {

    private static final int TAMANHO_MAXIMO_PAGINA = 100;
    private final EquipamentoService equipamentoService;

    public EquipamentoController(EquipamentoService equipamentoService) {
        this.equipamentoService = equipamentoService;
    }

    @PostMapping
    public ResponseEntity<EquipamentoResponse> criar(@Valid @RequestBody CreateEquipamentoRequest requisicao) {
        EquipamentoResponse resposta = equipamentoService.criar(requisicao);
        URI location = ServletUriComponentsBuilder.fromCurrentRequest().path("/{id}")
                .buildAndExpand(resposta.id()).toUri();
        return ResponseEntity.status(HttpStatus.CREATED).header(HttpHeaders.LOCATION, location.toString()).body(resposta);
    }

    @GetMapping("/{id}")
    public EquipamentoResponse buscarPorId(@PathVariable Long id) {
        return equipamentoService.buscarPorId(id);
    }

    @GetMapping
    public Page<EquipamentoResponse> listar(@RequestParam(required = false) Long unidadeId,
                                             @RequestParam(required = false) Long tipoEquipamentoId,
                                             @RequestParam(required = false) Boolean ativo,
                                             @PageableDefault(size = 20, sort = "nome") Pageable pageable) {
        Pageable limitado = pageable.getPageSize() > TAMANHO_MAXIMO_PAGINA
                ? PageRequest.of(pageable.getPageNumber(), TAMANHO_MAXIMO_PAGINA, pageable.getSort()) : pageable;
        return equipamentoService.listar(unidadeId, tipoEquipamentoId, ativo, limitado);
    }

    @PutMapping("/{id}")
    public EquipamentoResponse atualizar(@PathVariable Long id, @Valid @RequestBody UpdateEquipamentoRequest requisicao) {
        return equipamentoService.atualizar(id, requisicao);
    }

    @PatchMapping("/{id}/ativar")
    public EquipamentoResponse ativar(@PathVariable Long id) { return equipamentoService.ativar(id); }

    @PatchMapping("/{id}/desativar")
    public EquipamentoResponse desativar(@PathVariable Long id) { return equipamentoService.desativar(id); }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> excluir(@PathVariable Long id) {
        equipamentoService.excluir(id);
        return ResponseEntity.noContent().build();
    }
}
