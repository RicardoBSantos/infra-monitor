# Sessão com refresh token — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** sessão sobrevive a F5 e a uso contínuo por até 10 h, via refresh token opaco em cookie httpOnly; access token JWT continua de 15 min e em memória.

**Architecture:** backend ganha `POST /auth/refresh` e `POST /auth/logout`, autenticados por cookie + header `X-Requested-With`, sobre a tabela `sessao_usuario` (V26) acessada por `JdbcTemplate` com falha tolerada. Frontend restaura a sessão num `provideAppInitializer` antes dos guards e renova em voo único no interceptor ao receber 401. Dev passa a ser mesma origem via proxy do `ng serve`.

**Tech Stack:** Java 21, Spring Boot 4.1, Spring Security, jjwt 0.12.6, PostgreSQL 16, Flyway, Testcontainers; Angular 21 (signals, functional interceptors), Vitest, Playwright 1.63.

**Spec:** `Docs/superpowers/specs/2026-11-11-sessao-refresh-token-design.md` (leia antes de qualquer tarefa).

Worktree: `C:\Users\rbfilho\Documents\wt-sessao`, branch `fix/sessao-refresh-token`.

## Global Constraints

- Nunca tocar produção; nunca ligar motor ICMP, Telegram, dispatcher ou agendador de manutenção (`MONITORING_ENGINE_ENABLED`, `TELEGRAM_ENABLED`, `NOTIFICATION_DISPATCHER_ENABLED`, `MANUTENCAO_AGENDADA_ENABLED` ficam no default `false`).
- Nenhuma credencial inline em arquivo versionado; só variável de ambiente. Proibido `spring.config.import` nos YAML.
- Não editar migrations V1–V25. A nova é `V26__create_sessao_usuario.sql`.
- Sem Lombok, sem abstração especulativa, estilo de código igual ao arquivo vizinho (os arquivos de `auth/` e `security/` são densos, uma linha por método — siga).
- `Instant`/`Duration`, nunca `Date` (exceto onde jjwt exige, como já está).
- Erros da API sempre `ErroResposta` (`ErroResposta.de(status, error, code, message, path)`).
- `sessao_usuario` **não** é entidade JPA (proteção contra lockout com `ddl-auto: validate` — spec 1.6).
- Cookie: nome `inframonitor_refresh`, `HttpOnly`, `SameSite=Strict`, `Path=/api/v1/auth`, sem `Domain`, `Secure` = `app.auth.sessao.cookie-secure`, `Max-Age` = segundos até `expira_em`.
- Config: `app.auth.sessao.duracao: ${JWT_REFRESH_TOKEN_DURATION:10h}` (1 min ≤ x ≤ 24 h), `app.auth.sessao.cookie-secure: ${APP_AUTH_COOKIE_SECURE:true}`.
- Refresh/logout nunca recebem `Authorization` do front; nunca respondem 401 (refresh: 200/204/403; logout: 204/403).
- Mensagens e nomes em português, sem acento em código Java (padrão do projeto).
- Commits: `git commit -- <arquivos>` explícitos; mensagem termina com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Duas abas dando F5 juntas / N requisições com 401 juntas → nenhuma derruba a sessão (Task 1 teste concorrente; Task 4 teste de voo único).
2. Banco sem V26 (jar novo em produção antes da migration) → login 200 sem cookie, refresh 204 (Task 1 teste de degradação).
3. Bearer vencido enviado junto ao refresh → nunca deve ocorrer (Task 4 teste: refresh e logout sem `Authorization`).
4. Backend fora do ar no F5 → app abre o login, sem tela branca e sem laço (Task 4 teste do `restaurar` com erro de rede/timeout).
5. Usuário desativado/senha resetada com cookie válido → refresh 204 (Task 2).

---

### Task 1: Tabela, propriedades e serviço de sessão (backend)

