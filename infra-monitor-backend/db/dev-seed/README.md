# db/dev-seed

Dado de **demonstração** do banco de desenvolvimento. Não é migration e não é fixture de teste.

## Por que existe

O dado de demo do banco de dev (as 11 unidades, seus nomes, siglas, cidades e códigos IBGE) foi
inserido manualmente em algum momento de agosto/2026 — as linhas 3 a 11 têm `created_at` idêntico
ao microssegundo, marca de um `INSERT` em lote ad-hoc. Não havia script versionado, nem seed
Flyway, nem `data.sql`. Reproduzir o ambiente de dev em outra máquina era impossível.

Esta pasta é o mecanismo que faltava.

## Por que não é migration Flyway

`CLAUDE.md`: *"Schema é responsabilidade exclusiva do Flyway"* — schema, não carga de demonstração.
Uma `V19__seed_demo.sql` rodaria em produção no primeiro boot e plantaria 11 unidades fictícias num
ambiente real. O que está aqui é dado de vitrine e só deve existir onde alguém o aplicou de
propósito.

## Por que fora de `src/main/resources`

Arquivo sob `src/main/resources` entra no jar. Este dado não tem por que viajar para produção nem
como bagagem morta.

## Por que SQL direto, e não a API

`PUT /unidades/{id}` aplica o corpo inteiro: campo ausente no payload é gravado como nulo. Um seed
por API que só quisesse preencher `latitude`/`longitude` apagaria `nome`, `sigla` e `cidade` das 11
unidades. Os `CHECK` do banco (`ck_unidade_coordenadas_completas`, `ck_unidade_latitude_faixa`,
`ck_unidade_longitude_faixa`) continuam validando a escrita direta, que é o que importa aqui.

**A topologia é a exceção e não está neste diretório.** `conecta_a_unidade_id` é gravado pelo
script `infra-monitor-frontend/e2e/seed-topologia-unidades.cjs`, via
`PUT /unidades/{id}/conexao` — esse endpoint carrega a detecção de ciclo multi-hop, que o
`CHECK ck_unidade_conexao_nao_reflexiva` não faz (ele só barra `id = id`). Um erro de digitação no
seed que criasse `A → B → A` passaria batido no SQL e é recusado pelo endpoint.

## Como aplicar

```bash
docker exec -i inframonitor-postgres psql -U inframonitor -d inframonitor \
  < infra-monitor-backend/db/dev-seed/01-unidades-coordenadas.sql

# topologia (aplicação no ar, ver o cabeçalho do script para as variáveis)
node infra-monitor-frontend/e2e/seed-topologia-unidades.cjs
```

Os scripts são idempotentes: rodar de novo não duplica nem altera nada além do pretendido.
