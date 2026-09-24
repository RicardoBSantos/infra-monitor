package br.com.inframonitor.usuario.dto;
import br.com.inframonitor.usuario.entity.Papel;
public record UsuarioResponse(Long id, String nome, String email, Papel papel, boolean ativo, boolean trocaSenhaObrigatoria) { }