**Files:**
- Create: `infra-monitor-backend/src/main/resources/db/migration/V26__create_sessao_usuario.sql` (SQL exato da spec 1.6)
- Create: `infra-monitor-backend/src/main/java/br/com/inframonitor/auth/SessaoProperties.java`
- Create: `infra-monitor-backend/src/main/java/br/com/inframonitor/auth/SessaoUsuarioService.java`
- Modify: `infra-monitor-backend/src/main/resources/application.yml` (bloco `app.auth.sessao`)
- Modify: `infra-monitor-backend/src/test/java/br/com/inframonitor/common/config/ConfiguracaoPadraoDesligadaTest.java`
- Test: `infra-monitor-backend/src/test/java/br/com/inframonitor/auth/SessaoUsuarioServicePostgresIntegrationTest.java` (`@RequerDocker`)
- Test: `infra-monitor-backend/src/test/java/br/com/inframonitor/auth/SessaoPropertiesTest.java`

**Interfaces (Produces):**
- `@ConfigurationProperties(prefix="app.auth.sessao") record SessaoProperties(Duration duracao, boolean cookieSecure)` com `@PostConstruct validar()` (lança `IllegalStateException` fora de [1 min, 24 h]); habilitado por `@EnableConfigurationProperties` na `SecurityConfiguration`.
- `record SessaoCriada(String token, Instant expiraEm)` (aninhado em `SessaoUsuarioService`).
- `SessaoUsuarioService`:
  - `Optional<SessaoCriada> criar(long usuarioId)` — `@Transactional(propagation=REQUIRES_NEW)`; token = 32 bytes `SecureRandom`, Base64url sem padding; grava `sha256Hex(token)`; antes do insert apaga linhas com `expira_em` ou `revogada_em` anteriores a `now() - interval '1 day'`.
  - `Optional<Long> validar(String token)` — `REQUIRES_NEW`; devolve `usuario_id` se a linha existe, `revogada_em is null`, `expira_em > now()`; atualiza `ultimo_uso_em`.
  - `void revogar(String token)` e `void revogarTodas(long usuarioId)` — `REQUIRES_NEW`; só linhas não revogadas.
  - `static String sha256Hex(String token)` — 64 hex minúsculos.
  - Todos os métodos de instância capturam `DataAccessException`, logam `ERROR` com "Sessao persistente indisponivel (V26 aplicada?)" e devolvem vazio / nada. `null`/vazio como token → vazio sem tocar o banco.

- [ ] **Step 1: testes que falham.** `SessaoPropertiesTest`: `Duration.ofSeconds(59)` e `Duration.ofHours(25)` lançam; `Duration.ofHours(10)` passa. `SessaoUsuarioServicePostgresIntegrationTest` (padrão de `ManutencaoAgendadaHttpSecurityIntegrationTest`: `@RequerDocker`, `PostgreSQLContainer("postgres:16-alpine")`, `LimpezaBanco.limpar` no `@BeforeEach`, contexto com `app.auth.jwt.secret` de teste e flags desligadas):
  - `criaSessaoGuardandoSoOHash`: `criar(id)` → token com 43 chars; `select token_hash from sessao_usuario` = `sha256Hex(token)`; nenhuma linha contém o token em claro; `expira_em` ≈ agora + 10 h (±1 min).
  - `validaSessaoAtivaEAtualizaUltimoUso`: `validar(token)` = `Optional.of(id)`, `ultimo_uso_em` não nulo.
  - `recusaRevogadaExpiradaEDesconhecida`: após `revogar(token)` → vazio; outra sessão com `update ... set expira_em = now() - interval '1 second', criada_em = now() - interval '1 hour'` → vazio; token aleatório → vazio.
  - `revogarTodasDerrubaSoAsDoUsuario`.
  - `loginLimpaSessoesVencidasHaMaisDeUmDia`: linha com `expira_em` de 2 dias atrás some após `criar`.
  - `validacoesConcorrentesNaoSeAtrapalham`: 10 threads `validar(token)` simultâneas → todas `Optional.of(id)`.
  - `semTabelaDegradaSemExcecao`: `alter table sessao_usuario rename to sessao_usuario_off` (restaurar em `finally`) → `criar` vazio, `validar` vazio, `revogarTodas` não lança.
