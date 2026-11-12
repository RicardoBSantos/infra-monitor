# Infra Monitor — Backend

Backend do sistema interno de monitoramento de infraestrutura de rede.

O backend consolida o inventário, monitores ICMP, histórico de medições,
detecção de incidentes, leitura operacional para dashboard e a fila de
notificações Telegram. Autenticação permanece fora do escopo.

Fluxo operacional:

```text
Unidade -> Equipamento -> Monitor -> Medição -> Incidente -> Notificação -> Telegram
```

## Requisitos

## Autenticação A02

A API usa JWT bearer stateless: todas as rotas `/api/v1/**`, exceto `POST /api/v1/auth/login`, exigem token. `GET /actuator/health` permanece público. Tokens HS256 expiram em 15 minutos por padrão, CSRF é desabilitado e CORS usa origens explícitas, sem credentials. O frontend anterior à A03 receberá `401` nas APIs protegidas, intencionalmente.

Configure externamente `JWT_SECRET` (mínimo 32 bytes), `JWT_ISSUER`, `JWT_ACCESS_TOKEN_MINUTES` e, opcionalmente, `BOOTSTRAP_ADMIN_ENABLED`, `BOOTSTRAP_ADMIN_NAME`, `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD`. Não há senha bootstrap default. O bootstrap é idempotente. E-mails são normalizados para lowercase e também têm unicidade PostgreSQL em `LOWER(email)`; senhas são BCrypt cost 12, 12–128 caracteres.

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
| `DB_POOL_SIZE`| `20`            | tamanho máximo do pool Hikari      |
| `SERVER_PORT` | `8080`          | porta HTTP da aplicação            |

Em produção essas variáveis são obrigatórias — os defaults existem só para o ambiente local.

## Variáveis de ambiente e `.env`

**O Spring lê apenas variáveis de ambiente do processo** (e os `application*.yml`
versionados). O arquivo `.env` **não** é lido pela aplicação, e isso é intencional.
`.env.example` é o modelo; o `.env` real é ignorado pelo git (`.gitignore` do backend)
e nunca deve ser commitado.

Motor ICMP, Telegram e dispatcher ficam **desligados** se a variável não existir.
Ligar é sempre um ato explícito de quem sobe o processo:
`MONITORING_ENGINE_ENABLED=true`, e para alertas `TELEGRAM_ENABLED=true` **e**
`NOTIFICATION_DISPATCHER_ENABLED=true` com `TELEGRAM_BOT_TOKEN` e `TELEGRAM_CHAT_ID`.
`ConfiguracaoPadraoDesligadaTest` trava esses defaults e proíbe `spring.config.import`
nos YAML.

Sessão com refresh token (cookie httpOnly `inframonitor_refresh`, ver a subseção V26 em "Migrations"):

| Variável | Padrão | Efeito |
|---|---|---|
| `JWT_ACCESS_TOKEN_MINUTES` | `15` | Validade do access token. Continua 15: ele é curto e vive em memória no navegador. |
| `JWT_REFRESH_TOKEN_DURATION` | `10h` | Duração **absoluta** da sessão, contada do login, em formato `java.time.Duration` (`10h`, `8h`, `2m`). Entre 1 minuto e 24 horas. Não é estendida pelo uso. **Sempre com unidade:** `10` sem unidade é lido como 10 **ms**. Valor fora de [1 min, 24 h] **impede o backend de subir** (ninguém faz login, nem por senha): só altere com a unidade e valide antes num ambiente que não seja produção. |
| `APP_AUTH_COOKIE_SECURE` | `true` | Atributo `Secure` do cookie. `false` só para desenvolvimento por HTTP fora de `localhost`. |

Manutenção agendada (janelas em `/api/v1/manutencoes`):

- `GET /api/v1/manutencoes/{id}`: detalhe de uma janela.
- `GET /api/v1/manutencoes`: a listagem aceita o filtro `unidadeId`.
- `PUT /api/v1/manutencoes/{id}`: edita janela `AGENDADA`. Funciona com o agendador desligado e, nesse caso,
  a janela **não é ativada** (MA25).
