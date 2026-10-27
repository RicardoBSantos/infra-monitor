package br.com.inframonitor.notificacao.controller;

import br.com.inframonitor.notificacao.dto.NotificacaoResponse;
import br.com.inframonitor.notificacao.entity.CanalNotificacao;
import br.com.inframonitor.notificacao.entity.StatusNotificacao;
import br.com.inframonitor.notificacao.entity.TipoEventoNotificacao;
import br.com.inframonitor.notificacao.service.NotificacaoService;
import br.com.inframonitor.common.api.PaginaResposta;
import br.com.inframonitor.common.api.Paginacao;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.data.web.PageableDefault;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.Set;

@RestController
@RequestMapping("/api/v1/notificacoes")
public class NotificacaoController {

    private static final Set<String> CAMPOS_ORDENAVEIS = Set.of("id", "canal", "tipoEvento", "status", "tentativas", "enviadoEm", "createdAt", "updatedAt");
    private final NotificacaoService notificacaoService;

    public NotificacaoController(NotificacaoService notificacaoService) {
        this.notificacaoService = notificacaoService;
    }

    @GetMapping("/{id}")
    public NotificacaoResponse buscarPorId(@PathVariable Long id) {
        return notificacaoService.buscarPorId(id);
    }

    @GetMapping
    public PaginaResposta<NotificacaoResponse> listar(@RequestParam(required = false) Long incidenteId,
                                             @RequestParam(required = false) Long episodioLatenciaId,
                                             @RequestParam(required = false) Long manutencaoId,
                                             @RequestParam(required = false) Long manutencaoManualId,
                                             @RequestParam(required = false) StatusNotificacao status,
                                             @RequestParam(required = false) CanalNotificacao canal,
                                             @RequestParam(required = false) TipoEventoNotificacao tipoEvento,
                                             @RequestParam(required = false) Instant inicio,
                                             @RequestParam(required = false) Instant fim,
                                             @PageableDefault(size = 20, sort = {"createdAt", "id"}, direction = Sort.Direction.DESC)
                                             Pageable pageable) {
        return PaginaResposta.de(notificacaoService.listar(incidenteId, episodioLatenciaId, manutencaoId, manutencaoManualId, status, canal, tipoEvento, inicio, fim,
                Paginacao.limitarESanitizar(pageable, CAMPOS_ORDENAVEIS)));
    }
}