- [ ] **Step 2:** `./mvnw -q test -Dtest='SessaoPropertiesTest,SessaoUsuarioServicePostgresIntegrationTest'` → falha de compilação.
- [ ] **Step 3:** implementar V26, `SessaoProperties`, `SessaoUsuarioService`, YAML. Em `ConfiguracaoPadraoDesligadaTest.semVariaveisDeAmbienteNadaQueAgeSozinhoLiga` acrescentar `assertThat(resolver.getProperty("app.auth.sessao.cookie-secure", Boolean.class)).isTrue();` e `assertThat(resolver.getProperty("app.auth.sessao.duracao")).isEqualTo("10h");`.
- [ ] **Step 4:** mesmo comando + `ConfiguracaoPadraoDesligadaTest` → PASS (com Docker; sem Docker a classe Postgres é pulada — isso **não** conta como passou).
- [ ] **Step 5:** commit `feat(auth): tabela sessao_usuario (V26) e servico de sessao por JDBC`.

### Task 2: Endpoints, cookie, segurança e revogação (backend)

**Files:**
- Create: `infra-monitor-backend/src/main/java/br/com/inframonitor/auth/SessaoCookie.java`
- Modify: `auth/AuthController.java`, `auth/AuthService.java`, `security/SecurityConfiguration.java`, `usuario/service/UsuarioService.java`
- Test: `infra-monitor-backend/src/test/java/br/com/inframonitor/auth/SessaoHttpIntegrationTest.java` (`@RequerDocker`)

**Interfaces:**
- Consumes: Task 1 (`SessaoUsuarioService`, `SessaoProperties`, `SessaoCriada`).
- Produces (HTTP, consumido pelo front):
  - `POST /api/v1/auth/login` → como hoje + `Set-Cookie` quando `criar` devolve sessão.
  - `POST /api/v1/auth/refresh` → sem `X-Requested-With`: 403 `ErroResposta` code `FORBIDDEN`; sessão válida e usuário ativo: 200 `LoginResponse`; senão: 204 + cookie de apagar (`Max-Age=0`). Usuário inativo → `revogarTodas` antes do 204.
  - `POST /api/v1/auth/logout` → sem header: 403; senão `revogar(cookie)` e 204 + cookie de apagar.
- `SessaoCookie` (`@Component`): `ResponseCookie emitir(SessaoCriada s)`, `ResponseCookie apagar()`, `static final String NOME = "inframonitor_refresh"`, `PATH = "/api/v1/auth"`.
- `AuthService`: `Optional<LoginResponse> renovar(long usuarioId)`.
- `UsuarioService.desativar`, `resetarSenha`, `trocarMinhaSenha` chamam `sessoes.revogarTodas(id)` depois da alteração.
- `SecurityConfiguration`: `.requestMatchers(HttpMethod.POST,"/api/v1/auth/login","/api/v1/auth/refresh","/api/v1/auth/logout").permitAll()`.

- [ ] **Step 1: testes que falham** em `SessaoHttpIntegrationTest` (HTTP real com `java.net.http.HttpClient`, como `ManutencaoAgendadaHttpSecurityIntegrationTest`; cookie extraído do `Set-Cookie` e reenviado à mão no header `Cookie`):
  - `loginEmiteCookieRestrito`: `Set-Cookie` contém `inframonitor_refresh=`, `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/api/v1/auth`, `Max-Age=36000` (±60); não contém `Domain`; corpo tem `accessToken`.
  - `refreshComCookieDevolveTokenQueAutentica`: 200; novo `accessToken` → `GET /api/v1/auth/me` 200.
  - `refreshSemCabecalhoE403ESemCookieE204`.
  - `logoutRevogaNoServidor`: guarda cookie → logout 204 com `Max-Age=0` → refresh com o cookie antigo → 204 e sem corpo.
  - `cookieNaoAutenticaOrestoDaApi`: `GET /api/v1/unidades` só com o cookie → 401.
  - `desativarResetarETrocarSenhaRevogam`: três usuários, cada operação via API do ADMIN/do próprio → refresh do cookie de cada um → 204.
  - `refreshesParalelosTodosPassam`: 10 refreshes concorrentes com o mesmo cookie → todos 200.
  - `semTabelaLoginFuncionaSemCookie`: renomeia a tabela (restaura em `finally`) → login 200 sem `Set-Cookie`; refresh 204.
