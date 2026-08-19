ALTER TABLE notificacao ADD COLUMN proxima_tentativa_em TIMESTAMPTZ;

UPDATE notificacao
SET proxima_tentativa_em = created_at
WHERE status = 'PENDENTE';

CREATE INDEX ix_notificacao_dispatch_queue
    ON notificacao (canal, status, proxima_tentativa_em, created_at);
