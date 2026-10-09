# Contrato REST para o frontend

## Autenticação (A02)

Todas as rotas `/api/v1/**`, exceto `POST /api/v1/auth/login`, exigem `Authorization: Bearer <accessToken>`. O token é JWT HS256, expira em 15 minutos por padrão e não há refresh token ou cookies.

`POST /api/v1/auth/login` recebe `{"email":"admin@empresa.com","senha":"..."}` e retorna `{"accessToken":"eyJ...","expiresIn":900,"usuario":{"id":1,"nome":"Administrador","email":"admin@empresa.com","papel":"ADMIN","ativo":true,"trocaSenhaObrigatoria":false}}`.

`GET /api/v1/auth/me` retorna o objeto `usuario`. `401 UNAUTHORIZED` cobre token ausente, inválido ou expirado; `403 FORBIDDEN` indica papel insuficiente. Login inválido retorna `401 AUTHENTICATION_FAILED`; conta inativa retorna `401 ACCOUNT_DISABLED`.

`ADMIN` administra tudo. `OPERADOR` lê as áreas operacionais, altera inventário/monitores e fecha incidentes. `VISUALIZADOR` só lê. Apenas ADMIN usa `/usuarios/**`, salvo `PUT /api/v1/usuarios/me/senha`, disponível a qualquer autenticado com `senhaAtual` e `novaSenha`.

## Base e CORS

