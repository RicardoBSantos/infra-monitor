-- Seed do e2e de pré-carga (pre-carga-timeline-e-tela.cjs).
--
-- SÓ NO BANCO DESCARTÁVEL `infra-e2e` (porta 5437), restaurado de um pg_dump do dev.
-- Nunca rodar no `inframonitor-postgres` (5434):
--
--   docker exec -i infra-e2e psql -v ON_ERROR_STOP=1 -U inframonitor -d inframonitor < e2e/pre-carga-seed.sql
--
-- Guarda: o seed aborta se o banco não tiver o marcador `app.banco_descartavel = 'sim'`, gravado
-- uma única vez só no infra-e2e (depois de restaurar o dump; vale para conexões novas):
--   docker exec infra-e2e psql -U inframonitor -d postgres -c "ALTER DATABASE inframonitor SET app.banco_descartavel = 'sim'"
--
-- Pré-requisito: o backend já subiu uma vez contra o 5437 com BOOTSTRAP_ADMIN_* — o
-- FECHAMENTO_MANUAL aponta `fechado_por` para esse admin (e2e@inframonitor.local).
--
-- Reexecutável: apaga o que uma rodada anterior gravou (marca `e2e-pre-carga` em
-- `incidente.observacao` e `medicao.mensagem`) antes de gravar de novo. Os instantes saem de
-- now(), então reaplicar logo antes do e2e: o caso 6 lê só os últimos 26 minutos.
--
-- O que é gravado (monitores achados pelo nome do equipamento, não por id):
--   SWI-02-U6  três incidentes FECHADO, um por motivo, cada um com FALHA medida DEPOIS do
--              `encerrado_em` (prova o recorte da timeline em [iniciadoEm, encerradoEm]):
--                RECUPERACAO_AUTOMATICA  now-40h; os 2 sucessos terminam exatamente no encerrado_em
--                FECHAMENTO_MANUAL       now-30h; fechado_por = admin bootstrap
--                MANUTENCAO              now-20h
--   SWI-01-U7  um incidente ABERTO (now-2h, falhando até agora): única unidade OFFLINE do
--              Painel, para exercitar o singular "1 unidade afetada".
--   SWI-08-U8  só SUCESSO a cada 30 s nas últimas 3 h e nenhum incidente: perda 0 e 0
--              incidentes na gaveta de equipamento (caso 6).
--   SWI-06-U10 um episódio de latência encerrado (now-10h, limiar 250 ms) cuja janela só tem
--              FALHA: 0 medições acima do limiar (caso 7). Sintético de propósito — na vida
--              real o episódio nasce de N medições acima do limiar; aqui o que se prova é a
--              cor neutra do zero, não a abertura do episódio.

BEGIN;

DO $$
DECLARE
  base       timestamptz := date_trunc('second', now());
  admin_id   bigint;
  m_fechados bigint;
  m_aberto   bigint;
  m_saudavel bigint;
  m_latencia bigint;
  t          timestamptz;
  i          int;