- `PATCH /api/v1/manutencoes/{id}/fim`: altera o fim de janela `ATIVA`. **Exige o agendador ligado.**

| Variável | Padrão | Efeito |
|---|---|---|
| `MANUTENCAO_AGENDADA_ENABLED` | `false` | Liga o reconciliador que ativa, conclui e expira as janelas. **Desligado, a criação de janela é recusada com 409** (nenhuma janela seria ativada) e a tela mostra o aviso; o botão manual "Iniciar manutenção" do equipamento continua funcionando. Cancelar e encerrar janelas existentes funcionam com ele desligado. |
| `MANUTENCAO_AGENDADA_INTERVALO_MS` | `30000` | Intervalo entre duas passadas do reconciliador. A janela entra e sai com atraso de até um intervalo. |
| `MANUTENCAO_AGENDADA_DURACAO_MAXIMA` | `72h` | Duração máxima de uma janela, em formato `java.time.Duration` do Spring (`72h`, `5d`, `90m`). Mudar exige reiniciar. |

Janelas **ativas não terminam sozinhas** com o agendamento desligado (só o reconciliador as conclui):
o equipamento fica fora do monitoramento além do fim previsto, e a lista marca a linha com "fim
previsto já passou". Encerre-as pela tela, em "Encerrar agora".

Telegram da manutenção (F3, V23):

- A janela (início, fim, alteração do fim) e o botão manual (ligar, desligar) passam a gerar **uma mensagem por evento**
  no canal de alertas. Cancelar ou editar janela AGENDADA, e janela EXPIRADA, não geram nada. Os avisos individuais
  `INCIDENTE_ENCERRADO_MANUTENCAO` / `LATENCIA_ENCERRADA_MANUTENCAO` continuam como antes. Só saem se Telegram **e**
  dispatcher estiverem ligados (ver "Telegram Dispatcher"); com eles desligados as linhas ficam PENDENTE.
- **`REPORT_TIMEZONE` (padrão `America/Sao_Paulo`) passou a afetar os textos do Telegram.** Todas as mensagens, as novas e as
  antigas de incidente e latência, saem em horário local `dd/MM/yyyy HH:mm` com a linha final
  `Horários: UTC-03:00 (America/Sao_Paulo)`. Antes as antigas saíam em UTC. Mudar a variável muda o texto das próximas
  mensagens; as já gravadas não são reescritas.
- `GET /api/v1/equipamentos/{id}/manutencoes-manuais?page&size`: histórico das sessões do botão manual do equipamento
  (`size` padrão 5, máximo 50; mais recente primeiro; mesmos papéis do `GET /equipamentos/**`). Cada item traz `id`,
  `iniciadaEm`, `iniciadaPor {id, nome}`, `encerradaEm`, `encerradaPor` e `duracaoSegundos`. A sessão anterior à V23
  vem com início, autor e duração `null` ("início não registrado"). 404 se o equipamento não existe.
- **Contrato do encerrar mudou (só no backend):** `PATCH /api/v1/equipamentos/{id}/manutencao/encerrar` agora recebe o
  usuário autenticado (`@AuthenticationPrincipal UsuarioPrincipal`) e grava `encerrada_por_id` na sessão. O corpo
  continua vazio e o frontend não muda. `EquipamentoService.sairDeManutencao` e `EstadoManutencaoEquipamento.encerrarManual`
  ganharam o parâmetro `usuarioId`.
- `DELETE /api/v1/equipamentos/{id}` de equipamento com histórico de manutenção manual é recusado com 409
  ("Nao e possivel excluir o equipamento porque ele tem historico de manutencao manual").
- `GET /api/v1/notificacoes` aceita `manutencaoId` e `manutencaoManualId` (no máximo uma âncora por consulta, senão 400); o
  histórico e o CSV de notificações ganham `manutencao_id` e `manutencao_manual_id` no fim.

