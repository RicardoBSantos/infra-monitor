# Rodada curta: `.env` desarmado, testes sem Docker e `environment.prod.ts`

Data: 2026-10-13. Branch `fix/env-docker-prod` a partir de `main` (`1bbd6e5`). Sem push.

> **Situação posterior:** mesclado na `main` pelo PR #5 em 2026-10-13 (`801005f`).

Regras de execução: banco de dev (`inframonitor-postgres`, 5434) não foi tocado (nenhuma consulta,
nenhum boot da aplicação contra ele); motor e Telegram desligados em todas as execuções; o token do
Telegram nunca foi impresso. A única ação sobre o ambiente foi parar o Docker Desktop para a
execução sem Docker e religá-lo depois (o container do dev voltou sozinho, `restart: unless-stopped`).

## Item 1 — `.env` desarmado

### Estado encontrado

`infra-monitor-backend/.env` tinha `TELEGRAM_ENABLED=true`, `NOTIFICATION_DISPATCHER_ENABLED=true` e
o token real do bot do grupo de produção. Era inofensivo só porque o Spring não lê o arquivo; quem
"corrigisse" essa lacuna com um `spring.config.import` ligaria o Telegram real em todo boot local.

### O que mudou

- **(a)** `.env` local: os dois flags agora estão em `false`. Token e chat id ficaram (desligados).
  O arquivo não é versionado, então essa mudança não aparece no diff.
- **(b)** `.env` ignorado por `infra-monitor-backend/.gitignore` (`.env` e `.env.*`, exceto
  `.env.example`); `git ls-files` só lista o `.env.example`. **O token nunca foi commitado**:
  - `git log --all -S<token>`: 0 commits; `git grep -F <token>` em todas as revisões de
    `git rev-list --all`: 0 arquivos;
  - o id numérico do bot (parte antes do `:`) também não aparece em nenhum commit;
  - nenhum dos blobs inalcançáveis (`git fsck --unreachable`, que pegam stash e commits
    descartados) contém o token;
  - na árvore de trabalho, o único arquivo com o token é o próprio `.env`.
  Revogar no BotFather não é necessário por vazamento no git.
- **(c)** Decisão: **em produção, quem injeta as variáveis é o gerenciador do serviço**
  (systemd `EnvironmentFile=`, `<env>` do WinSW, `AppEnvironmentExtra` do NSSM ou `env_file:` do
  compose), a partir de um arquivo fora do repositório, legível só pela conta do serviço, no
  formato do `.env.example`. A aplicação continua lendo só variáveis do processo: não há código
  novo de carga.
  Por que não `spring.config.import=optional:file:.env[.properties]` no YAML:
  1. o caminho é relativo ao diretório de trabalho. `./mvnw test` e `./mvnw spring-boot:run` rodam
     dentro de `infra-monitor-backend/`, onde está o `.env` com o token real: todo contexto de
     teste e todo boot local carregariam o token, e um flag em `true` esquecido mandaria alerta de
     verdade a partir de teste ou dev;
  2. `optional:` transforma arquivo ausente em "tudo no default" sem aviso: serviço com diretório de
     trabalho errado sobe sem configuração e ninguém percebe;
  3. mantém segredo de produção dentro da árvore do código.
  Se algum dia for preciso importar arquivo, o caminho é a linha de comando do serviço, absoluto e
  sem `optional:` — nunca o YAML versionado.
  **Telegram desligado por padrão** já era o default do `application.yml`
  (`${TELEGRAM_ENABLED:...:false}`, `${NOTIFICATION_DISPATCHER_ENABLED:false}`). Agora há uma
  trava: `ConfiguracaoPadraoDesligadaTest` resolve os YAML sem nenhuma variável de ambiente e exige
  `notification.telegram.enabled`, `notification.dispatcher.enabled` e `monitoring.engine.enabled`
  em `false` e token vazio, e falha se qualquer `application*.yml` declarar `spring.config.import`.
  Prova de que a trava pega: com `spring.config.import: optional:file:.env[.properties]` acrescentado
  temporariamente ao `application-dev.yml`, o teste falhou com
  `[application-dev.yml nao pode declarar spring.config.import]`; arquivo restaurado, diff vazio.
- **(d)** `.env.example` ganhou cabeçalho (o Spring não lê o arquivo; formato `KEY=VALUE` sem aspas)
  e o bloco do Telegram explicando que ligar exige os dois flags. Entrou `MONITORING_ENGINE_ENABLED=false`,
  que faltava. README do backend: seção nova **"Variáveis de ambiente e `.env`"** com a tabela de
  injeção por ambiente, o porquê da decisão e o carregamento do `.env` no shell para dev (Git Bash e
  PowerShell; o trecho PowerShell foi executado contra o `.env` real e carregou os flags em `false`
  sem imprimir segredo).

