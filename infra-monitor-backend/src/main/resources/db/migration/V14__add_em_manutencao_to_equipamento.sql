-- Manutencao planejada: equipamento continua ativo, mas sai da leitura operacional de disponibilidade.
ALTER TABLE equipamento
    ADD COLUMN em_manutencao BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX idx_equipamento_em_manutencao ON equipamento (em_manutencao) WHERE em_manutencao;
