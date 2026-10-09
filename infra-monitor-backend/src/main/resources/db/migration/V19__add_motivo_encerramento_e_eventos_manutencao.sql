-- V19 - Motivo de encerramento e os eventos de notificacao da manutencao.
--
-- Fechar passa a ter tres caminhos, e nao os dois que a V17 registrou: o motor
-- (recuperacao), o operador (fechamento manual) e a entrada em manutencao. Sem
-- coluna propria, o terceiro seria lido como um dos dois primeiros, e o relatorio
-- diria "o monitor se recuperou" sobre um incidente que ninguem resolveu.
--
-- O status NAO muda: continua FECHADO. Nao ha valor novo em ck_incidente_status.

ALTER TABLE incidente ADD COLUMN motivo_encerramento VARCHAR(24);

ALTER TABLE incidente ADD CONSTRAINT ck_incidente_motivo_encerramento_valor CHECK (
    motivo_encerramento IS NULL OR motivo_encerramento IN (
        'RECUPERACAO_AUTOMATICA', 'FECHAMENTO_MANUAL', 'MANUTENCAO')
);

-- Irma de ck_incidente_fechamento_coerente (V17:21-23): so FECHADO carrega motivo
-- de encerramento. ABERTO e RECONHECIDO nao encerraram nada.
ALTER TABLE incidente ADD CONSTRAINT ck_incidente_motivo_encerramento_coerente CHECK (
    motivo_encerramento IS NULL OR status = 'FECHADO'
);

-- Backfill em duas passadas, da certeza para a duvida. O que sobrar fica NULL:
-- NULL aqui significa "fechado antes da V19, nao classificavel", e nao "faltou dado".
-- As contagens por faixa estao em Docs/validacao-producao/manutencao-backfill-diagnostico.md:
-- FECHAMENTO_MANUAL = 1, RECUPERACAO_AUTOMATICA = 0, ambiguos (NULL) = 75, dos 76
-- incidentes FECHADO no banco de dev. A Faixa 2 dar zero nao e defeito do criterio:
-- o motor de monitoramento nunca chegou a subir neste ambiente (bean duplicado,
-- corrigido no commit 6a58454), entao nunca houve fechamento automatico para o
-- LIKE casar. Em producao a faixa deixa de ser vazia.
UPDATE incidente SET motivo_encerramento = 'FECHAMENTO_MANUAL'
 WHERE status = 'FECHADO' AND fechado_por IS NOT NULL;

UPDATE incidente SET motivo_encerramento = 'RECUPERACAO_AUTOMATICA'
 WHERE status = 'FECHADO' AND fechado_por IS NULL AND motivo_encerramento IS NULL
   AND observacao LIKE 'Recuperacao detectada automaticamente apos %sucessos consecutivos.';

-- Episodio de latencia: hoje dois encerramentos semanticamente diferentes gravam
-- exatamente as mesmas colunas (LatencyEpisodeProcessor: encerramento silencioso
-- por incidente x normalizacao real). Manutencao seria o terceiro.
ALTER TABLE monitor_episodio_latencia ADD COLUMN motivo_encerramento VARCHAR(24);

ALTER TABLE monitor_episodio_latencia
    ADD CONSTRAINT ck_monitor_episodio_latencia_motivo_valor CHECK (
        motivo_encerramento IS NULL OR motivo_encerramento IN (
            'NORMALIZACAO', 'INCIDENTE', 'MANUTENCAO')
    );

ALTER TABLE monitor_episodio_latencia
    ADD CONSTRAINT ck_monitor_episodio_latencia_motivo_coerente CHECK (
        motivo_encerramento IS NULL OR encerrado_em IS NOT NULL
    );
-- Sem backfill de proposito: nao sobra nem um sinal fraco para desempatar os dois
-- caminhos antigos, e gravar palpite em coluna que o relatorio le como fato e pior
-- que NULL honesto. A ambiguidade existe desde a V15, nao foi criada aqui.

-- INCIDENTE_ENCERRADO_MANUTENCAO tem exatamente 30 caracteres, o limite atual da
-- coluna (V9:6). Zero margem para o proximo evento: alarga agora.
ALTER TABLE notificacao ALTER COLUMN tipo_evento TYPE VARCHAR(40);

-- CHECK nao se estende: e preciso recriar. Mesmo idioma de V15:48-52 e V16:17-20.
ALTER TABLE notificacao DROP CONSTRAINT ck_notificacao_status;
ALTER TABLE notificacao ADD CONSTRAINT ck_notificacao_status CHECK (
    status IN ('PENDENTE', 'ENVIANDO', 'ENVIADA', 'FALHA', 'CANCELADA')
);

ALTER TABLE notificacao DROP CONSTRAINT ck_notificacao_tipo_evento;
ALTER TABLE notificacao ADD CONSTRAINT ck_notificacao_tipo_evento CHECK (
    tipo_evento IN ('INCIDENTE_ABERTO', 'INCIDENTE_FECHADO',
                    'LATENCIA_ALTA', 'LATENCIA_NORMALIZADA',
                    'INCIDENTE_ENCERRADO_MANUTENCAO', 'LATENCIA_ENCERRADA_MANUTENCAO')
);

-- Dois tipos novos e nao um so: ck_notificacao_evento_coerente amarra tipo a ancora,
-- e um tipo servindo incidente E episodio afrouxaria a constraint nas duas direcoes.
ALTER TABLE notificacao DROP CONSTRAINT ck_notificacao_evento_coerente;
ALTER TABLE notificacao ADD CONSTRAINT ck_notificacao_evento_coerente CHECK (
    (tipo_evento IN ('INCIDENTE_ABERTO', 'INCIDENTE_FECHADO', 'INCIDENTE_ENCERRADO_MANUTENCAO')
     AND incidente_id IS NOT NULL)
    OR (tipo_evento IN ('LATENCIA_ALTA', 'LATENCIA_NORMALIZADA', 'LATENCIA_ENCERRADA_MANUTENCAO')
        AND episodio_latencia_id IS NOT NULL)
);
