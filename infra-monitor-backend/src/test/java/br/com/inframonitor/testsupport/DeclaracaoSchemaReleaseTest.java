package br.com.inframonitor.testsupport;

import org.junit.jupiter.api.Test;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.util.Arrays;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * {@code release/schema-compatibility.json} vai dentro do JAR e o empacotamento Windows o lê
 * ({@code deployment/windows/package.py}): {@code schemaVersion} tem de ser a maior migration Flyway do
 * próprio JAR, e {@code minSchemaVersion} é o banco mais antigo em que este JAR foi PROVADO rodar.
 * Migration nova sem rever a declaração quebra aqui, no PR, e não no empacotamento depois do merge — foi
 * assim, sem trava, que a V26 (84758be) saiu num pacote que declarava 25.
 */
class DeclaracaoSchemaReleaseTest {
    private static final Pattern MIGRATION = Pattern.compile("V(\\d+)__.+\\.sql");

    @Test
    void declaracaoAcompanhaAsMigrationsDoJar() throws IOException {
        Resource[] migrations = new PathMatchingResourcePatternResolver().getResources("classpath*:db/migration/V*__*.sql");
        int maior = Arrays.stream(migrations).map(Resource::getFilename)
                .map(MIGRATION::matcher).filter(Matcher::matches)
                .mapToInt(m -> Integer.parseInt(m.group(1))).max().orElseThrow();

        JsonNode declaracao;
        try (var entrada = getClass().getResourceAsStream("/release/schema-compatibility.json")) {
            assertThat(entrada).as("release/schema-compatibility.json no classpath").isNotNull();
            declaracao = JsonMapper.builder().build().readTree(entrada);
        }
        int schema = declaracao.get("schemaVersion").asInt();
        int minimo = declaracao.get("minSchemaVersion").asInt();

        assertThat(schema).as("schemaVersion declarado = maior migration do JAR (V%d)", maior).isEqualTo(maior);
        assertThat(minimo).as("minSchemaVersion entre 25 e schemaVersion").isBetween(25, schema);
        if (minimo < schema) {
            assertThat(declaracao.path("evidence").asString("")).as("tolerância declarada precisa citar a prova").isNotBlank();
        }
    }
}
