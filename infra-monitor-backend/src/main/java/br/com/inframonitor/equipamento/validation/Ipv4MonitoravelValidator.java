package br.com.inframonitor.equipamento.validation;

import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;

/** Troca a mensagem padrao pelo motivo exato, para o formulario dizer o que corrigir. */
public class Ipv4MonitoravelValidator implements ConstraintValidator<Ipv4Monitoravel, String> {

    @Override
    public boolean isValid(String valor, ConstraintValidatorContext contexto) {
        String motivo = RegraIpv4.motivoDeRecusa(valor);
        if (motivo == null) return true;
        contexto.disableDefaultConstraintViolation();
        contexto.buildConstraintViolationWithTemplate(motivo).addConstraintViolation();
        return false;
    }
}
