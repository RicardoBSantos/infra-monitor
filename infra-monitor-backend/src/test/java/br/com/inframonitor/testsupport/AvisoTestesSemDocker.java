package br.com.inframonitor.testsupport;

import org.junit.platform.engine.support.descriptor.ClassSource;
import org.junit.platform.launcher.TestExecutionListener;
import org.junit.platform.launcher.TestIdentifier;
import org.junit.platform.launcher.TestPlan;

import java.util.Set;
import java.util.TreeSet;

/**
 * Anuncia no fim da suite as classes {@link RequerDocker} puladas por falta de Docker.
 * Registrado em {@code META-INF/services/org.junit.platform.launcher.TestExecutionListener}.
 */
public class AvisoTestesSemDocker implements TestExecutionListener {

    private final Set<String> puladas = new TreeSet<>();

    @Override
    public void executionSkipped(TestIdentifier identificador, String motivo) {
        if (DockerDisponivelCondition.MOTIVO.equals(motivo)
                && identificador.getSource().orElse(null) instanceof ClassSource classe) {
            puladas.add(classe.getClassName());
        }
    }

    @Override
    public void testPlanExecutionFinished(TestPlan plano) {
        if (puladas.isEmpty()) {
            return;
        }
        String linha = "!".repeat(78);
        StringBuilder aviso = new StringBuilder()
                .append('\n').append(linha).append('\n')
                .append("!! ").append(puladas.size()).append(" classes puladas: Docker indisponivel.\n")
                .append("!! O banco (PostgreSQL/Flyway) NAO foi testado. Suite verde aqui nao vale.\n")
                .append("!! Suba o Docker e rode de novo para a contagem completa.\n");
        puladas.forEach(nome -> aviso.append("!!   - ").append(nome).append('\n'));
        aviso.append(linha).append('\n');
        System.err.print(aviso);
        System.err.flush();
    }
}
