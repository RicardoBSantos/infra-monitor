package br.com.inframonitor.manutencao.repository;

import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Map;
import java.util.Optional;

@Repository
public class CoberturaManutencao {

    /**
     * Fonte unica do predicado "coberto por janela ATIVA", com alias {@code e} para equipamento.
     * Olha o STATUS, nunca o relogio: so o reconciliador consulta o relogio (MA06), e painel,
     * motor e efeitos nao podem discordar por segundos.
     */
    public static final String COBERTO_E = """
            EXISTS (SELECT 1 FROM manutencao_agendada ma
                     WHERE ma.status = 'ATIVA'
                       AND ((ma.escopo = 'UNIDADE' AND ma.unidade_id = e.unidade_id)
                         OR (ma.escopo = 'EQUIPAMENTOS' AND EXISTS (
                               SELECT 1 FROM manutencao_agendada_equipamento mae
                                WHERE mae.manutencao_id = ma.id AND mae.equipamento_id = e.id))))""";

    private final NamedParameterJdbcTemplate jdbc;

    public CoberturaManutencao(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public boolean coberto(long equipamentoId) {
        return Boolean.TRUE.equals(jdbc.queryForObject(
                "SELECT " + COBERTO_E + " FROM equipamento e WHERE e.id = :id",
                Map.of("id", equipamentoId), Boolean.class));
    }

    /** Criador da janela ATIVA de menor id que cobre o equipamento: autor da entrada pelo job (MA10). */
    public Optional<Long> autorDaCobertura(long equipamentoId) {
        List<Long> ids = jdbc.queryForList("""
                SELECT ma.criado_por_id FROM manutencao_agendada ma JOIN equipamento e ON e.id = :id
                 WHERE ma.status = 'ATIVA'
                   AND ((ma.escopo = 'UNIDADE' AND ma.unidade_id = e.unidade_id)
                     OR (ma.escopo = 'EQUIPAMENTOS' AND EXISTS (SELECT 1 FROM manutencao_agendada_equipamento mae
                          WHERE mae.manutencao_id = ma.id AND mae.equipamento_id = e.id)))
                 ORDER BY ma.id LIMIT 1""", Map.of("id", equipamentoId), Long.class);
        return ids.stream().findFirst();
    }

    /** Equipamentos cujo efetivo diverge do desejado. Ordem por id: mesma ordem de lock em todo lugar. */
    public List<Long> divergentes() {
        return jdbc.queryForList("SELECT e.id FROM equipamento e WHERE e.em_manutencao <> (e.manutencao_manual OR "
                + COBERTO_E + ") ORDER BY e.id", Map.of(), Long.class);
    }

    /** Equipamentos que a janela cobre AGORA (escopo UNIDADE e dinamico: le a unidade no momento). */
    public List<Long> cobertosPor(long manutencaoId) {
        return jdbc.queryForList("""
                SELECT e.id FROM manutencao_agendada ma JOIN equipamento e
                    ON (ma.escopo = 'UNIDADE' AND e.unidade_id = ma.unidade_id)
                    OR (ma.escopo = 'EQUIPAMENTOS' AND EXISTS (SELECT 1 FROM manutencao_agendada_equipamento mae
                         WHERE mae.manutencao_id = ma.id AND mae.equipamento_id = e.id))
                 WHERE ma.id = :id ORDER BY e.id""", Map.of("id", manutencaoId), Long.class);
    }
}
