package br.com.inframonitor.configuracao.controller;

import br.com.inframonitor.configuracao.dto.AtualizarConfiguracaoModoTvRequest;
import br.com.inframonitor.configuracao.dto.ConfiguracaoModoTvResponse;
import br.com.inframonitor.configuracao.service.ConfiguracaoModoTvService;
import br.com.inframonitor.security.UsuarioPrincipal;
import jakarta.validation.Valid;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/configuracoes/modo-tv")
public class ConfiguracaoModoTvController {
    private final ConfiguracaoModoTvService service;

    public ConfiguracaoModoTvController(ConfiguracaoModoTvService service) {
        this.service = service;
    }

    @GetMapping
    public ConfiguracaoModoTvResponse obter() {
        return service.obter();
    }

    @PutMapping
    public ConfiguracaoModoTvResponse atualizar(@Valid @RequestBody AtualizarConfiguracaoModoTvRequest req,
                                                @AuthenticationPrincipal UsuarioPrincipal principal) {
        return service.atualizar(req, principal.id());
    }
}
