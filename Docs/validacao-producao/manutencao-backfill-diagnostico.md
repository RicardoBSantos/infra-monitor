# Diagnóstico do backfill da V19 — contagens por faixa

## Objetivo

A proposta de manutenção (`manutencao-proposta.md`) deixou as três faixas do backfill de
classificação de incidentes fechados como "NÃO VERIFICADO". Este documento traz os números
reais, medidos contra uma **cópia restaurada** do banco de dev, para dar suporte à migration
`V19` (Task 2).

## Método

1. `docker exec -e PGPASSWORD=... inframonitor-postgres pg_dump -U inframonitor -d inframonitor -Fc`
   gerou um dump lógico do banco de dev (porta 5434). `pg_dump` é operação de leitura pura.
2. O dump foi copiado para dentro de um container Postgres 16 **novo e descartável**
   (`infra-copia`, `docker run ... -p 5436:5432 postgres:16`) e restaurado ali com `pg_restore
   --no-owner`.
3. Todas as consultas de diagnóstico abaixo rodaram **na cópia, porta 5436**. Nenhuma escrita,
   `ALTER` ou migration foi aplicada ao banco de dev (porta 5434) em nenhum momento.
4. Ao final, o container `infra-copia` foi destruído (`docker rm -f`) e o arquivo de dump
   apagado. Ver seção "Prova de destruição".

## Linha de controle — banco de dev (porta 5434, somente leitura)

Consulta `SELECT` pura, rodada direto no `inframonitor-postgres` (5434), antes e depois do
trabalho na cópia, para provar que o dev não foi tocado:

| incidentes | medicoes | notificacoes | equipamentos | janelas | episodios_latencia |
|---:|---:|---:|---:|---:|---:|
| 76 | 317080 | 10 | 222 | 224 | 2 |

Flyway no dev: versão mais recente instalada = **V18**.

A mesma consulta, rodada na cópia restaurada (5436) logo após o `pg_restore`, devolveu os
mesmos números (76 / 317080 / 10 / 222 / 224 / 2) e o mesmo topo de `flyway_schema_history`
(V18), confirmando que a restauração é fiel e que o dev permaneceu inalterado durante o
diagnóstico.

## Faixas do backfill (consulta rodada na cópia, porta 5436)

Todos os 76 incidentes do banco de dev estão em status `FECHADO` (não há `ABERTO` nem outro
status).

| Faixa | Critério | Contagem |
|---|---|---:|
| 1 — `FECHAMENTO_MANUAL` (alta certeza) | `status = 'FECHADO' AND fechado_por IS NOT NULL` | **1** |
| 2 — `RECUPERACAO_AUTOMATICA` (alta certeza) | `status = 'FECHADO' AND fechado_por IS NULL AND observacao LIKE 'Recuperacao detectada automaticamente apos %sucessos consecutivos.'` | **0** |
| 3 — ambígua (fica `NULL`) | `status = 'FECHADO' AND fechado_por IS NULL AND (observacao IS NULL OR observacao NOT LIKE 'Recuperacao detectada automaticamente apos %sucessos consecutivos.')` | **75** |

Soma das três faixas = 76, bate com o total de incidentes `FECHADO`.

### Totais por status

| status | count |
|---|---:|
| FECHADO | 76 |

### Controle adicional — episódios de latência

`monitor_episodio_latencia` tem 2 registros no total; **1** tem `encerrado_em IS NOT NULL`. A
V19 não altera esta tabela — o número é só controle de contexto, confirmando que o dataset de
dev é pequeno e não influencia a leitura das faixas de incidente.

## Achado relevante sobre o dataset de dev

Inspecionando o conteúdo real por trás dos números: dos 76 incidentes `FECHADO`, **75 têm
`observacao IS NULL`** e apenas **1** tem `fechado_por` preenchido (id 78, sem observação). Não
existe, no banco de dev atual, nenhum incidente cuja observação contenha o texto de recuperação
automática (`ILIKE '%recupera%'` também devolve 0). Ou seja, a Faixa 2 está zerada não por falha
na lógica de classificação, e sim porque **este dataset de dev não contém nenhum caso real de
fechamento automático por recuperação** — os 76 incidentes foram todos fechados sem observação
registrada e, com uma única exceção, sem `fechado_por`.

## Por que a Faixa 3 é deliberadamente ambígua

A Faixa 3 mistura duas origens que a coluna atual não consegue distinguir:

* incidentes fechados manualmente **antes da V17**, quando a coluna `fechado_por` ainda não
  existia — logo, um fechamento manual legítimo aparece hoje como `fechado_por IS NULL`, igual a
  um fechamento automático;
* incidentes fechados pelo motor de monitoramento cuja observação foi sobrescrita ou nunca
  chegou a ser gravada (por exemplo, por uma versão anterior do motor que não preenchia
  `observacao`).

Os 75 incidentes desta faixa no dev são consistentes com esse cenário: são anteriores à
introdução de `fechado_por` (V17) e não carregam o texto padronizado de recuperação automática.
Não há, com os dados disponíveis, como separar dentro dessa faixa quanto foi fechamento manual
histórico e quanto foi automático sem observação — por isso a V19 deve classificar esta faixa
como `NULL` (não inferir), e não como um dos dois valores de alta certeza.

## Prova de destruição da cópia

```
$ docker rm -f infra-copia && rm -f <dump>
infra-copia
$ docker ps -a --filter name=infra-copia
CONTAINER ID   IMAGE   COMMAND   CREATED   STATUS   PORTS   NAMES
```

(saída vazia — nenhum container `infra-copia` remanescente; o arquivo de dump foi apagado do
diretório temporário de trabalho.)

## Conclusão para a Task 2 (V19)

* Faixa 1 (`FECHAMENTO_MANUAL`): 1 incidente no dev atual.
* Faixa 2 (`RECUPERACAO_AUTOMATICA`): 0 incidentes no dev atual — o critério está correto, mas
  o dataset de dev não tem exemplos dessa faixa.
* Faixa 3 (ambígua, `NULL`): 75 incidentes no dev atual — mistura fechamento manual pré-V17 com
  possível fechamento automático sem observação padronizada; tratar como incerteza genuína, não
  como um terceiro valor definitivo.
* Banco de dev (5434) permaneceu com os mesmos 76/317080/10/222/224/2 registros e Flyway em V18
  do início ao fim do diagnóstico — nenhuma escrita foi feita nele.
