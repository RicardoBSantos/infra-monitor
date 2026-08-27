package br.com.inframonitor.relatorio.pdf;

import br.com.inframonitor.security.UsuarioPrincipal;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.UUID;

@Service
public class VisaoGeralPdfService {
    private static final Logger audit = LoggerFactory.getLogger("REPORT_EXPORT_AUDIT");
    private static final Duration MAX_PERIOD = Duration.ofDays(31);
    private final VisaoGeralPdfRepository repository;
    private final VisaoGeralPdfRenderer renderer;

    public VisaoGeralPdfService(VisaoGeralPdfRepository repository, VisaoGeralPdfRenderer renderer) {
        this.repository = repository;
        this.renderer = renderer;
    }

    public Download exportar(Instant inicio, Instant fim, UsuarioPrincipal principal) {
        String correlationId = UUID.randomUUID().toString();
        long started = System.nanoTime();
        audit.info("event=PDF_EXPORT_STARTED correlationId={} userId={} papel={} relatorio=visao-geral inicio={} fim={} bytes=0 duracaoMs=0 timestamp={} resultado=STARTED",
                correlationId, principal.id(), principal.papel(), inicio, fim, Instant.now());
        try {
            validar(inicio, fim);
            Instant generatedAt = Instant.now();
            VisaoGeralPdfRepository.Coleta coleta = repository.coletar(inicio, fim, generatedAt);
            long renderStarted = System.nanoTime();
            byte[] bytes = renderer.render(coleta.modelo());
            long renderMillis = elapsed(renderStarted);
            long totalMillis = elapsed(started);
            audit.info("event=PDF_EXPORT_SUCCEEDED correlationId={} userId={} papel={} relatorio=visao-geral inicio={} fim={} consultasMs={} geracaoMs={} bytes={} duracaoMs={} timestamp={} resultado=SUCCEEDED",
                    correlationId, principal.id(), principal.papel(), inicio, fim, coleta.consultasMillis(), renderMillis,
                    bytes.length, totalMillis, Instant.now());
            return new Download(filename(inicio, fim), bytes, coleta.modelo(), coleta.consultasMillis(), renderMillis,
                    totalMillis);
        } catch (RuntimeException exception) {
            audit.warn("event=PDF_EXPORT_FAILED correlationId={} userId={} papel={} relatorio=visao-geral inicio={} fim={} bytes=0 duracaoMs={} timestamp={} resultado=FAILED code={}",
                    correlationId, principal.id(), principal.papel(), inicio, fim, elapsed(started), Instant.now(),
                    exception.getClass().getSimpleName());
            throw exception;
        }
    }

    private static void validar(Instant inicio, Instant fim) {
        if (inicio == null || fim == null) throw new IllegalArgumentException("inicio e fim sao obrigatorios");
        if (inicio.isAfter(fim)) throw new IllegalArgumentException("Periodo invalido: inicio posterior ao fim");
        if (Duration.between(inicio, fim).compareTo(MAX_PERIOD) > 0)
            throw new IllegalArgumentException("Periodo invalido: maximo de 31 dias");
    }

    private static String filename(Instant inicio, Instant fim) {
        DateTimeFormatter date = DateTimeFormatter.ISO_LOCAL_DATE;
        return "visao-geral_" + date.format(inicio.atZone(ZoneOffset.UTC)) + "_" +
                date.format(fim.atZone(ZoneOffset.UTC)) + ".pdf";
    }

    private static long elapsed(long started) { return (System.nanoTime() - started) / 1_000_000; }

    public record Download(String filename, byte[] bytes, VisaoGeralPdfModel modelo, long consultasMillis,
                           long geracaoMillis, long totalMillis) { }
}
