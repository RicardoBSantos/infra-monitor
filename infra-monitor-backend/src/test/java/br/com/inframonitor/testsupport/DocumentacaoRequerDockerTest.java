package br.com.inframonitor.testsupport;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

/** Impede que a documentacao anuncie uma cobertura de banco diferente da suite real. */
class DocumentacaoRequerDockerTest {
    private static final Pattern ANOTACAO = Pattern.compile("(?m)^\\s*@RequerDocker\\b");

    @Test
    void contagensDocumentadasConferemComAsClassesAnotadas() throws IOException {
        long quantidade;
        try (var fontes = Files.walk(Path.of("src/test/java"))) {
            quantidade = fontes.filter(p -> p.toString().endsWith(".java"))
                    .filter(DocumentacaoRequerDockerTest::requerDocker).count();
        }
        assertThat(quantidade).isPositive();
        assertThat(Files.readString(Path.of("../CLAUDE.md")))
                .contains("As " + quantidade + " classes de integração com PostgreSQL real");
        assertThat(Files.readString(Path.of("README.md")))
                .contains("classes de integração Postgres (" + quantidade + " hoje)");
    }

    private static boolean requerDocker(Path arquivo) {
        try {
            return ANOTACAO.matcher(Files.readString(arquivo)).find();
        } catch (IOException e) {
            throw new java.io.UncheckedIOException(e);
        }
    }
}
