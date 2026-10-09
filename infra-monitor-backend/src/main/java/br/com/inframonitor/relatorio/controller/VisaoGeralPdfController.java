package br.com.inframonitor.relatorio.controller;

import br.com.inframonitor.relatorio.pdf.VisaoGeralPdfService;
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

import java.time.Instant;

@RestController
@RequestMapping("/api/v1/relatorios/visao-geral/export")
public class VisaoGeralPdfController {
    private static final MediaType PDF = MediaType.APPLICATION_PDF;
    private final VisaoGeralPdfService service;

    public VisaoGeralPdfController(VisaoGeralPdfService service) { this.service = service; }

    @GetMapping("/pdf")
    public ResponseEntity<byte[]> exportar(@RequestParam Instant inicio, @RequestParam Instant fim,
                                            @AuthenticationPrincipal UsuarioPrincipal principal) {
        VisaoGeralPdfService.Download download = service.exportar(inicio, fim, principal);
        String disposition = "attachment; filename=\"" + download.filename() + "\"; filename*=UTF-8''" +
                download.filename();
        return ResponseEntity.ok().contentType(PDF).cacheControl(CacheControl.noStore())
                .header(HttpHeaders.CONTENT_DISPOSITION, disposition).contentLength(download.bytes().length)
                .body(download.bytes());
    }
}
