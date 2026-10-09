-- V17 - Trilha de auditoria do fechamento, irma de V16.
--
-- Fechar e a acao mais consequente do ciclo de vida e ate agora era a unica
-- sem autor registrado. Nao ha coluna de data a acrescentar: encerrado_em ja
-- existe desde V7 e ck_incidente_ciclo_vida ja garante que so FECHADO a tem.

ALTER TABLE incidente ADD COLUMN fechado_por BIGINT;

-- Mesma justificativa de V16: usuarios nao tem exclusao fisica (desativacao e
-- ativo = false), entao o RESTRICT nunca bloqueia na pratica e a trilha nunca
-- aponta para o vazio.
ALTER TABLE incidente ADD CONSTRAINT fk_incidente_fechado_por
    FOREIGN KEY (fechado_por) REFERENCES usuarios (id) ON DELETE RESTRICT;

-- Aqui V17 deixa de espelhar V16 de proposito. Reconhecer so tem caminho
-- humano, entao reconhecido_em/reconhecido_por sao um par obrigatorio
-- (ck_incidente_reconhecimento_par). Fechar tem dois caminhos: o operador,
-- via IncidenteService.fechar(), e o engine, via fecharAutomaticamente().
-- Logo fechado_por e NULL mesmo em FECHADO quando quem fechou foi o motor.
-- NULL aqui significa "fechamento automatico", nunca "dado faltando".
ALTER TABLE incidente ADD CONSTRAINT ck_incidente_fechamento_coerente CHECK (
    fechado_por IS NULL OR status = 'FECHADO'
);
