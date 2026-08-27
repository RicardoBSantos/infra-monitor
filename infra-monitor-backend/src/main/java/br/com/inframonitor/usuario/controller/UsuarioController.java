package br.com.inframonitor.usuario.controller;
import br.com.inframonitor.usuario.dto.*; import br.com.inframonitor.usuario.service.UsuarioService;
import jakarta.validation.Valid; import org.springframework.http.*; import org.springframework.security.core.annotation.AuthenticationPrincipal; import org.springframework.web.bind.annotation.*; import org.springframework.web.servlet.support.ServletUriComponentsBuilder; import java.util.*;
@RestController @RequestMapping("/api/v1/usuarios")
public class UsuarioController {
 private final UsuarioService service; public UsuarioController(UsuarioService service){this.service=service;}
 @GetMapping public List<UsuarioResponse> listar(){return service.listar();} @GetMapping("/{id}") public UsuarioResponse buscar(@PathVariable Long id){return service.buscar(id);}
 @PostMapping public ResponseEntity<UsuarioResponse> criar(@Valid @RequestBody CreateUsuarioRequest r){UsuarioResponse x=service.criar(r); return ResponseEntity.status(HttpStatus.CREATED).location(ServletUriComponentsBuilder.fromCurrentRequest().path("/{id}").buildAndExpand(x.id()).toUri()).body(x);}
 @PutMapping("/{id}") public UsuarioResponse atualizar(@PathVariable Long id,@Valid @RequestBody UpdateUsuarioRequest r){return service.atualizar(id,r);}
 @PatchMapping("/{id}/ativar") public UsuarioResponse ativar(@PathVariable Long id){return service.ativar(id);}
 @PatchMapping("/{id}/desativar") public UsuarioResponse desativar(@PathVariable Long id,@AuthenticationPrincipal br.com.inframonitor.security.UsuarioPrincipal p){return service.desativar(id,p.id());}
 @PutMapping("/{id}/senha") public UsuarioResponse resetar(@PathVariable Long id,@Valid @RequestBody ResetSenhaRequest r){return service.resetarSenha(id,r);}
 @PutMapping("/me/senha") @ResponseStatus(HttpStatus.NO_CONTENT) public void trocar(@AuthenticationPrincipal br.com.inframonitor.security.UsuarioPrincipal p,@Valid @RequestBody TrocaSenhaRequest r){service.trocarMinhaSenha(p.id(),r);}
}
