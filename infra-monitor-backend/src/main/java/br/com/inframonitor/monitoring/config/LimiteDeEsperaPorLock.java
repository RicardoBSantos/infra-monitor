package br.com.inframonitor.monitoring.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * lock_timeout das transacoes do motor que disputam linhas com a manutencao: o
 * FOR UPDATE OF e em inserirSeElegivel (incidente e episodio de latencia), o CAS de
 * fechamento do incidente (fecharAutomaticamenteSeEmAberto) e o CAS de
 * normalizacao do episodio de latencia (encerrarPorNormalizacaoSeAberto).
 *
 * <p>set_config(..., true) e SET LOCAL: vale so para a transacao corrente e morre no
 * commit/rollback, nao vaza para a conexao devolvida ao pool. Por isso precisa ser a
 * primeira instrucao DENTRO da transacao REQUIRES_NEW de cada processor.
 *
 * <p>2 s: quem segura a linha sao transacoes curtas (entrarEmManutencao, CRUD de
 * equipamento, abertura de outro monitor do mesmo equipamento), na casa de
 * milissegundos; e o menor intervalo de monitor e 10 s. Estourou, o processor faz
 * rollback e a proxima medicao reavalia a cauda — ver MedicaoService.criar.
 */
@Component
public class LimiteDeEsperaPorLock {

    private final JdbcTemplate jdbc;
    private final String valor;

    public LimiteDeEsperaPorLock(JdbcTemplate jdbc,
                                 @Value("${monitoring.engine.lock-timeout-ms:2000}") long lockTimeoutMs) {
        this.jdbc = jdbc;
        this.valor = lockTimeoutMs + "ms";
    }

    public void aplicarNaTransacaoCorrente() {
        jdbc.queryForObject("select set_config('lock_timeout', ?, true)", String.class, valor);
    }
}
