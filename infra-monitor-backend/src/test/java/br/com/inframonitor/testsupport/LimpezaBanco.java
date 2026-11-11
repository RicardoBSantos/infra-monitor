package br.com.inframonitor.testsupport;

import org.springframework.jdbc.core.JdbcTemplate;

import java.util.List;

/**
 * Limpeza entre testes de integracao, num lugar so (D-03). A lista de tabelas sai do schema
 * real, entao tabela nova entra na limpeza sem editar teste nenhum.
 *
 * <p>Ficam de fora so as tabelas que a propria migration povoa: o historico do Flyway e o
 * singleton {@code medicao_retencao_estado} (V25). Sem CASCADE de proposito: se uma tabela
 * excluida passar a referenciar outra, o TRUNCATE falha em vez de apaga-la calado.
 *
 * <p>Um TRUNCATE so, em ordem alfabetica: a ordem de lock e sempre a mesma. Isso nao protege
 * contra trabalho concorrente da propria aplicacao; por isso o agendador do reconciliador vem
 * desligado nos testes (src/test/resources/config/application.properties).
 */
public final class LimpezaBanco {

    private static final List<String> POVOADAS_PELA_MIGRATION =
            List.of("flyway_schema_history", "medicao_retencao_estado");

    public static void limpar(JdbcTemplate jdbc) {
        List<String> tabelas = jdbc.queryForList(
                "select tablename from pg_tables where schemaname = 'public' order by tablename", String.class)
                .stream().filter(t -> !POVOADAS_PELA_MIGRATION.contains(t)).toList();
        jdbc.execute("truncate table " + String.join(", ", tabelas) + " restart identity");
    }

    private LimpezaBanco() {
    }
}
