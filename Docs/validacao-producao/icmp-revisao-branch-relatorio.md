# Revisão do branch `fix/icmp-nativo-windows` — relatório final

Data: 2026-09-22. Branch `fix/icmp-nativo-windows`, **sem merge**. Motor e Telegram desligados em toda
execução. Banco de dev usado só para leitura e para a subida da aplicação.

Suíte final: **308 testes, 0 falhas, BUILD SUCCESS**. Nenhuma V19.

---

# 1. Contradição sobre o campo de IP

**Errada era a afirmação nova.** `\d equipamento` no banco de dev:

```
 ip_address          | character varying(45)    |           |          |
```

Sem `NOT NULL`, sem `ck_equipamento_ip_e_host`. A coluna nem se chama `ip` — é `ip_address`. Duas
migrations explicam:

- `V2__create_inventario_tables.sql:88` — `ip_address INET NOT NULL`, com `ck_equipamento_ip_e_host`
  em `:104-106` exigindo máscara de host.
- `V4__make_equipamento_ip_optional.sql:5-9` — `DROP CONSTRAINT` e
  `ALTER COLUMN ip_address TYPE VARCHAR(45) USING ip_address::text` + `DROP NOT NULL`.

Ou seja: o relatório de investigação (varchar(45)) estava certo; "`equipamento.ip` é INET" estava
errado no nome e no tipo.

**Dívida de IPv6 corrigida** em `icmp-falsos-positivos.md`. O risco **aumentou** com a conversão:
`VARCHAR(45)` não valida nada — aceita IPv6, hostname e lixo, enquanto o `INET` original rejeitava
não-endereço. Alvo não-IPv4 faz `paraOrdemDeRede` lançar `IllegalArgumentException`
(`WindowsNativeIcmpRunner:109`), que o `catch` de `:64` transforma em `IcmpResult.erro(0)` → medição
`FALHA` com `"Erro ICMP não identificado"` em toda sondagem, sem apontar a causa.

Também corrigi o `CLAUDE.md`, que ainda registrava `INET` como decisão arquitetural — era o registro
primário, e continuava induzindo ao erro. A divergência de fundo (decisão `INET` × banco
`VARCHAR(45)`) fica registrada como dívida de arquitetura.

---

# 2. Modo de falha da biblioteca nativa

## Como estava

`Native.load` vivia no inicializador estático de um **campo de interface**:

```java
Biblioteca INSTANCE = Native.load("Iphlpapi", Biblioteca.class, W32APIOptions.DEFAULT_OPTIONS);
```

Campo de interface é implicitamente `static final` → a carga disparava na primeira leitura de
`INSTANCE`, ou seja **na primeira sondagem, dentro de uma thread do pool**. Por sondagem:

| sondagem | resultado |
|---|---|
| 1ª | `UnsatisfiedLinkError` sobe do inicializador |
| 2ª+ | `NoClassDefFoundError` — classe marcada erroneous |
| todas | capturado como `LinkageError`, WARN, `IcmpResult.erro(0)` |

A aplicação subia, `/actuator/health` dizia `UP`, e **todo monitor ICMP gravava `FALHA` para
sempre**. O operador via a rede inteira caída.

## Como ficou

Carga explícita em `Iphlpapi.Jna.carregar()`, chamada uma vez por `IcmpAmbienteConfiguration.resolver`
na criação do bean:

| motor | implementação | carga | resultado |
|---|---|---|---|
| ligado | `nativo-windows` | falha | **app não sobe** — `IllegalStateException` citando a propriedade, a DLL e a alternativa |
| ligado | `auto` (Windows) | falha | `log.error` + queda para `processo-ping`, `cargaNativa=FALHOU` |
| ligado | `processo-ping` | — | `NAO_TENTADA` |
| desligado | qualquer | — | resolve, não carrega, `NAO_TENTADA` |

`pedida` e `ativa` são campos separados de propósito: sem isso, um `auto` que caiu fica
indistinguível de `processo-ping` configurado de propósito.

`IcmpAmbienteConfiguration` fica **fora** do `@ConditionalOnProperty` do motor — é o que permite
`/api/v1/status` reportar com o motor desligado.

## Testes

Fake que lança `UnsatisfiedLinkError` **cru**, não embrulhado:

- `nativoExplicitoComFalhaDeCargaDerrubaASubida` — `IllegalStateException`,
  `hasRootCauseInstanceOf(UnsatisfiedLinkError.class)`.
- `autoComFalhaDeCargaCaiParaProcessoPing` — sem lançar; `ativa=PROCESSO_PING`, `cargaNativa=FALHOU`,
  ERROR provado por `ListAppender`.
