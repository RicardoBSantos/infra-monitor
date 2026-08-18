# Infra Monitor

Sistema interno de monitoramento de infraestrutura de rede.

## Estado atual

| Módulo | Status |
|---|---|
| 01–03 (concepção, modelagem, banco) | fora deste repositório até agora |
| **04 — Backend Java/Spring Boot** | **fundação implementada** (`infra-monitor-backend/`) |
| 05 — Monitoring Engine (ICMP) | não iniciado |
| Frontend Angular | não iniciado |
| Notificações Telegram | não iniciado |
| Autenticação | não iniciada |

O backend atual entrega apenas fundação: projeto Spring Boot, PostgreSQL, Flyway,
Actuator, tratamento global de erros e testes. Não existe CRUD de negócio.

## Estrutura do repositório

```
infra-monitor/
└── infra-monitor-backend/     Java 21 + Spring Boot 4.1.0 + Maven Wrapper
```

## Stack

- Java 21, Spring Boot 4.1.0, Maven (via `./mvnw`)
- PostgreSQL 16, Flyway, Spring Data JPA, Bean Validation, Actuator
- Angular (futuro), Docker/Linux/Nginx (deploy futuro)

## Comandos (a partir de `infra-monitor-backend/`)

```bash
docker compose up -d          # PostgreSQL local
./mvnw spring-boot:run        # sobe a app (migrations rodam no boot)
./mvnw test                   # suíte completa
./mvnw -DskipTests package    # jar executável
```

Health: `GET /actuator/health` · Status: `GET /api/v1/status`

Porta 5432 pode estar ocupada por um PostgreSQL do host. Nesse caso use
`DB_PORT=55432` no compose e na aplicação.

## Arquitetura do backend

Modular por domínio sob `br.com.inframonitor`. Nada de `controller/`, `service/`,
`repository/` globais.

```
br.com.inframonitor
├── InfraMonitorApplication.java
├── common/{api,exception}          único módulo existente hoje
└── unidade, equipamento, monitor, incidente, notificacao   (criar quando houver código real)
```

Dentro de cada módulo, só o que for necessário: `controller service repository entity dto mapper`.

## Modelo de domínio (referência, ainda não implementado)

`Unidade → Equipamento → Monitor → Medição → Incidente → Notificação`

Regras já definidas:

1. Equipamento pertence obrigatoriamente a uma unidade e tem um tipo obrigatório.
2. Unidade tem N equipamentos; equipamento tem N monitores.
3. Monitor e equipamento são entidades distintas.
4. Medições pertencem ao monitor, não ao equipamento.
5. Incidentes pertencem ao monitor. Falha de ping não gera incidente automaticamente.
6. Um incidente gera N notificações. Notificação ≠ incidente.
7. Telegram é apenas um dos canais possíveis.
8. Desativação lógica via `ativo = false`; exclusão física só como operação administrativa.
9. Datas operacionais em UTC, prontas para conversão de timezone na apresentação.

## Convenções obrigatórias

- **Sem Lombok.** Classes e `record` Java explícitos.
- **Sem abstração especulativa:** nada de `BaseService`/`BaseController`/`BaseRepository`,
  interfaces sem implementação múltipla, padrões aplicados por padrão.
- **Não criar módulo ou classe vazia** antecipando etapa futura.
- Prefixo REST `/api/v1`.
- Datas: `Instant` e Java Time API. Nunca `java.util.Date` nem `Calendar`.
  Persistência e tráfego em UTC (`hibernate.jdbc.time_zone=UTC`, Jackson em UTC).
- Erros da API sempre no formato `ErroResposta`
  (`timestamp, status, error, message, path, campos`).
  `TratadorGlobalDeErros` herda de `ResponseEntityExceptionHandler` para cobrir
  também 404/405/415 do próprio Spring MVC — não trocar por `@ExceptionHandler` solto.
- Credenciais só por variável de ambiente: `DB_HOST DB_PORT DB_NAME DB_USERNAME
  DB_PASSWORD DB_POOL_SIZE SERVER_PORT`. Nunca versionar senha real.

## Banco e migrations

- `ddl-auto: validate`. Hibernate **nunca** cria ou altera schema.
  Proibido `create`, `create-drop`, `update`.
- Schema é responsabilidade exclusiva do Flyway, em
  `infra-monitor-backend/src/main/resources/db/migration`.
- `V1__baseline.sql` não cria objetos de propósito: apenas inicializa
  `flyway_schema_history`. As tabelas de domínio entram a partir de `V2`.
- **Nunca editar migration já executada.** Toda mudança é uma nova versão.

## Particularidades do Spring Boot 4.1 (custaram tempo, não regredir)

- Flyway precisa de `spring-boot-starter-flyway`. Só `flyway-core` não traz a
  autoconfiguração e as migrations silenciosamente não rodam.
- `@WebMvcTest` vive em `org.springframework.boot.webmvc.test.autoconfigure`,
  artefato `spring-boot-starter-webmvc-test`.
- `HealthEndpoint`/`Status` migraram para `org.springframework.boot.health.*`.
- Jackson 3: `spring.jackson.serialization.write-dates-as-timestamps` não existe
  mais e quebra o contexto. Datas já saem em ISO-8601 por padrão.
- Testcontainers não está no BOM do Boot 4 — versão fixada via
  `testcontainers-bom` no `dependencyManagement`.
- `NoResourceFoundException` é `ServletException` implementando `ErrorResponse`,
  não `ResponseStatusException`.

## Testes

- `StatusControllerTest` (`@WebMvcTest`) e `TratadorGlobalDeErrosTest` rodam sempre.
- `InfraMonitorApplicationTests` usa Testcontainers com PostgreSQL real; sem Docker
  é ignorado via `@EnabledIf("dockerDisponivel")`, nunca falha.
- Não criar mock ou teste artificial só para aumentar contagem.
