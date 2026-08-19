-- O contrato administrativo permite equipamentos sem IP de gerenciamento e
-- usa VARCHAR para manter o mapeamento JPA simples. A tabela e suas FKs foram
-- introduzidas na V2; esta migration preserva os dados e o historico.
ALTER TABLE equipamento
    DROP CONSTRAINT ck_equipamento_ip_e_host;

ALTER TABLE equipamento
    ALTER COLUMN ip_address TYPE VARCHAR(45) USING ip_address::text,
    ALTER COLUMN ip_address DROP NOT NULL;