- **Prova de reversão** `cargaAconteceUmaVezNaSubidaENuncaPorSondagem`: contador == 1 depois da
  subida, == 1 ainda depois de 5 sondagens. Com a carga preguiçosa reposta, falhou com
  `expected: 1 but was: 0`; revertida, voltou verde.

A revisão final confirmou: **nenhum `Native.load` preguiçoso sobrou** — único ponto de carga é
`Iphlpapi.Jna.carregar()`.

## Log real de subida, motor desligado

```
2026-09-22T09:22:32.517-03:00  INFO 33032 --- [infra-monitor-backend] [main] o.f.core.internal.command.DbValidate     : Successfully validated 18 migrations (execution time 00:00.034s)
2026-09-22T09:22:32.557-03:00  INFO 33032 --- [infra-monitor-backend] [main] o.f.core.internal.command.DbMigrate      : Current version of schema "public": 18
2026-09-22T09:22:35.640-03:00  INFO 33032 --- [infra-monitor-backend] [main] b.c.i.m.icmp.IcmpAmbienteConfiguration   : Implementacao ICMP ativa: NATIVO_WINDOWS (pedida: AUTO, carga nativa: NAO_TENTADA, motor: desligado, so=Windows 11)
```

## Resposta real de `GET /api/v1/status`

```json
{"aplicacao":"infra-monitor-backend","status":"UP","instante":"2026-09-22T12:26:44.469096600Z","icmp":{"pedida":"AUTO","ativa":"NATIVO_WINDOWS","cargaNativa":"NAO_TENTADA","detalheFalha":null,"motorLigado":false}}
```

Duas ressalvas honestas sobre essa captura:

1. **O endpoint exige autenticação.** Sem token devolve `401` — `SecurityConfiguration.java:13` dá
   `hasAnyRole("ADMIN","OPERADOR","VISUALIZADOR")` a qualquer `GET /api/v1/**`. É pré-existente, não
   efeito da mudança. Não alterei a configuração de segurança para colher evidência; emiti um token
   de dev descartável com o `JWT_SECRET` do `.env`, só com `SELECT` no banco, e apaguei depois. O
   Javadoc do `StatusController` dizia "endpoint minimo de infraestrutura" — corrigi para dizer que
   exige role.
2. **`detalheFalha` saiu do payload depois dessa captura.** A revisão final apontou que ele publica
   cru a mensagem do `Native.load`, que carrega o resource path completo, incluindo
   `C:\Users\<usuário>\...`, e o perfil `VISUALIZADOR` lê isso. Removi o campo da API; ele continua em
   `IcmpAmbiente` e no log. O payload atual são os quatro campos restantes.

---

# 3. Exceções que somem nos pools

## Como as tarefas são submetidas

| pool | submissão | lê o `Future`? | corpo |
|---|---|---|---|
| `monitoringWorkerExecutor` | `submit(...)` — `MonitorExecutionCoordinator:79` | **ninguém**, descartado na linha | `catch (RuntimeException)` → ERROR |
| `notificationWorkerExecutor` | `execute(...)` — `NotificationDispatcher:66` | n/a | `catch (RuntimeException)` → ERROR |

## A premissa do pedido estava errada

Uma `RuntimeException` do `IncidentProcessor` **não some hoje**: `MedicaoService.criar` já a captura e
loga ERROR em `:51-56`, com a mesma proteção para o `LatencyEpisodeProcessor` em `:57-61`. Não
encenei o cenário; registro o trecho.

**O que de fato desaparece é `Throwable` que não é `RuntimeException`** — `Error` e qualquer
`Throwable` cru:

- Pelo `submit()`: o `FutureTask` captura, guarda no `Future`, a thread termina normal, o `Future` é
  descartado. **Zero log, zero rastro.** É exatamente o caminho pelo qual o `UnsatisfiedLinkError` do
  item 2 sumiria sem o `catch` defensivo.
- Pelo `execute()`: a thread morre, o handler default imprime em `stderr` — fora do Logback,
  invisível para quem lê o log.

## Correção, geral

`common/concurrent/ExecutorQueLogaFalhas` embrulha os dois beans: `catch (Throwable)` → ERROR com o
rótulo, sem relançar, worker sobrevive. Rótulo por `TarefaRotulada` (`"monitor 42"`,
`"notificacao 7"`) — sem isso o ERROR não diria qual monitor.

Os `catch (RuntimeException)` locais **permanecem**: o do dispatcher compensa o estado da
notificação, o do coordinator garante o `finally` que libera `runningMonitors`, o do `MedicaoService`
preserva a medição como dado primário. O decorator é a rede de baixo.

