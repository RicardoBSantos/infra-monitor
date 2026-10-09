package br.com.inframonitor.relatorio.controller;

import br.com.inframonitor.incidente.entity.StatusIncidente;
import br.com.inframonitor.medicao.entity.StatusMedicao;
import br.com.inframonitor.notificacao.entity.CanalNotificacao;
import br.com.inframonitor.notificacao.entity.StatusNotificacao;
import br.com.inframonitor.notificacao.entity.TipoEventoNotificacao;
import br.com.inframonitor.relatorio.exportacao.RelatorioExportService;
import br.com.inframonitor.security.UsuarioPrincipal;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

import java.time.Instant;

@RestController
@RequestMapping("/api/v1/relatorios")
public class RelatorioExportController {
    private static final MediaType CSV = MediaType.parseMediaType("text/csv; charset=UTF-8");
    private final RelatorioExportService service;
    public RelatorioExportController(RelatorioExportService service){this.service=service;}

    @GetMapping("/disponibilidade/equipamentos/export")
    public ResponseEntity<StreamingResponseBody> disponibilidadeEquipamentos(@RequestParam Instant inicio,@RequestParam Instant fim,
            @RequestParam(required=false)Long unidadeId,@RequestParam(required=false)Long equipamentoId,@RequestParam(required=false)Long monitorId,
            @RequestParam(required=false)Long tipoEquipamentoId,@RequestParam(defaultValue="equipamentoNome,asc")String sort,
            @RequestParam(required=false)String page,@RequestParam(required=false)String size,@RequestParam(required=false)String format,
            @AuthenticationPrincipal UsuarioPrincipal principal){rejectVisualPagination(page,size,format);return response(service.disponibilidadeEquipamentos(inicio,fim,unidadeId,equipamentoId,monitorId,tipoEquipamentoId,sort,principal));}

    @GetMapping("/disponibilidade/unidades/export")
    public ResponseEntity<StreamingResponseBody> disponibilidadeUnidades(@RequestParam Instant inicio,@RequestParam Instant fim,@RequestParam(required=false)Long unidadeId,
            @RequestParam(defaultValue="unidadeNome,asc")String sort,@RequestParam(required=false)String page,@RequestParam(required=false)String size,@RequestParam(required=false)String format,
            @AuthenticationPrincipal UsuarioPrincipal principal){rejectVisualPagination(page,size,format);return response(service.disponibilidadeUnidades(inicio,fim,unidadeId,sort,principal));}

    @GetMapping("/incidentes/export")
    public ResponseEntity<StreamingResponseBody> incidentes(@RequestParam Instant inicio,@RequestParam Instant fim,@RequestParam(required=false)Long unidadeId,
            @RequestParam(required=false)Long equipamentoId,@RequestParam(required=false)Long monitorId,@RequestParam(required=false)StatusIncidente status,
            @RequestParam(defaultValue="iniciadoEm,desc")String sort,@RequestParam(required=false)String page,@RequestParam(required=false)String size,@RequestParam(required=false)String format,
            @AuthenticationPrincipal UsuarioPrincipal principal){rejectVisualPagination(page,size,format);return response(service.incidentes(inicio,fim,unidadeId,equipamentoId,monitorId,status,sort,principal));}

    @GetMapping("/medicoes/export")
    public ResponseEntity<StreamingResponseBody> medicoes(@RequestParam Instant inicio,@RequestParam Instant fim,@RequestParam(required=false)Long unidadeId,
            @RequestParam(required=false)Long equipamentoId,@RequestParam(required=false)Long monitorId,@RequestParam(required=false)StatusMedicao status,
            @RequestParam(defaultValue="executadoEm,desc")String sort,@RequestParam(required=false)String page,@RequestParam(required=false)String size,@RequestParam(required=false)String format,
            @AuthenticationPrincipal UsuarioPrincipal principal){rejectVisualPagination(page,size,format);return response(service.medicoes(inicio,fim,unidadeId,equipamentoId,monitorId,status,sort,principal));}

    @GetMapping("/latencia/export")
    public ResponseEntity<StreamingResponseBody> latencia(@RequestParam Instant inicio,@RequestParam Instant fim,@RequestParam(required=false)Long unidadeId,
            @RequestParam(required=false)Long equipamentoId,@RequestParam(required=false)Long monitorId,@RequestParam(defaultValue="monitorNome,asc")String sort,
            @RequestParam(required=false)String page,@RequestParam(required=false)String size,@RequestParam(required=false)String format,
            @AuthenticationPrincipal UsuarioPrincipal principal){rejectVisualPagination(page,size,format);return response(service.latencia(inicio,fim,unidadeId,equipamentoId,monitorId,sort,principal));}

    @GetMapping("/notificacoes/export")
    public ResponseEntity<StreamingResponseBody> notificacoes(@RequestParam Instant inicio,@RequestParam Instant fim,@RequestParam(required=false)Long incidenteId,
            @RequestParam(required=false)StatusNotificacao status,@RequestParam(required=false)CanalNotificacao canal,@RequestParam(required=false)TipoEventoNotificacao tipoEvento,
            @RequestParam(defaultValue="createdAt,desc")String sort,@RequestParam(required=false)String page,@RequestParam(required=false)String size,@RequestParam(required=false)String format,
            @AuthenticationPrincipal UsuarioPrincipal principal){rejectVisualPagination(page,size,format);return response(service.notificacoes(inicio,fim,incidenteId,status,canal,tipoEvento,sort,principal));}

    private ResponseEntity<StreamingResponseBody> response(RelatorioExportService.ExportDownload download){String filename=download.filename();String disposition="attachment; filename=\""+filename+"\"; filename*=UTF-8''"+filename;return ResponseEntity.ok().contentType(CSV).cacheControl(CacheControl.noStore()).header(HttpHeaders.CONTENT_DISPOSITION,disposition).body(download.body());}
    private void rejectVisualPagination(String page,String size,String format){if(page!=null||size!=null||format!=null)throw new IllegalArgumentException("page, size e format nao sao aceitos na exportacao");}
}
