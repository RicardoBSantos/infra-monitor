-- V20 - IP do equipamento: so IPv4 de host monitoravel, tambem no banco.
--
-- A V4 trocou INET NOT NULL por VARCHAR(45) NULL para permitir equipamento sem IP
-- e manter o mapeamento JPA simples. Desde entao o banco aceita qualquer texto
-- por SQL direto (seed, manutencao manual), e o motor so sonda IPv4: alvo
-- invalido falha em toda sondagem e abre incidente permanente.
--
-- Mesma regra de RegraIpv4 (API), ip-helper.ts (tela) e tools/carga-real:
--   1o octeto 1-223 (fora 0.0.0.0/8 e multicast/reservado/broadcast),
--   demais 0-255, sem zero a esquerda (o ping do Linux le "010" como octal),
--   sem espacos (a API grava sem eles).
-- NULL continua permitido (equipamento sem IP; o motor ignora o monitor).
--
-- Pre-checagem antes de aplicar em producao (tem de devolver 0):
--   SELECT count(*) FROM equipamento WHERE ip_address IS NOT NULL AND ip_address !~ '^(22[0-3]|2[01][0-9]|1[0-9]{2}|[1-9][0-9]?)(\.(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9][0-9]|[0-9])){3}$';
-- Dev em 2026-10-09: 222 equipamentos, 0 violacoes.
ALTER TABLE equipamento ADD CONSTRAINT ck_equipamento_ip_ipv4 CHECK (
    ip_address IS NULL
    OR ip_address ~ '^(22[0-3]|2[01][0-9]|1[0-9]{2}|[1-9][0-9]?)(\.(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9][0-9]|[0-9])){3}$'
);
