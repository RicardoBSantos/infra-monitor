-- Seed do e2e da rodada curta (rodada-curta.cjs): timeline só afirma o que lista.
--
-- SÓ NO BANCO DESCARTÁVEL `infra-e2e` (porta 5437), restaurado de um pg_dump do dev.
-- Nunca rodar no `inframonitor-postgres` (5434):
--
--   docker exec -i infra-e2e psql -v ON_ERROR_STOP=1 -U inframonitor -d inframonitor < e2e/rodada-curta-seed.sql
--
-- Guarda: aborta sem o marcador `app.banco_descartavel = 'sim'` (ver pre-carga-seed.sql).
--
-- Reexecutável: apaga o que uma rodada anterior gravou (marca `e2e-rodada-curta` em
-- `incidente.observacao` e `medicao.mensagem`; episódios pela assinatura exata limiar 251/252).
--
-- O que é gravado (monitores achados pelo nome do equipamento):
--   ACC-01-U1  incidente FECHADO por RECUPERACAO_AUTOMATICA (now-30h) cuja janela só tem FALHA:
--              nenhuma resposta de recuperação no histórico. A timeline não pode citar N.
--   ACC-02-U8  episódio de latência encerrado com motivo INCIDENTE (now-20h, limiar 251):
--              2 medições acima do limiar e depois FALHA. Não pode dizer "normalizada".
--   ACC-03-U7  episódio encerrado com motivo NORMALIZACAO (now-10h, limiar 252) e a sequência
--              completa de 2 medições dentro do limiar terminando no encerrado_em: controle
--              positivo, cita "2 medições consecutivas".

BEGIN;

DO $$
DECLARE
  base        timestamptz := date_trunc('second', now());
  m_auto      bigint;
  m_incidente bigint;
  m_normal    bigint;
  t           timestamptz;
BEGIN
  IF current_setting('app.banco_descartavel', true) IS DISTINCT FROM 'sim' THEN
    RAISE EXCEPTION 'seed so roda no banco descartavel (infra-e2e): marcador app.banco_descartavel ausente';
  END IF;

  SELECT m.id INTO m_auto      FROM monitor m JOIN equipamento e ON e.id = m.equipamento_id WHERE e.nome = 'ACC-01-U1' ORDER BY m.id LIMIT 1;
  SELECT m.id INTO m_incidente FROM monitor m JOIN equipamento e ON e.id = m.equipamento_id WHERE e.nome = 'ACC-02-U8' ORDER BY m.id LIMIT 1;
  SELECT m.id INTO m_normal    FROM monitor m JOIN equipamento e ON e.id = m.equipamento_id WHERE e.nome = 'ACC-03-U7' ORDER BY m.id LIMIT 1;
  IF m_auto IS NULL OR m_incidente IS NULL OR m_normal IS NULL THEN
    RAISE EXCEPTION 'monitor esperado ausente (ACC-01-U1=%, ACC-02-U8=%, ACC-03-U7=%)', m_auto, m_incidente, m_normal;
  END IF;

  -- Rodada anterior --------------------------------------------------------------
  DELETE FROM incidente WHERE observacao = 'e2e-rodada-curta';
  DELETE FROM medicao WHERE mensagem = 'e2e-rodada-curta';
  DELETE FROM monitor_episodio_latencia WHERE monitor_id IN (m_incidente, m_normal) AND limiar_ms IN (251, 252);

  -- 1. AUTO sem sequência: S, F F F F, encerrado 30 s depois da última falha, sem sucesso medido.
  t := base - interval '30 hours';
  INSERT INTO medicao (monitor_id, status, latencia_ms, mensagem, executado_em) VALUES
    (m_auto, 'SUCESSO', 12,   'e2e-rodada-curta', t - interval '30 seconds'),
    (m_auto, 'FALHA',   NULL, 'e2e-rodada-curta', t),
    (m_auto, 'FALHA',   NULL, 'e2e-rodada-curta', t + interval '30 seconds'),
    (m_auto, 'FALHA',   NULL, 'e2e-rodada-curta', t + interval '60 seconds'),
    (m_auto, 'FALHA',   NULL, 'e2e-rodada-curta', t + interval '90 seconds');
  INSERT INTO incidente (monitor_id, status, iniciado_em, encerrado_em, motivo, observacao,
                         created_at, updated_at, motivo_encerramento)
  VALUES (m_auto, 'FECHADO', t, t + interval '120 seconds',
          '3 falhas consecutivas de ICMP', 'e2e-rodada-curta',
          t + interval '60 seconds', t + interval '120 seconds', 'RECUPERACAO_AUTOMATICA');

  -- 2. Episódio encerrado por INCIDENTE: 2 acima do limiar, depois FALHA no encerramento.
  t := base - interval '20 hours';
  INSERT INTO medicao (monitor_id, status, latencia_ms, mensagem, executado_em) VALUES
    (m_incidente, 'SUCESSO', 400,  'e2e-rodada-curta', t),
    (m_incidente, 'SUCESSO', 420,  'e2e-rodada-curta', t + interval '30 seconds'),
    (m_incidente, 'FALHA',   NULL, 'e2e-rodada-curta', t + interval '60 seconds');
  INSERT INTO monitor_episodio_latencia (monitor_id, iniciado_em, encerrado_em, limiar_ms, created_at, updated_at, motivo_encerramento)
  VALUES (m_incidente, t, t + interval '60 seconds', 251, t + interval '30 seconds', t + interval '60 seconds', 'INCIDENTE');

  -- 3. Episódio NORMALIZACAO com sequência completa (2 dentro do limiar, a 2ª no encerrado_em).
  t := base - interval '10 hours';
  INSERT INTO medicao (monitor_id, status, latencia_ms, mensagem, executado_em) VALUES
    (m_normal, 'SUCESSO', 400, 'e2e-rodada-curta', t),
    (m_normal, 'SUCESSO', 410, 'e2e-rodada-curta', t + interval '30 seconds'),
    (m_normal, 'SUCESSO', 30,  'e2e-rodada-curta', t + interval '60 seconds'),
    (m_normal, 'SUCESSO', 28,  'e2e-rodada-curta', t + interval '90 seconds');
  INSERT INTO monitor_episodio_latencia (monitor_id, iniciado_em, encerrado_em, limiar_ms, created_at, updated_at, motivo_encerramento)
  VALUES (m_normal, t, t + interval '90 seconds', 252, t + interval '30 seconds', t + interval '90 seconds', 'NORMALIZACAO');
END $$;

COMMIT;

SELECT 'incidente' AS tipo, i.id, e.nome, i.motivo_encerramento, i.iniciado_em, i.encerrado_em
FROM incidente i JOIN monitor m ON m.id = i.monitor_id JOIN equipamento e ON e.id = m.equipamento_id
WHERE i.observacao = 'e2e-rodada-curta'
UNION ALL
SELECT 'episodio', l.id, e.nome, l.motivo_encerramento, l.iniciado_em, l.encerrado_em
FROM monitor_episodio_latencia l JOIN monitor m ON m.id = l.monitor_id JOIN equipamento e ON e.id = m.equipamento_id
WHERE l.limiar_ms IN (251, 252)
ORDER BY 1, 5;
