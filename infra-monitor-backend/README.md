# Infra Monitor — Backend

Backend do sistema interno de monitoramento de infraestrutura de rede.

O backend consolida o inventário, monitores ICMP, histórico de medições,
detecção de incidentes e a fila de notificações Telegram. Autenticação e
endpoints agregados de dashboard permanecem fora do escopo.

Fluxo operacional:

```text
Unidade -> Equipamento -> Monitor -> Medição -> Incidente -> Notificação -> Telegram
```

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
| `V1__baseline.sql`  | Baseline sem objetos de schema. Inicializa `flyway_schema_history` e valida a cadeia aplicação → driver → PostgreSQL → Flyway. |
| `V2__create_inventario_tables.sql` | Cria as tabelas de inventário, incluindo `unidade` com auditoria UTC e unicidade case-insensitive de nome e sigla. |
| `V3__align_tipo_equipamento_with_api.sql` | Alinha os limites e campos de tipo de equipamento ao contrato da API. |
| `V4__make_equipamento_ip_optional.sql` | Torna o IP de equipamento opcional e compatível com o mapeamento JPA. |
| `V5__create_monitor.sql` | Cria monitores por equipamento com intervalo, timeout e integridade referencial. |
| `V6__create_medicao.sql` | Cria o histórico imutável de medições e índices cronológicos. |
| `V7__create_incidente_tables.sql` | Cria incidentes e a unicidade de incidente aberto por monitor. |
| `V8__add_incident_thresholds_to_monitor.sql` | Adiciona thresholds de falha e recovery ao monitor. |
| `V9__create_notificacao.sql` | Cria notificações idempotentes por incidente, canal e evento. |
| `V10__add_notification_dispatch_queue.sql` | Adiciona a fila de despacho e seu índice de elegibilidade. |

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
disponível ele é **ignorado** (não falha); os testes de API rodam sempre. O fluxo
end-to-end usa medições simuladas e um cliente Telegram falso, sem ping ou envio
externo.

## Endpoints

| Endpoint           | Descrição                                                        |
|--------------------|------------------------------------------------------------------|
| `GET /actuator/health` | Health check: aplicação de pé + conexão com o banco (`db`).   |
| `GET /api/v1/status`   | Status simples da API (aplicação, status, instante em UTC).   |
| `POST /api/v1/unidades` | Cria uma unidade (`nome` e `sigla` são obrigatórios). Retorna `201 Created` e `Location`. |
| `GET /api/v1/unidades` | Lista unidades por nome; aceita o filtro opcional `ativo`. |
| `GET /api/v1/unidades/{id}` | Consulta uma unidade. |
| `PUT /api/v1/unidades/{id}` | Atualiza nome, sigla e descrição da unidade. |
| `PATCH /api/v1/unidades/{id}/ativar` | Ativa uma unidade. |
| `PATCH /api/v1/unidades/{id}/desativar` | Desativa uma unidade. |
| `DELETE /api/v1/unidades/{id}` | Exclui fisicamente uma unidade. |
| `POST /api/v1/tipos-equipamento` | Cria um tipo de equipamento (`nome` é obrigatório). Retorna `201 Created` e `Location`. |
| `GET /api/v1/tipos-equipamento` | Lista tipos por nome; aceita o filtro opcional `ativo`. |
| `GET /api/v1/tipos-equipamento/{id}` | Consulta um tipo de equipamento. |
| `PUT /api/v1/tipos-equipamento/{id}` | Atualiza nome e descrição do tipo. |
| `PATCH /api/v1/tipos-equipamento/{id}/ativar` | Ativa um tipo de equipamento. |
| `PATCH /api/v1/tipos-equipamento/{id}/desativar` | Desativa um tipo de equipamento. |
| `DELETE /api/v1/tipos-equipamento/{id}` | Exclui fisicamente um tipo de equipamento. |
| `POST /api/v1/equipamentos` | Cria um equipamento vinculado a uma unidade e tipo ativos. |
| `GET /api/v1/equipamentos` | Lista equipamentos paginados; aceita `unidadeId`, `tipoEquipamentoId` e `ativo`. |
| `GET /api/v1/equipamentos/{id}` | Consulta um equipamento. |
| `PUT /api/v1/equipamentos/{id}` | Atualiza os dados de inventário e os vínculos permitidos. |
| `PATCH /api/v1/equipamentos/{id}/ativar` | Ativa um equipamento quando unidade e tipo estão ativos. |
| `PATCH /api/v1/equipamentos/{id}/desativar` | Desativa um equipamento. |
| `DELETE /api/v1/equipamentos/{id}` | Exclui fisicamente um equipamento. |
| `POST` / `GET /api/v1/monitores` | Cria e lista monitores paginados; filtros `equipamentoId`, `tipo`, `ativo`. |
| `GET` / `PUT /api/v1/monitores/{id}` | Consulta ou atualiza um monitor; `PATCH .../ativar`, `PATCH .../desativar` e `DELETE` também estão disponíveis. |
| `POST /api/v1/medicoes` | Registra uma medição; não existe update nem delete público. |
| `GET /api/v1/medicoes` | Lista medições paginadas; filtros `monitorId`, `status`, `inicio`, `fim`. |
| `POST /api/v1/incidentes` | Abre incidente manualmente. |
| `GET /api/v1/incidentes` | Lista incidentes paginados; filtros `monitorId`, `equipamentoId`, `unidadeId`, `status`, `inicio`, `fim`. |
| `PATCH /api/v1/incidentes/{id}/fechar` | Fecha um incidente e cria a notificação de recovery. |
| `GET /api/v1/notificacoes` | Lista notificações paginadas; filtros `incidenteId`, `status`, `canal`, `tipoEvento`, `inicio`, `fim`. |
| `GET /api/v1/notificacoes/{id}` | Consulta uma notificação. |

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