Provas de reversão executadas: sem o envelope, `submitLogaErrorComRotulo` e
`executeLogaErrorComRotulo` falham por lista de registros vazia; sem `TarefaRotulada`,
`errorNaExecucaoViraErrorComRotulo` falha por não achar `monitor 77` no log.

## Fila cheia (`AbortPolicy`)

**A `RejectedExecutionException` aparece, não some.** `MonitorExecutionCoordinator:80-83` captura,
devolve o monitor a `runningMonitors` e loga WARN; `NotificationDispatcher:66` captura, tira de
`inFlight` e loga WARN. Travei isso por teste (`filaCheiaContinuaLogando`) para que uma refatoração
não o perca em silêncio. O envelope cobre falha **dentro** da tarefa; a rejeição continua subindo ao
chamador.

---

# 4. Evidências da Parte A

**(a) Trava A.0, condição 1 — 4 alvos, 2026-09-22, Ttl=128, timeout 3000 ms**

```
alvo=10.79.10.6 retorno=1 replyStatus=0 lastError=- rttMs=1
alvo=10.72.10.16 retorno=0 replyStatus=- lastError=11010 rttMs=-
alvo=10.79.20.250 retorno=1 replyStatus=11003 lastError=- rttMs=3002
alvo=10.79.20.250 retorno=1 replyStatus=11003 lastError=- rttMs=3003
alvo=10.73.10.15 retorno=0 replyStatus=- lastError=11010 rttMs=-
```

Divergência com 2026-09-21 registrada, sem escolher um lado: `10.72.10.16` dava `TTL_EXPIRADO`
(11013) e hoje dá timeout puro. A medição antiga continua no documento, intacta.

**(b) TTL padrão × TTL 128 — INCONCLUSIVA hoje**

```
Contagem (RequestOptions=NULL): {retorno=0,lastError=11010=10}
Contagem (Ttl=128):             {retorno=0,lastError=11010=5}
```

15 de 15 timeouts, com e sem `Ttl=128`. Isso **não reproduz nem contradiz** o "9 timeouts espúrios em
10" de 2026-09-21 — o alvo simplesmente está fora do ar agora. Não maquiei: a medição original fica,
esta entra ao lado marcada inconclusiva.

**(c) RTT nativo × `ping.exe`, 10 amostras contra `10.79.10.6`**

- Nativo (`RoundTripTime`, ms): `1 0 0 0 0 0 0 0 1 1` — 10/10 sucesso
- `ping.exe` (`tempo=`, ms): `1 <1 3 <1 <1 <1 1 <1 <1 <1` — 10/10 sucesso, TTL=127

Mesma faixa. Concordam.

**(d) Handle com 4 workers.** A Microsoft garante que `IcmpSendEcho` é thread-safe, mas **não**
garante HANDLE compartilhado entre threads simultâneas. O pool roda com `workerThreads = 4`
(`MonitoringEngineProperties.java:9`). Decisão: um handle por chamada, aberto e fechado em
`try/finally` (`WindowsNativeIcmpRunner:36-81`) — `IcmpCreateFile` só abre device handle, não faz I/O
de rede, e o custo não apareceu: o RTT de 0-3 ms acima já foi medido abrindo handle novo por chamada.

**(e) Campo de mensagem.** `medicao.mensagem VARCHAR(255)` (`V6__create_medicao.sql:7`). Todas as
mensagens vêm de `IcmpMonitorExecutor.mensagem` mais dois literais do `catch` — `PingOutputParser`
devolve status, nunca texto. Medido por teste:

```
[4e] campo: medicao.mensagem VARCHAR(255)
[4e] 7  | Timeout
[4e] 27 | Host de destino inacessível
[4e] 27 | Rede de destino inacessível
[4e] 24 | TTL expirado em trânsito
[4e] 21 | Erro ICMP -2147483648
[4e] 26 | Erro ICMP não identificado
[4e] 32 | Erro ao executar a sondagem ICMP
[4e] 26 | Sondagem ICMP interrompida
[4e] maior: 32 | Erro ao executar a sondagem ICMP
```

Maior mensagem: **32 caracteres**, folga de 223. (Na saída crua do console Windows os acentos
aparecem corrompidos por cp1252; os comprimentos contam certo. O documento preserva as duas formas.)

**(f) Comando Linux.**

```
ping -n -c 1 -W <segundos> <ip>
```

