package br.com.inframonitor.relatorio.exportacao;

import br.com.inframonitor.medicao.entity.StatusMedicao;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayOutputStream;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Arrays;

import static org.assertj.core.api.Assertions.assertThat;

class CsvWriterTest {
    @Test
    void escreveBomUtf8HeaderCrLfEscapingNullDataDecimalEEnum() throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        CsvWriter csv = new CsvWriter(output);
        csv.writeHeader("nome", "texto", "vazio", "data", "decimal", "status");
        csv.writeRow("São José", "vírgula, \"aspas\"\r\nlinha", null,
                Instant.parse("2026-08-25T14:32:10Z"), new BigDecimal("1000000000000000.50"), StatusMedicao.SUCESSO);
        csv.flush();

        byte[] bytes = output.toByteArray();
        assertThat(Arrays.copyOf(bytes, 3)).containsExactly(CsvWriter.UTF8_BOM);
        String body = new String(bytes, 3, bytes.length - 3, StandardCharsets.UTF_8);
        assertThat(body).isEqualTo("nome,texto,vazio,data,decimal,status\r\n"
                + "São José,\"vírgula, \"\"aspas\"\"\r\nlinha\",,2026-08-25T14:32:10Z,1000000000000000.50,SUCESSO\r\n");
        assertThat(body.replace("\r\n", "")).doesNotContain("\n");
    }

    @Test
    void neutralizaFormulaInclusiveAposEspacosETabCrLfSemAlterarNumeroNegativo() throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        CsvWriter csv = new CsvWriter(output);
        csv.writeHeader("a","b","c","d","e","f","g","h","i","numero");
        csv.writeRow("=1+1","+SUM(A1:A2)","-10+20","@cmd","  =1+1","\t=1+1","\r=1+1","\n=1+1","  \t=1+1",-10);
        csv.flush();
        String body = new String(output.toByteArray(), 3, output.size()-3, StandardCharsets.UTF_8);
        assertThat(body).contains("'=1+1","'+SUM(A1:A2)","'-10+20","'@cmd","'  =1+1","'\t=1+1","'\r=1+1","'\n=1+1","'  \t=1+1",",-10\r\n");
    }
}