### Produção: o gerenciador do serviço injeta as variáveis

Guarde as variáveis num arquivo **fora do repositório e fora do diretório da
aplicação**, legível só pela conta do serviço, no mesmo formato do `.env.example`
(`KEY=VALUE`, sem aspas). O gerenciador do serviço o carrega antes de iniciar a JVM:

| Ambiente | Como injetar |
|---|---|
| Linux + systemd | `EnvironmentFile=/etc/infra-monitor/backend.env` na unit; arquivo `root:root`, `0600` |
| Windows (WinSW) | um `<env name="..." value="..."/>` por variável no XML do serviço, com ACL restrita ao administrador e à conta do serviço |
| Windows (NSSM) | `nssm set <serviço> AppEnvironmentExtra KEY=VALUE ...` |
| Docker Compose | `env_file: /etc/infra-monitor/backend.env` no serviço do backend |

O sistema operacional de produção ainda não está confirmado; os quatro caminhos usam o
mesmo arquivo-modelo. Trocar um valor exige reiniciar o serviço.

Por que não `spring.config.import=optional:file:.env[.properties]` no `application.yml`:

- o caminho é relativo ao diretório de trabalho. `./mvnw test` e `./mvnw spring-boot:run`
  rodam dentro de `infra-monitor-backend/`, então todo contexto de teste e todo boot
  local passariam a carregar o `.env` com o token real do grupo de produção — basta um
  `TELEGRAM_ENABLED=true` esquecido nele para teste ou dev mandar alerta de verdade;
- com `optional:`, arquivo ausente vira silenciosamente "tudo no default"; num serviço
  com diretório de trabalho diferente do esperado, a produção sobe sem as variáveis e
  ninguém percebe;
- mantém um segredo de produção dentro da árvore do código-fonte.

Se um dia for preciso importar arquivo, que seja explícito na linha de comando do
serviço, com caminho absoluto e **sem** `optional:`
(`--spring.config.import=file:/etc/infra-monitor/backend.env[.properties]`), nunca no
YAML versionado.

### Desenvolvimento local

Exporte o `.env` para o shell antes de subir (sem `export`, o Spring não vê nada):

```bash
# Git Bash / Linux
set -a; . ./.env; set +a
./mvnw spring-boot:run
```

```powershell
# PowerShell (vale para a sessão atual)
Get-Content .env | Where-Object { $_ -match '^\s*[A-Z_]+=' } | ForEach-Object {
  $k, $v = $_ -split '=', 2; Set-Item "env:$($k.Trim())" $v
}
./mvnw spring-boot:run
```

Mantenha `TELEGRAM_ENABLED=false` e `NOTIFICATION_DISPATCHER_ENABLED=false` no `.env`
local. Para testar envio, prefira sobrescrever só no comando
(`TELEGRAM_ENABLED=true NOTIFICATION_DISPATCHER_ENABLED=true ./mvnw spring-boot:run`) e
de preferência com um bot/grupo de teste, não o de produção.

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

### Atualização para a V21 (manutenção agendada) e rollback

A V21 separa o botão manual (`manutencao_manual`) do estado efetivo (`em_manutencao` = manual OU
janela ativa) e trava a relação com `ck_equipamento_manutencao_manual_efetiva`
(`CHECK (NOT manutencao_manual OR em_manutencao)`).

**Antes de atualizar**, anote quem está em manutenção:

```sql
select id, nome from equipamento where em_manutencao;
```

A V21 faz o backfill `manutencao_manual = em_manutencao`: todos esses passam a ser manutenção
**manual** e só saem por "Encerrar manutenção" no equipamento.

**Código anterior à F1 num banco já em V21** (rollback do jar sem rollback do banco, ou uma segunda
instância antiga apontando para o mesmo banco). O código antigo não conhece `manutencao_manual`:

- "Iniciar manutenção" nele grava só `em_manutencao = true`; o reconciliador da versão nova (quando ligado)
  enxerga um flag sem origem (nem manual nem janela) e o desfaz na próxima passada;