- [ ] **Step 2:** `./mvnw -q test -Dtest=SessaoHttpIntegrationTest` → FAIL.
- [ ] **Step 3:** implementar. Controller: `@CookieValue(name=SessaoCookie.NOME, required=false) String token`, `@RequestHeader(name="X-Requested-With", required=false) String xrw`; `ResponseEntity` com `HttpHeaders.SET_COOKIE`.
- [ ] **Step 4:** `./mvnw test` completo (com Docker) → tudo verde; o aviso `!! N classes puladas` não pode aparecer.
- [ ] **Step 5:** commit `feat(auth): refresh e logout por cookie httpOnly com revogacao`.

### Task 3: Dev mesma origem (frontend)

**Files:**
- Create: `infra-monitor-frontend/proxy.conf.mjs`
- Modify: `infra-monitor-frontend/angular.json` (`serve.options.proxyConfig`), `src/environments/environment.ts` (`apiUrl: '/api/v1'`), `e2e/api-porta.cjs`

**Interfaces (Produces):** `ng serve` encaminha `/api` para `http://localhost:${process.env.API_PORT ?? '8080'}` com `changeOrigin: false`, `secure: false`. `apontarApi(ctx, base)` ganha segundo parâmetro opcional `base` (origem do front, default `process.env.E2E_BASE || 'http://localhost:4200'`): quando `API_PORT≠8080`, além da rota antiga de `http://localhost:8080/**`, roteia `${new URL(base).origin}/api/**` para `http://localhost:${porta}/api/...` via `route.fetch({ url })` (preserva método, headers e corpo). Chamadas existentes `apontarApi(ctx)` continuam válidas.

- [ ] **Step 1:** criar os arquivos; `npx ng build --configuration development` → sucesso.
- [ ] **Step 2:** subir `ng serve --port 4310` com `API_PORT=<porta de um backend de teste>` e `curl -s -o /dev/null -w '%{http_code}' http://localhost:4310/api/v1/auth/me` → `401` (chegou ao backend). Derrubar o processo por PID e provar porta livre.
- [ ] **Step 3:** commit `build(front): proxy de dev para a API na mesma origem`.

### Task 4: Sessão no frontend (bootstrap, voo único, logout)

**Files:**
- Create: `src/app/core/services/sessao.service.ts`, `src/app/core/services/sessao.service.spec.ts`
- Modify: `src/app/core/services/auth-state.service.ts` (+spec), `src/app/core/interceptors/auth.interceptor.ts` (+spec), `src/app/core/services/auth.service.ts` (+spec), `src/app/app.config.ts`, `src/index.html`, `src/app/layout/topbar/topbar.component.ts`, `src/app/features/auth/change-password.component.ts`

