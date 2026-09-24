package br.com.inframonitor.usuario.dto;
import jakarta.validation.constraints.*;
public record ResetSenhaRequest(@NotBlank @Size(min=12,max=128) String novaSenha) { }
