# Sessão com refresh token em cookie httpOnly — desenho

Data: 2026-11-11 · Branch: `fix/sessao-refresh-token` (base `origin/main` 920e4d5) · Migration: V26

## 0. Intenção

Dois defeitos em produção, com a causa já diagnosticada:

1. **Desconexão em uso.** `JwtService.gerar()` emite `exp = agora + accessTokenMinutes` (15, `application.yml`
   `JWT_ACCESS_TOKEN_MINUTES`). `AuthController` só tem `POST /login` e `GET /me`. Não existe renovação: são
   15 minutos absolutos desde o login.
2. **F5 derruba a sessão.** `AuthStateService` guarda token, `expiresAt` e usuário só em `signal()`.

Decisão do responsável (não reabrir): refresh token em cookie httpOnly; access token curto e em memória;
sessão de jornada (8–10 h); **sem** expiração por inatividade.

**Anti-objetivo central:** nenhuma mudança aqui pode impedir o login por senha. Em qualquer falha do
mecanismo novo (cookie recusado, refresh fora do ar, V26 ausente no backend antigo) o comportamento tem
de degradar para o de hoje — login funciona, sessão dura 15 min — e nunca para "ninguém entra".

Fora de escopo: rotação de refresh token, timeout por inatividade, "lembrar-me", tarefa agendada nova no
Windows, backup novo, mudança nos roteiros e2e existentes (só listados em 1.8).

## 1.1 CSRF

**Evidência — todo o resto da API é autenticado só por header.** `JwtAuthenticationFilter.doFilterInternal`
lê exclusivamente `r.getHeader("Authorization")`; sem header, segue anônimo e o `authorizeHttpRequests`
de `SecurityConfiguration` devolve 401 em tudo que não é `permitAll`. Não há `formLogin`, `httpBasic`,
`HttpSession` (`SessionCreationPolicy.STATELESS`) nem leitura de cookie em nenhuma classe do backend.
Um request forjado por outro site chega sem `Authorization` (o navegador não anexa header por conta
própria) → 401. Portanto `csrf.disable()` continua correto para esses endpoints, e continua depois desta
mudança, porque o filtro JWT **não** passa a ler o cookie.

**Endpoints autenticados pelo cookie:** só `POST /api/v1/auth/refresh` e `POST /api/v1/auth/logout`.

**O que o atacante ganha disparando o refresh:**
- O cookie tem `SameSite=Strict`: de outro *site* o navegador nem anexa o cookie. Resta o caso de um host
  irmão no mesmo site registrável (outro `*.dominio` da intranet comprometido), para o qual SameSite não
  vale.
- Mesmo com o cookie anexado, a resposta (o access token) é ilegível: `CorsConfiguration` não lista a
  origem do atacante e tem `allowCredentials(false)` explícito, então o navegador bloqueia a leitura de
  qualquer resposta credenciada cross-origin. Ele não rouba o access token.
- O único efeito colateral possível seria **escrita** no estado da sessão. Com rotação, seria girar o token.
  Sem rotação (decisão 1.6), o refresh só lê a sessão e atualiza `ultimo_uso_em`. O atacante não ganha nada.

**Defesa adicional barata, sem token CSRF:** refresh e logout exigem o header `X-Requested-With`
(presença, qualquer valor; o front manda `XMLHttpRequest`). Formulário HTML não envia header custom, e um
`fetch` cross-origin com header custom dispara preflight, que falha (origem não permitida, ou permitida mas
sem `Allow-Credentials`). Isso fecha também o caso do host irmão. Sem o header → `403`.

