package br.com.inframonitor.testsupport;

import org.junit.jupiter.api.extension.ExtendWith;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Classe de teste que precisa de PostgreSQL real via Testcontainers.
 *
 * <p>Sem Docker a classe e pulada em vez de dar erro, e {@link AvisoTestesSemDocker}
 * anuncia no fim da suite quantas classes ficaram sem rodar: suite verde que nao testou o
 * banco precisa dizer isso.
 */
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@ExtendWith(DockerDisponivelCondition.class)
public @interface RequerDocker {
}