- "Encerrar manutenção" nele, num equipamento com `manutencao_manual = true`, grava
  `em_manutencao = false`, viola `ck_equipamento_manutencao_manual_efetiva` e devolve erro.

Remédio antes de subir o código antigo sobre um banco em V21:

```sql
UPDATE equipamento SET manutencao_manual = false WHERE manutencao_manual;
```

O CHECK continua aceitando `em_manutencao = true` sozinho, então quem estava em manutenção segue
em manutenção e o código antigo volta a controlar o flag. Ao reinstalar a versão nova, refaça o
"Iniciar manutenção" desses equipamentos (ou rode o `UPDATE` inverso para os que devem ser manuais).

A **V22** (F2) é aditiva: coluna com default e tabela nova de alterações. O código da F1 roda normalmente
sobre um banco em V22, e voltar o jar para a F1 deixa a V22 no lugar, sem efeito.

### V23 (F3, Telegram da manutenção) e rollback

A **V23** é aditiva: tabela `manutencao_manual` (sessões do botão; backfill de uma sessão aberta, sem início e sem autor, para
cada equipamento que já está no botão), duas colunas-âncora em `notificacao` (`manutencao_agendada_id`,
`manutencao_manual_id`) e os `CHECK` de âncora e de tipo de evento recriados com cinco valores novos
(`MANUTENCAO_INICIADA`, `MANUTENCAO_ENCERRADA`, `MANUTENCAO_FIM_ALTERADO`, `MANUTENCAO_MANUAL_INICIADA`,
`MANUTENCAO_MANUAL_ENCERRADA`).

Deploy com janela já ATIVA: ela termina com o "alertas retomados" normal sem ter tido anúncio de início (uma vez por janela;
só as transições depois do deploy anunciam).

**Rollback para o código da V22 não é suportado depois que existir qualquer linha de notificação da F3, em qualquer status.**
O `tipo_evento` é lido como `@Enumerated(STRING)`; pelo comportamento esperado desse mapeamento, o código anterior não
conhece os cinco valores novos e falha ao ler essas linhas, na fila do dispatcher e também em `GET /api/v1/notificacoes` e
nos relatórios. Isso é inferido do mapeamento e **não foi exercitado contra um jar real da V22**. O schema em si é compatível
(nada foi removido), mas o caminho de saída é corrigir para frente, com código da F3. A consulta abaixo é só diagnóstico, para
saber se já existem linhas da F3:

```sql
select id, tipo_evento, status from notificacao
 where tipo_evento in ('MANUTENCAO_INICIADA','MANUTENCAO_ENCERRADA','MANUTENCAO_FIM_ALTERADO',
                       'MANUTENCAO_MANUAL_INICIADA','MANUTENCAO_MANUAL_ENCERRADA');
```

Qualquer alteração de dados em produção por causa disso é decisão do operador e fica fora deste guia.

O banco da carga real (`inframonitor-carga`) **não recebeu a V23**: a 8080 roda código da V22 com dispatcher e Telegram
reais, e uma linha F3 iria ao grupo e quebraria o enum do código antigo. Aplicar a V23 lá e trocar a 8080 para a F3 é decisão
do usuário, depois de conferido o formato das mensagens.

Atenção: o banco da carga real (`inframonitor-carga`) **já está em V21**, enquanto a pilha do dia a
dia pode estar rodando código anterior à F1. Não aponte um jar antigo para ele sem o `UPDATE` acima.

### V26 (sessão com refresh token) — aplicar em produção e rollback

A **V26** cria só a tabela `sessao_usuario` (hash SHA-256 do refresh token, validade, último uso, revogação) e um índice.
Não toca linha nem coluna existente e roda em milissegundos. Desenho completo em
`Docs/superpowers/specs/2026-11-11-sessao-refresh-token-design.md`.

