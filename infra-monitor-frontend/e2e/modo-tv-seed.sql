-- Seed do e2e do modo TV (modo-tv.cjs).
--
-- SÓ NO CONTAINER DESCARTÁVEL `inframonitor-e2e-tv` (postgres:16-alpine, porta 5441), criado vazio para
-- o e2e e migrado pelo jar do branch (Flyway V1–V27). Nunca no dev (5434) nem na carga (5436):
--
--   docker exec inframonitor-e2e-tv psql -U inframonitor -d postgres -c "ALTER DATABASE inframonitor SET app.banco_descartavel = 'sim'"
--   docker exec -i inframonitor-e2e-tv psql -v ON_ERROR_STOP=1 -U inframonitor -d inframonitor < e2e/modo-tv-seed.sql
--
-- Guarda: aborta sem o marcador `app.banco_descartavel = 'sim'` (mesma convenção de pre-carga-seed.sql).
-- Reexecutável: apaga o que uma rodada anterior gravou (tudo com prefixo `TV-` / marca `e2e-modo-tv`),
-- a configuração do modo TV (volta aos padrões) e as sessões.
--
-- O que é gravado:
--   3 unidades em Sergipe com código IBGE e coordenadas reais da sede do município:
--     TV Sede Aracaju     2800308  -10.947200 -37.073100  (raiz da topologia)
--     TV Itabaiana        2802908  -10.685000 -37.425000  (conecta à sede)
--     TV Lagarto          2803500  -10.917200 -37.650000  (conecta à sede)
--   7 equipamentos (3 + 2 + 2), um monitor ICMP ativo em cada, janela de monitoramento aberta há 25 h,
--   medições a cada 10 min nas últimas 24 h (1015 linhas).
--   1 incidente ABERTO em TV-RT-LAG (now-2h, só FALHA desde então): Lagarto fica DEGRADADA,
--   Painel com OFFLINE = 1 e INCIDENTES ABERTOS = 1. O passo 3 do e2e fecha esse incidente por SQL.

BEGIN;

DO $$
DECLARE
  base      timestamptz := date_trunc('minute', now());
  u_sede    bigint;
  u_ita     bigint;
  u_lag     bigint;
  t_switch  bigint;
  t_fw      bigint;
  t_srv     bigint;
  m_falha   bigint;
  r         record;