## Item 2 — testes de Postgres sem Docker

### Estado encontrado

27 classes de teste usam `PostgreSQLContainer`. 8 tinham `@EnabledIf("dockerDisponivel")` com o
método copiado em cada uma; **19 não tinham nada** e davam erro sem Docker ("Could not find a valid
Docker environment"). O `CLAUDE.md` dizia que só `InfraMonitorApplicationTests` era protegida e
dava a entender que bastava; nenhuma das duas coisas estava certa.

### O que mudou

- `testsupport/RequerDocker` (anotação de classe) + `DockerDisponivelCondition` (`ExecutionCondition`
  sobre `DockerClientFactory.isDockerAvailable()`). As **27** classes usam a anotação; os 8 métodos
  `dockerDisponivel()` duplicados saíram.
- `testsupport/AvisoTestesSemDocker`: `TestExecutionListener` do JUnit Platform, registrado por
  `META-INF/services`, que junta as classes puladas pelo motivo da condição e imprime no fim da
  suíte, em `stderr`, um bloco com a contagem e a lista. Exigiu a dependência de teste
  `junit-platform-launcher` (versão do BOM do Boot).
- `CLAUDE.md` e README do backend corrigidos.

### Prova

| Execução | Resultado |
|---|---|
| Docker Desktop **parado** (`docker desktop stop`, `docker info` falhando) | `Tests run: 432, Failures: 0, Errors: 0, Skipped: 119` — **BUILD SUCCESS**, com o aviso `!! 27 classes puladas: Docker indisponivel.` e a lista das 27. Antes desta rodada (execução anterior do mesmo dia, não repetida aqui): BUILD FAILURE, 435 executados, 93 erros nas 19 classes sem guarda |
| Docker **ligado**, antes do teste novo de configuração | `Tests run: 652, Failures: 0, Errors: 0, Skipped: 0` — BUILD SUCCESS, nenhuma linha de aviso |
| Docker **ligado**, final | `Tests run: 656, Failures: 0, Errors: 0, Skipped: 0` — BUILD SUCCESS (652 + 4 de `ConfiguracaoPadraoDesligadaTest`), nenhuma linha de aviso |

Saídas recortadas: [evidencias/docker-1-parado.txt](evidencias/docker-1-parado.txt) e
[evidencias/docker-2-ligado.txt](evidencias/docker-2-ligado.txt).

O "Skipped: 119" é a conta do Surefire (por método conhecido; parametrizados não expandem), não o
número de testes de banco que deixaram de rodar: com Docker essas 27 classes executam 343 testes
(656 − 313 executados sem Docker). A contagem que importa é a de **classes**, que o aviso mostra.

O aviso sai logo antes do bloco `Results:` do Maven, não depois do `BUILD SUCCESS`: o listener roda na
JVM de teste, que termina antes de o Maven imprimir o resumo.

## Item 3 — `environment.prod.ts`

### O que mudou

- `src/environments/environment.prod.ts`: `production: true`, `apiUrl: '/api/v1'` (relativa à
  origem).
- `angular.json`, configuração `production` do build: `fileReplacements` de `environment.ts` por
  `environment.prod.ts`. `ng serve` e `ng test` continuam no `environment.ts` (dev, absoluto em
  `http://localhost:8080/api/v1`).
- `auth.interceptor.ts`: `isProtectedApi` exportada e com `apiUrl` como parâmetro (default
  `environment.apiUrl`), para o teste exercitar a forma relativa sem trocar o `environment`.

### O que poderia quebrar com URL relativa

| Ponto | Resultado |
|---|---|
| Interceptor de autenticação | Já resolvia `new URL(environment.apiUrl, window.location.origin)`: `/api/v1` vira `<origem>/api/v1`. Testes novos com `/api/v1`: protege relativa e absoluta da mesma origem; não protege login, `assets/maps/se-municipalities.geo.json`, outra origem nem `/api/v10/...` |
| Mapa: GeoJSON | `geo-municipio.service.ts` busca `assets/maps/se-municipalities.geo.json` relativo ao `<base href="/">`; não depende de `apiUrl` e não recebe token |
| Mapa: worker do MapLibre | `setWorkerUrl(new URL('maplibre/maplibre-gl-worker.mjs', document.baseURI))`; não depende de `apiUrl` |
| Serviços de API | Todos montam `${environment.apiUrl}/...`; nenhum host fixo fora do `environment.ts` |
| Downloads de PDF/CSV | Vêm do `HttpClient` (passam pelo interceptor) e viram `blob:`; sem URL montada à mão |
| `environment.production` | Nenhum código lê o campo |

Limite: com `apiUrl` começando por `/`, a API fica na raiz da origem mesmo que o app seja servido em
subcaminho com outro `--base-href`. Hoje o `base href` é `/`; servir em subcaminho exige rever os dois.

### Prova

- `ng build --configuration production`: bundle gerado; o chunk do `environment` contém
  `{production:!0,apiUrl:"/api/v1"}` e **nenhum** arquivo `.js` do `dist` contém `localhost:8080`.
  Único aviso: budget de `mapa.component.scss` (95,78 kB contra 6 kB), em arquivo não tocado.
- `ng test --watch=false`: **50 arquivos, 457 testes, 0 falhas** (455 + 2 novos).

## Como servir o frontend (só investigação)

Fatos do código que pesam em qualquer opção:

- `SecurityConfiguration` termina em `anyRequest().denyAll()`: hoje o Spring **recusaria** todo
  arquivo estático, inclusive `/` e `/index.html`.
- Não existe `src/main/resources/static` nem controller de fallback de SPA. Rotas profundas
  (`/equipamentos/12`, deep-link compartilhado) cairiam no `TratadorGlobalDeErros`, que devolve
  `ErroResposta` JSON 404 (`NoResourceFoundException`), não o `index.html`.
- O worker do MapLibre é `.mjs` e precisa sair com MIME JavaScript, senão o mapa sobe e não
  desenha, sem erro (sem `setWorkerUrl` e o asset copiado isso já aconteceu uma vez no projeto).
- O build tem `outputHashing: all`: chunks com hash podem ter cache longo; `index.html` não.

| Opção | O que exige | Prós | Contras |
|---|---|---|---|
| **A. Spring serve o build** (sugerida) | Copiar `dist/infra-monitor-frontend/browser` para `classpath:/static` no build do jar (ex.: `frontend-maven-plugin` ou passo de cópia no pipeline); `permitAll` de `GET` para `/`, `/index.html`, `/*.js`, `/*.css`, `/assets/**`, `/maplibre/**`, `/favicon.ico` antes do `denyAll`; fallback que encaminha para `index.html` toda rota que não é `/api/**`, `/actuator/**` nem arquivo; `Cache-Control` `no-cache` no `index.html` e longo nos chunks; conferir MIME do `.mjs` | Um artefato, um processo, uma porta; mesma origem, CORS deixa de ser necessário em produção; casa com "um serviço com reinício automático" de [monitoramento-parado-investigacao.md](monitoramento-parado-investigacao.md) | Mexe na `SecurityConfiguration` (abrir rotas com cuidado para não abrir `/api`); build do backend passa a depender do Node; o 404 em JSON precisa conviver com o fallback |
| **B. Nginx na frente** (estático + `proxy_pass /api/` e `/actuator/health` para o backend) | `nginx.conf` com `try_files $uri /index.html`, cache por tipo, `types` com `mjs`; backend só ouvindo em localhost | Segurança do backend intocada; TLS e compressão no Nginx; deploy do front independente | Mais um serviço para operar e reiniciar; ainda sem SO de produção confirmado |
| **C. Origens separadas** | `apiUrl` absoluta por ambiente (outro `environment` ou `config.json` lido em runtime) e `CORS_ALLOWED_ORIGINS` | Nada a mudar no backend | Volta o host fixo que este item tirou; CORS e mais uma origem para manter |

Recomendação para quando for implementar: **A**, se a produção for uma máquina só sem proxy; **B**, se
já houver Nginx (o `CLAUDE.md` cita Docker/Linux/Nginx como deploy futuro). Os dois funcionam com o
`apiUrl` relativo sem tocar no frontend. Nada disso foi implementado.

## Arquivos

- Backend: `pom.xml`, `.env.example`, `README.md`, `src/test/resources/META-INF/services/...TestExecutionListener`,
  `src/test/java/br/com/inframonitor/testsupport/{RequerDocker,DockerDisponivelCondition,AvisoTestesSemDocker}.java`,
  `common/config/ConfiguracaoPadraoDesligadaTest.java` e as 27 classes de integração.
- Frontend: `angular.json`, `src/environments/environment.prod.ts`, `auth.interceptor.ts` e spec.
- Raiz: `CLAUDE.md`.
- Fora do git: `infra-monitor-backend/.env` (flags em `false`).