## Monitoring Engine ICMP

O engine fica desabilitado por padrao e deve ser habilitado somente na instancia
unica responsavel por executar monitores:

```bash
MONITORING_ENGINE_ENABLED=true ./mvnw spring-boot:run
```

As configuracoes disponiveis sao `MONITORING_ENGINE_SCHEDULER_DELAY_MS` (padrao
`1000`), `MONITORING_ENGINE_WORKER_THREADS` (padrao `4`) e
`MONITORING_ENGINE_QUEUE_CAPACITY` (padrao `100`). Em Linux, a execucao usa
`ping` via `ProcessBuilder`, sem shell, e o timeout e controlado pela JVM.
Imagens Docker precisam disponibilizar `iputils-ping`; dependendo da politica de
seguranca, podem precisar da capability `NET_RAW`.

Esta versao pressupoe uma unica instancia executando o engine e nao possui lock
distribuido. Equipamento ativo sem IP e ignorado com log de aviso, sem Medicao ou
Incidente.

## Telegram Dispatcher

O dispatcher fica desabilitado por padrao. Para habilitar o envio na unica instancia
responsavel pelos alertas, configure valores reais fora do repositorio e ative ambos:

```bash
TELEGRAM_BOT_TOKEN=... TELEGRAM_CHAT_ID=... \
NOTIFICATION_TELEGRAM_ENABLED=true NOTIFICATION_DISPATCHER_ENABLED=true ./mvnw spring-boot:run
```

`TELEGRAM_BOT_TOKEN` e `TELEGRAM_CHAT_ID` nao possuem valores default. Com Telegram
habilitado, ambos sao obrigatorios; a aplicacao falha no startup sem revelar valores.
Com Telegram ou dispatcher desabilitado, nao ocorre chamada externa e notificacoes
TELEGRAM ficam PENDENTE.

Propriedades configuraveis: `notification.telegram.connect-timeout-ms`,
`notification.telegram.read-timeout-ms`, `notification.dispatcher.poll-delay-ms`,
`batch-size`, `worker-threads`, `queue-capacity`, `max-attempts` e
`base-delay-seconds`. O backoff e 30s, 60s por padrao (configuravel), sem espera de
thread. A entrega e **at-least-once**: em uma queda apos Telegram aceitar a mensagem
e antes do banco gravar `ENVIADA`, um retry pode duplicar o alerta.
