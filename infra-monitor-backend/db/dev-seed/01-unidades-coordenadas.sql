-- Coordenadas e endereços das 11 unidades de demonstração do banco de desenvolvimento.
--
-- Não é migration. Ver db/dev-seed/README.md para por que este arquivo não está sob
-- src/main/resources/db/migration e por que a topologia (conecta_a_unidade_id) NÃO é gravada aqui.
--
-- Casamento por `sigla`, não por `id`: `uq_unidade_sigla` já garante unicidade entre as não
-- excluídas, e id de sequence não é estável entre bancos recriados do zero.
--
-- Coordenadas são plausíveis, não cadastrais: centro do município, e nas quatro unidades de
-- Aracaju um ponto distinto por unidade (Centro, Siqueira Campos, São José, Atalaia) para que os
-- marcadores não colidam no mesmo pixel do mapa. `numeric(9,6)` guarda as 6 casas; o par completo é
-- exigido por `ck_unidade_coordenadas_completas`, então latitude e longitude andam sempre juntas.
--
-- Idempotente: reaplica os mesmos valores, e não toca em unidade cuja sigla não esteja na lista.

begin;

update unidade u set
    latitude   = dado.latitude,
    longitude  = dado.longitude,
    endereco   = dado.endereco,
    updated_at = now()
from (values
    -- Aracaju (2800308) — quatro unidades, quatro pontos distintos da cidade.
    ('SED',    -10.911600, -37.049700, 'Av. Ivo do Prado, 1291 - Centro'),
    ('ESC',    -10.931700, -37.065800, 'Rua Niceu Dantas, 180 - Siqueira Campos'),
    ('CIS-01', -10.941800, -37.060200, 'Rua Campo do Brito, 990 - São José'),
    ('HOT-04', -10.988000, -37.048000, 'Av. Santos Dumont, 1500 - Atalaia'),
    -- Interior — um ponto por município.
    ('LAG-03', -10.917200, -37.670000, 'Av. Dep. Antônio Carlos Valadares, 615 - Centro'),
    ('EST-05', -11.267900, -37.438300, 'Rua Capitão Salomão, 88 - Centro'),
    ('SOC-06', -10.855600, -37.126400, 'Av. Coletora A, 210 - Conjunto Marcos Freire II'),
    ('SCR-07', -11.014700, -37.206400, 'Rua Messias Prado, 47 - Centro Histórico'),
    ('PRO-08', -10.211700, -36.840300, 'Praça Cel. José Vieira, 45 - Centro'),
    ('ITA-09', -10.685300, -37.425600, 'Av. Otoniel Dória, 720 - Centro'),
    ('SIM-10', -10.738600, -37.810600, 'Praça Fausto Cardoso, 12 - Centro')
) as dado(sigla, latitude, longitude, endereco)
where lower(u.sigla) = lower(dado.sigla)
  and u.deleted_at is null;

-- Falha alto se alguma sigla da lista não existir no banco: seed silenciosamente parcial deixaria
-- unidade sem coordenada e o mapa sem marcador, sem nada que indicasse a causa.
do $$
declare faltando int;
begin
    select count(*) into faltando
    from (values ('SED'),('ESC'),('CIS-01'),('HOT-04'),('LAG-03'),('EST-05'),
                 ('SOC-06'),('SCR-07'),('PRO-08'),('ITA-09'),('SIM-10')) as esperada(sigla)
    where not exists (
        select 1 from unidade u
        where lower(u.sigla) = lower(esperada.sigla)
          and u.deleted_at is null
          and u.latitude is not null
    );
    if faltando > 0 then
        raise exception 'dev-seed: % unidade(s) da lista não receberam coordenada', faltando;
    end if;
end $$;

commit;

select id, sigla, nome, latitude, longitude, endereco from unidade where deleted_at is null order by id;
