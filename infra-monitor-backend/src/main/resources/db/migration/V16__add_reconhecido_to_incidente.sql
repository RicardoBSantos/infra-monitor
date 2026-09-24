-- V16 - Estado RECONHECIDO no ciclo de vida do incidente.
--
-- Reconhecido e um incidente que alguem assumiu, mas que continua acontecendo:
-- operacionalmente ele e tao aberto quanto ABERTO. Toda regra que pergunta
-- "existe incidente aberto neste monitor?" passa a valer para os dois estados.
-- Episodio de latencia nao tem estado equivalente: ele fecha sozinho, sem
-- intervencao humana, entao continua so aberto/encerrado.

ALTER TABLE incidente ADD COLUMN reconhecido_em TIMESTAMPTZ;
ALTER TABLE incidente ADD COLUMN reconhecido_por BIGINT;

-- usuarios nao tem exclusao fisica (desativacao e ativo = false), entao o
-- RESTRICT nunca bloqueia na pratica e a trilha nunca aponta para o vazio.
ALTER TABLE incidente ADD CONSTRAINT fk_incidente_reconhecido_por
    FOREIGN KEY (reconhecido_por) REFERENCES usuarios (id) ON DELETE RESTRICT;

-- CHECK nao se estende: e preciso recriar com o estado novo.
ALTER TABLE incidente DROP CONSTRAINT ck_incidente_status;
ALTER TABLE incidente ADD CONSTRAINT ck_incidente_status
    CHECK (status IN ('ABERTO', 'RECONHECIDO', 'FECHADO'));

-- RECONHECIDO nao encerra nada: so FECHADO tem encerrado_em.
ALTER TABLE incidente DROP CONSTRAINT ck_incidente_ciclo_vida;
ALTER TABLE incidente ADD CONSTRAINT ck_incidente_ciclo_vida CHECK (
    (status IN ('ABERTO', 'RECONHECIDO') AND encerrado_em IS NULL)
    OR (status = 'FECHADO' AND encerrado_em IS NOT NULL)
);

-- Reconhecimento e um par: quem e quando, sempre juntos ou sempre ausentes.
ALTER TABLE incidente ADD CONSTRAINT ck_incidente_reconhecimento_par CHECK (
    num_nonnulls(reconhecido_em, reconhecido_por) IN (0, 2)
);

-- ABERTO e o estado "ninguem viu ainda" e nao pode carregar reconhecimento.
-- FECHADO pode ter ou nao: a trilha sobrevive ao fechamento de um incidente
-- que passou por RECONHECIDO, e fica nula no que fechou direto.
ALTER TABLE incidente ADD CONSTRAINT ck_incidente_reconhecimento_coerente CHECK (
    status <> 'ABERTO' OR reconhecido_em IS NULL
);

ALTER TABLE incidente ADD CONSTRAINT ck_incidente_reconhecimento_posterior CHECK (
    reconhecido_em IS NULL OR reconhecido_em >= iniciado_em
);

-- Sem isto um incidente RECONHECIDO deixa de ocupar a vaga do monitor e o
-- IncidentProcessor abre um segundo incidente para a mesma indisponibilidade.
DROP INDEX uq_incidente_monitor_aberto;
CREATE UNIQUE INDEX uq_incidente_monitor_aberto ON incidente (monitor_id)
    WHERE status IN ('ABERTO', 'RECONHECIDO');
