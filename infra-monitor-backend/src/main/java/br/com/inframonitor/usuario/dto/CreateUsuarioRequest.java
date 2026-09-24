package br.com.inframonitor.usuario.dto;
import br.com.inframonitor.usuario.entity.Papel;
import jakarta.validation.constraints.*;
public record CreateUsuarioRequest(@NotBlank @Size(max=150) String nome, @NotBlank @Email @Size(max=254) String email,
                                   @NotBlank @Size(min=12,max=128) String senhaInicial, @NotNull Papel papel) { }
