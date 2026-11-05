-- D02.9: one durable coverage marker and fair cursor; no medicao rewrite/index.
CREATE TABLE medicao_retencao_estado (
    id SMALLINT PRIMARY KEY CHECK (id = 1),
    historico_detalhado_desde TIMESTAMPTZ,
    cursor_monitor_id BIGINT NOT NULL DEFAULT 0 CHECK (cursor_monitor_id >= 0),
    total_excluidas BIGINT NOT NULL DEFAULT 0 CHECK (total_excluidas >= 0),
    alterado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO medicao_retencao_estado (id) VALUES (1);
