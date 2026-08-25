package br.com.inframonitor.tipoequipamento.repository;

import br.com.inframonitor.tipoequipamento.entity.TipoEquipamento;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface TipoEquipamentoRepository extends JpaRepository<TipoEquipamento, Long> {

    boolean existsByNomeIgnoreCase(String nome);

    List<TipoEquipamento> findAllByOrderByNomeAsc();

    List<TipoEquipamento> findAllByAtivoOrderByNomeAsc(boolean ativo);
}
