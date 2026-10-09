package br.com.inframonitor.relatorio.pdf;

import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDDocumentInformation;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.common.PDRectangle;
import org.apache.pdfbox.pdmodel.font.PDFont;
import org.apache.pdfbox.pdmodel.font.PDType1Font;
import org.apache.pdfbox.pdmodel.font.PDType0Font;
import org.apache.pdfbox.pdmodel.font.Standard14Fonts;
import org.apache.pdfbox.util.Matrix;
import org.springframework.stereotype.Component;

import java.awt.Color;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;

/** Renderer PDF V1 programatico, sem HTML, browser, DOM ou entidades persistentes. */
@Component
public class VisaoGeralPdfRenderer {
    private static final float MARGIN = 36;
    private static final float BOTTOM = 42;
    private static final Color NAVY = new Color(19, 45, 75);
    private static final Color BLUE = new Color(31, 111, 168);
    private static final Color LIGHT = new Color(235, 242, 247);
    private static final Color GRID = new Color(190, 200, 208);
    private static final DateTimeFormatter INSTANT = DateTimeFormatter.ofPattern("dd/MM/yyyy HH:mm:ss 'UTC'")
            .withZone(ZoneOffset.UTC);

    private final PDFont bold = new PDType1Font(Standard14Fonts.FontName.HELVETICA_BOLD);