BEGIN
  IF current_setting('app.banco_descartavel', true) IS DISTINCT FROM 'sim' THEN
    RAISE EXCEPTION 'seed so roda no banco descartavel (inframonitor-e2e-tv): marcador app.banco_descartavel ausente';
  END IF;

  -- Rodada anterior --------------------------------------------------------------
  DELETE FROM incidente WHERE monitor_id IN (SELECT m.id FROM monitor m JOIN equipamento e ON e.id = m.equipamento_id WHERE e.nome LIKE 'TV-%');
  DELETE FROM medicao WHERE monitor_id IN (SELECT m.id FROM monitor m JOIN equipamento e ON e.id = m.equipamento_id WHERE e.nome LIKE 'TV-%');
  DELETE FROM janela_monitoramento WHERE monitor_id IN (SELECT m.id FROM monitor m JOIN equipamento e ON e.id = m.equipamento_id WHERE e.nome LIKE 'TV-%');
  DELETE FROM monitor WHERE equipamento_id IN (SELECT id FROM equipamento WHERE nome LIKE 'TV-%');
  DELETE FROM equipamento WHERE nome LIKE 'TV-%';
  UPDATE unidade SET conecta_a_unidade_id = NULL WHERE sigla LIKE 'TV-%';
  DELETE FROM unidade WHERE sigla LIKE 'TV-%';
  DELETE FROM tipo_equipamento WHERE slug LIKE 'tv-%';
  -- Configuração do modo TV volta aos padrões (sem linha): o passo 1 do e2e grava pela UI de novo.
  DELETE FROM configuracao_modo_tv_tela;
  DELETE FROM configuracao_modo_tv;
  -- Sessões de rodadas anteriores (o passo 7 revoga todas): só lixo neste banco descartável.
  DELETE FROM sessao_usuario;

  -- Cadastro ---------------------------------------------------------------------
  INSERT INTO tipo_equipamento (nome, slug, descricao, icone) VALUES ('Switch (TV)', 'tv-switch', 'e2e-modo-tv', 'switch') RETURNING id INTO t_switch;
  INSERT INTO tipo_equipamento (nome, slug, descricao, icone) VALUES ('Firewall (TV)', 'tv-firewall', 'e2e-modo-tv', 'firewall') RETURNING id INTO t_fw;
  INSERT INTO tipo_equipamento (nome, slug, descricao, icone) VALUES ('Servidor (TV)', 'tv-servidor', 'e2e-modo-tv', 'server') RETURNING id INTO t_srv;

  INSERT INTO unidade (nome, sigla, descricao, cidade, estado, latitude, longitude, codigo_ibge)
  VALUES ('TV Sede Aracaju', 'TV-SEDE', 'e2e-modo-tv', 'Aracaju', 'SE', -10.947200, -37.073100, '2800308') RETURNING id INTO u_sede;
  INSERT INTO unidade (nome, sigla, descricao, cidade, estado, latitude, longitude, codigo_ibge, conecta_a_unidade_id)
  VALUES ('TV Itabaiana', 'TV-ITA', 'e2e-modo-tv', 'Itabaiana', 'SE', -10.685000, -37.425000, '2802908', u_sede) RETURNING id INTO u_ita;
  INSERT INTO unidade (nome, sigla, descricao, cidade, estado, latitude, longitude, codigo_ibge, conecta_a_unidade_id)
  VALUES ('TV Lagarto', 'TV-LAG', 'e2e-modo-tv', 'Lagarto', 'SE', -10.917200, -37.650000, '2803500', u_sede) RETURNING id INTO u_lag;

  INSERT INTO equipamento (unidade_id, tipo_equipamento_id, nome, hostname, ip_address, descricao) VALUES
    (u_sede, t_switch, 'TV-SW-SEDE',  'sw-sede.e2e',  '10.41.0.1',  'e2e-modo-tv'),
    (u_sede, t_fw,     'TV-FW-SEDE',  'fw-sede.e2e',  '10.41.0.2',  'e2e-modo-tv'),
    (u_sede, t_srv,    'TV-SRV-SEDE', 'srv-sede.e2e', '10.41.0.10', 'e2e-modo-tv'),
    (u_ita,  t_switch, 'TV-SW-ITA',   'sw-ita.e2e',   '10.41.1.1',  'e2e-modo-tv'),
    (u_ita,  t_srv,    'TV-SRV-ITA',  'srv-ita.e2e',  '10.41.1.10', 'e2e-modo-tv'),
    (u_lag,  t_switch, 'TV-SW-LAG',   'sw-lag.e2e',   '10.41.2.1',  'e2e-modo-tv'),
    (u_lag,  t_fw,     'TV-RT-LAG',   'rt-lag.e2e',   '10.41.2.254','e2e-modo-tv');

  INSERT INTO monitor (equipamento_id, tipo, nome, intervalo_segundos, timeout_ms)
  SELECT e.id, 'ICMP', 'ICMP ' || e.nome, 60, 2000 FROM equipamento e WHERE e.nome LIKE 'TV-%' ORDER BY e.id;

  -- Janela aberta antes das medições: o trigger grava primeira_medicao_em.
  INSERT INTO janela_monitoramento (monitor_id, inicio_em, origem)
  SELECT m.id, base - interval '25 hours', 'PRECISA'
  FROM monitor m JOIN equipamento e ON e.id = m.equipamento_id WHERE e.nome LIKE 'TV-%';

  SELECT m.id INTO m_falha FROM monitor m JOIN equipamento e ON e.id = m.equipamento_id WHERE e.nome = 'TV-RT-LAG';

  -- Medições: a cada 10 min nas últimas 24 h; latência 6..45 ms; TV-RT-LAG só FALHA nas últimas 2 h.
  FOR r IN SELECT m.id, row_number() OVER (ORDER BY m.id) AS k FROM monitor m JOIN equipamento e ON e.id = m.equipamento_id WHERE e.nome LIKE 'TV-%' LOOP
    INSERT INTO medicao (monitor_id, status, latencia_ms, mensagem, executado_em)
    SELECT r.id,
           CASE WHEN r.id = m_falha AND n <= 12 THEN 'FALHA' ELSE 'SUCESSO' END,
           CASE WHEN r.id = m_falha AND n <= 12 THEN NULL ELSE 6 + ((n * 7 + r.k * 5) % 40)::int END,
           'e2e-modo-tv',
           base - (n * interval '10 minutes')
    FROM generate_series(0, 144) AS n;
  END LOOP;

  INSERT INTO incidente (monitor_id, status, iniciado_em, motivo, observacao, created_at, updated_at)
  VALUES (m_falha, 'ABERTO', base - interval '2 hours', '3 falhas consecutivas de ICMP', 'e2e-modo-tv',
          base - interval '110 minutes', base - interval '110 minutes');
END $$;

COMMIT;

SELECT u.nome, count(DISTINCT e.id) AS equipamentos, count(md.id) AS medicoes,
       count(DISTINCT i.id) FILTER (WHERE i.status = 'ABERTO') AS incidentes_abertos
FROM unidade u JOIN equipamento e ON e.unidade_id = u.id JOIN monitor m ON m.equipamento_id = e.id
LEFT JOIN medicao md ON md.monitor_id = m.id LEFT JOIN incidente i ON i.monitor_id = m.id
WHERE u.sigla LIKE 'TV-%' GROUP BY u.nome ORDER BY u.nome;