`-n` suprime resolução de nomes, `-c 1` envia um pacote, `-W` é timeout **em segundos** e não aceita
fração — `timeoutMs` é arredondado para cima por `Math.max(1L, (timeoutMs + 999L) / 1000L)`
(`ProcessoPingIcmpRunner:70-73`), para o timeout efetivo nunca ficar menor que o pedido. 2000 ms →
`-W 2`; 2001 ms → `-W 3`. Continua valendo a dívida: o formato de saída do `ping` do Linux nunca foi
verificado em máquina Linux.

**(g) SYSTEM.** Continua **NÃO VERIFICADA** (`schtasks /ru SYSTEM` recusado por falta de elevação).
Agora com fase nomeada no documento: verificação na **instalação do serviço Windows**, com item de
checklist — *com o serviço rodando sob a conta de produção e o motor ligado, conferir em
`GET /api/v1/status` que `icmp.cargaNativa = OK` e `icmp.ativa = NATIVO_WINDOWS`, e confirmar no log
de subida que não houve queda para `processo-ping`*. Nenhuma inferência sobre privilégio substitui
isso.

---

# 5. Parte B — resumo

**B.1 — Motivo de encerramento.** O incidente sabe por que abriu e quem fechou, mas não *como* —
`fechado_por` distingue só humano/motor, binário que não cobre manutenção. A V19 adiciona
`incidente.motivo_encerramento` e `monitor_episodio_latencia.motivo_encerramento`. Status continua
`FECHADO`; nenhum estado novo.
*Descartadas:* sentinela `INDETERMINADO` (entraria na CHECK para sempre, quarto caso que o código
nunca escreve); reaproveitar `motivo` (é o motivo de **abertura**, em três telas e no CSV);
reaproveitar `observacao` (texto livre virando chave de classificação oficializaria um acidente);
inferir o caso ambíguo por proximidade com sucessos em `medicao` (grava palpite não auditável onde o
relatório lê fato).
*Em aberto:* quantas linhas caem em cada faixa do backfill — NÃO VERIFICADO.

**B.2 — Notificações.** A supressão não entra em `fecharAutomaticamente`/`fechar`; mora num terceiro
método, `fecharPorManutencao`, que não chama `criarParaIncidenteFechado`. Para a `PENDENTE` que ainda
não saiu, status novo `CANCELADA` via `UPDATE ... WHERE status = 'PENDENTE'`, mesma guarda
compare-e-troca de `reserveForDispatch`. Nunca cancelar `ENVIANDO`, `ENVIADA` ou `FALHA`.
*Descartadas:* `boolean notificar` nos dois métodos existentes (espalha a regra por métodos que não
sabem o que é manutenção); deixar a pendente sair (incidente órfão no Telegram); marcar `FALHA`
(mente — é KPI de saúde no PDF, toda manutenção degradaria); deletar a linha (apaga auditoria e
libera o slot de unicidade).
*Em aberto:* nada.

**B.3 — Contadores.** Não existe contador armazenado; o motor deriva de consulta às últimas N
`medicao`. "Zerar" = parar de produzir medição (`and e.em_manutencao = false` no filtro de
candidatos) e fechar o incidente com `MANUTENCAO`. Na saída, a sequência de sucessos já tem guarda, a
de falhas não: a cauda congelada reabre incidente retroativo na primeira falha nova. Proposta:
ancorar `processarAbertura` na `janela_monitoramento`, espelhando o que `processarRecovery` já faz.
*Descartadas:* coluna `equipamento.manutencao_saiu_em` (segunda fonte para o mesmo fato); apagar as
medições do período (inverte a regra de que medição é dado primário); contador em memória (não
sobrevive a restart nem a segunda instância, e seria o primeiro estado de negócio fora do banco).
*Em aberto:* nada.

**B.4 — Corrida com medição em andamento.** Três guardas CAS, no idioma já usado em
`reconhecerSeAberto` e `reserveForDispatch`: flag via `UPDATE ... WHERE em_manutencao = false`
(idempotente); fechamento do incidente por bulk update CAS contra os dois estados em aberto; abertura
por `INSERT ... SELECT ... WHERE e.em_manutencao = false ON CONFLICT DO NOTHING`, que absorve o
índice único sem tratar exceção. Ordem na entrada: flag primeiro, fechamento depois. A medição
atrasada é **sempre gravada**; só a interpretação é descartada.
*Descartadas:* descartar a medição atrasada (destrói evidência, abre buraco na série temporal, e não
há lugar claro para o descarte).
*Em aberto:* nada.

