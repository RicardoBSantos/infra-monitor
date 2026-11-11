package br.com.inframonitor.manutencao.service;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

/**
 * D-03: o agendador e separado do reconciliador para que o teste de integracao tenha o bean sem a
 * passada da subida. Em producao, ligar a manutencao agendada liga o agendador sem mais nada.
 * ApplicationContextRunner nao le src/test/resources/config, entao aqui valem os defaults reais.
 */
class AgendadorReconciliacaoManutencaoTest {

    private final ApplicationContextRunner contexto = new ApplicationContextRunner()
            .withBean(ReconciliadorManutencao.class, () -> mock(ReconciliadorManutencao.class))
            .withUserConfiguration(AgendadorReconciliacaoManutencao.class);

    @Test
    void manutencaoLigadaLigaOAgendadorPorPadrao() {
        contexto.withPropertyValues("manutencao.agendada.enabled=true")
                .run(c -> assertThat(c).hasSingleBean(AgendadorReconciliacaoManutencao.class));
    }

    @Test
    void manutencaoDesligadaNaoAgenda() {
        contexto.run(c -> assertThat(c).doesNotHaveBean(AgendadorReconciliacaoManutencao.class));
    }

    @Test
    void agendadorDesligadoMantemSoOReconciliador() {
        contexto.withPropertyValues("manutencao.agendada.enabled=true", "manutencao.agendada.agendador-ativo=false")
                .run(c -> {
                    assertThat(c).doesNotHaveBean(AgendadorReconciliacaoManutencao.class);
                    assertThat(c).hasSingleBean(ReconciliadorManutencao.class);
                });
    }
}
