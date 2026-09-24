# Manutenção de equipamento — verificação ponta a ponta

Verificação viva do módulo de manutenção da branch `feat/manutencao-equipamento`, contra um backend
real (motor ICMP + dispatcher de notificação) apontando para um Postgres 16 descartável, com um mock
HTTP no lugar da API do Telegram. Nada disto toca o banco de dev da porta 5434.

Executada em duas sessões: a primeira montou o ambiente e rodou os quatro passos do roteiro (SQL e
corpos do mock abaixo, colados sem parafrasear); a segunda — esta — congelou o estado (motor
desligado), tirou as telas por Playwright, escreveu este documento, destruiu o ambiente e comparou o
banco de dev antes/depois.

## Ambiente

- Postgres 16 descartável, container `infra-e2e`, porta **5435**, usuário/banco `inframonitor`.
- Mock HTTP do Telegram em `http://localhost:8099`, respondendo `{"ok":true,...}` a
  `POST /bot<token>/sendMessage` e gravando cada corpo recebido em JSON-lines.
- Backend Spring Boot em `8080`, `DB_PORT=5435`, motor de monitoramento e dispatcher **ligados**
  durante o roteiro (desligados só na etapa de congelamento, ao final).
- Cadastro: 1 unidade (`Unidade E2E Manutencao`, sem coordenadas — ver limitação na seção do mapa),
  2 equipamentos em `192.0.2.10` (TEST-NET-1, id 1) e `192.0.2.11` (id 2), 1 monitor ICMP por
  equipamento (`intervaloSegundos=10`, `falhasParaIncidente=3`).

## Passo 1 — incidentes abrem e o mock recebe

```sql
SELECT id, monitor_id, status, iniciado_em FROM incidente ORDER BY id;
--  1 | 1 (.10) | ... | 2026-09-23 03:15:46.339188+00
--  2 | 2 (.11) | ... | 2026-09-23 03:15:46.339188+00
```

Corpos recebidos pelo mock (arquivo `telegram-mock-received.jsonl`, colados sem edição):

```json
{"receivedAt":"2026-09-23T03:16:07.772Z","url":"/bottoken-de-teste/sendMessage","body":"{\"text\":\"INCIDENTE ABERTO\\n\\nUnidade: Unidade E2E Manutencao\\nEquipamento: EQ-192.0.2.11\\nIP: 192.0.2.11\\nMonitor: Monitor ICMP .11\\nInicio: 2026-09-23T03:15:46.339188Z\\nMotivo: Indisponibilidade detectada automaticamente apos 3 falhas consecutivas.\",\"chat_id\":\"-1\"}"}
{"receivedAt":"2026-09-23T03:16:07.773Z","url":"/bottoken-de-teste/sendMessage","body":"{\"text\":\"INCIDENTE ABERTO\\n\\nUnidade: Unidade E2E Manutencao\\nEquipamento: EQ-192.0.2.10\\nIP: 192.0.2.10\\nMonitor: Monitor ICMP .10\\nInicio: 2026-09-23T03:15:46.339188Z\\nMotivo: Indisponibilidade detectada automaticamente apos 3 falhas consecutivas.\",\"chat_id\":\"-1\"}"}
```

Os dois equipamentos abriram incidente após 3 falhas consecutivas, e o mock recebeu as duas
mensagens `INCIDENTE ABERTO`.

## Passo 2 — `.10` entra em manutenção

```sql
SELECT id, monitor_id, status, encerrado_em, motivo_encerramento, fechado_por
FROM incidente WHERE monitor_id = 1;
--  1 | 1 | FECHADO | 2026-09-23 03:16:36.302515+00 | MANUTENCAO | 1

SELECT id, monitor_id, inicio_em, fim_em, origem FROM janela_monitoramento WHERE monitor_id = 1;
--  1 | 1 | 2026-09-23 03:15:45.788545+00 | 2026-09-23 03:16:36.315474+00 | PRECISA

SELECT tipo_evento, status FROM notificacao WHERE incidente_id = 1;
-- INCIDENTE_ABERTO               | ENVIADA
-- INCIDENTE_ENCERRADO_MANUTENCAO | ENVIADA

SELECT count(*) FROM medicao WHERE monitor_id = 1
  AND executado_em > '2026-09-23 03:16:36.302515+00'
  AND executado_em < '2026-09-23 03:18:49.125206+00';
-- 0  (janela inteira de manutenção, sem nenhuma medição nova)
```

