package br.com.inframonitor.relatorio.exportacao;

import java.io.IOException;
import java.io.OutputStream;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.Instant;

/** Serializer CSV deliberadamente pequeno, explicito e compativel com RFC 4180. */
public final class CsvWriter {
    public static final byte[] UTF8_BOM = {(byte) 0xef, (byte) 0xbb, (byte) 0xbf};
    private static final byte[] COMMA = {','};
    private static final byte[] CRLF = {'\r', '\n'};
    private final OutputStream output;

    public CsvWriter(OutputStream output) throws IOException {
        this.output = output;
        output.write(UTF8_BOM);
    }

    public void writeHeader(String... headers) throws IOException {
        write(false, headers);
    }

    public void writeRow(Object... values) throws IOException {
        write(true, values);
    }

    public void flush() throws IOException {
        output.flush();
    }

    private void write(boolean neutralizeText, Object[] values) throws IOException {
        for (int i = 0; i < values.length; i++) {
            if (i > 0) output.write(COMMA);
            Object value = values[i];
            String rendered = render(value);
            if (neutralizeText && value instanceof String) rendered = neutralize(rendered);
            writeEscaped(rendered);
        }
        output.write(CRLF);
    }

    private String render(Object value) {
        if (value == null) return "";
        if (value instanceof BigDecimal decimal) return decimal.toPlainString();
        if (value instanceof Instant instant) return instant.toString();
        if (value instanceof Timestamp timestamp) return timestamp.toInstant().toString();
        if (value instanceof Enum<?> enumeration) return enumeration.name();
        return value.toString();
    }

    static String neutralize(String value) {
        if (value.isEmpty()) return value;
        char first = value.charAt(0);
        if (first == '\t' || first == '\r' || first == '\n') return "'" + value;
        int index = 0;
        while (index < value.length() && Character.isWhitespace(value.charAt(index))) index++;
        if (index < value.length()) {
            char candidate = value.charAt(index);
            if (candidate == '=' || candidate == '+' || candidate == '-' || candidate == '@') return "'" + value;
        }
        return value;
    }

    private void writeEscaped(String value) throws IOException {
        boolean quote = value.indexOf(',') >= 0 || value.indexOf('"') >= 0
                || value.indexOf('\r') >= 0 || value.indexOf('\n') >= 0;
        if (!quote) {
            output.write(value.getBytes(StandardCharsets.UTF_8));
            return;
        }
        output.write('"');
        output.write(value.replace("\"", "\"\"").getBytes(StandardCharsets.UTF_8));
        output.write('"');
    }
}
