package br.com.inframonitor.auth.dto;
import br.com.inframonitor.usuario.dto.UsuarioResponse;
public record LoginResponse(String accessToken, long expiresIn, UsuarioResponse usuario) { }