**Por que não há token CSRF (registrado aqui de propósito):** o token CSRF protege contra uma requisição
forjada que *muda estado em nome da vítima*. Aqui (a) o único endpoint que muda estado pelo cookie é o
logout, cujo pior efeito forjado é deslogar o usuário — e ainda assim exige o header custom; (b) o refresh
não muda nada que interesse ao atacante, porque não há rotação; (c) a leitura da resposta é bloqueada por
CORS. Um token CSRF exigiria guardar e entregar um segredo legível por JS, que é justamente o que o cookie
httpOnly evita. O header custom + SameSite=Strict + CORS sem credenciais cobre o mesmo risco.

**Rotação com detecção de reuso — o caso pedido.** Se houvesse rotação, um disparo forçado de fora (host
irmão) ou simplesmente duas abas dando F5 ao mesmo tempo mandariam o mesmo token T1 em paralelo: uma
chamada gira para T2, a outra apresenta T1 já consumido → "reuso" → revoga a família → **o usuário
legítimo cai**. É exatamente o sintoma que estamos corrigindo. O desenho evita isso **não rotacionando**
(1.6). Não há corrida possível: o refresh é idempotente.

## 1.2 Dev cross-origin vs. produção mesma origem

Confirmado: `environment.ts` → `http://localhost:8080/api/v1` (4200→8080); `environment.prod.ts` →
`/api/v1`; não existe `proxy.conf`; `angular.json` `serve` sem `proxyConfig`; `CorsConfiguration` com
`allowCredentials(false)`.

**Decisão: proxy de dev, dev passa a ser mesma origem como produção.** Não se afrouxa o cookie.

- `infra-monitor-frontend/proxy.conf.mjs` (novo): `/api` → `http://localhost:${API_PORT ?? 8080}`,
  `changeOrigin: false` (o `Host` chega igual ao `Origin`, então o Spring não trata a chamada como CORS,
  inclusive quando o `ng serve` é aberto por `127.0.0.1` ou pelo IP da LAN). `.mjs` para a porta do
  backend vir de variável, como já fazem os roteiros (`API_PORT`).
- `angular.json` → `serve.options.proxyConfig: "proxy.conf.mjs"`.
- `environment.ts` → `apiUrl: '/api/v1'` (igual a produção).
- `CorsConfiguration` **não muda** (continua `allowCredentials(false)`). O CORS fica só para quem chama a API
  direto por outra origem com Bearer.
- **Roteiros e2e:** os que abrem o front no `ng serve` passam a ver a API em `http://localhost:4200/api/v1`.
  - Chamadas diretas à API com `request` + Bearer (`const API = 'http://localhost:8080/api/v1'` em n04, n05,
    n06, m06, modal-usuarios, rodada-curta, pre-carga, seed-topologia, manutencao-verificacao,
    mapa-manutencao-verificacao, painel-status-tipos, r036, r045) **continuam funcionando**: o backend segue
    em 8080 e aceita Bearer.
  - `e2e/api-porta.cjs` intercepta `http://localhost:8080/**`; com o proxy o navegador não chama mais 8080,
    então com `API_PORT≠8080` ele deixaria de redirecionar **em silêncio** e o roteiro bateria no backend
    errado. Ajuste necessário (é infraestrutura compartilhada, não roteiro): passar a interceptar
    `**/api/v1/**` da origem do front. Alternativa equivalente: subir o `ng serve` com `API_PORT=8081`.
  - `d24-arco-capturas.cjs` e `manutencao-agendada-f2.cjs` têm cópia inline do mesmo `ctx.route` — com
    `API_PORT≠8080` precisam do mesmo ajuste. Não altero nesta tarefa; listado.
  - `overflow-telas.cjs` recomenda `localhost` porque "o CORS não libera 127.0.0.1": com o proxy essa
    restrição desaparece.
- **Ambiente de LAN do responsável** (cópia local não versionada com `apiUrl: 'http://10.79.20.163:8080'`):
  com o proxy, basta `ng serve --host 0.0.0.0` e `apiUrl` relativa. Se insistir na URL absoluta e por HTTP,
  o cookie não é aceito (Secure fora de `localhost`) e a sessão volta a durar 15 min — login funciona.

