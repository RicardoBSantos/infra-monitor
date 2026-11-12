CREATE TABLE configuracao_modo_tv (
    id BIGINT GENERATED ALWAYS AS IDENTITY,
    ativo BOOLEAN NOT NULL,
    intervalo_atualizacao_segundos INTEGER NOT NULL,
    atualizado_em TIMESTAMPTZ NOT NULL,
    atualizado_por BIGINT,
    CONSTRAINT pk_configuracao_modo_tv PRIMARY KEY (id),
    CONSTRAINT fk_configuracao_modo_tv_usuario FOREIGN KEY (atualizado_por) REFERENCES usuarios (id),
    CONSTRAINT ck_configuracao_modo_tv_intervalo CHECK (intervalo_atualizacao_segundos BETWEEN 30 AND 600)
);
-- Linha unica: o indice sobre a constante impede uma segunda linha.
CREATE UNIQUE INDEX uq_configuracao_modo_tv_unica ON configuracao_modo_tv ((true));

CREATE TABLE configuracao_modo_tv_tela (
    configuracao_id BIGINT NOT NULL,
    tela VARCHAR(20) NOT NULL,
    ordem INTEGER NOT NULL,
    duracao_segundos INTEGER NOT NULL,
    CONSTRAINT pk_configuracao_modo_tv_tela PRIMARY KEY (configuracao_id, tela),
    CONSTRAINT fk_configuracao_modo_tv_tela_configuracao FOREIGN KEY (configuracao_id)
        REFERENCES configuracao_modo_tv (id) ON DELETE CASCADE,
    CONSTRAINT uq_configuracao_modo_tv_tela_ordem UNIQUE (configuracao_id, ordem) DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT ck_configuracao_modo_tv_tela_tela CHECK (tela IN ('MAPA', 'PAINEL', 'INCIDENTES', 'RELATORIOS')),
    CONSTRAINT ck_configuracao_modo_tv_tela_ordem CHECK (ordem >= 1),
    CONSTRAINT ck_configuracao_modo_tv_tela_duracao CHECK (duracao_segundos BETWEEN 10 AND 3600)
);
