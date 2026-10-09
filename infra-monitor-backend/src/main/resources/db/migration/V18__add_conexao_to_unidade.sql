-- V18 - Conexao entre unidades (hub).
--
-- Modelo escolhido: auto-referencia, e nao um booleano "principal". O que a tela desenha e
-- enlace, e enlace tem duas pontas identificadas. Um booleano diria apenas quem e a sede, e
-- obrigaria o frontend a assumir "todas as outras ligam nela" -- uma topologia estrela cravada
-- em codigo. Com a FK a estrela continua sendo o caso trivial (N unidades apontando para a
-- mesma), sem regra implicita, e uma hierarquia futura nao exige nova migration.
--
-- Unidade raiz (hub) e a que tem conecta_a_unidade_id IS NULL. Nao existe coluna dizendo
-- "sou o hub": isso e derivado, nao um segundo campo para divergir do primeiro.

ALTER TABLE unidade ADD COLUMN conecta_a_unidade_id BIGINT;

ALTER TABLE unidade ADD CONSTRAINT fk_unidade_conecta_a
    FOREIGN KEY (conecta_a_unidade_id) REFERENCES unidade (id);

-- Unidade nao conecta a si mesma. Ciclo mais longo (A -> B -> A) o CHECK nao alcanca:
-- fica em UnidadeService, que percorre a cadeia antes de gravar.
ALTER TABLE unidade ADD CONSTRAINT ck_unidade_conexao_nao_reflexiva
    CHECK (conecta_a_unidade_id IS NULL OR conecta_a_unidade_id <> id);

-- Indice parcial: so as unidades conectadas entram. A consulta que importa e "quem aponta
-- para esta unidade", feita ao excluir o hub -- e unidade raiz nunca e resposta dessa busca.
CREATE INDEX ix_unidade_conecta_a ON unidade (conecta_a_unidade_id)
    WHERE conecta_a_unidade_id IS NOT NULL;
