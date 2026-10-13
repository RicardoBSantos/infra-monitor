package br.com.inframonitor.testsupport;

import org.junit.jupiter.api.extension.ConditionEvaluationResult;
import org.junit.jupiter.api.extension.ExecutionCondition;
import org.junit.jupiter.api.extension.ExtensionContext;
import org.testcontainers.DockerClientFactory;

/** Condicao de {@link RequerDocker}. O Testcontainers guarda o resultado da sondagem. */
class DockerDisponivelCondition implements ExecutionCondition {

    static final String MOTIVO = "Docker indisponivel: teste de integracao Postgres pulado";

    @Override
    public ConditionEvaluationResult evaluateExecutionCondition(ExtensionContext context) {
        return DockerClientFactory.instance().isDockerAvailable()
                ? ConditionEvaluationResult.enabled("Docker disponivel")
                : ConditionEvaluationResult.disabled(MOTIVO);
    }
}