**Interfaces:**
- Consumes: HTTP da Task 2.
- Produces:
  - `SessaoService.restaurar(): Promise<void>` — nunca rejeita; `timeout(8000)`.
  - `SessaoService.renovar(): Observable<string | null>` — voo único (`shareReplay({ bufferSize: 1, refCount: false })` + `finalize` zerando o compartilhado); `POST ${apiUrl}/auth/refresh`, `{}` de corpo, header `X-Requested-With: XMLHttpRequest`, `observe: 'response'`; status 200 com corpo → `state.setSession(body)` e emite o token; qualquer outro resultado (204, erro, timeout 8000) → emite `null`.
  - `AuthService.logout(): Observable<void>` — `POST /auth/logout` com o mesmo header; erro ignorado; `state.clear()` sempre (`finalize`).
  - `export const REPETIDA_APOS_REFRESH = new HttpContextToken<boolean>(() => false)` em `auth.interceptor.ts`.
  - `isProtectedApi` exclui `${api}/auth/login`, `/auth/refresh`, `/auth/logout`.
  - `AuthStateService.authenticated = computed(() => token !== null && usuario !== null)`; `expiresAt` permanece.
  - `app.config.ts`: `provideAppInitializer(() => inject(SessaoService).restaurar())`.
  - `index.html`: dentro de `<app-root>`, bloco estático centralizado "Infra Monitor" + "Restaurando sessão…", `role="status"`, CSS inline com `prefers-color-scheme`, `lang="pt-BR"`; **sem** `<script>` e sem atributos `on*` (o CI barra).
  - Topbar e troca de senha: `logout().subscribe({ complete: () => router.navigate(['/login']) })`. Troca de senha: no sucesso do PUT, `auth.login(state.usuario()!.email, novaSenha)` → navega `/dashboard` (se `trocaSenhaObrigatoria` ainda vier `true`, mantém a mensagem atual de erro).

- [ ] **Step 1: testes que falham** (Vitest, `HttpTestingController`):
  - `sessao.service.spec.ts`: `restaurar` com 200 → `authenticated()` true; com 204 → false e resolve; com erro de rede (`req.error(new ProgressEvent('error'))`) → resolve sem sessão; com 8 s sem resposta (`vi.useFakeTimers`) → resolve; request leva `X-Requested-With` e **não** leva `Authorization` mesmo com token em memória; `renovar()` chamado 3× em paralelo → `expectOne` (um só POST) e os três recebem o token.
  - `auth.interceptor.spec.ts`: substituir o teste "keeps the global 401 flow…" para esperar `POST /auth/refresh` respondido 204 e então `/login`; novos: `401 → refresh 200 → repete com Bearer novo e entrega a resposta`; `três 401 simultâneos → um refresh, três repetições`; `repetição que toma 401 vai ao login sem segundo refresh`; `401 no próprio refresh não dispara refresh`; `refresh/logout nunca recebem Authorization`; `isProtectedApi('/api/v1/auth/refresh', api)` e `logout` → false.
  - `auth-state.service.spec.ts`: sessão com `expiresIn: -1` continua `authenticated()` true (comportamento novo).
  - `auth.service.spec.ts`: `logout()` faz `POST /auth/logout` e limpa o estado mesmo com resposta 500.
- [ ] **Step 2:** `npx ng test --watch=false` → falhas esperadas.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** `npx ng test --watch=false` → tudo verde; `npx ng build --configuration production --source-map=false` → sucesso; rodar o script Python/regex do passo "Verificar compatibilidade do index.html com a CSP" de `.github/workflows/ci-frontend.yml` (equivalente em Node) → sem handlers nem scripts inline.
- [ ] **Step 5:** commit `feat(front): restaura sessao no F5 e renova o access token em voo unico`.

### Task 5: Prova em navegador real (Playwright) e compatibilidade de rollback

**Files:**
- Create: `infra-monitor-frontend/e2e/sessao-refresh.cjs` (+ `"e2e:sessao": "node e2e/sessao-refresh.cjs"` em `package.json`)
- Evidência: `infra-monitor-frontend/e2e/sessao-refresh-evidence/` (JSON + capturas)

Ambiente descartável, nunca o banco de dev nem o da carga: Postgres `postgres:16-alpine` em container próprio na porta 5441; jar do worktree na 8083 com `DB_PORT=5441`, `JWT_SECRET` de teste, `BOOTSTRAP_ADMIN_*` de teste, `JWT_ACCESS_TOKEN_MINUTES=1`, `JWT_REFRESH_TOKEN_DURATION=4m`, flags de motor/Telegram/dispatcher/agendador no default `false`; `ng serve --port 4310` com `API_PORT=8083`.