    public byte[] render(VisaoGeralPdfModel model) {
        try (PDDocument document = new PDDocument(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            PDDocumentInformation information = new PDDocumentInformation();
            information.setTitle("Infra Monitor - Visão Geral");
            information.setAuthor("Infra Monitor");
            information.setSubject("Relatório consolidado server-side");
            document.setDocumentInformation(information);
            InputStream fontResource = VisaoGeralPdfRenderer.class.getResourceAsStream(
                    "/org/apache/pdfbox/resources/ttf/LiberationSans-Regular.ttf");
            if (fontResource == null) throw new IOException("Fonte Unicode nao encontrada");
            PDFont unicodeFont;
            try (fontResource) { unicodeFont = PDType0Font.load(document, fontResource, true); }
            Canvas canvas = new Canvas(document, unicodeFont);

            canvas.title("Visão Geral");
            canvas.text("Período: " + INSTANT.format(model.inicio()) + " a " + INSTANT.format(model.fim()), 10, NAVY);
            canvas.text("Gerado em: " + INSTANT.format(model.geradoEm()), 9, Color.DARK_GRAY);
            canvas.space(8);
            canvas.kpis(model.kpis());

            canvas.section("Top 5 Unidades por pior disponibilidade");
            canvas.table(new String[]{"Unidade", "Disponibilidade", "Estado", "Incidentes"},
                    new float[]{210, 95, 140, 70}, unidadeRows(model));

            canvas.section("Top 5 Equipamentos críticos");
            canvas.table(new String[]{"Equipamento", "Unidade", "Monitor", "Disponib.", "Estado", "Qualidade", "Inc."},
                    new float[]{105, 85, 80, 62, 78, 68, 32}, equipamentoRows(model));

            canvas.section("Latência por Monitor");
            canvas.table(new String[]{"Monitor", "Equipamento", "Unidade", "Mín.", "Média", "Máx.", "P95", "Amostras"},
                    new float[]{85, 90, 75, 48, 55, 48, 48, 61}, latenciaRows(model));

            canvas.section("Legenda analítica");
            canvas.text("CALCULADO: disponibilidade temporal calculável. SEM_DADOS: há monitor, mas não há janela observável. " +
                    "SEM_MONITORAMENTO: não há monitor ICMP. PRECISA: janela registrada no evento. INFERIDA: janela histórica inferida. " +
                    "Valores sem dados são exibidos como - e permanecem no fim dos rankings (NULLS LAST).", 8, Color.DARK_GRAY);
            canvas.close();
            document.save(output);
            return output.toByteArray();
        } catch (IOException exception) {
            throw new IllegalStateException("Falha ao gerar PDF da Visão Geral", exception);
        }
    }

    private List<String[]> unidadeRows(VisaoGeralPdfModel model) {
        List<String[]> rows = new ArrayList<>();
        for (VisaoGeralPdfModel.Unidade value : model.unidades()) rows.add(new String[]{safe(value.nome()),
                percent(value.disponibilidadePercentual()), safe(value.estadoAnalitico()), Long.toString(value.incidentes())});
        return emptyRow(rows, 4);
    }

    private List<String[]> equipamentoRows(VisaoGeralPdfModel model) {
        List<String[]> rows = new ArrayList<>();
        for (VisaoGeralPdfModel.Equipamento value : model.equipamentos()) rows.add(new String[]{safe(value.nome()),
                safe(value.unidade()), safe(value.monitor()), percent(value.disponibilidadePercentual()),
                safe(value.estadoAnalitico()), safe(value.qualidadeJanela()), Long.toString(value.incidentes())});
        return emptyRow(rows, 7);
    }

    private List<String[]> latenciaRows(VisaoGeralPdfModel model) {
        List<String[]> rows = new ArrayList<>();
        for (VisaoGeralPdfModel.Latencia value : model.latencias()) rows.add(new String[]{safe(value.monitor()),
                safe(value.equipamento()), safe(value.unidade()), millis(value.minLatenciaMs()),
                decimalMillis(value.avgLatenciaMs()), millis(value.maxLatenciaMs()), millis(value.p95LatenciaMs()),
                Long.toString(value.amostras())});
        return emptyRow(rows, 8);
    }

    private static List<String[]> emptyRow(List<String[]> rows, int columns) {
        if (!rows.isEmpty()) return rows;
        String[] empty = new String[columns];
        empty[0] = "Sem registros no período";
        for (int i = 1; i < columns; i++) empty[i] = "-";
        rows.add(empty);
        return rows;
    }

    // PDF e leitura humana: virgula como o resto da tela. CSV continua com ponto (dado para maquina, delimitador virgula).
    private static String duasCasas(BigDecimal value) {
        return value.setScale(2, RoundingMode.HALF_UP).toPlainString().replace('.', ',');
    }

    private static String percent(BigDecimal value) {
        return value == null ? "-" : duasCasas(value) + "%";
    }

    private static String millis(Integer value) { return value == null ? "-" : value + " ms"; }
    private static String decimalMillis(BigDecimal value) {
        return value == null ? "-" : duasCasas(value) + " ms";
    }
    private static String safe(String value) {
        if (value == null || value.isBlank()) return "-";
        return value.replace('\r', ' ').replace('\n', ' ').replaceAll("[\\p{Cc}]", " ").trim();
    }

    private final class Canvas {
        private final PDDocument document;
        private PDPage page;
        private PDPageContentStream stream;
        private final PDFont bodyFont;
        private float y;
        private int pageNumber;

        private Canvas(PDDocument document, PDFont bodyFont) throws IOException {
            this.document = document; this.bodyFont = bodyFont; newPage();
        }

        private void newPage() throws IOException {
            if (stream != null) stream.close();
            page = new PDPage(PDRectangle.A4);
            document.addPage(page);
            stream = new PDPageContentStream(document, page);
            pageNumber++;
            y = page.getMediaBox().getHeight() - MARGIN;
            stream.setNonStrokingColor(NAVY); stream.addRect(0, y - 26, page.getMediaBox().getWidth(), 26); stream.fill();
            drawText("INFRA MONITOR", MARGIN, y - 18, 10, bold, Color.WHITE);
            drawText("Página " + pageNumber, page.getMediaBox().getWidth() - 78, 20, 8, bodyFont, Color.GRAY);
            y -= 42;
        }

        private void title(String value) throws IOException { drawText(value, MARGIN, y, 22, bold, NAVY); y -= 29; }
        private void section(String value) throws IOException { ensure(44); y -= 18; drawText(value, MARGIN, y, 13, bold, NAVY); y -= 22; }
        private void space(float value) { y -= value; }

        private void text(String value, float size, Color color) throws IOException {
            List<String> lines = wrap(safe(value), bodyFont, size, page.getMediaBox().getWidth() - 2 * MARGIN);
            ensure(lines.size() * (size + 3));
            for (String line : lines) { drawText(line, MARGIN, y, size, bodyFont, color); y -= size + 3; }
        }

        private void kpis(VisaoGeralPdfModel.Kpis kpis) throws IOException {
            ensure(72);
            float gap = 8, width = (page.getMediaBox().getWidth() - 2 * MARGIN - 2 * gap) / 3;
            kpi(MARGIN, width, "Incidentes abertos", kpis.incidentesAbertos());
            kpi(MARGIN + width + gap, width, "Medições com falha", kpis.medicoesComFalha());
            kpi(MARGIN + 2 * (width + gap), width, "Notificações com falha", kpis.notificacoesComFalha());
            y -= 70;
        }

        private void kpi(float x, float width, String label, long value) throws IOException {
            stream.setNonStrokingColor(LIGHT); stream.addRect(x, y - 57, width, 57); stream.fill();
            drawText(label, x + 8, y - 17, 8, bold, NAVY);
            drawText(Long.toString(value), x + 8, y - 44, 20, bold, BLUE);
        }

        private void table(String[] headers, float[] widths, List<String[]> rows) throws IOException {
            float height = 18;
            ensure(height * 2);
            drawRow(headers, widths, true, height);
            for (String[] row : rows) {
                if (y - height < BOTTOM) { newPage(); drawRow(headers, widths, true, height); }
                drawRow(row, widths, false, height);
            }
        }

        private void drawRow(String[] cells, float[] widths, boolean header, float height) throws IOException {
            float x = MARGIN;
            stream.setNonStrokingColor(header ? NAVY : Color.WHITE);
            stream.addRect(x, y - height, sum(widths), height); stream.fill();
            stream.setStrokingColor(GRID); stream.addRect(x, y - height, sum(widths), height); stream.stroke();
            for (int index = 0; index < cells.length; index++) {
                if (index > 0) { stream.moveTo(x, y); stream.lineTo(x, y - height); stream.stroke(); }
                PDFont font = header ? bold : bodyFont;
                Color color = header ? Color.WHITE : Color.DARK_GRAY;
                drawText(fit(safe(cells[index]), font, 7, widths[index] - 6), x + 3, y - 12, 7, font, color);
                x += widths[index];
            }
            y -= height;
        }

        private void ensure(float needed) throws IOException { if (y - needed < BOTTOM) newPage(); }
        private void close() throws IOException { if (stream != null) stream.close(); }

        private void drawText(String value, float x, float baseline, float size, PDFont font, Color color) throws IOException {
            stream.beginText(); stream.setFont(font, size); stream.setNonStrokingColor(color);
            stream.setTextMatrix(Matrix.getTranslateInstance(x, baseline)); stream.showText(safe(value)); stream.endText();
        }
    }

    private List<String> wrap(String value, PDFont font, float size, float maxWidth) throws IOException {
        List<String> lines = new ArrayList<>(); StringBuilder line = new StringBuilder();
        for (String word : value.split(" ")) {
            String candidate = line.isEmpty() ? word : line + " " + word;
            if (!line.isEmpty() && width(candidate, font, size) > maxWidth) { lines.add(line.toString()); line = new StringBuilder(word); }
            else line = new StringBuilder(candidate);
        }
        if (!line.isEmpty()) lines.add(line.toString());
        return lines;
    }

    private String fit(String value, PDFont font, float size, float maxWidth) throws IOException {
        if (width(value, font, size) <= maxWidth) return value;
        String suffix = "..."; int end = value.length();
        while (end > 0 && width(value.substring(0, end) + suffix, font, size) > maxWidth) end--;
        return end == 0 ? "-" : value.substring(0, end) + suffix;
    }

    private float width(String value, PDFont font, float size) throws IOException { return font.getStringWidth(value) / 1000 * size; }
    private static float sum(float[] values) { float total = 0; for (float value : values) total += value; return total; }
}
