-- Configuracao por monitor para abertura e recovery automaticos de incidentes.
ALTER TABLE monitor
    ADD COLUMN falhas_para_incidente INTEGER NOT NULL DEFAULT 3,
    ADD COLUMN sucessos_para_recovery INTEGER NOT NULL DEFAULT 2,
    ADD CONSTRAINT ck_monitor_falhas_para_incidente_faixa
        CHECK (falhas_para_incidente BETWEEN 1 AND 100),
    ADD CONSTRAINT ck_monitor_sucessos_para_recovery_faixa
        CHECK (sucessos_para_recovery BETWEEN 1 AND 100);
