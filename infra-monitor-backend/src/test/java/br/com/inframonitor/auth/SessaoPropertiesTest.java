package br.com.inframonitor.auth;

import org.junit.jupiter.api.Test;

import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class SessaoPropertiesTest {

    @Test
    void recusaDuracaoForaDoIntervalo() {
        assertThatThrownBy(() -> new SessaoProperties(Duration.ofSeconds(59), true).validar())
                .isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> new SessaoProperties(Duration.ofHours(25), true).validar())
                .isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> new SessaoProperties(null, true).validar())
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void aceitaDuracaoDentroDoIntervalo() {
        assertThatCode(() -> new SessaoProperties(Duration.ofHours(10), true).validar()).doesNotThrowAnyException();
        assertThatCode(() -> new SessaoProperties(Duration.ofMinutes(1), false).validar()).doesNotThrowAnyException();
        assertThatCode(() -> new SessaoProperties(Duration.ofHours(24), false).validar()).doesNotThrowAnyException();
    }
}
