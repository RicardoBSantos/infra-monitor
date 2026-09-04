package br.com.inframonitor.monitoring.latency.controller;

import br.com.inframonitor.monitoring.latency.dto.EpisodioLatenciaResponse;
import br.com.inframonitor.monitoring.latency.service.EpisodioLatenciaService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/episodios-latencia")
public class EpisodioLatenciaController {

    private final EpisodioLatenciaService episodioLatenciaService;

    public EpisodioLatenciaController(EpisodioLatenciaService episodioLatenciaService) {
        this.episodioLatenciaService = episodioLatenciaService;
    }

    @GetMapping("/{id}")
    public EpisodioLatenciaResponse buscarPorId(@PathVariable Long id) {
        return episodioLatenciaService.buscarPorId(id);
    }
}
