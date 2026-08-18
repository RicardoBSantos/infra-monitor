-- V1 - Baseline do Infra Monitor.
--
-- Nenhum objeto de schema e criado aqui de proposito: as tabelas de dominio
-- (unidade, equipamento, monitor, medicao, incidente, notificacao) pertencem ao
-- modulo de Banco de Dados e entrarao como V2 em diante.
-- Esta migration existe apenas para inicializar o flyway_schema_history e provar
-- que a cadeia aplicacao -> driver -> PostgreSQL -> Flyway esta funcional.
SELECT 1;
