package br.com.inframonitor.usuario.service;

import br.com.inframonitor.common.exception.*;
import br.com.inframonitor.usuario.dto.*;
import br.com.inframonitor.usuario.entity.*;
import br.com.inframonitor.usuario.repository.UsuarioRepository;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.util.*;

@Service @Transactional(readOnly = true)
public class UsuarioService {
    private final UsuarioRepository repository; private final PasswordEncoder passwordEncoder;
    public UsuarioService(UsuarioRepository repository, PasswordEncoder passwordEncoder) { this.repository = repository; this.passwordEncoder = passwordEncoder; }
    public List<UsuarioResponse> listar() { return repository.findAllByOrderByNomeAsc().stream().map(this::resposta).toList(); }
    public UsuarioResponse buscar(Long id) { return resposta(obter(id)); }
    @Transactional public UsuarioResponse criar(CreateUsuarioRequest r) {
        String email = email(r.email()); if (repository.existsByEmailIgnoreCase(email)) throw new ConflitoException("Ja existe um usuario com este e-mail");
        return resposta(repository.save(new Usuario(nome(r.nome()), email, passwordEncoder.encode(r.senhaInicial()), r.papel(), true)));
    }
    @Transactional public UsuarioResponse atualizar(Long id, UpdateUsuarioRequest r) {
        repository.lockActiveAdmins(); Usuario u = repository.findByIdForUpdate(id).orElseThrow(() -> naoEncontrado());
        String email = email(r.email());
        if (!u.getEmail().equalsIgnoreCase(email) && repository.existsByEmailIgnoreCase(email)) throw new ConflitoException("Ja existe um usuario com este e-mail");
        if (u.getPapel() == Papel.ADMIN && u.isAtivo() && r.papel() != Papel.ADMIN && ativosAdminsAposExclusao(u) == 0) throw new ConflitoException("Nao e permitido rebaixar o ultimo ADMIN ativo");
        u.setNome(nome(r.nome())); u.setEmail(email); u.setPapel(r.papel()); return resposta(u);
    }
    @Transactional public UsuarioResponse ativar(Long id) { Usuario u = obter(id); u.setAtivo(true); return resposta(u); }
    @Transactional public UsuarioResponse desativar(Long id, Long solicitanteId) {
        if (id.equals(solicitanteId)) throw new ConflitoException("ADMIN nao pode desativar a propria conta");
        repository.lockActiveAdmins(); Usuario u = repository.findByIdForUpdate(id).orElseThrow(() -> naoEncontrado());
        if (u.getPapel() == Papel.ADMIN && u.isAtivo() && ativosAdminsAposExclusao(u) == 0) throw new ConflitoException("Nao e permitido desativar o ultimo ADMIN ativo");
        u.setAtivo(false); return resposta(u);
    }
    @Transactional public UsuarioResponse resetarSenha(Long id, ResetSenhaRequest r) { Usuario u = obter(id); u.setSenhaHash(passwordEncoder.encode(r.novaSenha())); u.setTrocaSenhaObrigatoria(true); return resposta(u); }
    @Transactional public void trocarMinhaSenha(Long id, TrocaSenhaRequest r) {
        Usuario u = obter(id); if (!passwordEncoder.matches(r.senhaAtual(), u.getSenhaHash())) throw new IllegalArgumentException("Senha atual invalida");
        u.setSenhaHash(passwordEncoder.encode(r.novaSenha())); u.setTrocaSenhaObrigatoria(false);
    }
    @Transactional public void registrarLogin(Usuario u) { u.setUltimoLoginEm(java.time.Instant.now()); }
    public Usuario obter(Long id) { return repository.findById(id).orElseThrow(() -> naoEncontrado()); }
    public UsuarioResponse resposta(Usuario u) { return new UsuarioResponse(u.getId(),u.getNome(),u.getEmail(),u.getPapel(),u.isAtivo(),u.isTrocaSenhaObrigatoria()); }
    private int ativosAdminsAposExclusao(Usuario alvo) { return (int) repository.lockActiveAdmins().stream().filter(a -> !a.getId().equals(alvo.getId())).count(); }
    private String email(String value) { return value.trim().toLowerCase(Locale.ROOT); } private String nome(String value) { return value.trim(); }
    private RecursoNaoEncontradoException naoEncontrado() { return new RecursoNaoEncontradoException("Usuario nao encontrado"); }
}
