package br.com.inframonitor.common.config;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.boot.env.YamlPropertySourceLoader;
import org.springframework.core.env.MutablePropertySources;
import org.springframework.core.env.PropertySource;
import org.springframework.core.env.PropertySourcesPropertyResolver;
import org.springframework.core.io.ClassPathResource;

import java.io.IOException;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Ligar Telegram, dispatcher, motor ou agendador de manutencao tem de ser ato explicito de quem sobe o processo.
 *
 * <p>Resolve os YAML versionados sem nenhuma variavel de ambiente: o que sobra e o default.
 * Tambem barra {@code spring.config.import} nos YAML, porque importar o {@code .env} do
 * diretorio de trabalho carregaria o token real em todo boot local e em todo contexto de teste.
 */
class ConfiguracaoPadraoDesligadaTest {

    @ParameterizedTest
    @ValueSource(strings = {"application.yml", "application-dev.yml", "application-prod.yml"})
    void nenhumYamlImportaArquivoExterno(String arquivo) throws IOException {
        for (PropertySource<?> fonte : carregar(arquivo)) {
            assertThat(fonte.containsProperty("spring.config.import"))
                    .as("%s nao pode declarar spring.config.import", arquivo)
                    .isFalse();
        }
    }

    @Test
    void semVariaveisDeAmbienteNadaQueAgeSozinhoLiga() throws IOException {
        MutablePropertySources fontes = new MutablePropertySources();
        carregar("application.yml").forEach(fontes::addLast);
        PropertySourcesPropertyResolver resolver = new PropertySourcesPropertyResolver(fontes);

        assertThat(resolver.getProperty("notification.telegram.enabled", Boolean.class)).isFalse();
        assertThat(resolver.getProperty("notification.dispatcher.enabled", Boolean.class)).isFalse();
        assertThat(resolver.getProperty("monitoring.engine.enabled", Boolean.class)).isFalse();
        assertThat(resolver.getProperty("manutencao.agendada.enabled", Boolean.class)).isFalse();
        assertThat(resolver.getProperty("notification.telegram.bot-token")).isEmpty();
    }

    private static List<PropertySource<?>> carregar(String arquivo) throws IOException {
        return new YamlPropertySourceLoader().load(arquivo, new ClassPathResource(arquivo));
    }
}