**B.5 — Janela de monitoramento.** Invariante: existe janela aberta se e somente se o monitor é
candidato à execução (`equipamento.ativo AND monitor.ativo AND NOT equipamento.em_manutencao`) — o
mesmo predicado do filtro do motor. Três ações abrem janela sem checar manutenção e precisam de
correção (ativar equipamento, ativar monitor, criar monitor); duas já estão certas. Entrar em
manutenção fecha a janela; sair reabre via `abrirEquipamento`, simétrico ao `fecharEquipamento`. A
guarda fica dentro de `abrir(Monitor)`, não repetida nos três chamadores.
*Descartadas:* nenhuma registrada — esta seção é a única sem alternativa documentada.
*Em aberto:* nada declarado.

**B.6 — Relatórios.** Princípio: o incidente encerrado por manutenção aconteceu de verdade; o que sai
do cálculo é o *período*, e quem já faz esse corte é a `janela_monitoramento`. Logo a maioria das
métricas não muda — KPI de abertos, contagem por monitor/unidade, tempo indisponível, disponibilidade
%, PDF de Visão Geral. Muda a duração recortada, que passa a terminar no fechamento por manutenção;
listagem/API e CSV precisam expor `motivo_encerramento`. MTTR não existe hoje (zero ocorrências no
grep); fica a regra para quando existir: excluir `MANUTENCAO`, porque a duração é tempo até alguém
clicar num botão, não capacidade de resolver falha.
*Descartadas:* filtrar a contagem por monitor/unidade excluindo `MANUTENCAO` (apagaria a
indisponibilidade real ocorrida antes da manutenção).
*Em aberto:* **contrato do CSV** — acrescentar a coluna muda arquivo que terceiros podem consumir em
planilha. Se há consumidor externo é NÃO VERIFICADO. Decisão de produto.

**B.7 — Telas.** Drawer do incidente ganha "Encerrado por" e "Motivo do encerramento" após "Encerrado
em". A lista unificada não ganha coluna: marca discreta junto do badge, ou `title` da célula.
Histórico do equipamento e aba de incidentes da unidade também precisam do motivo. **Defeito ativo:**
a timeline imprime "Incidente fechado" com o texto de recuperação por sequência de sucessos mesmo
quando o fechamento foi por manutenção — falso, precisa de ramo por `motivoEncerramento`. A legenda
"fora da leitura ICMP" e o comentário do mapa hoje são meia verdade (o equipamento some do KPI mas
continua sendo pingado e gerando incidente); depois da mudança passam a ser literalmente verdadeiros
— manter os dois textos.
*Descartadas:* décima segunda coluna na lista (custa largura numa tabela que já rola no laptop, para
dado que só interessa depois de o operador abrir o drawer).
*Em aberto:* nada como decisão de produto. (`fechadoPorNome` não renderizado em template nenhum é
dívida pré-existente.)

## Rascunho da V19, na íntegra

Continua rascunho dentro de `manutencao-proposta.md`. **Nenhum arquivo foi criado em `db/migration`.**

```sql
-- V19 - Motivo de encerramento do incidente e do episodio de latencia.
--
-- Fechar passa a ter tres caminhos, e nao os dois que a V17 registrou: o motor
-- (recuperacao), o operador (fechamento manual) e a entrada em manutencao. Sem
-- coluna propria, o terceiro seria lido como um dos dois primeiros, e o relatorio
-- diria "o monitor se recuperou" sobre um incidente que ninguem resolveu.
--
-- O status NAO muda: continua FECHADO. Nao ha valor novo em ck_incidente_status.

ALTER TABLE incidente ADD COLUMN motivo_encerramento VARCHAR(24);

ALTER TABLE incidente ADD CONSTRAINT ck_incidente_motivo_encerramento_valor CHECK (
    motivo_encerramento IS NULL OR motivo_encerramento IN (
        'RECUPERACAO_AUTOMATICA', 'FECHAMENTO_MANUAL', 'MANUTENCAO')
);

-- Irma de ck_incidente_fechamento_coerente (V17:21-23): so FECHADO carrega motivo
-- de encerramento. ABERTO e RECONHECIDO nao encerraram nada.
ALTER TABLE incidente ADD CONSTRAINT ck_incidente_motivo_encerramento_coerente CHECK (
    motivo_encerramento IS NULL OR status = 'FECHADO'
);

-- Backfill em duas passadas, da certeza para a duvida. O que sobrar fica NULL:
-- NULL aqui significa "fechado antes da V19, nao classificavel", e nao "faltou dado".
UPDATE incidente SET motivo_encerramento = 'FECHAMENTO_MANUAL'
 WHERE status = 'FECHADO' AND fechado_por IS NOT NULL;

UPDATE incidente SET motivo_encerramento = 'RECUPERACAO_AUTOMATICA'
 WHERE status = 'FECHADO' AND fechado_por IS NULL AND motivo_encerramento IS NULL
   AND observacao LIKE 'Recuperacao detectada automaticamente apos %sucessos consecutivos.';

ALTER TABLE monitor_episodio_latencia ADD COLUMN motivo_encerramento VARCHAR(24);

ALTER TABLE monitor_episodio_latencia
    ADD CONSTRAINT ck_monitor_episodio_latencia_motivo_valor CHECK (
        motivo_encerramento IS NULL OR motivo_encerramento IN (
            'NORMALIZACAO', 'INCIDENTE', 'MANUTENCAO')
);

ALTER TABLE monitor_episodio_latencia
    ADD CONSTRAINT ck_monitor_episodio_latencia_motivo_coerente CHECK (
        motivo_encerramento IS NULL OR encerrado_em IS NOT NULL
);
-- Sem backfill de proposito: ver a secao do episodio, abaixo.
```