Corpo recebido pelo mock com a mensagem específica de manutenção:

```json
{"receivedAt":"2026-09-23T03:16:37.136Z","url":"/bottoken-de-teste/sendMessage","body":"{\"text\":\"🔧 Incidente encerrado: equipamento entrou em manutenção\\n\\nUnidade: Unidade E2E Manutencao\\nEquipamento: EQ-192.0.2.10\\nIP: 192.0.2.10\\nMonitor: Monitor ICMP .10\\nInicio: 2026-09-23T03:15:46.339188Z\\nFim: 2026-09-23T03:16:36.302515Z\\nDuracao: 0h 0m 49s\",\"chat_id\":\"-1\"}"}
```

Incidente fechado com `motivo_encerramento = MANUTENCAO`, `fechado_por` preenchido (usuário 1), a
janela fechou no mesmo instante, a notificação foi do tipo `INCIDENTE_ENCERRADO_MANUTENCAO` (nunca
`INCIDENTE_FECHADO`), e zero medições novas durante a janela de manutenção.

**Nota de honestidade:** ao reler o banco nesta segunda sessão, `count(*)` sem o limite superior de
`03:18:49` (fim real da manutenção) dá **1328**, não 0 — porque o motor continuou rodando por horas
depois que a primeira sessão morreu por limite de sessão, e só foi desligado nesta sessão ao
congelar o estado (ver "Congelamento do estado" abaixo). As 1328 medições são posteriores à saída da
manutenção (depois de `03:18:49`, quando `.10` já tinha voltado à leitura), não durante ela — a
contagem com os dois limites de tempo acima, delimitando exatamente a janela de manutenção, é a que
prova o comportamento e continua em 0.

## Passo 3 — `.11` com o dispatcher desligado

```sql
SELECT id, monitor_id, status, encerrado_em, motivo_encerramento FROM incidente WHERE monitor_id = 2;
--  2 | 2 | FECHADO | 2026-09-23 03:18:02.775362+00 | MANUTENCAO
--  3 | 2 | FECHADO | 2026-09-23 03:18:40.176645+00 | MANUTENCAO

SELECT tipo_evento, status FROM notificacao WHERE incidente_id IN (2, 3) ORDER BY id;
-- incidente 2: INCIDENTE_ABERTO | ENVIADA ; INCIDENTE_ENCERRADO_MANUTENCAO | PENDENTE
-- incidente 3: INCIDENTE_ABERTO | CANCELADA
```

`.11` passou por dois ciclos: um com o dispatcher ligado (incidente 2, cuja notificação de
manutenção ficou `PENDENTE` porque o dispatcher foi desligado depois do incidente já ter sido
aberto) e um com o dispatcher desligado do início ao fim (incidente 3, notificação `CANCELADA`).
Em nenhum dos dois casos o mock recebeu um corpo referente a `.11` além do `INCIDENTE ABERTO`
inicial — a contagem de linhas em `telegram-mock-received.jsonl` continuou em 3 (as do Passo 1 e
2) depois deste passo.

## Passo 4 — `.10` sai da manutenção: âncora da janela em campo

```sql
SELECT id, monitor_id, inicio_em, fim_em, origem FROM janela_monitoramento WHERE monitor_id = 1 ORDER BY id;
--  1 | 1 | 2026-09-23 03:15:45.788545+00 | 2026-09-23 03:16:36.315474+00 | PRECISA
--  4 | 1 | 2026-09-23 03:18:49.125206+00 |                               | PRECISA  (janela nova, ainda aberta)

SELECT id, monitor_id, status, iniciado_em FROM incidente WHERE monitor_id = 1 ORDER BY id;
--  1 | 1 | FECHADO | 2026-09-23 03:15:46.339188+00
--  4 | 1 | ABERTO  | 2026-09-23 03:18:49.172154+00
```

O incidente novo (id 4) só abriu depois da 3ª falha nova, com `iniciado_em = 03:18:49.172154+00`,
**posterior** ao início da janela nova (`03:18:49.125206+00`, 47 ms antes). Isto prova a âncora da
janela em campo: a contagem de falhas para abrir o próximo incidente reinicia no início da janela
nova, não antes.

