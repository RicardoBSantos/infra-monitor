# R04.2 — Contrato operacional da exportação CSV

**Status:** implementado e homologado em 25/08/2026.

## Endpoints

Todos os endpoints são `GET`, exigem bearer válido e aceitam `inicio` e `fim` em ISO-8601 com offset. `page`, `size` e `format` não pertencem ao contrato e retornam `400 INVALID_REQUEST`.

| Relatório | Endpoint | Filtros opcionais | Sort padrão |
|---|---|---|---|
| Disponibilidade Equipamentos | `/api/v1/relatorios/disponibilidade/equipamentos/export` | `unidadeId`, `equipamentoId`, `monitorId`, `tipoEquipamentoId`, `sort` | `equipamentoNome,asc` |
| Disponibilidade Unidades | `/api/v1/relatorios/disponibilidade/unidades/export` | `unidadeId`, `sort` | `unidadeNome,asc` |
| Incidentes | `/api/v1/relatorios/incidentes/export` | `unidadeId`, `equipamentoId`, `monitorId`, `status`, `sort` | `iniciadoEm,desc` |
| Medições | `/api/v1/relatorios/medicoes/export` | `unidadeId`, `equipamentoId`, `monitorId`, `status`, `sort` | `executadoEm,desc` |
| Latência | `/api/v1/relatorios/latencia/export` | `unidadeId`, `equipamentoId`, `monitorId`, `sort` | `monitorNome,asc` |
| Notificações | `/api/v1/relatorios/notificacoes/export` | `incidenteId`, `status`, `canal`, `tipoEvento`, `sort` | `createdAt,desc` |

Whitelists de sort, validações temporais, existência e coerência hierárquica são as mesmas dos relatórios homologados. Os limites temporais permanecem 365 dias para disponibilidade, incidentes e notificações, 31 dias para medições e 90 dias para latência.

## Resposta de sucesso

```http
HTTP/1.1 200 OK
Content-Type: text/csv;charset=UTF-8
Content-Disposition: attachment; filename="medicoes_2026-08-01_2026-08-25.csv"; filename*=UTF-8''medicoes_2026-08-01_2026-08-25.csv
Cache-Control: no-store
```

O arquivo contém BOM UTF-8 `EF BB BF`, header normativo, separador vírgula, escaping RFC 4180 e CRLF. `null` é campo vazio; datas são ISO-8601 UTC com `Z`; decimais usam ponto e representação plain; enums não são traduzidos. Texto iniciado por `=`, `+`, `-`, `@`, TAB, CR ou LF, inclusive após whitespace inicial, recebe apóstrofo antes do escaping CSV.

Os headers e a ordem das colunas permanecem normativos em `Docs/reports-export-architecture.md` e na especificação R04.2.

## Limites e erros

O backend valida filtros e sort e faz um `COUNT` real antes de configurar qualquer byte do CSV. Até 100.000 linhas de dados é permitido; acima disso retorna:

```http
HTTP/1.1 422 Unprocessable Entity
Content-Type: application/json
```

```json
{
  "status": 422,
  "error": "Unprocessable Entity",
  "code": "EXPORT_LIMIT_EXCEEDED",
  "message": "A exportacao excede o limite de 100000 linhas; restrinja o periodo ou os filtros.",
  "path": "/api/v1/relatorios/medicoes/export"
}
```

Erros de parâmetros/filtros/sort retornam `400 INVALID_REQUEST`, IDs inexistentes retornam `404 RESOURCE_NOT_FOUND`, ausência/invalidez do bearer e conta inativa retornam 401, e troca obrigatória de senha retorna `403 PASSWORD_CHANGE_REQUIRED`. Timeout antes do body retorna `503 EXPORT_TIMEOUT`. Todos os erros anteriores ao streaming usam `ErroResposta` JSON e não iniciam CSV.

As propriedades operacionais são:

| Propriedade | Variável | Default |
|---|---|---:|
| `app.reports.export.max-rows` | `REPORT_EXPORT_MAX_ROWS` | 100000 |
| `app.reports.export.fetch-size` | `REPORT_EXPORT_FETCH_SIZE` | 500 |
| `app.reports.export.timeout-seconds` | `REPORT_EXPORT_TIMEOUT_SECONDS` | 60 |

O limite configurado nunca pode elevar o teto público acima de 100.000.

## Streaming e consistência

A preparação abre uma conexão JDBC dedicada com `autocommit=false`, `readOnly=true` e isolamento `REPEATABLE_READ`. O count inicia o snapshot; a mesma conexão permanece aberta até o `ResultSet` da exportação terminar. O cursor usa `TYPE_FORWARD_ONLY`, `CONCUR_READ_ONLY`, `FETCH_FORWARD` e `fetchSize=500`. Cada projeção JDBC é mapeada e escrita imediatamente no `OutputStream`; não existe lista ampla, paginação em loop, `OFFSET` progressivo, entidade JPA ou N+1.

O redispatch servlet `ASYNC` é permitido somente depois da requisição inicial já autenticada/autorizada. JWT e RBAC continuam obrigatórios na entrada.

## CORS e RBAC

O CORS central expõe `Content-Disposition`, aceita `Authorization`, preserva `allowCredentials(false)` e rejeita origens não configuradas. `ADMIN`, `OPERADOR` e `VISUALIZADOR` ativos com senha regular podem exportar os seis relatórios.

## Auditoria

O logger `REPORT_EXPORT_AUDIT` emite `EXPORT_STARTED`, `EXPORT_SUCCEEDED` e `EXPORT_FAILED` com ID interno, papel, relatório, período, filtros normalizados, sort validado, quantidade, bytes, duração, timestamp, resultado e correlation ID gerado por exportação. Não registra bearer/JWT, conteúdo CSV, texto livre, credenciais, secrets, token Telegram, exceção interna ou stack trace.

## Evidências da homologação local

Ambiente: Java 21.0.8, Spring Boot 4.1.0, PostgreSQL 16 real e Testcontainers 1.21.4.

| Ensaio | Linhas | Tempo | Bytes | Memória aproximada do backend |
|---|---:|---:|---:|---:|
| Medições | 100.000 | 1.003 ms | 10.486.441 | pico incremental 47.161.344 bytes |
| Disponibilidade Equipamentos | 5.000 | 508 ms | 758.047 | pico incremental 34.443.264 bytes |

O teste automatizado confirmou 100.000 linhas permitidas e 100.001 como 422 JSON sem BOM/CSV parcial. Os seis smokes autenticados em `http://localhost:8080` retornaram 200 e arquivos válidos.

`EXPLAIN (ANALYZE, BUFFERS)` foi executado nas duas queries críticas. Medições entregou 100.000 linhas em 106,777 ms no PostgreSQL e fez external merge de 12.736 kB para o sort estável. Disponibilidade entregou 5.000 linhas em 65,788 ms; o sort final usou quicksort de 1.013 kB e a agregação temporal teve spill temporário pequeno (248 kB). Não houve N+1 nem loop paginado. Esses planos são adequados ao teto atual e devem ser reavaliados se cardinalidade, concorrência ou sorts mudarem.

O Excel desktop não estava instalado no ambiente. BOM, UTF-8/acentuação e contrato byte a byte foram validados por teste e smoke; a abertura no Excel alvo permanece como revalidação da R04.5, sem bloquear a R04.2.