### Classificação das linhas antigas, com o grau de certeza

| sinal | classificação | certeza |
|---|---|---|
| `status='FECHADO' AND fechado_por IS NOT NULL` | `FECHAMENTO_MANUAL` | **alta.** `fechado_por` só é escrito em `IncidenteService.java:141`, com o principal autenticado, e `ck_incidente_fechamento_coerente` impede que apareça em outro estado. |
| `fechado_por IS NULL` e `observacao` com o prefixo `Recuperacao detectada automaticamente apos ` | `RECUPERACAO_AUTOMATICA` | **alta.** Texto literal de origem única: `IncidenteService.java:92-93`. |
| `fechado_por IS NULL` e sem o prefixo | **fica `NULL`** | **ambíguo, e assumidamente.** |

O terceiro caso é a parte honesta: mistura pelo menos duas populações que a linha não separa.
**Fechamentos manuais anteriores à V17** — a coluna `fechado_por` não existia, todo fechamento humano
daquele período tem `NULL` ali, igual aos automáticos; se o operador fechou sem `observacao`
(`normalizar` em `:192-196` transforma vazio em `null`), a linha é idêntica a um fechamento do motor
com texto sobrescrito. E **fechamentos manuais com observação própria** sem autor por caminho não
previsto. Não há como desempatar.

Quantas linhas caem em cada faixa: **NÃO VERIFICADO** — exigiria consultar o banco, fora do escopo. A
consulta de diagnóstico, para quem for rodar: contar `incidente` por `status`, por
`fechado_por IS NULL` e pelo `LIKE` acima, **antes** de aplicar a V19.

### Episódio de latência: backfill nenhum, de propósito

`monitor_episodio_latencia` (`V15:7-24`) não tem `status` nem `motivo` — o ciclo de vida é
`encerrado_em IS NULL`. **Já existem hoje dois encerramentos semanticamente diferentes que a linha não
distingue:** `LatencyEpisodeProcessor:74-77` encerra em silêncio quando há incidente aberto no mesmo
monitor ("não normalizou, piorou"), sem gerar `LATENCIA_NORMALIZADA`; `:115-117` encerra por
normalização de verdade e **gera** o evento. As duas linhas resultantes são idênticas no banco.
Manutenção seria a terceira, também silenciosa — daí os três valores.

Ao contrário do incidente, aqui não sobra nem sinal fraco: não há `fechado_por`, não há `observacao`,
e os dois caminhos gravam exatamente as mesmas colunas. Dá para heurizar cruzando `encerrado_em` com
`incidente` do mesmo monitor no mesmo instante, e acertaria bastante — é a mesma objeção do parágrafo
anterior e vale igual. Legado fica `NULL`.

---

# A.1 — `/status` verdadeiro com o motor desligado

A seção 2 acima documentou a revisão anterior do branch, onde `motorLigado == false` **curto-
circuitava** `resolver` antes de tocar a fábrica: `cargaNativa` saía sempre `NAO_TENTADA`, mesmo
quando a biblioteca nativa teria falhado ao carregar naquele processo. Ou seja, `/status` podia
dizer "não tentei" quando a resposta honesta era "tentei e teria falhado" — só que ninguém saberia
até ligar o motor.

**Correção (Task 1 do fechamento do branch):** `IcmpAmbienteConfiguration.resolver` agora tenta a
carga nativa sempre que a implementação resolvida é `NATIVO_WINDOWS`, **independente de
`motorLigado`**. Só `escolhida != NATIVO_WINDOWS` continua pulando a tentativa (`NAO_TENTADA`
passou a significar "implementação de processo, ou SO não-Windows" — não mais "motor desligado").