## Congelamento do estado (segunda sessão)

O backend da primeira sessão continuou rodando por horas depois dela terminar (limite de sessão),
com o motor ligado contra o mesmo Postgres 5435 — sujando a tabela `medicao` com dados fora do
roteiro. Antes de tirar qualquer tela desta sessão:

1. Confirmado de pé: container `infra-e2e` (5435), backend (8080, PID antigo), mock (8099), frontend
   dev server (4200).
2. Backend antigo derrubado (`taskkill /F`), porta 8080 liberada.
3. Backend religado **contra o mesmo banco 5435** (nenhuma migration rodada, nenhum dado apagado),
   com `MONITORING_ENGINE_ENABLED=false` e `NOTIFICATION_DISPATCHER_ENABLED=false`, e um admin novo
   via bootstrap (`BOOTSTRAP_ADMIN_EMAIL=evidencia@local`, senha gerada com `openssl rand -hex 12`,
   guardada só em variável de ambiente do processo — nunca em arquivo nem em screenshot).
4. Confirmado com duas leituras de `count(*) FROM medicao` quinze segundos separadas — **1349** nas
   duas — que o motor parou de produzir medições.

Estado congelado a partir daqui: `equipamento.id=1` (`.10`) fora de manutenção com o incidente 4
`ABERTO`; `equipamento.id=2` (`.11`) com `em_manutencao=true`.

## Telas por Playwright

Roteiro em `infra-monitor-frontend/e2e/manutencao-verificacao.cjs`, login e navegação **por clique**
(evitando a armadilha conhecida: `page.goto` depois do login cai em `/login`), sem `catch` mudo em
seletor, log de rede e resultado gravados em `finally`
(`infra-monitor-frontend/e2e/manutencao-evidence/manutencao-verificacao.json`). 14/14 verificações
passaram. Screenshots em `infra-monitor-frontend/e2e/manutencao-evidence/`:

1. **`01-drawer-encerrado-por-motivo.png`** — drawer do incidente `INC-3` (equipamento `.11`),
   card "Janela da ocorrência" mostrando `Encerrado por: Admin` e
   `Motivo do encerramento: Entrada em manutenção`. Mostra o que o nome promete.
2. **`02-timeline-drawer.png`** — mesma ocorrência, rolada até o fim da linha do tempo: depois da
   sequência de `Falha ICMP` e da notificação `TELEGRAM · cancelada`, o último evento é
   `Encerrado por manutenção — O equipamento entrou em manutenção e saiu da observação. Nenhuma
   recuperação foi medida.` Não há nenhum evento de recuperação — confirmado tanto pelo texto
   completo capturado pelo script (`app-incidente-timeline`, sem ocorrência de "recupera" fora
   desta frase) quanto pela leitura visual do screenshot.
3. **`03-lista-marca-manutencao.png`** — lista unificada de incidentes, aba "Todos", com a marca
   🔧 ao lado do badge de status nas linhas `INC-3` e `INC-2` (ambas fechadas por manutenção).
4. **`04-painel-kpi-manutencao.png`** — painel (`/painel`) com o cartão `EM MANUTENÇÃO` mostrando
   **1** (equipamento `.11`, ainda em manutenção no momento da captura).
5. **`05-mapa-equipamento-manutencao.png`** — **limitação real, não forçada**: a `Unidade E2E
   Manutencao` foi cadastrada sem latitude/longitude/código IBGE (confirmado por
   `SELECT latitude, longitude, codigo_ibge FROM unidade` — todos `NULL`), então o mapa a lista em
   "Unidades sem localização" com o status agregado da unidade (`Indisponível`, por causa do
   incidente aberto em `.10`), sem marcador geográfico e sem um jeito de abrir o painel de
   equipamentos por clique a partir daí — o mapa só abre esse painel a partir de um marcador. A
   tela **não** mostra o badge "Em manutenção" no nível do equipamento; mostra que a legenda do mapa
   inclui a cor "Em manutenção" e que a unidade aparece na lista de sem-localização com seu status
   agregado. Isto é uma lacuna do cadastro de teste (unidade sem coordenadas), não algo que este
   roteiro pôde atribuir a um bug do recurso de manutenção — mas também não é a prova pedida no
   item 5 do roteiro, e por isso não deve ser lida como tal.
   **Refeito em 2026-09-24 com unidade georreferenciada: ver a seção "Mapa — refeito com
   coordenadas" no fim deste documento, que substitui esta tela como prova do item 5.**