- Base URL: `http://<host>:<porta>/api/v1`; o Angular deve configurar essa URL no próprio ambiente.
- CORS é centralizado para `/api/**`. Em desenvolvimento a origem padrão é `http://localhost:4200`.
- Produção deve definir `CORS_ALLOWED_ORIGINS` (uma ou mais origens separadas por vírgula), sem recompilar a API. Não há wildcard, nem credentials.
- Métodos permitidos: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`. Headers permitidos: `Accept`, `Content-Type`, `X-Requested-With`.
- Health administrativo: `GET /actuator/health`; não é parte da API de negócio.

## Convenções

- JSON usa `camelCase`; IDs são números; enums são strings; instantes são ISO-8601 UTC, por exemplo `2026-08-19T12:00:00Z`.
- Ausência de dado é `null` (por exemplo, `encerradoEm` de incidente aberto e `ultimaMedicao` sem histórico). Coleções são `[]`.
- `DELETE` retorna `204 No Content`. Criações retornam `201`, corpo do recurso e header `Location`. `PUT` e os `PATCH` de ativação retornam o recurso atualizado.
- `ativo` é status administrativo. O status operacional deve ser lido exclusivamente da Dashboard API; não inferir indisponibilidade por uma medição `FALHA` isolada.

## Paginação

Endpoints paginados retornam sempre:

```json
{"content":[],"page":0,"size":20,"totalElements":0,"totalPages":0,"first":true,"last":true}
```

`page` é zero-based. `size` tem máximo 100 (valores maiores são limitados a 100). Os defaults são 20, exceto medições (50). `sort=campo,asc|desc` aceita somente campos documentados abaixo; campo inválido retorna `400 INVALID_REQUEST`.

## Erros

```json
{"timestamp":"2026-08-19T12:00:00Z","status":400,"error":"Bad Request","code":"VALIDATION_ERROR","message":"Requisicao invalida","path":"/api/v1/equipamentos","fields":{"nome":"must not be blank"}}
```

`fields` existe apenas em validação. Códigos estáveis: `VALIDATION_ERROR`, `INVALID_ENUM`, `MALFORMED_REQUEST`, `INVALID_PARAMETER`, `INVALID_REQUEST`, `RESOURCE_NOT_FOUND`, `BUSINESS_CONFLICT`, `DATA_INTEGRITY_VIOLATION` e `INTERNAL_ERROR`. O corpo 500 não contém detalhes de banco, framework ou integrações.

## Endpoints

| Recurso | Rotas e filtros |
|---|---|
| Unidades | `GET/POST /unidades`; `GET/PUT/DELETE /unidades/{id}`; `PATCH /unidades/{id}/ativar|desativar`; filtro de lista: `ativo`. |
| Tipos de equipamento | Mesma operação de Unidades em `/tipos-equipamento`; filtro: `ativo`. |
| Equipamentos | `GET/POST /equipamentos`; `GET/PUT/DELETE /equipamentos/{id}`; `PATCH /equipamentos/{id}/ativar|desativar`; paginado, filtros `unidadeId`, `tipoEquipamentoId`, `ativo`; sort: `id,nome,ip,hostname,localizacao,ativo,createdAt,updatedAt`. |
| Monitores | Equivalente em `/monitores`; paginado, filtros `equipamentoId`, `tipo`, `ativo`; sort: `id,nome,tipo,intervaloSegundos,timeoutMs,ativo,createdAt,updatedAt`. |
| Medições | `GET/POST /medicoes`, `GET /medicoes/{id}`; paginado, filtros `monitorId`, `status`, `inicio`, `fim`; sort: `id,status,latenciaMs,executadoEm,createdAt`. |
| Incidentes | `GET/POST /incidentes`, `GET /incidentes/{id}`, `PATCH /incidentes/{id}/fechar`; paginado, filtros `monitorId`, `equipamentoId`, `unidadeId`, `status`, `inicio`, `fim`; sort: `id,status,iniciadoEm,encerradoEm,createdAt,updatedAt`. |
| Notificações | `GET /notificacoes`, `GET /notificacoes/{id}`; paginado, filtros `incidenteId`, `status`, `canal`, `tipoEvento`, `inicio`, `fim`; sort: `id,canal,tipoEvento,status,tentativas,enviadoEm,createdAt,updatedAt`. |
| Dashboard | `GET /dashboard/resumo`; `GET /dashboard/unidades`; `GET /dashboard/unidades/{id}`; `GET /dashboard/unidades/{id}/equipamentos` (paginado; filtros `tipoEquipamentoId`, `ativo`; sort: `id,nome,ip,localizacao,ativo`). |

`inicio` e `fim` são `Instant`; `inicio > fim` retorna `400 INVALID_REQUEST`. Os lookups de formulários reutilizam `GET /unidades?ativo=true`, `GET /tipos-equipamento?ativo=true` e `GET /equipamentos?unidadeId=<id>&ativo=true`.

### Payloads de criação mais usados

Uma Unidade possui `id`, `nome`, `sigla`, `descricao`, `codigoIbge`, `ativo`, `createdAt` e `updatedAt`. `codigoIbge` é `string | null`: código IBGE municipal de sete dígitos, usado pelo frontend para associação cartográfica. Requests de criação e atualização podem omiti-lo ou enviá-lo como `null`.

```json
{"nome":"Sede Administrativa","sigla":"SEDE","descricao":"Administração","codigoIbge":"2800308"}
```

```json
{"unidadeId":1,"tipoEquipamentoId":2,"nome":"SW-CORE-01","ip":"10.0.0.1","hostname":"sw-core-01","descricao":"Switch core","localizacao":"CPD"}
```

```json
{"equipamentoId":10,"tipo":"ICMP","nome":"ICMP principal","intervaloSegundos":60,"timeoutMs":2000,"falhasParaIncidente":3,"sucessosParaRecovery":2}
```

### Enums públicos

- `TipoMonitor`: `ICMP`.
- `StatusMedicao`: `SUCESSO`, `FALHA`.
- `StatusIncidente`: `ABERTO`, `FECHADO`.
- `CanalNotificacao`: `TELEGRAM`; `TipoEventoNotificacao`: `INCIDENTE_ABERTO`, `INCIDENTE_FECHADO`; `StatusNotificacao`: `PENDENTE`, `ENVIANDO`, `ENVIADA`, `FALHA`.
- Dashboard: `StatusOperacionalMonitor` (`DISPONIVEL`, `INDISPONIVEL`, `SEM_DADOS`, `DESABILITADO`), `StatusOperacionalEquipamento` (inclui `SEM_MONITORAMENTO`) e `StatusOperacionalUnidade` (inclui `DEGRADADA`, `SEM_EQUIPAMENTOS`).

O dashboard aplica os thresholds e a regra de incidentes no backend; o frontend deve apresentar o `status` recebido, sem recalcular estado operacional.

### Unidade da Dashboard

As respostas de `GET /dashboard/unidades` e `GET /dashboard/unidades/{id}` também contêm `codigoIbge: string | null`, propagado do cadastro da Unidade. É o código IBGE municipal usado pelo frontend para associação cartográfica; a Dashboard não faz geocoding nem descoberta de município.
