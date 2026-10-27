-- Primeira medicao de cada janela, guardada na propria janela.
--
-- O SLA so lia a tabela medicao para isto: a janela comeca a contar na primeira medicao dentro
-- dela (greatest(inicio, j.inicio_em, primeira)). Com a coluna, o calculo nao le medicao nenhuma,
-- e apagar medicao antiga (retencao futura) nao move o inicio de uma janela antiga.
--
-- Quem mantem a coluna e o banco, nao a aplicacao: medicao entra por varios caminhos (motor,
-- carga de dados, seed SQL, testes, psql), e um caminho que esquecesse de gravar viraria SEM_DADOS
-- silencioso no SLA. A entidade JanelaMonitoramento NAO mapeia a coluna: o update de todas as
-- colunas do Hibernate em fechar() regravaria por cima o valor que o gatilho escreveu.

ALTER TABLE janela_monitoramento ADD COLUMN primeira_medicao_em TIMESTAMPTZ;

-- Preenchimento das janelas existentes, com a mesma regra do SQL de disponibilidade ate aqui:
-- menor executado_em em [inicio_em, fim_em). O "between" e a ordem prendem a busca ao indice
-- ix_medicao_monitor_executado_em (motivo em DashboardReadRepository.ESTADOS).
UPDATE janela_monitoramento j
   SET primeira_medicao_em = (
       SELECT md.executado_em FROM medicao md
        WHERE md.monitor_id BETWEEN j.monitor_id AND j.monitor_id
          AND md.executado_em >= j.inicio_em
          AND (j.fim_em IS NULL OR md.executado_em < j.fim_em)
        ORDER BY md.monitor_id DESC, md.executado_em
        LIMIT 1);

ALTER TABLE janela_monitoramento ADD CONSTRAINT ck_janela_monitoramento_primeira_medicao
    CHECK (primeira_medicao_em IS NULL OR primeira_medicao_em >= inicio_em);

-- Medicao nova: se cair numa janela do monitor e for anterior a primeira registrada, vira a
-- primeira. O WHERE e a guarda (UPDATE condicional, sem ler-depois-escrever); quando nao ha o que
-- mudar, nenhuma linha e escrita. Duas medicoes concorrentes do mesmo monitor se serializam na
-- linha da janela e o PostgreSQL reavalia o WHERE sobre a versao nova (EvalPlanQual), entao fica
-- sempre o menor executado_em, em qualquer ordem de chegada.
CREATE FUNCTION janela_registrar_primeira_medicao() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    UPDATE janela_monitoramento
       SET primeira_medicao_em = NEW.executado_em
     WHERE monitor_id = NEW.monitor_id
       AND inicio_em <= NEW.executado_em
       AND (fim_em IS NULL OR NEW.executado_em < fim_em)
       AND (primeira_medicao_em IS NULL OR primeira_medicao_em > NEW.executado_em);
    RETURN NULL;
END
$$;

CREATE TRIGGER trg_medicao_primeira_da_janela
    AFTER INSERT ON medicao
    FOR EACH ROW EXECUTE FUNCTION janela_registrar_primeira_medicao();

-- Janela nova, ou com periodo alterado, sem primeira valida: busca entre as medicoes que ja
-- existem no periodo. Cobre a ordem inversa (medicao gravada antes da janela) e a extensao do
-- periodo. Uma primeira ja registrada e dentro do periodo nunca e recalculada: depois de uma
-- retencao, a medicao que a originou pode nao existir mais. Se o fim encolher para antes dela, o
-- SQL de disponibilidade descarta a janela (primeira_medicao_em < fim_em), como antes.
CREATE FUNCTION janela_preencher_primeira_medicao() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.primeira_medicao_em IS NULL OR NEW.primeira_medicao_em < NEW.inicio_em THEN
        NEW.primeira_medicao_em := (
            SELECT md.executado_em FROM medicao md
             WHERE md.monitor_id BETWEEN NEW.monitor_id AND NEW.monitor_id
               AND md.executado_em >= NEW.inicio_em
               AND (NEW.fim_em IS NULL OR md.executado_em < NEW.fim_em)
             ORDER BY md.monitor_id DESC, md.executado_em
             LIMIT 1);
    END IF;
    RETURN NEW;
END
$$;

CREATE TRIGGER trg_janela_primeira_medicao
    BEFORE INSERT OR UPDATE OF inicio_em, fim_em ON janela_monitoramento
    FOR EACH ROW EXECUTE FUNCTION janela_preencher_primeira_medicao();
