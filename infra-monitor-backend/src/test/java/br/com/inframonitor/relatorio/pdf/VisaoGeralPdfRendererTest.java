package br.com.inframonitor.relatorio.pdf;

import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.text.PDFTextStripper;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class VisaoGeralPdfRendererTest {
    @Test
    void geraPdfValidoMultipaginaComUnicodeEstadosP95ENullSafety() throws Exception {
        List<VisaoGeralPdfModel.Unidade> unidades = new ArrayList<>();
        for (int index = 1; index <= 30; index++) unidades.add(new VisaoGeralPdfModel.Unidade(
                index == 1 ? "São José" : "Unidade " + index,
                index == 2 ? null : new BigDecimal("87.345"),
                index == 2 ? "SEM_DADOS" : index == 3 ? "SEM_MONITORAMENTO" : "CALCULADO", index));
        VisaoGeralPdfModel model = new VisaoGeralPdfModel(
                Instant.parse("2026-08-01T00:00:00Z"), Instant.parse("2026-08-26T23:59:59Z"),
                Instant.parse("2026-08-26T12:34:56Z"), new VisaoGeralPdfModel.Kpis(25, 31, 7), unidades,
                List.of(new VisaoGeralPdfModel.Equipamento("Produção", "São José", "Monitoração",
                        null, "SEM_DADOS", "INFERIDA", 1),
                        new VisaoGeralPdfModel.Equipamento("Core", "Matriz", "ICMP", new BigDecimal("99.10"),
                                "CALCULADO", "PRECISA", 0)),
                List.of(new VisaoGeralPdfModel.Latencia("Monitoração", "Produção", "São José", 10,
                        new BigDecimal("55.555"), 100, 96, 10),
                        new VisaoGeralPdfModel.Latencia("Sem amostras", "Roteador", "Filial", null,
                                null, null, null, 0)));

        byte[] pdf = new VisaoGeralPdfRenderer().render(model);

        assertThat(pdf).startsWith("%PDF".getBytes(java.nio.charset.StandardCharsets.US_ASCII));
        assertThat(pdf.length).isGreaterThan(1_000);
        try (PDDocument document = Loader.loadPDF(pdf)) {
            assertThat(document.getNumberOfPages()).isGreaterThan(1);
            String text = new PDFTextStripper().getText(document);
            assertThat(text).contains("Visão Geral", "01/08/2026 00:00:00 UTC", "Incidentes abertos",
                    "Medições com falha", "Notificações com falha", "São José", "Produção", "Monitoração",
                    "Top 5 Unidades", "Top 5 Equipamentos críticos", "Latência por Monitor", "87,35%", "99,10%", "55,56 ms",
                    "CALCULADO", "SEM_DADOS", "SEM_MONITORAMENTO", "PRECISA", "INFERIDA", "96 ms");
            assertThat(text).doesNotContain("null", "undefined", "NaN", "87.35%", "99.10%", "55.56 ms");
        }
    }
}
