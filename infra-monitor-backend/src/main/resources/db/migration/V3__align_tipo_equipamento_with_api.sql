-- V3 - Ajusta tipo_equipamento ao contrato administrativo da API.
--
-- A V2 foi criada pelo modulo de inventario e antecipou o campo slug. Como
-- este cadastro nao o recebe nem o expoe, ele deve ser opcional. Os limites
-- de nome e descricao ficam alinhados ao contrato Java desta feature.
ALTER TABLE tipo_equipamento
    ALTER COLUMN nome TYPE VARCHAR(150),
    ALTER COLUMN descricao TYPE VARCHAR(1000),
    ALTER COLUMN slug DROP NOT NULL;