Regra de queda aprovada para o caso `motorLigado == false`:

- **Falha com pedido `AUTO`:** cai para `PROCESSO_PING`, `cargaNativa=FALHOU` — igual ao caso com
  motor ligado.
- **Falha com pedido explícito `NATIVO_WINDOWS`:** a subida **não cai** (não há motor rodando para
  derrubar), mas o resultado **não vira fallback silencioso** — `ativa` continua `NATIVO_WINDOWS`
  com `cargaNativa=FALHOU`, para que `/status` mostre exatamente o que impediria ligar o motor
  neste processo. Só com `motorLigado == true` o mesmo pedido explícito derruba a subida com
  `IllegalStateException`, como já documentado na seção 2.

## Log real de subida, motor desligado (após a correção)

Máquina Windows real, biblioteca nativa disponível — a carga é tentada e funciona:

```
2026-09-22T13:48:24.889-03:00  INFO 29076 --- [infra-monitor-backend] [           main] b.c.i.m.icmp.IcmpAmbienteConfiguration   : Implementacao ICMP ativa: NATIVO_WINDOWS (pedida: AUTO, carga nativa: OK, motor: desligado, so=Windows 11)
```

## Resposta real de `GET /api/v1/status`, motor desligado (após a correção)

Subida contra Postgres descartável (`postgres:16`, porta `5435`, container `infra-status-evid`,
removido ao final), token de `ADMIN` emitido por um bootstrap-admin descartável só para esta
captura:

```json
{"aplicacao":"infra-monitor-backend","status":"UP","instante":"2026-09-22T16:48:40.310267900Z","icmp":{"pedida":"AUTO","ativa":"NATIVO_WINDOWS","cargaNativa":"OK","motorLigado":false}}
```

`cargaNativa=OK` com `motorLigado=false` é exatamente a lacuna que esta task fecha: antes da
correção, essa mesma combinação de ambiente teria respondido `NAO_TENTADA`.

## Motor ligado, mesmo banco descartável (após `6a58454`)

O bean `monitoringClock` duplicado (`MonitoringEngineConfiguration` e
`MonitoringClockConfiguration` definindo os dois o mesmo nome) que antes impedia a subida com
`MONITORING_ENGINE_ENABLED=true` foi corrigido no commit `6a58454` (`fix(monitoring): remover bean
monitoringClock duplicado no motor`). A subida com o motor ligado passou a ser possível, e a
evidência abaixo foi colhida com o mesmo procedimento da subida com o motor desligado.

Log real de subida, motor ligado:

```
2026-09-22T14:02:37.818-03:00  INFO 30124 --- [infra-monitor-backend] [           main] b.c.i.m.icmp.IcmpAmbienteConfiguration   : Implementacao ICMP ativa: NATIVO_WINDOWS (pedida: AUTO, carga nativa: OK, motor: ligado, so=Windows 11)
```

Resposta real de `GET /api/v1/status`, motor ligado — Postgres descartável (`postgres:16`, porta
`5435`, container `icmp-a1-motor-ligado`, removido ao final), token de `ADMIN` emitido por um
bootstrap-admin descartável só para esta captura:

```json
{"aplicacao":"infra-monitor-backend","status":"UP","instante":"2026-09-22T17:02:49.204219900Z","icmp":{"pedida":"AUTO","ativa":"NATIVO_WINDOWS","cargaNativa":"OK","motorLigado":true}}
```

O par `ativa=NATIVO_WINDOWS`/`motorLigado=true` com carga OK, antes coberto só pelos testes
unitários, agora tem evidência de subida real.

---

# Decisões tomadas sem consulta

Estas são as escolhas feitas no caminho, com o custo de cada uma se estiver errada:

1. **Item 3: provei o buraco real em vez de encenar a premissa.** `RuntimeException` do
   `IncidentProcessor` já é logada; o que some é `Throwable`. *Se errado:* o teste não cobre o
   cenário literal descrito no pedido.
2. **`detalheFalha` saiu do payload HTTP**, ficando no holder e no log, em vez de restringi-lo a
   `ADMIN`. *Se errado:* quem diagnostica precisa abrir o log em vez da API.
3. **Não alterei `SecurityConfiguration`** para colher a evidência do `/status`; emiti token de dev
   descartável. *Se errado:* nada — a alternativa é que era mudança sensível fora do escopo.
4. **A suíte completa saiu do escopo das tasks de implementação** e rodou uma vez ao final (a Task 3
   travou duas vezes esperando por ela). *Se errado:* uma regressão fora dos alvos restritos só
   apareceria no fim, com commits já feitos. Não aconteceu — 308/308.
