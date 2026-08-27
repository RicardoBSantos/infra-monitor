package br.com.inframonitor.usuario.repository;

import br.com.inframonitor.usuario.entity.*;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.*;
import org.springframework.data.repository.query.Param;
import java.util.*;

public interface UsuarioRepository extends JpaRepository<Usuario, Long> {
    Optional<Usuario> findByEmailIgnoreCase(String email);
    boolean existsByEmailIgnoreCase(String email);
    List<Usuario> findAllByOrderByNomeAsc();
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select u from Usuario u where u.id = :id")
    Optional<Usuario> findByIdForUpdate(@Param("id") Long id);
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select u from Usuario u where u.papel = br.com.inframonitor.usuario.entity.Papel.ADMIN and u.ativo = true")
    List<Usuario> lockActiveAdmins();
}