**A ordem importa, mas errar a ordem não tranca ninguém.** Em produção o backend sobe com `--spring.flyway.enabled=false`;
o Flyway roda à parte com o papel `inframonitor_owner`. A aplicação acessa `sessao_usuario` por JDBC com falha tolerada
(não é entidade JPA, então `ddl-auto: validate` não a conhece): **sem a V26 o login funciona e a sessão dura 15 min**, como antes.
Nesse modo o log mostra uma linha `WARN Sessao persistente indisponivel (V26 aplicada?): 42P01 ...` por tentativa, sem stack.
Falha **transitória** do banco (pool esgotado, banco reiniciando) não derruba a sessão: o refresh responde `503 SERVICE_UNAVAILABLE`
sem mexer no cookie, e o próximo refresh ou F5 a restaura; o login responde 200 sem cookie e o logout responde 204 limpando o cookie.
Mesmo assim, aplique a V26 antes de subir o jar novo.

**Passo a passo:**

1. Backup com o script existente `ops/Backup-InfraMonitorDatabase.ps1`.
2. Aplicar a V26 com o jar **novo**, em console, com o backend antigo ainda no ar na 8080 (ele não percebe). Mesma abordagem da
   D02.10-C: o jar completo sobe em loopback na 18080 com o Flyway ligado e depois é parado. Nada que aja sozinho fica ligado:

```powershell
$env:MONITORING_ENGINE_ENABLED='false'; $env:TELEGRAM_ENABLED='false'; $env:NOTIFICATION_DISPATCHER_ENABLED='false'; $env:MANUTENCAO_AGENDADA_ENABLED='false'; $env:RETENTION_ENABLED='false'; $env:BOOTSTRAP_ADMIN_ENABLED='false'
& "$env:JAVA_HOME\bin\java.exe" "-Djava.io.tmpdir=C:\InfraMonitor\tmp\backend" "-Djdk.net.unixdomain.tmpdir=C:\InfraMonitor\tmp\backend" -jar <app.jar da release nova> --spring.profiles.active=prod --server.address=127.0.0.1 --server.port=18080 --spring.flyway.enabled=true --spring.flyway.target=26 "--spring.datasource.url=jdbc:postgresql://127.0.0.1:5432/inframonitor" --spring.datasource.username=inframonitor_owner "--spring.datasource.password=<senha do owner, digitada no console, nunca em arquivo>" "--app.auth.jwt.secret=<qualquer valor descartável com 32+ bytes>"
```

   Espere a linha de log `Successfully applied 1 migration to schema "public", now at version v26` e depois
   `Started InfraMonitorApplication`; então pare com Ctrl+C. **Não** use `--spring.main.web-application-type=none`: a migração
   roda, mas o processo termina com erro por falta do bean de CORS. Por isso o jar sobe completo em loopback.
3. Conferir (parada obrigatória antes do passo 4):