6. **`06-notificacoes-historico.png`** — histórico de notificações (`/notificacoes/historico`)
   mostrando a notificação `#3` do incidente `#3` (equipamento `.11`) com status **`Cancelada`**, e
   as notificações `#1`/`#2` com evento **`Incidente encerrado por manutenção`** — os dois tipos
   novos (status e evento) visíveis nos badges da tabela, sem filtro aplicado.

## Prova final: o banco de dev não mudou

Container `infra-e2e` destruído, mock e backend de evidência encerrados, nenhum processo Java órfão
e nenhuma porta 5435/8099 em LISTENING (verificado abaixo, na seção de fechamento do relatório de
tarefa). Consulta de conferência, somente `SELECT`, contra o banco de dev na porta 5434:

```
Antes de qualquer tarefa da branch (ledger, sessão 1):
incidentes=76 medicoes=317080 notificacoes=10 equipamentos=222 janelas=224 episodios_latencia=2
flyway: ultima migration = V18

Depois de destruir o ambiente descartável (esta sessão):
incidentes=76 medicoes=317080 notificacoes=10 equipamentos=222 janelas=224 episodios_latencia=2
flyway: ultima migration = V18
```

Números idênticos. O banco de dev não foi tocado em nenhum momento além de `SELECT` de conferência.

## Mapa — refeito com coordenadas (2026-09-24)

Refaz a tela 5 acima, que ficou sem prova porque a unidade de teste não tinha coordenadas. Ambiente
novo, do zero, no mesmo desenho; código em `1e44d9f` (`feat/manutencao-equipamento`).

### Ambiente

- Postgres 16 descartável, container `infra-e2e` (`postgres:16-alpine`), porta **5435**, senha
  gerada na hora (`openssl rand`) e mantida só em variável de ambiente. Flyway aplicou V1–V19.
- Mock do Telegram em `http://localhost:8099` (Node `http`, responde `{"ok":true,...}` a
  `POST /bot*/sendMessage`, grava JSON-lines e registra cada requisição com o token mascarado).
- Backend: jar empacotado (`./mvnw -q -DskipTests package`) copiado para o scratchpad e rodado de
  lá, porta 8080, `DB_PORT=5435`, `JWT_SECRET` gerado, `TELEGRAM_BOT_TOKEN=token-de-teste`,
  `TELEGRAM_CHAT_ID=-1`, `TELEGRAM_API_BASE_URL=http://localhost:8099`, admin `evidencia@local`
  por bootstrap com senha gerada só em variável de ambiente. Motor ICMP (`NATIVO_WINDOWS`) e
  dispatcher **ligados** na preparação. O `.env` do backend (token real) não foi lido nem
  carregado: o jar rodou fora da pasta do projeto e o Spring não importa `.env`.
- Frontend: `ng serve` em **4300** (a 4200 estava ocupada por um processo do usuário, que não foi
  tocado), com `CORS_ALLOWED_ORIGINS=http://localhost:4300,http://127.0.0.1:4300` no backend. O
  frontend não usa proxy: `environment.ts` fixa `apiUrl: 'http://localhost:8080/api/v1'`, então o
  backend tinha de ficar na 8080 (estava livre).
- Antes de haver dado: `POST /api/v1/notificacoes/telegram/teste` → `{"enviado":true}` e o mock
  registrou `POST /bot<token>/sendMessage` com `TESTE DE INTEGRACAO`, prova de que a URL da API
  do Telegram era a do mock.

### Cadastro (pela API)

Coordenadas copiadas do dev-seed (`infra-monitor-backend/db/dev-seed/01-unidades-coordenadas.sql`),
não inventadas:

