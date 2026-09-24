package br.com.inframonitor.usuario.dto;
import jakarta.validation.constraints.*;
public record TrocaSenhaRequest(@NotBlank String senhaAtual, @NotBlank @Size(min=12,max=128) String novaSenha) { }
