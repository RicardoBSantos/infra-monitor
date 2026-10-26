package br.com.inframonitor.manutencao.config;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.boot.context.properties.bind.BindException;
import org.springframework.boot.context.properties.bind.Binder;
import org.springframework.boot.context.properties.source.MapConfigurationPropertySource;

import java.time.Duration;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** duracao-maxima so em horas inteiras e positivas, recusada no bind (boot), nao na criacao. */
class ManutencaoAgendadaPropertiesTest {

    @ParameterizedTest
    @ValueSource(strings = {"90m", "0h", "-1h", "3600001ms"})
    void recusaDuracaoQueNaoEHorasInteirasPositivas(String valor) {
        assertThatThrownBy(() -> ligar(valor))
                .isInstanceOf(BindException.class)
                .rootCause()
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("MANUTENCAO_AGENDADA_DURACAO_MAXIMA");
    }

    @Test
    void aceitaHorasEDias() {
        assertThat(ligar("72h").getDuracaoMaxima()).isEqualTo(Duration.ofHours(72));
        assertThat(ligar("5d").getDuracaoMaxima()).isEqualTo(Duration.ofDays(5));
        assertThat(ligar("120m").getDuracaoMaxima()).isEqualTo(Duration.ofHours(2));
    }

    @Test
    void padraoE72Horas() {
        assertThat(new ManutencaoAgendadaProperties().getDuracaoMaxima()).isEqualTo(Duration.ofHours(72));
    }

    private static ManutencaoAgendadaProperties ligar(String duracao) {
        Binder binder = new Binder(new MapConfigurationPropertySource(
                Map.of("manutencao.agendada.duracao-maxima", duracao)));
        return binder.bind("manutencao.agendada", ManutencaoAgendadaProperties.class).get();
    }
}
