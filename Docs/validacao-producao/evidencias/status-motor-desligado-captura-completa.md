# Evidência bruta — `/api/v1/status`, motor desligado, contexto completo da captura

Origem: sondagem de rede e subida real registrada durante a revisão do branch
`fix/icmp-nativo-windows` (rodada anterior a este fechamento). Este arquivo preserva o contexto
bruto da captura que sustenta a seção "2. Modo de falha da biblioteca nativa" de
`Docs/validacao-producao/icmp-revisao-branch-relatorio.md` — em especial o log de subida, a
resposta de `/api/v1/status` e a divergência entre `SecurityConfiguration` e o Javadoc de
`StatusController`, que no relatório aparecem já resumidos.

Ambiente da captura: `MONITORING_ENGINE_ENABLED=false`, `TELEGRAM_ENABLED=false`,
`NOTIFICATION_DISPATCHER_ENABLED=false`, banco de dev (`DB_PORT=5434`), `SERVER_PORT=8080`.

## Log de subida — implementação ICMP ativa e Flyway

Trecho cru de `app-boot.log` (contexto em volta da linha-alvo):

```
2026-09-22T09:22:34.060-03:00  INFO 33032 --- [infra-monitor-backend] [           main] j.LocalContainerEntityManagerFactoryBean : Initialized JPA EntityManagerFactory for persistence unit 'default'
2026-09-22T09:22:34.099-03:00  INFO 33032 --- [infra-monitor-backend] [           main] o.s.d.j.r.query.QueryEnhancerFactories   : Hibernate is in classpath; If applicable, HQL parser will be used.
2026-09-22T09:22:34.702-03:00 DEBUG 33032 --- [infra-monitor-backend] [           main] b.c.i.security.JwtAuthenticationFilter   : Filter 'jwtAuthenticationFilter' configured for use
2026-09-22T09:22:35.640-03:00  INFO 33032 --- [infra-monitor-backend] [           main] b.c.i.m.icmp.IcmpAmbienteConfiguration   : Implementacao ICMP ativa: NATIVO_WINDOWS (pedida: AUTO, carga nativa: NAO_TENTADA, motor: desligado, so=Windows 11)
2026-09-22T09:22:35.692-03:00  INFO 33032 --- [infra-monitor-backend] [           main] r$InitializeUserDetailsManagerConfigurer : Global AuthenticationManager configured with UserDetailsService bean with name userDetailsService
2026-09-22T09:22:35.915-03:00  INFO 33032 --- [infra-monitor-backend] [           main] o.s.b.a.e.web.EndpointLinksResolver      : Exposing 1 endpoint beneath base path '/actuator'
2026-09-22T09:22:36.093-03:00  INFO 33032 --- [infra-monitor-backend] [           main] o.s.boot.tomcat.TomcatWebServer          : Tomcat started on port 8080 (http) with context path '/'
2026-09-22T09:22:36.100-03:00  INFO 33032 --- [infra-monitor-backend] [           main] b.c.i.InfraMonitorApplication            : Started InfraMonitorApplication in 5.555 seconds (process running for 5.8)
```

Confirmação do Flyway (linhas anteriores do mesmo `app-boot.log`):

```
2026-09-22T09:22:32.440-03:00  INFO 33032 --- [infra-monitor-backend] [           main] org.flywaydb.core.FlywayExecutor         : Database: jdbc:postgresql://localhost:5434/inframonitor (PostgreSQL 16.15)
2026-09-22T09:22:32.517-03:00  INFO 33032 --- [infra-monitor-backend] [           main] o.f.core.internal.command.DbValidate     : Successfully validated 18 migrations (execution time 00:00.034s)
2026-09-22T09:22:32.557-03:00  INFO 33032 --- [infra-monitor-backend] [           main] o.f.core.internal.command.DbMigrate      : Current version of schema "public": 18
2026-09-22T09:22:32.560-03:00  INFO 33032 --- [infra-monitor-backend] [           main] o.f.core.internal.command.DbMigrate      : Schema "public" is up to date. No migration necessary.
```

`Successfully validated 18 migrations`, schema `public` já na versão 18, "up to date" — nenhuma
migration nova foi aplicada por esta captura.

## `GET /api/v1/status` — primeira tentativa, sem token

```
{"timestamp":"2026-09-22T12:22:48.429344900Z","status":401,"error":"Unauthorized","code":"UNAUTHORIZED","message":"Autenticacao obrigatoria","path":"/api/v1/status"}
```

`SecurityConfiguration.java:13` exige role para qualquer `GET /api/v1/**`:

```java
.requestMatchers(HttpMethod.GET,"/api/v1/**").hasAnyRole("ADMIN","OPERADOR","VISUALIZADOR")
```

Esse `401` é comportamento correto e pré-existente da regra de segurança — não é falha da coleta
nem do endpoint.

## `GET /api/v1/status` — segunda tentativa, com token JWT válido

Consulta de leitura (sem escrita) usada para localizar um usuário elegível:

```
SELECT id, papel, ativo, troca_senha_obrigatoria FROM usuarios ORDER BY id LIMIT 10;

 id | papel | ativo | troca_senha_obrigatoria
----+-------+-------+-------------------------
  1 | ADMIN | t     | f
(1 row)
```

Resposta real, com token emitido para esse usuário (subject=1, role=ADMIN, issuer=infra-monitor,
validade 15 minutos — token e segredo de assinatura descartados ao final da sessão, nunca
versionados):

```
HTTP_STATUS:200
{"aplicacao":"infra-monitor-backend","status":"UP","instante":"2026-09-22T12:26:44.469096600Z","icmp":{"pedida":"AUTO","ativa":"NATIVO_WINDOWS","cargaNativa":"NAO_TENTADA","detalheFalha":null,"motorLigado":false}}
```

`200 OK`, bloco `icmp` presente: `ativa: "NATIVO_WINDOWS"`, `motorLigado: false` — confirma em
JSON, pela via oficial do endpoint, exatamente o que o log de subida já mostrava em texto.

**Aviso de formato: `detalheFalha` não existe mais nesse payload.** O commit `c008def`
(`fix(icmp): corrigir comentario obsoleto, vazamento de path e invariante nao garantida`), deste
mesmo branch, removeu o campo `detalheFalha` de `StatusController.IcmpResposta` porque ele publicava
cru a mensagem de `Native.load`, que carrega o caminho completo de recurso do sistema de arquivos
(ex.: `C:\Users\<usuário>\...`) para qualquer papel com acesso ao endpoint, inclusive
`VISUALIZADOR`. O Javadoc de `StatusController` (linhas 50–56) documenta a decisão: o detalhe
continua existindo em `IcmpAmbiente` e no log de subida, e `cargaNativa=FALHOU` já sinaliza o
problema pela API. A captura JSON acima é anterior a `c008def` e preserva `detalheFalha:null` porque
é transcrição literal do que foi colhido naquele momento — não é o formato que a API produz hoje.

## Divergência registrada a partir desta captura

O Javadoc de `StatusController` descrevia o endpoint como "mínimo de infraestrutura", texto que lê
como endpoint público de baixo nível. O comportamento real observado nesta captura (`401` sem
token, `200` só com JWT de um usuário com papel `ADMIN`/`OPERADOR`/`VISUALIZADOR`) mostra que ele
exige autenticação com role, igual a qualquer endpoint de negócio. Essa divergência entre
documentação e comportamento real está registrada na seção 2 do relatório de revisão.
