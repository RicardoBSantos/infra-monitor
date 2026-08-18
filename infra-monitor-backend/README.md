# Infra Monitor — Backend

Backend do sistema interno de monitoramento de infraestrutura de rede.

Esta etapa entrega apenas a **fundação** do backend: projeto Spring Boot, conexão
PostgreSQL, Flyway, Actuator, tratamento global de erros e testes.
O motor de monitoramento ICMP, alertas Telegram e autenticação **não** fazem parte
deste módulo.

## Requisitos

| Item       | Versão                                   |
|------------|------------------------------------------|
| Java       | 21 (JDK)                                 |
| Maven      | via Maven Wrapper (`./mvnw`), Maven 3.9.16 |
| PostgreSQL | 16 (container local ou instância própria) |
| Docker     | opcional — banco local e teste de integração |

## Configuração do PostgreSQL

A aplicação nunca lê credenciais do código-fonte. Tudo vem de variáveis de
ambiente, com defaults de desenvolvimento em `application.yml`.

| Variável      | Default local   | Uso                                |
|---------------|-----------------|------------------------------------|
| `DB_HOST`     | `localhost`     | host do PostgreSQL                 |
| `DB_PORT`     | `5432`          | porta do PostgreSQL                |
| `DB_NAME`     | `inframonitor`  | database                           |
| `DB_USERNAME` | `inframonitor`  | usuário                            |
| `DB_PASSWORD` | `inframonitor`  | senha (apenas desenvolvimento)     |
| `DB_POOL_SIZE`| `10`            | tamanho máximo do pool Hikari      |
| `SERVER_PORT` | `8080`          | porta HTTP da aplicação            |

`.env.example` traz o conjunto pronto para copiar para `.env` (o `.env` é ignorado pelo git).

Em produção essas variáveis são obrigatórias — os defaults existem só para o ambiente local.

## Subir o banco local

```bash
docker compose up -d
docker compose ps          # aguardar o healthcheck ficar "healthy"
docker compose logs -f postgres
docker compose down        # parar (o volume de dados é preservado)
```

O `compose.yml` cria apenas o PostgreSQL, com volume persistente
(`inframonitor-postgres-data`), healthcheck `pg_isready` e porta configurável via
`DB_PORT`. A aplicação **não** é dockerizada nesta etapa.

## Migrations (Flyway)

Local: `src/main/resources/db/migration`.

O schema é responsabilidade exclusiva do Flyway — o Hibernate roda com
`ddl-auto: validate` e nunca cria ou altera tabelas.

As migrations são aplicadas automaticamente na inicialização da aplicação.
Migrations já executadas nunca são editadas; toda mudança de schema entra como
uma nova versão (`V2__...`, `V3__...`).

| Migration           | Conteúdo                                                                 |
|---------------------|--------------------------------------------------------------------------|
| `V1__baseline.sql`  | Baseline sem objetos de schema. Inicializa `flyway_schema_history` e valida a cadeia aplicação → driver → PostgreSQL → Flyway. As tabelas de domínio entram a partir da `V2`, vindas do módulo de Banco de Dados. |

## Executar a aplicação

```bash
./mvnw spring-boot:run
```

Ou a partir do jar:

```bash
./mvnw -DskipTests package
java -jar target/infra-monitor-backend-0.0.1-SNAPSHOT.jar
```

Perfil padrão: `dev`. Para outro perfil:

```bash
./mvnw spring-boot:run -Dspring-boot.run.profiles=prod
java -jar target/infra-monitor-backend-0.0.1-SNAPSHOT.jar --spring.profiles.active=prod
```

## Executar os testes

```bash
./mvnw test
```

O teste de integração usa Testcontainers e sobe um PostgreSQL real. Sem Docker
disponível ele é **ignorado** (não falha); os testes de API rodam sempre.

## Endpoints

| Endpoint           | Descrição                                                        |
|--------------------|------------------------------------------------------------------|
| `GET /actuator/health` | Health check: aplicação de pé + conexão com o banco (`db`).   |
| `GET /api/v1/status`   | Status simples da API (aplicação, status, instante em UTC).   |

```bash
curl http://localhost:8080/actuator/health
curl http://localhost:8080/api/v1/status
```

Somente o endpoint `health` do Actuator é exposto. No perfil `prod` os detalhes
do health ficam ocultos (`show-details: never`).

## Convenções

- Prefixo da API REST: `/api/v1`.
- Estrutura modular por domínio sob `br.com.inframonitor` (`common`, e os módulos
  de negócio conforme forem implementados).
- Timestamps persistidos e trafegados em UTC (`Instant`, `hibernate.jdbc.time_zone=UTC`,
  Jackson em UTC). A conversão para o fuso do usuário é responsabilidade das
  camadas de apresentação.
- Sem Lombok: classes e records Java explícitos.
- Erros da API seguem o corpo padrão de `ErroResposta`:

```json
{
  "timestamp": "2026-08-18T11:20:17.465Z",
  "status": 400,
  "error": "Bad Request",
  "message": "Requisicao invalida",
  "path": "/api/v1/exemplo",
  "campos": [
    { "campo": "nome", "mensagem": "não deve estar em branco" }
  ]
}
```

## Notas do ambiente local

- Existe um PostgreSQL instalado no host desta máquina ouvindo em `5432`. Se a
  porta estiver ocupada, suba o container e a aplicação em outra porta:

```bash
DB_PORT=55432 docker compose up -d
DB_PORT=55432 ./mvnw spring-boot:run
```

- O Maven Wrapper baixa o Maven 3.9.16 na primeira execução; não é necessário ter
  Maven instalado.
