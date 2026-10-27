# Integração F3 e V24 — 27/10/2026

## Inventário inicial

Referência remota consultada com `git fetch origin`: `cd0ae4b` (PR #19).
Contagens abaixo são anteriores aos merges desta rodada. Exclusivos são commits ausentes de
`origin/main`; total inclui todos os ancestrais alcançáveis e commits de merge.

| Branch local | Total | Exclusivos | Origem/base | Situação inicial | Migrations próprias |
|---|---:|---:|---|---|---|
| `main` | 322 | 0 | `2176cd1` | 38 commits atrás; atualizada por fast-forward | até V22 após atualização |
| `feat/manutencao-agendada` | 357 | 0 | criada de `origin/main`, `2176cd1` | publicada e mesclada no PR #19 | V21, V22 |
| `feat/manutencao-f3` | 380 | 20 | criada em `82c9c90`, reposicionada em `cd0ae4b` antes da implementação | não publicada inicialmente | V23 |
| `perf/medicao-consultas-lateral` | 363 | 3 | criada de `origin/main`, `cd0ae4b` | não publicada inicialmente | V24 |
| `fix/login-sem-indicadores-ficticios` | 323 | 0 | `2176cd1` | publicada e mesclada no PR #18 | nenhuma |
| `docs/preparacao-carga-real` | 181 | 5 | reflog: criada de `origin/main`, `1bbd6e5`; base comum atual `801005f` | publicada, PR #6 aberto; fora do escopo | nenhuma |
| `spike/n01-maplibre` | 37 | 1 | base comum com main `0d13913` | snapshot local antigo; fora do escopo | nenhuma |

F1 e F2 já entraram juntas: [PR #19](https://github.com/RicardoBSantos/infra-monitor/pull/19),
mesclado em 26/10/2026 às 11:20:32Z. Não criar PR duplicado.

Ordem mantida: **V21 (F1) → V22 (F2) → V23 (F3) → V24 (medições)**.
V24 não referencia objetos da V23, mas aplicar V24 primeiro deixa V23 pendente abaixo da versão
corrente e a validação padrão do Flyway rejeita essa situação. Sem `outOfOrder` e sem renumeração.

`git merge-tree --write-tree` passou para main × F3 e F3 × medições, sem conflitos textuais.
Os arquivos Java de produção alterados pela F3 e pela correção são distintos. A validação
funcional conjunta depende das suítes executadas após cada merge.

## Documentação de Testcontainers

Contagem por arquivos Java com anotação `@RequerDocker`: main inicial 42, F3 isolada 48,
correção isolada 46, integração final 52. CLAUDE.md e README do backend são atualizados no
PR da V24. `DocumentacaoRequerDockerTest` conta as classes nas fontes e confronta os dois
documentos durante `mvnw test`, inclusive sem Docker.

## Estado operacional antes da troca

A 8080 e a 4200 já estavam sem listener no início desta execução; não havia JVM da aplicação.
Docker Desktop também estava parado. Ao iniciá-lo, os containers existentes
`inframonitor-carga` (5436) e `inframonitor-postgres` (5434) retornaram.
Nenhum processo da aplicação foi encerrado por esta operação.

Registro estruturado local: `tmp/integracao-v24/estado-antes.json`, às 09:15:31 de 27/10 (UTC−3).

- Banco da carga em V22, todas as migrations bem-sucedidas.
- 87.313 medições; última em 26/10/2026 às **23:43:48.483683** (UTC−3).
- 11 notificações, todas ENVIADA; nenhuma PENDENTE ou ENVIANDO.
- Um incidente aberto: #5, monitor #8 (Swtich CPD), desde 26/10 às 08:09:03.983137.
- 14 janelas de monitoramento abertas; nenhuma manutenção manual ligada.
- As oito janelas de manutenção anteriores estão concluídas ou canceladas.
- Pré-checagem ICMP: 13 dos 14 alvos respondem; Swtich CPD continua sem resposta,
  coerente com o incidente já aberto.
- Backup `pg_dump -Fc`: `tmp/integracao-v24/pre-v24-20261027.dump`, 1.339.056 bytes;
  catálogo lido por `pg_restore -l`. Backup contém dados operacionais e fica fora do Git.

Não é possível identificar o horário exato da parada anterior apenas pela última medição.
O intervalo entre a última medição antiga e a primeira nova será reportado como lacuna observada;
o tempo entre início do processo atualizado e retomada será registrado separadamente.

## Execução e resultados

Logs e registros desta rodada ficam em `tmp/integracao-v24/` no worktree de integração;
não incluem tokens nem senhas nos relatórios. Os logs de teste usam bancos efêmeros Docker.

| Main validada | Backend | Frontend | Ferramenta de carga |
|---|---:|---:|---:|
| F1+F2, `cd0ae4b`, PR #19 | 1.165 | 682 (61 arquivos) | 91 |

Primeira etapa: zero falhas, erros ou testes pulados. Backend: `mvnw.cmd test` com Docker;
frontend: `npm test -- --watch=false`; carga: `node --test tools/carga-real/test/*.test.mjs`.
Os grupos optativos `rede-real` e `bench` continuam fora da suíte padrão conforme `pom.xml`.

F3: [PR #20](https://github.com/RicardoBSantos/infra-monitor/pull/20), commit de merge
`ff1ea34`. A V24 incorpora essa main por merge normal, sem reescrever commits publicados.

A checagem da documentação passou com 52 e falhou ao alterar temporariamente somente
CLAUDE.md para 51 (1 teste, 1 falha); o documento correto foi restaurado imediatamente.