| Unidade | Sigla | IBGE | Latitude | Longitude | Equipamento | Papel |
|---|---|---|---|---|---|---|
| Unidade E2E Mapa Manutencao | E2E-MAN | 2802908 (Itabaiana) ¹ | -10.685300 | -37.425600 (da ITA-09) | EQ-192.0.2.11 | único equipamento, entra em manutenção |
| Unidade E2E Mapa Contraste | E2E-CTR | 2803500 (Lagarto) | -10.917200 | -37.670000 (da LAG-03) | EQ-192.0.2.10 | contraste, sem manutenção |

Um monitor ICMP por equipamento (`intervaloSegundos=10`, `timeoutMs=1000`, `falhasParaIncidente=3`).

¹ A unidade nasceu com `2803005`, o código que a ITA-09 tem no banco de dev. **`2803005` é
Itabaianinha**, não Itabaiana (`2802908`), conferido em
`infra-monitor-frontend/public/assets/maps/se-municipalities.geo.json`; a coordenada da ITA-09 cai
no polígono de Itabaiana. A primeira execução rodou assim e achou um defeito (ver "Execução 1");
o código foi então corrigido **só no banco descartável** via `PUT /unidades/1`.

### Preparação: incidente, depois manutenção

Os dois monitores abriram incidente após 3 falhas; o mock recebeu as duas mensagens
`INCIDENTE ABERTO` (13:43:42Z). `PATCH /equipamentos/1/manutencao/iniciar` às 13:43:50Z; o mock
recebeu `🔧 Incidente encerrado: equipamento entrou em manutenção` para `EQ-192.0.2.11`.

Congelamento: backend reiniciado com `MONITORING_ENGINE_ENABLED=false` e
`NOTIFICATION_DISPATCHER_ENABLED=false`; `count(*) FROM medicao` = **8** às 13:44:28Z e **8** às
13:44:43Z.

SQL de conferência na 5435, estado congelado (colado sem edição):

```
 id |  sigla  | codigo_ibge |  cidade   |  latitude  | longitude
----+---------+-------------+-----------+------------+------------
  1 | E2E-MAN | 2802908     | Itabaiana | -10.685300 | -37.425600
  2 | E2E-CTR | 2803500     | Lagarto   | -10.917200 | -37.670000

 id | unidade_id | ip_address | em_manutencao
----+------------+------------+---------------
  1 |          1 | 192.0.2.11 | t
  2 |          2 | 192.0.2.10 | f

 id | monitor_id | status  |          iniciado_em          |         encerrado_em          | motivo_encerramento | fechado_por
----+------------+---------+-------------------------------+-------------------------------+---------------------+-------------
  1 |          2 | ABERTO  | 2026-09-24 13:43:21.360388+00 |                               |                     |
  2 |          1 | FECHADO | 2026-09-24 13:43:21.360388+00 | 2026-09-24 13:43:50.309183+00 | MANUTENCAO          |           1

 incidente_id |          tipo_evento           | status
--------------+--------------------------------+---------
            1 | INCIDENTE_ABERTO               | ENVIADA
            2 | INCIDENTE_ABERTO               | ENVIADA
            2 | INCIDENTE_ENCERRADO_MANUTENCAO | ENVIADA
```

`GET /api/v1/dashboard/unidades` no mesmo estado: unidade 1 `"status":"EM_MANUTENCAO"`,
`equipamentosEmManutencao:1`; unidade 2 `"status":"INDISPONIVEL"`.

### Cor esperada, derivada antes de subir o ambiente

- Status: `OperationalStatusResolver.unidade()`
  (`infra-monitor-backend/src/main/java/br/com/inframonitor/dashboard/OperationalStatusResolver.java:59-66`):
  com o único equipamento ativo em `EM_MANUTENCAO`, `monitorados` fica vazio e `ativos` contém
  `EM_MANUTENCAO` → **`EM_MANUTENCAO`**.
- Cor: `COR_DO_STATUS['em-manutencao'] = '#7fadff'`
  (`infra-monitor-frontend/src/app/features/mapa/mapa.component.ts:106`), convertida por
  `corDoStatus()` (`:119`), aplicada como `--cor-unidade` no `<button class="map__unidade">`
  (`:716`) e lida em `.map__unidade { background: var(--cor-unidade, #8797a6) }`
  (`mapa.component.scss:74`) → **`#7fadff` = `rgb(127, 173, 255)`**.
- Contraste (unidade 2, único equipamento com incidente aberto): `INDISPONIVEL` →
  `'indisponivel': '#e5484d'` (`mapa.component.ts:106`) = `rgb(229, 72, 77)`.