BEGIN
  IF current_setting('app.banco_descartavel', true) IS DISTINCT FROM 'sim' THEN
    RAISE EXCEPTION 'seed so roda no banco descartavel (infra-e2e): marcador app.banco_descartavel ausente';
  END IF;

  SELECT id INTO admin_id FROM usuarios WHERE lower(email) = 'e2e@inframonitor.local';
  IF admin_id IS NULL THEN
    RAISE EXCEPTION 'admin bootstrap e2e@inframonitor.local ausente: suba o backend com BOOTSTRAP_ADMIN_* antes do seed';
  END IF;

  SELECT m.id INTO m_fechados FROM monitor m JOIN equipamento e ON e.id = m.equipamento_id WHERE e.nome = 'SWI-02-U6' ORDER BY m.id LIMIT 1;
  SELECT m.id INTO m_aberto   FROM monitor m JOIN equipamento e ON e.id = m.equipamento_id WHERE e.nome = 'SWI-01-U7' ORDER BY m.id LIMIT 1;
  SELECT m.id INTO m_saudavel FROM monitor m JOIN equipamento e ON e.id = m.equipamento_id WHERE e.nome = 'SWI-08-U8' ORDER BY m.id LIMIT 1;
  SELECT m.id INTO m_latencia FROM monitor m JOIN equipamento e ON e.id = m.equipamento_id WHERE e.nome = 'SWI-06-U10' ORDER BY m.id LIMIT 1;
  IF m_fechados IS NULL OR m_aberto IS NULL OR m_saudavel IS NULL OR m_latencia IS NULL THEN
    RAISE EXCEPTION 'monitor esperado ausente (SWI-02-U6=%, SWI-01-U7=%, SWI-08-U8=%, SWI-06-U10=%)',
      m_fechados, m_aberto, m_saudavel, m_latencia;
  END IF;

  -- Rodada anterior --------------------------------------------------------------
  DELETE FROM incidente WHERE observacao = 'e2e-pre-carga';
  DELETE FROM medicao WHERE mensagem = 'e2e-pre-carga';
  -- Só a assinatura exata do que este seed insere (passo 6).
  DELETE FROM monitor_episodio_latencia
   WHERE monitor_id = m_latencia AND limiar_ms = 250
     AND created_at = iniciado_em AND encerrado_em = iniciado_em + interval '90 seconds';

  -- 1. RECUPERACAO_AUTOMATICA: S, F F F F, S S (fecha no 2º S), F F depois do fechamento.
  t := base - interval '40 hours';
  INSERT INTO medicao (monitor_id, status, latencia_ms, mensagem, executado_em) VALUES
    (m_fechados, 'SUCESSO', 14,   'e2e-pre-carga', t - interval '30 seconds'),
    (m_fechados, 'FALHA',   NULL, 'e2e-pre-carga', t),
    (m_fechados, 'FALHA',   NULL, 'e2e-pre-carga', t + interval '30 seconds'),
    (m_fechados, 'FALHA',   NULL, 'e2e-pre-carga', t + interval '60 seconds'),
    (m_fechados, 'FALHA',   NULL, 'e2e-pre-carga', t + interval '90 seconds'),
    (m_fechados, 'SUCESSO', 17,   'e2e-pre-carga', t + interval '120 seconds'),
    (m_fechados, 'SUCESSO', 15,   'e2e-pre-carga', t + interval '150 seconds'),
    (m_fechados, 'FALHA',   NULL, 'e2e-pre-carga', t + interval '180 seconds'),
    (m_fechados, 'FALHA',   NULL, 'e2e-pre-carga', t + interval '210 seconds');
  INSERT INTO incidente (monitor_id, status, iniciado_em, encerrado_em, motivo, observacao,
                         created_at, updated_at, motivo_encerramento)
  VALUES (m_fechados, 'FECHADO', t, t + interval '150 seconds',
          '3 falhas consecutivas de ICMP', 'e2e-pre-carga',
          t + interval '60 seconds', t + interval '150 seconds', 'RECUPERACAO_AUTOMATICA');

  -- 2. FECHAMENTO_MANUAL: S, F F F F, fechado à mão 10 s depois, F F depois do fechamento.
  t := base - interval '30 hours';
  INSERT INTO medicao (monitor_id, status, latencia_ms, mensagem, executado_em) VALUES
    (m_fechados, 'SUCESSO', 16,   'e2e-pre-carga', t - interval '30 seconds'),
    (m_fechados, 'FALHA',   NULL, 'e2e-pre-carga', t),
    (m_fechados, 'FALHA',   NULL, 'e2e-pre-carga', t + interval '30 seconds'),
    (m_fechados, 'FALHA',   NULL, 'e2e-pre-carga', t + interval '60 seconds'),
    (m_fechados, 'FALHA',   NULL, 'e2e-pre-carga', t + interval '90 seconds'),
    (m_fechados, 'FALHA',   NULL, 'e2e-pre-carga', t + interval '120 seconds'),
    (m_fechados, 'FALHA',   NULL, 'e2e-pre-carga', t + interval '150 seconds');
  INSERT INTO incidente (monitor_id, status, iniciado_em, encerrado_em, motivo, observacao,
                         created_at, updated_at, fechado_por, motivo_encerramento)
  VALUES (m_fechados, 'FECHADO', t, t + interval '100 seconds',
          '3 falhas consecutivas de ICMP', 'e2e-pre-carga',
          t + interval '60 seconds', t + interval '100 seconds', admin_id, 'FECHAMENTO_MANUAL');

  -- 3. MANUTENCAO: S, F F F F, entra em manutenção 10 s depois, F F depois do fechamento.
  t := base - interval '20 hours';
  INSERT INTO medicao (monitor_id, status, latencia_ms, mensagem, executado_em) VALUES
    (m_fechados, 'SUCESSO', 13,   'e2e-pre-carga', t - interval '30 seconds'),
    (m_fechados, 'FALHA',   NULL, 'e2e-pre-carga', t),
    (m_fechados, 'FALHA',   NULL, 'e2e-pre-carga', t + interval '30 seconds'),
    (m_fechados, 'FALHA',   NULL, 'e2e-pre-carga', t + interval '60 seconds'),
    (m_fechados, 'FALHA',   NULL, 'e2e-pre-carga', t + interval '90 seconds'),
    (m_fechados, 'FALHA',   NULL, 'e2e-pre-carga', t + interval '120 seconds'),
    (m_fechados, 'FALHA',   NULL, 'e2e-pre-carga', t + interval '150 seconds');
  INSERT INTO incidente (monitor_id, status, iniciado_em, encerrado_em, motivo, observacao,
                         created_at, updated_at, motivo_encerramento)
  VALUES (m_fechados, 'FECHADO', t, t + interval '100 seconds',
          '3 falhas consecutivas de ICMP', 'e2e-pre-carga',
          t + interval '60 seconds', t + interval '100 seconds', 'MANUTENCAO');

  -- 4. Incidente ABERTO: falha a cada 30 s nas últimas 2 h.
  t := base - interval '2 hours';
  INSERT INTO medicao (monitor_id, status, latencia_ms, mensagem, executado_em)
  SELECT m_aberto, 'FALHA', NULL, 'e2e-pre-carga', t + (n * interval '30 seconds')
  FROM generate_series(0, 240) AS n;
  INSERT INTO incidente (monitor_id, status, iniciado_em, motivo, observacao, created_at, updated_at)
  VALUES (m_aberto, 'ABERTO', t, '3 falhas consecutivas de ICMP', 'e2e-pre-carga',
          t + interval '60 seconds', t + interval '60 seconds');

  -- 5. Equipamento saudável: SUCESSO a cada 30 s nas últimas 3 h, latência 8..20 ms.
  t := base - interval '3 hours';
  INSERT INTO medicao (monitor_id, status, latencia_ms, mensagem, executado_em)
  SELECT m_saudavel, 'SUCESSO', 8 + (n * 7) % 13, 'e2e-pre-carga', t + (n * interval '30 seconds')
  FROM generate_series(0, 360) AS n;

  -- 6. Episódio de latência encerrado com a janela só de FALHA.
  t := base - interval '10 hours';
  FOR i IN 0..3 LOOP
    INSERT INTO medicao (monitor_id, status, latencia_ms, mensagem, executado_em)
    VALUES (m_latencia, 'FALHA', NULL, 'e2e-pre-carga', t + (i * interval '30 seconds'));
  END LOOP;
  INSERT INTO monitor_episodio_latencia (monitor_id, iniciado_em, encerrado_em, limiar_ms, created_at, updated_at)
  VALUES (m_latencia, t, t + interval '90 seconds', 250, t, t + interval '90 seconds');
END $$;

COMMIT;

-- Resumo do que ficou gravado.
SELECT i.id, e.nome AS equipamento, i.status, i.motivo_encerramento, i.iniciado_em, i.encerrado_em,
       u.nome AS fechado_por
FROM incidente i
JOIN monitor m ON m.id = i.monitor_id
JOIN equipamento e ON e.id = m.equipamento_id
LEFT JOIN usuarios u ON u.id = i.fechado_por
WHERE i.observacao = 'e2e-pre-carga'
ORDER BY i.iniciado_em;
