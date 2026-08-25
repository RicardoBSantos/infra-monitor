package br.com.inframonitor.unidade.repository;

import br.com.inframonitor.unidade.entity.Unidade;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface UnidadeRepository extends JpaRepository<Unidade, Long> {

    boolean existsByNomeIgnoreCase(String nome);

    boolean existsBySiglaIgnoreCase(String sigla);

    List<Unidade> findAllByOrderByNomeAsc();

    List<Unidade> findAllByAtivoOrderByNomeAsc(boolean ativo);
}