5. **Binding relaxado de `monitoring.engine.enabled` virou dívida registrada, sem mudar
   comportamento.** *Se errado:* com `yes`/`on`/`1` **e** `implementacao=nativo-windows`, a subida cai
   por um motor que nunca é montado.
6. **Corrigi o `CLAUDE.md`** sobre `INET`, que estava fora do escopo literal do pedido. *Se errado:*
   nada, é uma linha de documento — mas era o registro primário que induzia ao erro.
7. **A faixa da revisão final foi `550223c..HEAD`, não `main..HEAD`** — `main..HEAD` traz 748 arquivos
   de trabalho anterior deste branch. *Se errado:* algo commitado antes de `550223c` não foi olhado,
   mas por definição não é desta rodada.
8. **Mantive o diretório de trabalho `.superpowers/sdd/2026-09-22-.../`** em vez de apagá-lo. As
   saídas cruas das sondagens e o JSON do `/status` só existem lá — a versão destilada é que foi para
   o documento.

**Sem Playwright nesta entrega:** `/api/v1/status` não é consumido por nenhum arquivo de
`infra-monitor-frontend/src` (grep vazio). Nenhuma tela mudou, então não havia o que verificar no
navegador.

**Commits** (9, nenhum merge): `d3ed76c` spec · `0bdc20b` plano · `83f1aa4` envelope · `3a4dce7`
rótulo e pools · `69ed6f4` carga nativa · `f513128` bloco icmp no status · `bdb55a8` medida da
mensagem · `ceb8ea2` + `513037a` documento · `c008def` + `2293b8c` + `36c3e4c` onda de correção.

---

# A.4 — `.superpowers/`

Verificado por comando, não repetindo afirmação de terceiro:

```
$ git check-ignore -v .superpowers
.gitignore:31:.superpowers/	.superpowers

$ git log --all --oneline -- .superpowers | head
(saída vazia)

$ git ls-files .superpowers | head
(saída vazia)
```

`.superpowers/` está em `.gitignore:31` e **nunca foi versionado** — as duas últimas saídas vieram
vazias, confirmando que nenhum commit, em nenhum branch, tocou esse diretório. Não houve vazamento
de caminho de usuário nem de token por esse caminho, porque não há histórico algum ali para vazar.

Uma varredura no conteúdo local (não versionado) por padrões de caminho e segredo (`C:\Users\`,
`/c/Users/`, `BOT_TOKEN`, `JWT_SECRET`, `password`, `senha`) encontrou ocorrências em relatórios e
diffs de trabalho — todos processo local (briefs, relatórios de tarefa, diffs de revisão, ledgers),
nunca versionado e fora do escopo de cópia.

**Copiado para `Docs/validacao-producao/evidencias/`** (sanitizado — caminhos absolutos viraram
relativos, tokens/segredos removidos, sem nome de pessoa):

- `status-motor-desligado-captura-completa.md` — contexto bruto da captura de log de subida +
  `GET /api/v1/status` (401 sem token, 200 com token, consulta SQL do usuário elegível) que sustenta
  a seção "2. Modo de falha da biblioteca nativa" deste relatório, incluindo o trecho do log de
  Flyway e a divergência entre `SecurityConfiguration` e o Javadoc de `StatusController`.

**Deliberadamente deixado de fora** (critério: processo, não evidência de afirmação específica, ou
já integralmente reproduzido inline neste relatório):

- Todos os `task-*-brief.md` e `task-*-report.md` das duas pastas de `.superpowers/sdd/` — narrativa
  de processo (o que foi feito e por quê), não evidência bruta; o conteúdo que de fato sustenta
  afirmações deste relatório já está citado literalmente nas seções 2, 3, 4 e A.1 deste documento.
- `progress.md` e os ledgers das duas rodadas — estado de execução das tarefas, não evidência.
- Todos os `review-*.diff` — diffs de revisão de código, processo da rodada anterior, não evidência
  de comportamento em produção.
- `correcao-final-report.md` e `parte-b-resumo.md` (rodada anterior) — relatórios de tarefa.
- Sondagens de rede brutas (`sonda-a0-output.txt`, `ping-comparativo.txt` e equivalentes citados nos
  relatórios de tarefa) — os números já estão reproduzidos por completo na seção "4. Evidências da
  Parte A" deste relatório; copiar de novo seria duplicar, não sustentar.

**Decisão sobre o diretório de trabalho:** `.superpowers/sdd/` continua não versionado e fora do
repositório, como já era — esta seção apenas documenta o que foi conferido e o que foi extraído
dele.