Roteiro (falha com `process.exitCode=1` e mensagem clara em qualquer passo):
1. Login pela tela → `/dashboard`. Captura.
2. `page.reload()` → continua fora de `/login` (nenhuma navegação a `/login` registrada) e um `POST /auth/refresh` 200 foi observado.
3. `page.goto(BASE + '/equipamentos')` (link direto) → tela de equipamentos, sem login.
4. Uso contínuo por 150 s, clicando no menu lateral a cada ~15 s → nunca vai ao login; ao menos um `POST /auth/refresh` 200 depois do primeiro minuto; registrar contagem de 401 retentados.
5. Copiar o cookie `inframonitor_refresh` → "Sair" → `context.request.post('/api/v1/auth/refresh', {headers:{'X-Requested-With':'XMLHttpRequest', Cookie: 'inframonitor_refresh=<antigo>'}})` → 204.
6. Novo login; esperar até 4 min + 10 s desde esse login; clicar num menu → cai em `/login?sessionExpired=1` com "Sua sessão expirou".
Modo `SESSAO_E2E_BASE` para apontar outro front.

- [ ] **Step 1:** rodar contra o front novo → todos os passos PASS.
- [ ] **Step 2: prova de reversão.** Worktree descartável de `origin/main` (front antigo) em `ng serve --port 4311`, com rota Playwright de `localhost:8080` → `8083` (CORS do backend de teste com `CORS_ALLOWED_ORIGINS=http://localhost:4311`). Rodar o mesmo roteiro → passos 2 e 4 **falham**. Registrar a saída.
- [ ] **Step 3: compatibilidade de rollback.** Build do jar de `origin/main`; parar o 8083; subir o jar antigo na 8083 com `--spring.flyway.enabled=false` contra o banco 5441 (já em V26) → health `UP` e login por API 200. Registrar.
- [ ] **Step 4: comando de migração de produção.** Em outro container limpo (5442) já migrado até V25 pelo jar de `origin/main`, rodar o jar novo no modo descrito no README (Task 6) com `--spring.flyway.target=26` e sem web → processo termina sozinho; `flyway_schema_history` com `26 | t`. Ajustar o comando até terminar sozinho; o texto do README sai daqui.
- [ ] **Step 5:** derrubar tudo por PID, remover containers, provar portas livres. Commit do roteiro e da evidência.

### Task 6: Documentação

**Files:** `Docs/validacao-producao/D02.11-A.1-estabilizacao-operacional.md` (U-08, texto exato da spec 1.8), `Docs/validacao-producao/D02.11-A-homologacao-funcional.md` (linha U-08), `CLAUDE.md` e `infra-monitor-backend/README.md` (contagem `@RequerDocker` = resultado de `DocumentacaoRequerDockerTest`; variáveis `JWT_REFRESH_TOKEN_DURATION` e `APP_AUTH_COOKIE_SECURE`; seção "Aplicar migration em produção" com o comando provado na Task 5 Step 4; seção curta de rollback apontando a spec), `Docs/auth-architecture/A03 - Frontend - Login e Sessao.md` (nota de que a sessão agora sobrevive a F5), README/CLAUDE do front se citarem `localhost:8080` como apiUrl do dev.

- [ ] **Step 1:** editar; `./mvnw -q test -Dtest=DocumentacaoRequerDockerTest` → PASS.
- [ ] **Step 2:** commit `docs: sessao com refresh token, U-08 novo e implantacao da V26`.

### Task 7: Revisão final, CI e PR

- [ ] `./mvnw test` completo com Docker; `npx ng test --watch=false`; build de produção.
- [ ] Revisão do branch inteiro por revisor independente; corrigir achados.
- [ ] `git push -u origin fix/sessao-refresh-token`; abrir PR (não fazer merge); acompanhar as workflows até verde.
