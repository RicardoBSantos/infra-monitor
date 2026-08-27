package br.com.inframonitor.auth.dto;
import jakarta.validation.constraints.*;
public record LoginRequest(@NotBlank @Email @Size(max=254) String email, @NotBlank String senha) { }
