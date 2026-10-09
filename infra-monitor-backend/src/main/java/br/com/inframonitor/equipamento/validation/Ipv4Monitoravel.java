package br.com.inframonitor.equipamento.validation;

import jakarta.validation.Constraint;
import jakarta.validation.Payload;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/** IP opcional; quando presente, so IPv4 de host monitoravel. Regra em {@link RegraIpv4}. */
@Documented
@Constraint(validatedBy = Ipv4MonitoravelValidator.class)
@Target({ElementType.FIELD, ElementType.METHOD, ElementType.PARAMETER})
@Retention(RetentionPolicy.RUNTIME)
public @interface Ipv4Monitoravel {
    String message() default RegraIpv4.FORMATO;
    Class<?>[] groups() default {};
    Class<? extends Payload>[] payload() default {};
}
