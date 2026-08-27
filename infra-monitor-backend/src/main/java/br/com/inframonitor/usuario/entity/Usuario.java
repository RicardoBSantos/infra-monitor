package br.com.inframonitor.usuario.entity;

import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name = "usuarios")
public class Usuario {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) private Long id;
    @Column(nullable = false, length = 150) private String nome;
    @Column(nullable = false, length = 254) private String email;
    @Column(name = "senha_hash", nullable = false, length = 100) private String senhaHash;
    @Enumerated(EnumType.STRING) @Column(nullable = false, length = 20) private Papel papel;
    @Column(nullable = false) private boolean ativo;
    @Column(name = "troca_senha_obrigatoria", nullable = false) private boolean trocaSenhaObrigatoria;
    @Column(name = "ultimo_login_em") private Instant ultimoLoginEm;
    @Column(name = "created_at", nullable = false, updatable = false) private Instant createdAt;
    @Column(name = "updated_at", nullable = false) private Instant updatedAt;

    protected Usuario() { }
    public Usuario(String nome, String email, String senhaHash, Papel papel, boolean trocaSenhaObrigatoria) {
        this.nome = nome; this.email = email; this.senhaHash = senhaHash; this.papel = papel;
        this.ativo = true; this.trocaSenhaObrigatoria = trocaSenhaObrigatoria;
    }
    @PrePersist void criar() { Instant agora = Instant.now(); createdAt = agora; updatedAt = agora; }
    @PreUpdate void atualizar() { updatedAt = Instant.now(); }
    public Long getId() { return id; } public String getNome() { return nome; } public void setNome(String nome) { this.nome = nome; }
    public String getEmail() { return email; } public void setEmail(String email) { this.email = email; }
    public String getSenhaHash() { return senhaHash; } public void setSenhaHash(String senhaHash) { this.senhaHash = senhaHash; }
    public Papel getPapel() { return papel; } public void setPapel(Papel papel) { this.papel = papel; }
    public boolean isAtivo() { return ativo; } public void setAtivo(boolean ativo) { this.ativo = ativo; }
    public boolean isTrocaSenhaObrigatoria() { return trocaSenhaObrigatoria; } public void setTrocaSenhaObrigatoria(boolean valor) { trocaSenhaObrigatoria = valor; }
    public Instant getUltimoLoginEm() { return ultimoLoginEm; } public void setUltimoLoginEm(Instant valor) { ultimoLoginEm = valor; }
    public Instant getCreatedAt() { return createdAt; } public Instant getUpdatedAt() { return updatedAt; }
}