```sql
select version, success from flyway_schema_history where version = '26';   -- esperado: 26 | t
select has_table_privilege('inframonitor_app', 'sessao_usuario', 'SELECT,INSERT,UPDATE,DELETE');   -- esperado: t
```

   Se o segundo for `f`, como dono do schema:

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON sessao_usuario TO inframonitor_app;
GRANT USAGE, SELECT ON SEQUENCE sessao_usuario_id_seq TO inframonitor_app;
```

4. Release `Both` com as ferramentas atuais, `-SchemaVersion 25`: o pacote continua "compatível com schema 25" (o jar novo funciona,
   degradado, num banco em 25) e a V26 é um opcional aditivo aplicado à parte. Não altere as ferramentas de release.
5. Pós-subida (operador, estação da VLAN de TI):
   - health `UP`;
   - login com o ADMIN funciona (é o caminho que não mudou; se falhar, rollback imediato);
   - DevTools, Application, Cookies: `inframonitor_refresh` com HttpOnly, Secure, SameSite Strict e Path `/api/v1/auth`
     (prova que o `Set-Cookie` atravessou o ARR; o IIS não pôde ser testado aqui);
   - F5 numa tela interna continua logado, e o Network mostra `POST /api/v1/auth/refresh` 200;
   - Sair, F5: volta ao login;
   - `select count(*) from sessao_usuario` maior que 0, e nenhuma coluna com o valor do cookie.

Sessões abertas na troca: abas com o JS antigo seguem até o access token vencer e então vão ao login; quem der F5 carrega o front
novo, ainda sem cookie, e entra uma vez. Ninguém fica trancado.

**Voltar atrás se o login quebrar:**

1. `Invoke-WindowsRelease.ps1 -Operation Rollback` para a release anterior, com as ferramentas de sempre (`-SchemaVersion 25`).
2. **Não** remova a V26: o jar antigo roda com ela e a tabela fica parada. Só se um dia for preciso removê-la:
   `DROP TABLE sessao_usuario; DELETE FROM flyway_schema_history WHERE version = '26';` (não é necessário para voltar atrás).
3. Rollback parcial: front novo com backend antigo cai em "sem sessão" e o login funciona como hoje; front antigo com backend novo
   é idêntico a hoje (o `Set-Cookie` é ignorado).
4. Se o problema for só o cookie (por exemplo o ARR descartando `Set-Cookie`), nada a reverter com urgência: o sistema degrada para
   sessão de 15 min e o login funciona.

Provado em 2026-11-11 em bancos descartáveis: jar novo aplicou a V26 sobre um banco em V25 (44 ms); jar de origin/main (920e4d5) com Flyway desligado subiu UP sobre o banco em V26 e o login respondeu 200; jar novo com Flyway desligado sobre banco sem V26 subiu UP, login 200 sem cookie, refresh 204.

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

As classes de integração Postgres (56 hoje) são marcadas com `@RequerDocker` e sobem
um PostgreSQL real via Testcontainers. Sem Docker disponível elas são **puladas**, não
falham, e o fim da execução imprime um aviso com a contagem e a lista
(`!! N classes puladas: Docker indisponivel.`): uma suíte verde nesse estado **não**
testou o banco. A contagem completa só vale com Docker no ar. Classe nova que use
`PostgreSQLContainer` precisa levar `@RequerDocker`; os testes de API rodam sempre. O fluxo
end-to-end usa medições simuladas e um cliente Telegram falso, sem ping ou envio
externo.

`DocumentacaoRequerDockerTest` conta as classes anotadas nas fontes e verifica este número
e o de `CLAUDE.md` na suíte padrão, mesmo sem Docker. Ao adicionar ou remover uma classe
com `@RequerDocker`, atualize a contagem nos dois documentos; o teste falha se divergirem.

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
| `GET /api/v1/equipamentos/{id}/manutencoes-manuais` | Histórico paginado das sessões do botão de manutenção manual do equipamento (F3); `size` padrão 5, máximo 50. |
| `GET /api/v1/dashboard/resumo` | Cards globais de inventário, monitoramento e incidentes abertos. |
| `GET /api/v1/dashboard/unidades` | Resumo operacional das unidades ativas, por nome. |
| `GET /api/v1/dashboard/unidades/{id}` | Detalhe operacional agregado de uma unidade. |
| `GET /api/v1/dashboard/unidades/{id}/equipamentos` | Equipamentos operacionais paginados da unidade; filtros `tipoEquipamentoId` e `ativo`. |

```bash
curl http://localhost:8080/actuator/health
curl http://localhost:8080/api/v1/status
```

Somente o endpoint `health` do Actuator é exposto. No perfil `prod` os detalhes
do health ficam ocultos (`show-details: never`).

## Dashboard operacional

Os status do Dashboard são projeções de leitura: nenhum status é persistido.
O Incident Engine é a fonte de verdade para indisponibilidade; portanto uma
única medição `FALHA` sem incidente `ABERTO` ainda resulta em `DISPONIVEL`.

- Monitor: `DESABILITADO` quando inativo; depois `INDISPONIVEL` se houver
  incidente aberto; `SEM_DADOS` sem medição; caso contrário `DISPONIVEL`.
- Equipamento: inativo é `DESABILITADO`; sem monitor ativo é
  `SEM_MONITORAMENTO`; incidente aberto em qualquer monitor ativo é
  `INDISPONIVEL`; todos os monitores ativos sem dados é `SEM_DADOS`; os demais
  são `DISPONIVEL`.
- Unidade: equipamentos inativos não afetam seu estado. Sem equipamento ativo
  é `SEM_EQUIPAMENTOS`; sem equipamento monitorado é `SEM_DADOS`; todos os
  monitorados indisponíveis é `INDISPONIVEL`; parte deles indisponível é
  `DEGRADADA`; todos sem dados é `SEM_DADOS`; os demais são `DISPONIVEL`.

As contagens globais e por unidade são agregadas no PostgreSQL. A página de
equipamentos é paginada no banco e enriquecida por consultas em lote para
monitores, últimas medições e incidentes abertos. `ultimaMedicao` em um
equipamento é a mais recente entre seus monitores ativos; ela é `null` quando
nenhum deles possui medição.

## Integração Frontend

A API pública utiliza a base `/api/v1`, JSON `camelCase`, IDs numéricos, enums
como strings e timestamps ISO-8601 em UTC. As listas paginadas possuem o
envelope estável `content`, `page`, `size`, `totalElements`, `totalPages`,
`first` e `last` (`page` começa em zero; `size` máximo é 100).

CORS é centralizado para `/api/**`. As origens padrão de desenvolvimento são
`http://localhost:4200` e `http://127.0.0.1:4200`. Em outro ambiente, defina
`CORS_ALLOWED_ORIGINS` com uma lista separada por vírgulas, por exemplo
`CORS_ALLOWED_ORIGINS=http://localhost:4200,http://127.0.0.1:4200`, sem recompilar.
Não há origem wildcard nem cookies/credentials nesta etapa.

Erros têm `code` estável para o frontend e `fields` em erros de validação.
O contrato completo, incluindo rotas, filtros, payloads e Dashboard, está em
[docs/frontend-api-contract.md](docs/frontend-api-contract.md).

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
TELEGRAM_ENABLED=true TELEGRAM_BOT_TOKEN=... TELEGRAM_CHAT_ID=... \
NOTIFICATION_DISPATCHER_ENABLED=true ./mvnw spring-boot:run
```

`TELEGRAM_ENABLED` e `NOTIFICATION_DISPATCHER_ENABLED` podem ser definidos como
`false` para desabilitar completamente o envio. `TELEGRAM_BOT_TOKEN` e
`TELEGRAM_CHAT_ID` nao possuem valores default. Com Telegram habilitado, ambos sao
obrigatorios; a aplicacao falha no startup sem revelar valores. O nome legado
`NOTIFICATION_TELEGRAM_ENABLED` continua aceito quando `TELEGRAM_ENABLED` nao foi definido.
Com Telegram ou dispatcher desabilitado, nao ocorre chamada externa e notificacoes
TELEGRAM ficam PENDENTE.

Propriedades configuraveis: `notification.telegram.connect-timeout-ms`,
`notification.telegram.read-timeout-ms`, `notification.dispatcher.poll-delay-ms`,
`batch-size`, `worker-threads`, `queue-capacity`, `max-attempts` e
`base-delay-seconds`. O backoff e 30s, 60s por padrao (configuravel), sem espera de
thread. A entrega e **at-least-once**: em uma queda apos Telegram aceitar a mensagem
e antes do banco gravar `ENVIADA`, um retry pode duplicar o alerta.

Para validar, gere uma abertura e um fechamento de incidente em um ambiente controlado,
consulte `GET /api/v1/notificacoes` e confirme que cada evento evoluiu de `PENDENTE`
para `ENVIADA`, com `tentativas` e `enviadoEm` preenchidos. O frontend consulta apenas
esses endpoints; ele nao recebe token, chat id ou executa chamadas ao Telegram.
