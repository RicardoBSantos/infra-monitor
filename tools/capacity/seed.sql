-- Capacity proof (D02.11-A.1): synthetic inventory for an ISOLATED database only.
-- 25 units x 10 devices x 1 ICMP monitor = 250 monitors at 60 s, all with an open monitoring
-- window since :dias days ago. Never run against production.
\set ON_ERROR_STOP on
INSERT INTO tipo_equipamento (nome, slug) VALUES ('Bench', 'bench');
INSERT INTO unidade (nome, sigla, cidade, estado)
SELECT 'Unidade bench ' || u, 'UB' || u, 'Aracaju', 'SE' FROM generate_series(1, 25) u;
INSERT INTO equipamento (unidade_id, tipo_equipamento_id, nome, ip_address)
SELECT un.id, (SELECT id FROM tipo_equipamento WHERE slug = 'bench'),
       'Equipamento bench ' || un.id || '-' || e, '10.200.' || un.id || '.' || e
FROM unidade un CROSS JOIN generate_series(1, 10) e;
INSERT INTO monitor (equipamento_id, tipo, nome, intervalo_segundos, timeout_ms, created_at)
SELECT eq.id, 'ICMP', 'ICMP ' || eq.nome, 60, 2000, now() - make_interval(days => :dias + 1)
FROM equipamento eq;
INSERT INTO janela_monitoramento (monitor_id, inicio_em, origem)
SELECT m.id, date_trunc('minute', now()) - make_interval(days => :dias), 'PRECISA' FROM monitor m;
SELECT count(*) AS monitores FROM monitor;
