package br.com.inframonitor.manutencao.repository;

import br.com.inframonitor.manutencao.entity.ManutencaoAgendada;
import br.com.inframonitor.manutencao.entity.SituacaoManutencao;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.Collection;
import java.util.List;

public interface ManutencaoAgendadaRepository extends JpaRepository<ManutencaoAgendada, Long> {

    /**
     * Filtro comum das listagens. ESCAPE '\': o servico escapa \, % e _ digitados, que assim
     * casam como texto e nao como curinga.
     */
    String FILTRO = " where m.situacao in :situacoes and (:unidadeId = 0 or u.id = :unidadeId)"
            + " and (lower(u.nome) like :busca escape '\\'"
            + " or lower(m.motivo) like :busca escape '\\')";
    String CONTAGEM = "select count(m) from ManutencaoAgendada m join m.unidade u" + FILTRO;

    /** ATIVA primeiro, depois por inicio. A ordem vive aqui: o Pageable chega sem Sort. */
    @Query(value = """
            select m from ManutencaoAgendada m join fetch m.unidade u join fetch m.criadoPor
              left join fetch m.encerradaPor left join fetch m.canceladaPor""" + FILTRO + """

             order by case when m.situacao = br.com.inframonitor.manutencao.entity.SituacaoManutencao.ATIVA
                           then 0 else 1 end,
                      m.inicioPrevisto asc, m.id asc""",
            countQuery = CONTAGEM)
    Page<ManutencaoAgendada> vigentes(@Param("situacoes") Collection<SituacaoManutencao> situacoes,
                                      @Param("busca") String busca, @Param("unidadeId") long unidadeId,
                                      Pageable pageable);

    /** Mais recente primeiro. */
    @Query(value = """
            select m from ManutencaoAgendada m join fetch m.unidade u join fetch m.criadoPor
              left join fetch m.encerradaPor left join fetch m.canceladaPor""" + FILTRO + """

             order by m.inicioPrevisto desc, m.id desc""",
            countQuery = CONTAGEM)
    Page<ManutencaoAgendada> historico(@Param("situacoes") Collection<SituacaoManutencao> situacoes,
                                       @Param("busca") String busca, @Param("unidadeId") long unidadeId,
                                      Pageable pageable);

    boolean existsByUnidadeId(Long unidadeId);

    @Query(value = "SELECT EXISTS (SELECT 1 FROM manutencao_agendada_equipamento WHERE equipamento_id = :id)",
            nativeQuery = true)
    boolean equipamentoConstaEmJanela(@Param("id") Long equipamentoId);

    /**
     * Janelas vigentes da mesma unidade que cruzam o periodo e cobrem algum equipamento em
     * comum; escopo UNIDADE de qualquer lado cobre todos. E aviso, nunca recusa.
     */
    @Query(value = """
            SELECT o.id FROM manutencao_agendada o
             WHERE o.id <> :id AND o.status IN ('AGENDADA', 'ATIVA') AND o.unidade_id = :unidadeId
               AND o.inicio_previsto < :fim AND o.fim_previsto > :inicio
               AND (:escopo = 'UNIDADE' OR o.escopo = 'UNIDADE' OR EXISTS (
                    SELECT 1 FROM manutencao_agendada_equipamento a JOIN manutencao_agendada_equipamento b
                        ON a.equipamento_id = b.equipamento_id
                     WHERE a.manutencao_id = o.id AND b.manutencao_id = :id))
             ORDER BY o.id""", nativeQuery = true)
    List<Long> sobreposicoes(@Param("id") Long id, @Param("unidadeId") Long unidadeId, @Param("escopo") String escopo,
                             @Param("inicio") Instant inicio, @Param("fim") Instant fim);
}
