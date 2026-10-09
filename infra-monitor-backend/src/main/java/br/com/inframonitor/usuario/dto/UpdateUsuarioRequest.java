package br.com.inframonitor.usuario.dto;
import br.com.inframonitor.usuario.entity.Papel;
import jakarta.validation.constraints.*;
public record UpdateUsuarioRequest(@NotBlank @Size(max=150) String nome, @NotBlank @Email @Size(max=254) String email,
                                   @NotNull Papel papel) { }