## 1.3 IIS / ARR

Lido em `deployment/windows/web.config.template` (já com o PR #33):

- A regra `Backend API` é `Rewrite` de `^api/v1(/.*)?$` para `http://127.0.0.1:8080/api/v1{R:1}`. ARR em
  modo rewrite repassa todos os headers de requisição (inclusive `Cookie`) e de resposta (inclusive
  `Set-Cookie`). O único reescrita de header de resposta que o ARR faz por padrão é o host no `Location`
  (`reverseRewriteHostInResponseHeaders`), que não toca cookie.
- `outboundRules`: as duas regras alteram só `RESPONSE_Cache_Control`, e a segunda exclui `^/api`.
- `<location path="api">` só remove `X-Content-Type-Options` e `X-Frame-Options` (D-04). Nada sobre cookie.
- CSP `connect-src 'self'`: o refresh é mesma origem, permitido.
- **Prova:** apenas leitura de configuração. Não há IIS neste ambiente → **inferido, não provado**. O
  operador confere no item de pós-implantação (1.9).

**Path do cookie: `/api/v1/auth`.** Só refresh e logout precisam dele (login e `/me` o recebem mas
ignoram). Nunca `/`: as rotas do SPA e os assets não têm motivo para carregar o cookie. Sem `Domain`
(host-only, vale só para o hostname exato do site).

**HTTPS ponta a ponta do ponto de vista do navegador:** o template exige binding HTTPS
("Bind this site ONLY to its approved host name and HTTPS certificate"), a regra `HTTPS only` (antes da
`Backend API`) devolve 301 para `https://` em **qualquer** URL, inclusive `/api`, e há
`Strict-Transport-Security: max-age=31536000`. O trecho IIS→backend é HTTP em loopback, mas o navegador só
fala com o IIS por HTTPS — é o que conta para o atributo `Secure`. O backend marca `Secure` por
configuração (`APP_AUTH_COOKIE_SECURE`, default `true`), **não** por `request.isSecure()` (que seria
`false` atrás do ARR).

**Acesso por HTTP:** o 301 acontece antes de qualquer chamada chegar ao backend; o navegador nunca envia
cookie `Secure` por HTTP; após a primeira visita o HSTS impede o próprio HTTP. Não há caminho em que o
cookie vaze em claro.

## 1.4 Bootstrap no recarregamento (corrige o sintoma 2)

**Mecanismo: `provideAppInitializer`.** O Angular só cria o componente raiz — e o roteador só faz a
navegação inicial, que é quando os guards rodam — depois que todos os inicializadores resolvem. O
inicializador chama `SessaoService.restaurar()`:

- `POST /api/v1/auth/refresh` com `X-Requested-With`, `timeout(8000)`.
- `200` → `AuthStateService.setSession(resposta)`; os guards veem a sessão.
- `204` (sem cookie, expirado, revogado, usuário inativo) → segue sem sessão.
- erro de rede, `5xx`, `502/503` do ARR, timeout → segue sem sessão.
- **Nunca rejeita.** Um inicializador rejeitado impede o bootstrap e deixa tela branca.

**Por que `204` e não `401` para "sem sessão":** a primeira visita de qualquer pessoa não tem cookie. Um
`401` apareceria em vermelho no console e reprovaria o U-01 ("console sem erros vermelhos"). `204` é
"não há sessão para renovar", sem ruído. `401` não é usado pelo refresh.

**O que o usuário vê com o refresh em voo:** o conteúdo estático de `<app-root>` em `index.html` (que o
Angular substitui só ao criar o componente raiz): uma marca discreta "Infra Monitor · Restaurando sessão…"
centralizada, com CSS inline (permitido: `style-src 'unsafe-inline'`), sem `<script>` inline (barrado pela
CSP e pelo passo do `ci-frontend`). Tema claro/escuro por `prefers-color-scheme`. Leva o tempo de um
round-trip local (~dezenas de ms); no pior caso, 8 s.

**Falha do refresh:** o roteador navega normalmente; `authGuard` vê sem sessão e manda para
`/login?returnUrl=<url>`. Um único redirecionamento, sem laço: o guard é síncrono e o `loginGuard` deixa
entrar em `/login` quando não autenticado. Depois do login, `returnUrl` devolve o usuário à página que
recarregou.

**Backend fora do ar:** mesmo caminho (timeout ou 502 → sem sessão → login). O cookie continua válido no
navegador; quando o backend voltar, um F5 restaura a sessão sem digitar senha. O login mostra o erro que
já mostra hoje se o backend estiver fora.

**Mudança necessária em `authenticated()`:** hoje inclui `!isExpired()`. Com refresh, o access token
vencido não significa sessão encerrada; se o guard continuar olhando a validade, quem fica 16 min parado e
clica num menu é mandado ao login sem tentar renovar. Passa a ser `accessToken !== null && usuario !== null`.
O vencimento é tratado pelo 401 → refresh (1.5).

## 1.5 Renovação concorrente (corrige o sintoma 1)

**Interceptor, em voo único:**

- Requisição protegida recebe `401` e **não** é repetição → pede `SessaoService.renovar()`.
- `renovar()` mantém um `Observable` compartilhado (`shareReplay({bufferSize:1, refCount:false})`) enquanto
  o refresh estiver em voo; N requisições que tomam 401 juntas assinam o mesmo, só **um** `POST /refresh`
  sai. Ao terminar, o compartilhado é descartado (`finalize`), para que um 401 de daqui a 15 min dispare
  um refresh novo.
- Sucesso → cada requisição é repetida **uma vez** com o token novo, marcada com um `HttpContextToken`
  `REPETIDA_APOS_REFRESH`.
- Falha (`204`, erro, timeout) → `auth.clear()` e o fluxo de hoje: `redirecting401` + `/login?sessionExpired=1`.

**Anti-laço:**
1. `/auth/refresh`, `/auth/logout` e `/auth/login` não são "protegidas" em `isProtectedApi`: não levam
   Bearer e o 401 delas nunca dispara refresh.
2. Uma requisição repetida que toma 401 de novo não renova outra vez: vai ao login.
3. O refresh nunca responde 401 (só 200/204/403, e 503 em falha transitória do banco).

Sem renovação proativa por relógio: o access token de 15 min vence, a próxima chamada toma 401 e é
repetida de forma transparente. Um 401 por 15 min de uso é custo desprezível e evita timer.

**Usuário desativado com access token ainda válido:** o filtro devolve 401 → refresh → backend vê
`ativo=false`, revoga e devolve 204 → login. Igual ao comportamento de hoje, no máximo uma chamada depois.

## 1.6 Persistência e revogação — V26

```sql
CREATE TABLE sessao_usuario (
    id BIGINT GENERATED BY DEFAULT AS IDENTITY,
    usuario_id BIGINT NOT NULL,
    token_hash CHAR(64) NOT NULL,
    criada_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expira_em TIMESTAMPTZ NOT NULL,
    ultimo_uso_em TIMESTAMPTZ,
    revogada_em TIMESTAMPTZ,
    CONSTRAINT pk_sessao_usuario PRIMARY KEY (id),
    CONSTRAINT fk_sessao_usuario_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id),
    CONSTRAINT uq_sessao_usuario_token_hash UNIQUE (token_hash),
    CONSTRAINT ck_sessao_usuario_validade CHECK (expira_em > criada_em)
);
CREATE INDEX ix_sessao_usuario_usuario ON sessao_usuario (usuario_id);
```

- **Hash, nunca em claro.** Token = 32 bytes de `SecureRandom`, Base64url (43 caracteres) no cookie. No
  banco, `SHA-256` hex. SHA-256 sem sal basta porque o segredo tem 256 bits de entropia (não é senha:
  bcrypt seria custo sem ganho). Um dump do banco não permite montar cookie válido.
- **Sem rotação; token fixo pela sessão, validade absoluta.** Sistema interno de NOC, poucos usuários,
  cookie httpOnly + Secure + Strict + Path restrito. A rotação só ajuda a detectar um refresh token roubado
  e reapresentado; para roubar o cookie é preciso controlar o navegador ou a estação, situação em que a
  rotação não salva. Em troca, a rotação cria a corrida de 1.1 (multi-aba, F5 simultâneo, disparo forçado),
  que derrubaria exatamente o usuário que esta mudança quer manter. `expira_em = criada_em + 10 h` e
  **não** é estendido pelo uso: sem expiração por inatividade e sem sessão eterna.
- **Logout revoga no servidor:** `POST /auth/logout` faz `revogada_em = now()` na linha do hash do cookie e
  devolve `Set-Cookie` com `Max-Age=0`. Um cookie copiado antes do logout e reapresentado depois recebe
  204 (sem sessão). Idempotente: sem cookie ou já revogado → 204.
- **Revogação por senha/conta:** `desativar` e `resetarSenha` (ADMIN) e a troca da **própria** senha revogam
  todas as sessões do usuário — trocar a senha é a reação típica a suspeita de sessão roubada. Para não
  derrubar quem acabou de trocar, a tela de troca, depois do `PUT /usuarios/me/senha`, faz `login(email,
  novaSenha)` (recebe sessão e cookie novos) em vez do `GET /me` de hoje.
- **Acesso por JDBC, não por entidade JPA (proteção contra lockout).** Em produção o Flyway está desligado
  na partida (1.9). Se `sessao_usuario` fosse entidade, `ddl-auto: validate` impediria o jar novo de subir
  sem a V26 → health falha → site parado → todos fora. Com `JdbcTemplate`, o `validate` não conhece a
  tabela. A criação da sessão roda em transação própria, depois da transação do login, e qualquer
  `DataAccessException` é registrada (`WARN` sem stack se estrutural, `ERROR` com stack nos demais casos; "sessão persistente indisponível — V26 aplicada?") e
  engolida: o login responde 200 sem cookie. Refresh com a tabela ausente → 204. Ou seja: sem V26, o sistema
  se comporta exatamente como hoje. Só tabela ausente ou sem privilégio (SQLState 42P01/42501, `BadSqlGrammarException`)
  vira "sem sessão", com uma linha `WARN` sem stack; outra falha de banco no refresh responde `503` sem `Set-Cookie`, para
  um pool esgotado ou banco reiniciando não derrubar a sessão de 10 h (revisão final).
- **Limpeza sem tarefa agendada:** a cada login bem-sucedido, na mesma transação,
  `DELETE FROM sessao_usuario WHERE expira_em < now() - interval '1 day' OR revogada_em < now() - interval '1 day'`.
  Com poucos usuários e logins diários a tabela fica em dezenas de linhas. Nada no Windows, nada no
  agendador do Spring.
- `LimpezaBanco` (testes) já descobre tabelas do schema real; a nova entra no `TRUNCATE` sozinha.

**Endpoints:**

| Método e caminho | Autenticação | Respostas |
|---|---|---|
| `POST /api/v1/auth/login` | senha | `200 LoginResponse` + `Set-Cookie` (novo) |
| `POST /api/v1/auth/refresh` | cookie + `X-Requested-With` | `200 LoginResponse` · `204` sem sessão (limpa cookie) · `403` sem header · `503 SERVICE_UNAVAILABLE` em falha transitória do banco (cookie intacto) |
| `POST /api/v1/auth/logout` | cookie + `X-Requested-With` | `204` sempre (revoga se houver) + cookie `Max-Age=0` · `403` sem header |
| `GET /api/v1/auth/me` | Bearer | inalterado |

`LoginResponse` não muda de forma; o refresh devolve a mesma estrutura (`accessToken`, `expiresIn`,
`usuario`), então o front usa `setSession` nos dois casos. `refresh` e `logout` entram em `permitAll`.

## 1.7 Configuração (variável de ambiente, default seguro)

| Variável | Propriedade | Default | Nota |
|---|---|---|---|
| `JWT_ACCESS_TOKEN_MINUTES` | `app.auth.jwt.access-token-minutes` | `15` | inalterada; o access continua curto |
| `JWT_REFRESH_TOKEN_DURATION` | `app.auth.sessao.duracao` | `10h` | `java.time.Duration` (`10h`, `8h`, `2m`); validação: entre 1 min e 24 h |
| `APP_AUTH_COOKIE_SECURE` | `app.auth.sessao.cookie-secure` | `true` | `false` só para dev por HTTP fora de `localhost` |

10 h e não 8: cobre jornada de 8 h com almoço e uma sobra sem cair no fim do turno. Nome do cookie fixo
(`inframonitor_refresh`), `SameSite=Strict`, `Path=/api/v1/auth`, `HttpOnly` sempre — não configuráveis,
para não haver jeito de afrouxar sem mudar código. `ConfiguracaoPadraoDesligadaTest` ganha a asserção
de que o default de `cookie-secure` é `true`.

## 1.8 O que esta mudança quebra

**U-08** (D02.11-A.1, PASS hoje) fica inválido. Texto novo:

> | U-08 | Entrar; usar o sistema; deixar a aba parada 16 min e clicar num menu; apertar F5 numa tela interna; abrir `https://<hostname>/equipamentos` numa aba nova; usar "Sair" e apertar Voltar | Nenhum desses passos volta ao login, exceto "Sair". Após "Sair", Voltar e F5 levam ao login. O console não mostra erros vermelhos. A sessão só termina sozinha ~10 h depois do login. |

E também a linha resumo de D02.11-A ("Sessão expira depois de 15 minutos") → "Sessão sobrevive a F5 e a uso
contínuo; termina ao fim da jornada (10 h) ou no Sair".

Teste do comportamento correto: roteiro Playwright novo `e2e/sessao-refresh.cjs` (não altera os existentes),
contra backend com `JWT_ACCESS_TOKEN_MINUTES=1` e banco descartável:
1. login → `page.reload()` → continua na tela interna, sem passar por `/login`;
2. uso contínuo por 2,5 min (> 2× o access) clicando menus → nunca vai ao login, e ao menos um
   `POST /auth/refresh` 200 ocorreu;
3. copiar o cookie → Sair → reenviar o cookie antigo ao `/auth/refresh` → 204, sem token;
4. backend com `JWT_REFRESH_TOKEN_DURATION=2m` → depois de 2 min, a próxima ação vai ao login com
   "Sua sessão expirou".
Prova de reversão: o mesmo roteiro contra o front de `origin/main` falha nos passos 1 e 2.

**Testes que mudam:**
- `auth-state.service.spec.ts`: `authenticated()` deixa de depender de `expiresAt` — o teste de expiração
  muda de expectativa.
- `auth.interceptor.spec.ts`: "keeps the global 401 flow…" passa a esperar um `POST /auth/refresh` (204)
  antes do login; testes novos de voo único, repetição, anti-laço.
- `auth.service.spec.ts`: `logout()` passa a chamar `POST /auth/logout`.
- Novos: `sessao.service.spec.ts` (restaurar/renovar); guards inalterados.
- Backend: `JwtServiceTest` inalterado; novo `SessaoUsuarioHttpIntegrationTest` (`@RequerDocker`); novo teste
  unitário do serviço de sessão (hash, expiração); `ManutencaoAgendadaHttpSecurityIntegrationTest` e demais
  que fazem login continuam (o corpo do login não muda; o cookie extra é ignorado).
- Contagem `@RequerDocker` no `CLAUDE.md` e no `README` do backend: 53 → 54.

**Roteiros e2e que podem ser simplificados (só listados, não alterados):** a regra "nunca `page.goto()`
depois do login; navegar por clique" existia por este defeito. Com F5/link direto restaurando a sessão,
os roteiros que logam pela tela e depois navegam por clique para chegar a uma rota podem usar `page.goto`:
`consistencia-visual-r1/r2`, `d24-arco-capturas`, `login-capturas`, `m06-drawer-no-mapa`,
`manutencao-agendada` (F1/F2/F3), `manutencao-interface`, `manutencao-verificacao`, `mapa-legenda-painel`,
`mapa-manutencao-verificacao`, `mapa-marcador-ibge-divergente`, `mapa-marcador-investigacao`,
`modal-usuarios`, `n04`…`n08`, `overflow-telas`, `painel-status-tipos`, `pre-carga-timeline-e-tela`,
`rodada-curta`, `unidade-detalhe-aviso-ibge`, `r034`/`r035`/`r036`/`r043`/`r045`. Ressalva: `page.goto`
dispara o refresh no bootstrap, então o contexto Playwright precisa manter cookies (o padrão).

**`ConfiguracaoPadraoDesligadaTest`:** continua passando — os YAML não ganham `spring.config.import` e os
quatro flags continuam `false`. Ganha uma asserção (cookie `Secure` por padrão).

**Empacotamento Windows — não muda.** `package.py` grava `schemaVersion: 25` e `Test-RollbackCompatibility`
aceita só 25 (`ReleaseTools.psm1:83`). Como o jar novo sobe e funciona (degradado) num banco em 25, o
pacote continua honestamente "compatível com schema 25"; a V26 é um opcional aditivo aplicado à parte.
Alterar as ferramentas criaria outro problema: cada pacote leva a própria cópia dos scripts, e o rollback
com a cópia antiga recusaria 26. Mantendo 25, release e rollback seguem com as ferramentas atuais.

## 1.9 Implantação e reversão

**Fato crítico (evidência `winsw.xml.template` e D02.10-C):** em produção o backend sobe com
`--spring.flyway.enabled=false`; o Flyway foi executado à parte com o papel `inframonitor_owner`, e a
aplicação usa `inframonitor_app`, que recebe DML por *default privileges*. Se `sessao_usuario` fosse
entidade JPA, o jar novo não subiria sem a V26 (`validate`) e o script deixaria o site parado → todos fora.
O desenho elimina esse modo de falha (JDBC com falha tolerada — 1.6): **sem a V26 o jar novo sobe, o login
funciona e a sessão dura 15 min como hoje.** A ordem abaixo continua sendo a recomendada, mas errar a ordem
não tranca ninguém.

**A V26 é segura e reversível.** Só cria uma tabela nova e um índice; não toca linha nem coluna existente;
roda em milissegundos (tabela vazia). O jar antigo ignora a tabela (o `validate` só confere entidades
mapeadas; o Flyway está desligado em produção). Para removê-la, se um dia for preciso:
`DROP TABLE sessao_usuario; DELETE FROM flyway_schema_history WHERE version = '26';` — não é necessário
para voltar atrás.

**Passo a passo:**
1. Backup com o script existente `ops/Backup-InfraMonitorDatabase.ps1` (já aprovado; nada novo).
2. Aplicar a V26 com o jar **novo**, em console, com o backend antigo no ar (ele não percebe), usando o
   papel dono do schema e nada que aja sozinho ligado — comando exato, testado localmente, em
   `infra-monitor-backend/README.md`, subseção "V26 (sessão com refresh token) — aplicar em produção e rollback".
3. Conferir (parada obrigatória antes do passo 4):
   `select version, success from flyway_schema_history where version='26'` → `26 | t`;
   `select has_table_privilege('inframonitor_app','sessao_usuario','SELECT,INSERT,UPDATE,DELETE')` → `t`.
   Se `f`, como dono: `GRANT SELECT, INSERT, UPDATE, DELETE ON sessao_usuario TO inframonitor_app;` e
   `GRANT USAGE, SELECT ON SEQUENCE sessao_usuario_id_seq TO inframonitor_app;`.
4. Release `Both` com as ferramentas atuais (`-SchemaVersion 25`, ver 1.8).
5. Pós-subida (operador, estação da VLAN de TI):
   - health `UP`;
   - login com o ADMIN funciona (é o caminho que **não mudou**; se falhar, rollback imediato);
   - DevTools → Application → Cookies: `inframonitor_refresh` com HttpOnly, Secure, SameSite Strict,
     Path `/api/v1/auth` (prova que o `Set-Cookie` atravessou o ARR — item inferido em 1.3);
   - F5 numa tela interna continua logado; Network mostra `POST /api/v1/auth/refresh` 200;
   - Sair → F5 → login;
   - `select count(*) from sessao_usuario` > 0 e nenhuma coluna com o valor do cookie.

**Sessões abertas no momento da troca:** abas abertas mantêm o JS antigo em memória e o access token
antigo, que continua válido (mesmo `JWT_SECRET`) até vencer; aí o JS antigo manda ao login. Quem der F5
carrega o front novo, não tem cookie ainda → login. Resultado: cada usuário entra **uma vez** depois da
troca. Ninguém fica trancado.

**Voltar atrás se o login quebrar:**
1. `Invoke-WindowsRelease.ps1 -Operation Rollback` para a release anterior, com as ferramentas de sempre
   (`-SchemaVersion 25`).
2. **Não** remover a V26: o jar antigo roda com ela (provado em 2026-11-11 — ver README do backend, V26). A tabela fica parada.
3. Compatibilidade cruzada, para rollback parcial:
   - front novo + backend antigo: o bootstrap chama `/auth/refresh` → backend antigo responde 401 (cai em
     `/api/**` ADMIN sem token) → tratado como "sem sessão" → login funciona como hoje; logout chama
     `/auth/logout` → 401 → o front limpa a sessão local mesmo assim;
   - front antigo + backend novo: idêntico a hoje (o `Set-Cookie` é ignorado).
4. Se o problema for o cookie (p. ex. ARR descartando `Set-Cookie`): nada a reverter com urgência — o
   sistema degrada para "sessão de 15 min" e o login funciona. Investigar sem pressa.

## Decisões tomadas por mim (para conferência)

- Sem rotação; validade absoluta 10 h; 204 para "sem sessão"; header `X-Requested-With` como defesa extra.
- Revogação em desativação, reset por ADMIN e troca da própria senha (o front refaz login com a senha nova).
- Tabela acessada por JDBC com falha tolerada; empacotamento Windows intacto (proteção contra lockout).
- Restrição: refresh/logout nunca levam `Authorization` (o filtro JWT devolve 401 a um Bearer vencido antes
  do `permitAll`); `isProtectedApi` passa a excluir `/auth/refresh` e `/auth/logout`.
- Limpeza oportunista no login.
- Proxy `.mjs` com `API_PORT`; `api-porta.cjs` ajustado; demais roteiros intactos.
- Tela de espera estática no `index.html`.

## Revisão do desenho (revisor independente, 2026-11-11)

Apontou: (1) o "guard de schema 26" proposto antes não lia o banco — o operador digitaria o número e, sem
a V26, uma entidade JPA trancaria todos fora; (2) o procedimento de V26 citado não existe no repositório;
(3) o rollback com a cópia antiga dos scripts recusaria 26. Resolvido trocando a abordagem: JDBC com
falha tolerada (o jar novo funciona sem V26), ferramentas de release intactas, comando de migração testado
e documentado no README do backend.