**Obtido: `rgb(127, 173, 255)` no miolo e no anel de pulso (`::after`), `--cor-unidade: #7fadff`
inline; contraste `rgb(229, 72, 77)`. Confere nas duas execuções.**

### Playwright

Roteiro `infra-monitor-frontend/e2e/mapa-manutencao-verificacao.cjs`: login por clique, Mapa pelo
menu (clique), sem `page.goto` depois do login, sem `catch` mudo, resultado e log de rede em
`finally`. Evidência em `infra-monitor-frontend/e2e/mapa-manutencao-evidence/`.

**Execução 1: código IBGE divergente da coordenada (10/11, falha registrada).** Cor correta, mas o
clique no marcador **não abriu o painel da unidade**: o painel lateral mostrou "Itabaiana —
Nenhuma unidade cadastrada neste município." e o marcador ficou com `aria-pressed="false"`.
Leitura do código (sem alteração): o `click` do `<button class="map__unidade">` chama
`selecionarPeloMarcador` (município 2803005 + unidade), e o mesmo clique também dispara o
`map.on('click', 'municipios-fill')` do polígono que está debaixo do marcador (Itabaiana, 2802908,
sem unidade), cujo `selectMunicipio` chama `limparUnidade()` e apaga a seleção. Com código e
coordenada no mesmo município os dois caminhos concordam e o defeito fica escondido; com código
divergente, **o marcador fica inclicável**. A ITA-09 do banco de dev está exatamente nesse caso.
Arquivos em `mapa-manutencao-evidence/execucao-1-codigo-ibge-divergente/`: `01` e `02` iguais aos
da execução 2, e `03-clique-no-marcador-sem-painel-da-unidade.png` — card "Itabaiana / Nenhuma
unidade cadastrada neste município." no painel, a dica do marcador ("Em manutenção") aberta sobre o
mapa, e nenhum bloco "Unidade selecionada".

**Execução 2: código 2802908, coerente com a coordenada (18/18).** Screenshots, cada um
conferido visualmente:

1. **`01-marcador-em-manutencao.png`** — recorte de 180×180 px CSS centrado no marcador: disco
   azul-claro (`#7fadff`) com o anel de pulso na mesma cor, sobre o fundo neutro dos municípios.
2. **`02-mapa-inteiro.png`** — página inteira: marcador azul-claro em Itabaiana e vermelho em
   Lagarto; painel "Status geográfico" com `Indisponível 1` e `Em manutenção 1`; nenhum bloco
   "Unidades sem localização".
3. **`03-painel-equipamento-em-manutencao.png`** — depois do clique no marcador: bloco "Unidade
   selecionada — Unidade E2E Mapa Manutencao" com badge `Em manutenção`, KPIs `EQUIPAMENTOS 1`,
   `EM MANUTENÇÃO 1`, `INCIDENTES ABERTOS 0`, e em "Equipamentos afetados" a linha
   `EQ-192.0.2.11 · Switch E2E · 192.0.2.11` com badge `Em manutenção`. O marcador continua
   azul-claro, agora selecionado (`aria-pressed="true"`).

Observações sem ação (fora do que foi pedido):

- No tema claro, a bolinha "Em manutenção" da legenda é um azul mais escuro que o marcador: a
  legenda usa o token do tema, o marcador usa `COR_DO_STATUS` ("mesmos valores do tema escuro",
  diz o comentário). Não afeta a comparação do marcador.
- O rodapé da navegação mostra "Monitoramento ICMP ativo" com o motor desligado; não investigado.

### Teardown e banco de dev

Backend, mock e `ng serve` (4300) encerrados; `docker rm -f infra-e2e`; nenhum `java.exe`
restante; nenhuma porta 5435/8099/8080/4300 em LISTEN. A 4200 do usuário continuou de pé.

Ledger do banco de dev (5434), só `SELECT` — incidentes | medições | notificações | equipamentos |
janelas | episódios de latência | última migration:

```
antes  (13:40Z): 76 | 317080 | 10 | 222 | 224 | 2 | 18
depois (13:48Z): 76 | 317080 | 10 | 222 | 224 | 2 | 18
```

Idênticos.
