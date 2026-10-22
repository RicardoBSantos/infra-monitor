# Manutenção de equipamento — proposta de desenho

Proposta, não implementação. Nada aqui foi escrito em `src/`, nenhuma migration foi criada e o banco
não foi tocado. Todo caminho `arquivo:linha` citado foi conferido por leitura no branch
`fix/icmp-nativo-windows`.

Premissas de produto, já decididas e fora de discussão neste documento:

1. Equipamento em manutenção para de ser pingado e sai do cálculo de SLA.
2. Incidente `ABERTO` ou `RECONHECIDO` no momento da entrada em manutenção é encerrado com motivo
   "manutenção", **sem** notificação de encerramento para o Telegram.
3. O status continua `FECHADO`. Não nasce estado novo no ciclo de vida.

O estado de hoje, em uma frase: `equipamento.em_manutencao` existe desde a `V14`, é escrito por
`EquipamentoService.entrarEmManutencao` (`:112-117`) e `sairDeManutencao` (`:119-124`), e **não tem
nenhum outro efeito no sistema** além de vencer a precedência da projeção de status do painel
(`OperationalStatusResolver.java:38-39` e `DashboardReadRepository.java:34-35`). O motor continua
pingando, continua abrindo incidente, continua notificando o Telegram e a disponibilidade continua
contando a queda.

---

## B.1 — Motivo de encerramento

### O incidente já sabe COMO foi fechado?

Não. Sabe **por que abriu** e **quem fechou**, e isso não é a mesma pergunta.

O schema vigente de `incidente`, consolidado a partir de `V7`, `V16` e `V17`:

| coluna | origem | o que significa |
|---|---|---|
| `status VARCHAR(20)` | `V7:5` | `ABERTO`, `RECONHECIDO`, `FECHADO` (`ck_incidente_status`, recriada em `V16:18-20`) |
| `iniciado_em TIMESTAMPTZ NOT NULL` | `V7:6` | início, retroativo à primeira falha da sequência |
| `encerrado_em TIMESTAMPTZ` | `V7:7` | fim; `ck_incidente_ciclo_vida` (`V16:23-27`) amarra a `FECHADO` |
| `motivo VARCHAR(255)` | `V7:8` | **motivo de abertura**, gravado em `IncidenteService.java:72-73` |
| `observacao VARCHAR(1000)` | `V7:9` | texto livre; o fechamento automático o sobrescreve em `IncidenteService.java:92-93` |
| `reconhecido_em` / `reconhecido_por` | `V16:9-10` | trilha do reconhecimento humano |
| `fechado_por BIGINT` | `V17:7` | FK para `usuarios`; **nulo significa "fechamento automático"** |

`fechado_por` é o único sinal de "como" que existe, e é binário: humano ou motor. Ele não distingue
um terceiro caminho, e a `V17` diz isso explicitamente em `V17:15-20`, onde declara que fechar tem
exatamente dois caminhos. Manutenção é o terceiro. Sem coluna nova, um incidente encerrado por
manutenção ficaria indistinguível de um fechamento manual comum — e, se for fechado sem autor, de um
fechamento automático, que é pior ainda porque o relatório leria "o monitor se recuperou".

`ck_incidente_fechamento_coerente` (`V17:21-23`) é `fechado_por IS NULL OR status = 'FECHADO'`:
permite `fechado_por` preenchido em `FECHADO` e nada mais. Ela não atrapalha nada do que vem a
seguir.

### Rascunho da V19

A última migration aplicada é `V18__add_conexao_to_unidade.sql`; a próxima é a `V19`. O bloco abaixo
é rascunho **dentro deste documento** — nenhum arquivo foi criado em `db/migration`.

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

**Descartado: valor sentinela `INDETERMINADO` para o legado.** Ele entraria na CHECK para sempre e
todo consumidor teria de tratar um quarto caso que o código nunca escreve. `NULL` já é o valor que a
UI sabe renderizar (`'—'` em todo o drawer) e que diz a mesma coisa sem poluir o domínio. O custo
aceito é que a CHECK não consegue exigir `motivo_encerramento NOT NULL` em linhas `FECHADO` — uma
restrição temporal desse tipo não é expressável em CHECK —, então a garantia de que todo fechamento
novo traz motivo fica na aplicação, não no banco. Registrado como dívida.

**Descartado: reaproveitar `motivo`.** Ele é o motivo de **abertura** desde a `V7:8`, é lido como tal
em três telas (`incidente-detalhe-drawer.component.html:154`,
`equipamento-detalhe-drawer.component.html:237`, `incidentes-tab.component.html:28`) e é exportado no
CSV (`RelatorioExportService.java:112`). Sobrescrevê-lo no fechamento apagaria a razão da abertura.

**Descartado: reaproveitar `observacao`.** É exatamente o que o fechamento automático faz hoje
(`IncidenteService.java:92-93`), e é justamente por isso que o backfill abaixo depende de um
`LIKE` sobre texto de log. Texto livre não é chave de classificação; transformá-lo em uma
oficializaria o acidente.

### Como cada linha antiga é classificada, e com que certeza

| sinal | classificação | certeza |
|---|---|---|
| `status='FECHADO' AND fechado_por IS NOT NULL` | `FECHAMENTO_MANUAL` | **alta.** `fechado_por` só é escrito em `IncidenteService.java:141`, com o principal autenticado, e `ck_incidente_fechamento_coerente` impede que ele apareça em qualquer outro estado. |
| `fechado_por IS NULL` e `observacao` com o prefixo `Recuperacao detectada automaticamente apos ` | `RECUPERACAO_AUTOMATICA` | **alta.** O texto é literal e tem uma única origem: `IncidenteService.java:92-93`. Nenhum outro caminho escreve essa frase. |
| `fechado_por IS NULL` e sem o prefixo | **fica `NULL`** | **ambíguo, e assumidamente.** |

O terceiro caso é a parte honesta. Ele mistura pelo menos duas populações que a linha não separa:

- **Fechamentos manuais anteriores à `V17`.** A coluna `fechado_por` não existia; todo fechamento
  humano daquele período tem `NULL` ali, exatamente como os automáticos. Se o operador fechou sem
  preencher `observacao` — `IncidenteService.normalizar` (`:192-196`) transforma string vazia em
  `null` —, a linha é literalmente idêntica a um fechamento do motor cujo texto tivesse sido
  sobrescrito. Não há como desempatar.
- **Fechamentos manuais com observação própria**, de antes ou de depois da `V17` sem autor por algum
  caminho não previsto. Também indistinguíveis por regra.

Quantas linhas caem em cada faixa: **NÃO VERIFICADO** — exigiria consultar o banco, e o escopo desta
rodada proíbe tocá-lo. A consulta de diagnóstico, para quem for rodar a migration, é contar
`incidente` por `status`, por `fechado_por IS NULL` e pelo `LIKE` acima antes de aplicar a `V19`.

**Descartado: inferir o caso ambíguo por proximidade com uma medição de sucesso.** Reconstruir
"houve N sucessos consecutivos logo antes de `encerrado_em`" a partir de `medicao` classificaria
bem a maioria, mas grava um palpite em coluna que o relatório vai tratar como fato. Um `NULL`
honesto vale mais que uma classificação que ninguém pode auditar depois.

### E o episódio de latência?

A mesma pergunta, e a resposta é **sim, ele precisa da coluna — e já precisava antes desta mudança**.

`monitor_episodio_latencia` (`V15:7-24`) não tem `status` nem `motivo`: o ciclo de vida inteiro é
`encerrado_em IS NULL`. O único mutador é `MonitorEpisodioLatencia.encerrar(Instant)` (`:61-63`), que
só seta a data.

O achado que muda o desenho: **hoje já existem dois encerramentos semanticamente diferentes que a
linha não distingue**.

- `LatencyEpisodeProcessor.java:74-77` encerra o episódio **em silêncio** quando existe incidente
  aberto no mesmo monitor — "não normalizou, piorou", como diz o comentário em `:69-71`. Não gera
  `LATENCIA_NORMALIZADA`.
- `LatencyEpisodeProcessor.java:115-117` encerra por normalização de verdade e **gera**
  `LATENCIA_NORMALIZADA`.

As duas linhas resultantes são idênticas no banco. Manutenção seria a terceira, também silenciosa.
Daí os três valores propostos: `NORMALIZACAO`, `INCIDENTE`, `MANUTENCAO`.

**Backfill do episódio: nenhum, de propósito.** Ao contrário do incidente, aqui não sobra nem um
sinal fraco — não há `fechado_por`, não há `observacao`, e os dois caminhos gravam exatamente as
mesmas colunas. Dá para heurizar cruzando `encerrado_em` com `incidente` do mesmo monitor no mesmo
instante, e isso acertaria bastante; é a mesma objeção do parágrafo anterior e vale igual. Legado
fica `NULL`.

O status do incidente continua `FECHADO` em todos os casos, como manda a premissa 3.

---

## B.2 — Notificações

### Onde suprimir, exatamente

`NotificacaoService.criarParaIncidenteFechado` está definida em `NotificacaoService.java:42-45` e é
chamada em **exatamente dois lugares**:

- `IncidenteService.java:95` — dentro de `fecharAutomaticamente`, o caminho do motor;
- `IncidenteService.java:143` — dentro de `fechar`, o caminho humano.

A resposta correta para "é só o caminho automático ou os dois?" é **nenhum dos dois**. Os dois
existentes continuam chamando incondicionalmente — o motor que recuperou e o operador que fechou na
mão devem notificar, sempre. A supressão pertence a um **terceiro método**, que ainda não existe,
algo como `IncidenteService.fecharPorManutencao(...)`, que simplesmente não chama
`criarParaIncidenteFechado`.

Isso é uma decisão, não um detalhe. A alternativa — passar um `boolean notificar` para
`fecharAutomaticamente` ou para `fechar` — espalha a regra de manutenção por dois métodos que hoje
não sabem o que é manutenção, e torna possível chamar o caminho do motor com notificação desligada
por engano. **Descartado.**

Armadilha a registrar: a garantia "uma vez suprimida, nunca recriada" que
`uq_notificacao_incidente_canal_evento` (`V9:17`) somada ao `ON CONFLICT DO NOTHING`
(`NotificacaoRepository.java:40-53`) oferece vale para linhas **que existem**. Uma notificação que
nunca foi criada não ocupa o slot: se alguém chamar `criarParaIncidenteFechado` para aquele
incidente depois, a linha nasce normalmente. A supressão é "não chamar", e é revogável por descuido.

### A notificação PENDENTE que ainda não saiu

O caso: o incidente abriu há dois segundos, `criarParaIncidenteAberto` gravou um `INCIDENTE_ABERTO`
`PENDENTE`, o dispatcher ainda não o pegou (`NotificationDispatcher.java:48`, poll a cada
`notification.dispatcher.poll-delay-ms:1000`), e o equipamento entra em manutenção.

| opção | prós | contras |
|---|---|---|
| **A. Deixar sair** | Zero código, zero migration. A mensagem era verdadeira quando foi enfileirada. | O plantão recebe "incidente aberto" e **nunca** recebe o fechamento, porque a premissa 2 o suprime. Fica um incidente órfão no Telegram, que é exatamente o ruído que a manutenção existe para evitar. |
| **B. Marcar `FALHA`** | Reusa estado existente, sem migration. `StatusNotificacao` (`PENDENTE, ENVIANDO, ENVIADA, FALHA`) não muda, `ck_notificacao_status` (`V9:20`) não é recriada. | **Mente, e mente num lugar medido.** `FALHA` significa "tentamos e não deu"; `VisaoGeralPdfRepository.java:26-27` conta `notificacao` com `status='FALHA'` como KPI de saúde, exibido no PDF (`VisaoGeralPdfRenderer.java`, terceiro cartão de `kpis`). Toda manutenção degradaria um indicador operacional. |
| **C. Estado `CANCELADA`** | Honesto e auditável: a linha continua existindo e diz por que não saiu. Raio de alcance pequeno — o dispatcher filtra `status = PENDENTE` (`NotificacaoRepository.java:70-76`), `releaseStaleSending` (`:83-86`) só mexe em `ENVIANDO`, o KPI só conta `FALHA`. Nada precisa aprender o valor novo para continuar correto. | Custo real: a `V19` passa a recriar `ck_notificacao_status`, no mesmo idioma de `V15:48-52` e `V16:17-20` ("CHECK não se estende"); `StatusNotificacao` ganha um valor; o badge do front precisa de rótulo e cor (`incidente-unificado-list.component.html:61-67` já renderiza status de notificação). |
| **D. Deletar a linha** | Mais simples de escrever. | Apaga a trilha de auditoria de um evento que aconteceu. E é contraproducente: deletar **libera** o slot de `uq_notificacao_incidente_canal_evento`, então um reprocessamento posterior pode recriar a mesma notificação, que é o oposto do objetivo. |

**Recomendação: C.** A `V19` recria `ck_notificacao_status` com `CANCELADA`, e a entrada em manutenção
executa um UPDATE condicional:

```sql
UPDATE notificacao
   SET status = 'CANCELADA', updated_at = :agora
 WHERE incidente_id = :incidenteId
   AND status = 'PENDENTE'
```

O `WHERE status = 'PENDENTE'` é a mesma guarda compare-e-troca de
`NotificacaoRepository.reserveForDispatch` (`:78-81`), e resolve a corrida sem lock: as duas
instruções disputam a mesma linha e o Postgres serializa.

- Se o cancelamento chega primeiro, `reserveForDispatch` encontra `CANCELADA`, atualiza 0 linhas e o
  dispatcher desiste. É o caminho feliz.
- Se `reserveForDispatch` chega primeiro, a linha já é `ENVIANDO`, o cancelamento atualiza 0 linhas e
  **a mensagem sai**. Aceito e deliberado: a chamada ao Telegram pode já estar em voo, e marcar
  `CANCELADA` em cima de algo que foi enviado seria uma mentira pior que a mensagem extra.
  `releaseStaleSending` devolve a linha para `PENDENTE` só se o envio travar, e aí ela sai mesmo.

Regra derivada, curta: **nunca cancelar `ENVIANDO`, `ENVIADA` ou `FALHA`. Só `PENDENTE`.**

O escopo do UPDATE deve ser por incidente, não por tipo de evento: na prática só existirá um
`INCIDENTE_ABERTO` pendente, mas escrever `AND tipo_evento = 'INCIDENTE_ABERTO'` acopla a regra a
uma enumeração que a `V15:49-52` já mostrou que cresce.

---

## B.3 — Contadores

### Onde ficam guardados

Em lugar nenhum. **Não existe contador**, nem em memória nem em coluna.

`IncidentProcessor` deriva tudo de consulta a cada medição: `ultimasMedicoes` (`:86-88`) busca as
últimas N linhas de `medicao` em `DESC`, e `sequenciaCompleta` (`:90-92`) exige que sejam exatamente
N e que todas tenham o mesmo status. N vem de `Monitor.getFalhasParaIncidente()` (`Monitor.java:91`)
ou `getSucessosParaRecovery()` (`:93`), colunas criadas pela `V8` com CHECK `BETWEEN 1 AND 100`.
`LatencyEpisodeProcessor` diz o mesmo de si em `:30-31`. `MonitorExecutionCoordinator.runningMonitors`
(`:34`) é o único estado em memória e serve só para não submeter o mesmo monitor duas vezes; some no
restart e não tem nada a ver com sequências.

**Consequência:** não há o que zerar. O estado do motor é uma função pura de duas coisas — a cauda
recente de `medicao` e a existência de um incidente em aberto. "Zerar contador" aqui só pode
significar uma de duas coisas: **fazer a cauda deixar de qualificar**, ou **ensinar o processor a
ignorar a cauda antiga**.

### Entrar em manutenção

Dois efeitos, nessa ordem:

1. **Parar de produzir medição.** `MonitorRepository.findActiveExecutionCandidates()` (`:29-38`)
   filtra apenas `m.ativo = true and e.ativo = true` (`:35`). Acrescentar `and e.em_manutencao = false`
   é a mudança de uma linha que cumpre a premissa 1 e congela a cauda onde ela estiver.
2. **Fechar o incidente em aberto** com `motivo_encerramento = 'MANUTENCAO'`, sem notificação.

Depois disso não há mais nada acontecendo: sem medição nova, o `IncidentProcessor` nunca roda para
aquele monitor, porque só é chamado a partir de `MedicaoService.criar` (`:52`).

### Sair da manutenção — o problema real

Aqui está o risco, e ele é assimétrico: **um dos dois lados já está protegido e o outro não**.

**Sequência antiga de sucessos não fecha indevidamente — já hoje.** `processarRecovery`
(`IncidentProcessor.java:74-84`) exige, além da sequência completa, que nenhuma das N medições seja
anterior a `incidente.getIniciadoEm()` (`:78`). Um incidente aberto depois da saída da manutenção
começa depois de toda medição pré-manutenção, então a guarda rejeita a cauda velha sozinha. Nada a
fazer.

**Sequência antiga de falhas abre incidente indevidamente — não há guarda.** `processarAbertura`
(`:57-72`) só olha as N últimas linhas e o status delas. Com `falhasParaIncidente = 3` e um
equipamento que entrou em manutenção durante uma queda, a cauda congelada é `[FALHA, FALHA, FALHA]`.
Na saída, **a primeira medição nova que falhar** — e ela pode falhar por um motivo trivial, como o
equipamento ainda subindo — produz a cauda `[FALHA(nova), FALHA(velha), FALHA(velha)]`, sequência
completa, incidente aberto, Telegram disparado. O incidente é aberto retroativamente com
`iniciadoEm` da última posição da lista (`:66-67`), isto é, **com data de antes da manutenção**.

Proposta: dar a `processarAbertura` a guarda simétrica à de `:78`, ancorada na janela de
monitoramento.

```java
// espelho de processarRecovery: medicao anterior ao inicio da observacao atual
// nao sustenta abertura. Sem isto a cauda congelada pela manutencao abre um
// incidente com iniciadoEm de antes dela.
if (medicoes.stream().anyMatch(m -> m.getExecutadoEm().isBefore(janelaAberta.getInicioEm()))) return;
```

Por que a janela e não uma coluna nova: a `janela_monitoramento` (`V13`) **já é** a resposta canônica
do projeto para "desde quando este monitor está sendo observado", já tem índice de unicidade da
janela aberta (`uq_janela_monitoramento_aberta`, `V13:10`), já é a base do cálculo de disponibilidade
(`DisponibilidadeSqlRepository.java:57-61`) e, pela B.5, a saída da manutenção passa a abrir uma
janela nova de qualquer jeito. A guarda sai de graça e mantém uma única definição de "agora conta".

**Descartado: coluna `equipamento.manutencao_saiu_em`.** Seria uma segunda fonte para o mesmo fato,
que diverge da janela na primeira vez que alguém desativar e reativar o monitor por outro motivo.

**Descartado: apagar as medições do período.** `MedicaoService.java:54` já afirma a regra do projeto
— "a medição é o dado primário: uma falha de interpretação não a invalida". Apagar dado bruto para
consertar interpretação inverte isso.

**Descartado: contador em memória zerado na transição.** Não sobrevive a restart, não sobrevive a
segunda instância, e criaria o primeiro estado de negócio fora do banco em todo o motor.

---

## B.4 — Corrida com medição em andamento

### O caminho, de ponta a ponta

```
MonitoringScheduler.scheduleMonitors()                MonitoringScheduler.java:13-14
  @Scheduled(fixedDelayString = "${monitoring.engine.scheduler-delay-ms:1000}")
└─ MonitorExecutionCoordinator.scheduleDueMonitors()  MonitorExecutionCoordinator.java:46-60
   ├─ monitorRepository.findActiveExecutionCandidates()   :48  → MonitorRepository.java:29-38
   │     filtra so m.ativo e e.ativo (:35). em_manutencao NAO entra.
   └─ submit(candidate)                                :66-75  guarda runningMonitors, so anti-duplicata
      └─ execute(candidate)                            :77-88  em worker de pool
         └─ MedicaoService.criar(...)                  :81     → MedicaoService.java:43-63
            @Transactional(propagation = NOT_SUPPORTED)        :43  — sem transacao envolvente
            ├─ medicaoRepository.save(medicao)                 :50  — a medicao grava aqui
            ├─ incidentProcessor.process(persistida)           :52  REQUIRES_NEW (IncidentProcessor.java:38)
            │     guarda de medicao atrasada                   IncidentProcessor.java:41-45
            │     └─ processarAbertura → IncidenteService.abrirAutomaticamente  :66-67 → :71-81
            │            saveAndFlush + criarParaIncidenteAberto (:75-76)
            └─ latencyEpisodeProcessor.process(persistida)     :58  REQUIRES_NEW
            ambos envolvidos em try/catch RuntimeException     :51-61
```

A janela de corrida tem duas bordas. A primeira é entre `:48` do coordinator e `:81`: os candidatos
foram lidos, o ping demora até `timeoutMs`, e nesse intervalo o operador clica em "entrar em
manutenção". A segunda, menor e mais perigosa, é dentro de `MedicaoService.criar`: como ele é
`NOT_SUPPORTED`, o `save` da medição e o `REQUIRES_NEW` do processor são **transações separadas**, e
o fechamento por manutenção pode acontecer entre as duas — ou pior, entre a leitura de
`findFirstByMonitorIdAndStatusInOrderByIniciadoEmDescIdDesc` (`IncidentProcessor.java:48-49`) e o
`saveAndFlush` da abertura.

`runningMonitors` (`MonitorExecutionCoordinator.java:34,67,86`) não ajuda: ele impede submissão
duplicada do mesmo monitor, não sabe o que é manutenção e some no restart.

### Guardas propostas

Nenhuma delas lê-depois-escreve. Todas são `WHERE` condicional, no idioma que o projeto já usa duas
vezes: `IncidenteRepository.reconhecerSeAberto` (`:56-60`) e `NotificacaoRepository.reserveForDispatch`
(`:78-81`).

**1. O próprio flag.** `entrarEmManutencao` (`EquipamentoService.java:112-117`) hoje é
`obterEquipamento` + setter: dois operadores clicando juntos rodariam os efeitos colaterais duas
vezes. Vira:

```sql
UPDATE equipamento SET em_manutencao = true, updated_at = :agora
 WHERE id = :id AND em_manutencao = false
```

Retorno 0 = já estava em manutenção; a operação é idempotente e os efeitos colaterais (fechar
incidente, fechar janela, cancelar notificação) só rodam para quem ganhou.

**2. O fechamento do incidente**, CAS contra os dois estados em aberto, espelhando `reconhecerSeAberto`:

```java
@Modifying(clearAutomatically = true, flushAutomatically = true)
@Query("update Incidente i set i.status = ...FECHADO, i.encerradoEm = :agora, "
     + "i.motivoEncerramento = ...MANUTENCAO, i.fechadoPor = :usuario, i.updatedAt = :agora "
     + "where i.monitor.equipamento.id = :equipamentoId and i.status in (...EM_ABERTO)")
int fecharPorManutencao(Long equipamentoId, Usuario usuario, Instant agora);
```

Fecha todos os monitores do equipamento numa instrução, devolve quantos fechou, e a releitura para a
resposta segue o mesmo padrão já documentado em `IncidenteService.java:163-164` (bulk update não
atualiza a instância carregada).

**3. A abertura do incidente**, que é onde a corrida realmente morde. `abrirAutomaticamente`
(`IncidenteService.java:71-81`) hoje faz `saveAndFlush` incondicional. Vira um `INSERT ... SELECT`
condicional, no idioma nativo de `NotificacaoRepository.inserirPendenteSeAusente` (`:40-53`):

```sql
INSERT INTO incidente (monitor_id, status, iniciado_em, motivo, created_at, updated_at)
SELECT m.id, 'ABERTO', :iniciadoEm, :motivo, :agora, :agora
  FROM monitor m JOIN equipamento e ON e.id = m.equipamento_id
 WHERE m.id = :monitorId AND m.ativo AND e.ativo AND e.em_manutencao = false
ON CONFLICT DO NOTHING
```

Retorno 0 significa "a manutenção ganhou a corrida, ou já havia incidente aberto"; nos dois casos
**não se cria notificação** — e esse é o ponto crítico, porque hoje `criarParaIncidenteAberto` é
chamado logo depois do save (`:76`) sem olhar se algo foi inserido. O `ON CONFLICT DO NOTHING`
absorve o índice parcial `uq_incidente_monitor_aberto` de brinde, eliminando o
`catch (DataIntegrityViolationException)` de `:78-80` que existe só para traduzir a violação.

Com essa guarda, a ordem correta da entrada em manutenção é **flag primeiro, fechamento depois**:
qualquer processor que estiver a caminho encontra `em_manutencao = true` e não abre nada; qualquer um
que tenha aberto antes do flag é fechado pelo passo 2.

Fica anotado que `fecharAutomaticamente` (`IncidenteService.java:84-97`) continua sendo
read-modify-write puro, sem guarda no banco, e é a última das três escritas de ciclo de vida sem CAS.
Não é regressão desta mudança, mas passa a ter vizinhas que fazem certo.

### A medição atrasada: gravada ou descartada?

**Recomendação: gravada. Descarta-se a interpretação, nunca o dado.**

| | prós | contras |
|---|---|---|
| **Gravar** | É a regra já escrita do projeto: `MedicaoService.java:54` — "a medição é o dado primário: uma falha de interpretação não a invalida". O ping aconteceu; a linha é um fato. `IncidentProcessor.java:41-45` já resolve medição atrasada exatamente assim — ignora a interpretação e mantém a linha. A exclusão do SLA não depende de apagar nada: fechada a janela (B.5), `DisponibilidadeSqlRepository` só soma tempo dentro de `janelas_unidas` (`:57-61`), então a medição do período simplesmente não entra na conta. O relatório de latência (`RelatorioService.java:79`) e o contador "Amostras na janela" do drawer (`incidente-detalhe-drawer.component.html:173-178`) continuam íntegros. | Quem olhar `medicao` cru vê falhas dentro de um período que não conta para nada. Mitigado por `janela_monitoramento`, que é justamente o registro de quando a leitura valia. |
| **Descartar** | Nenhum resíduo confuso na tabela. | Destrói evidência de diagnóstico — a medição do início da manutenção costuma ser a mais interessante. Cria um buraco silencioso em séries temporais. E abre a pergunta insolúvel de "descartar onde": no coordinator, antes do save, exigiria uma leitura extra de `em_manutencao` por ciclo; depois do save, seria DELETE. |

Concretamente: `MedicaoService.criar` continua igual; a guarda de manutenção entra em
`IncidentProcessor.processarAbertura` e no INSERT condicional acima, não no caminho da medição.

---

## B.5 — Janela de monitoramento

### Como está hoje

`CicloJanelaMonitoramentoService` (`relatorio/service/`) tem três métodos: `abrir(Monitor)` (`:13`,
idempotente — só abre se `repo.aberta(...)` estiver vazio), `fechar(Monitor)` (`:14`) e
`fecharEquipamento(Long)` (`:15`). Abrem janela: `MonitorService.criar` (`:55`), `MonitorService.ativar`
(`:103`) e `EquipamentoService.ativar` (`:108`, em lote sobre os monitores ativos, inline). Fecham:
`MonitorService.desativar` (`:111`) e `EquipamentoService.desativar` (`:130`). `excluir` de monitor
(`MonitorService.java:115-125`) e de equipamento (`EquipamentoService.java:134-141`) não tocam em
janela. **Manutenção não abre nem fecha janela nenhuma.** Não existe `abrirEquipamento`: o simétrico
de `fecharEquipamento` está espalhado inline em `EquipamentoService.java:108`.

### Matriz de estados — todas as 8 combinações

Invariante proposto, e ele é a coisa mais importante desta seção:

> **Existe janela aberta para um monitor se e somente se aquele monitor é candidato à execução.**

Ou seja, o predicado da janela e o `WHERE` de `MonitorRepository.findActiveExecutionCandidates()`
(`:35`) passam a ser a mesma expressão: `equipamento.ativo AND monitor.ativo AND NOT
equipamento.em_manutencao`. Se divergirem, ou se mede tempo em que não se pinga (SLA punindo o
equipamento por silêncio administrativo), ou se pinga tempo que não se mede (queda invisível).

| # | `equipamento.ativo` | `monitor.ativo` | `em_manutencao` | janela aberta? | por quê |
|---|---|---|---|---|---|
| 1 | true | true | false | **SIM** | único caso observado |
| 2 | true | true | **true** | NÃO | premissa 1: não se pinga, não se mede |
| 3 | true | false | false | NÃO | monitor desativado não observa |
| 4 | true | false | true | NÃO | duas razões independentes |
| 5 | false | true | false | NÃO | equipamento desativado |
| 6 | false | true | true | NÃO | duas razões |
| 7 | false | false | false | NÃO | — |
| 8 | false | false | true | NÃO | três razões |

As linhas 4, 6 e 8 são alcançáveis hoje: `entrarEmManutencao` (`:112-117`) não verifica `ativo`. Não
é incoerente — o flag é ortogonal —, mas significa que a saída da manutenção **não pode** abrir
janela sozinha: ela precisa reavaliar o predicado inteiro. Ver a tabela de transições.

### Matriz de transições

Ação por ação, a partir de qualquer estado. "Reavalia" significa aplicar o predicado do invariante,
não presumir o resultado.

| ação | janela | hoje | proposto |
|---|---|---|---|
| **ativar equipamento** (`EquipamentoService.java:98-110`) | abre para cada monitor ativo, **somente se `em_manutencao = false`** | abre **incondicionalmente** (`:108`) | **corrigir.** Ativar um equipamento que está em manutenção abre janela hoje e não pode. |
| **desativar equipamento** (`:126-132`) | fecha todas as abertas do equipamento | `fecharEquipamento(id)` (`:130`) | já correto |
| **ativar monitor** (`MonitorService.java:95-105`) | abre **somente se** equipamento ativo **e não em manutenção** | abre sempre (`:103`); o equipamento ativo já é validado em `:98-100`, a manutenção não | **corrigir.** Ativar um monitor de equipamento em manutenção abre janela hoje e não pode. |
| **desativar monitor** (`:107-113`) | fecha a janela daquele monitor | `fechar(monitor)` (`:111`) | já correto |
| **criar monitor** (`MonitorService.java:47-57`) | abre se ativo **e** equipamento não em manutenção | abre se ativo (`:55`) | **corrigir**, mesma razão |
| **entrar em manutenção** (`EquipamentoService.java:112-117`) | **fecha** todas as abertas do equipamento | não faz nada | **criar.** `cicloJanela.fecharEquipamento(id)` |
| **sair da manutenção** (`:119-124`) | **abre** para cada monitor ativo, se o equipamento estiver ativo | não faz nada | **criar.** `cicloJanela.abrirEquipamento(id)` |
| **excluir monitor / equipamento** | — | não tocam em janela (`MonitorService.java:115-125`, `EquipamentoService.java:134-141`) | fora de escopo; ver dívidas |

Explícito, porque é onde a regra é contraintuitiva:

> **Ativar um monitor, ou ativar um equipamento, que está em manutenção NÃO pode abrir janela.**
> A ativação é uma decisão administrativa sobre o cadastro; a manutenção é uma decisão operacional
> sobre a observação. A segunda vence enquanto durar. A janela só nasce quando o equipamento sai da
> manutenção — e aí a saída reavalia `ativo` do equipamento e de cada monitor.

### Métodos que mudam

- **`CicloJanelaMonitoramentoService.abrirEquipamento(Long)`** — **novo**, irmão simétrico de
  `fecharEquipamento` (`:15`). Recebe o id, busca os monitores ativos do equipamento, aplica o
  predicado e chama `abrir` para cada um. Absorve a lógica inline de `EquipamentoService.java:108`,
  que hoje duplica a consulta `findByEquipamentoIdIn(...).filter(Monitor::isAtivo)` dentro do service
  de equipamento. Passa a ter dois chamadores: `ativar` e `sairDeManutencao`.
- **`CicloJanelaMonitoramentoService.abrir(Monitor)`** (`:13`) — ganha a guarda de manutenção
  (`m.getEquipamento().isEmManutencao()` recusa). Colocar a regra aqui, e não nos chamadores, é
  deliberado: `abrir` tem hoje três pontos de entrada (`MonitorService:55`, `MonitorService:103`,
  `EquipamentoService:108`) e repetir a condição em três lugares é garantir que um dia sobre um sem
  ela. A idempotência de `:13` (`if repo.aberta(...).isEmpty()`) e o índice
  `uq_janela_monitoramento_aberta` (`V13:10`) continuam sendo a rede de segurança.
- **`EquipamentoService.entrarEmManutencao`** (`:112-117`) — UPDATE condicional (B.4) + fechar janela
  + fechar incidentes + cancelar notificações pendentes.
- **`EquipamentoService.sairDeManutencao`** (`:119-124`) — UPDATE condicional + `abrirEquipamento`.
- **`EquipamentoService.ativar`** (`:98-110`) — troca o bloco inline de `:108` pela chamada a
  `abrirEquipamento`.
- **`MonitorService.criar`** (`:55`) e **`MonitorService.ativar`** (`:103`) — nada muda no chamador se
  a guarda ficar dentro de `abrir`; é exatamente o argumento para pô-la lá.
- **`MonitorRepository.findActiveExecutionCandidates`** (`:35`) — `and e.em_manutencao = false`.

---

## B.6 — Relatórios

Princípio único que atravessa a seção: **o incidente encerrado por manutenção aconteceu de verdade**.
O que a manutenção retira do cálculo é o *período de manutenção*, não a queda que a antecedeu. Quem
exclui o período é a `janela_monitoramento` (B.5), e ela já faz isso sozinha.

| métrica | onde | efeito | tratamento proposto |
|---|---|---|---|
| **Incidentes abertos (KPI)** | `VisaoGeralPdfRepository.java:20-28`, especificamente `:22-23` | filtra `status in ('ABERTO','RECONHECIDO')`; o incidente fechado por manutenção sai da contagem no instante do fechamento | **nada a fazer.** Correto por construção, e é o comportamento desejado: manutenção limpa o painel. |
| **Contagem de incidentes por monitor / unidade** | CTE `quedas` (`DisponibilidadeSqlRepository.java:62-69`), CTE `incidentes` (`:76-78`), coluna `incidentes` em `:87` e `:103` | conta todo incidente que intersecta a janela; com a janela fechada na manutenção, `least(coalesce(i.encerrado_em,:fim), upper(faixa))` (`:65`) recorta o incidente no fim da janela | **nada a fazer,** e **descartado** filtrar por `motivo_encerramento <> 'MANUTENCAO'`: isso apagaria a indisponibilidade real ocorrida *antes* da manutenção, que é o dado mais relevante — foi ela que motivou a manutenção. |
| **Tempo indisponível / disponibilidade %** | `:73-75`, `:84-86` | recortado pela janela, como acima | nada a fazer |
| **Caminho em memória** | `DisponibilidadeTemporalCalculator.calcular` (`:9-17`), interseção de incidentes com janelas em `:15` | mesma lógica do SQL | nada a fazer; confirmar que os dois caminhos continuam concordando é teste, não mudança |
| **Duração recortada pelo período** | `RelatorioService.java:77` e `RelatorioExportService.java:34` (mesma expressão `extract(epoch from greatest(interval '0', least(...)-greatest(...)))`) | a duração passa a terminar no fechamento por manutenção em vez de seguir até `:fim` | correto; mas o leitor precisa saber **por que** aquela duração terminou. Daí a coluna na listagem. |
| **Listagem de incidentes (tela e API)** | `RelatorioService.java:77` — a projeção traz `i.motivo, i.observacao` | não distingue o encerramento | **acrescentar `i.motivo_encerramento`** à projeção e ao `HistoricoIncidenteResponse` |
| **CSV de incidentes** | `RelatorioExportService.java:31-43` (SQL), `:111-113` (cabeçalho em `:112`, mapper em `:113`) | exporta `motivo` e `observacao`; **não exporta `fechado_por`** | acrescentar `motivo_encerramento` ao cabeçalho e ao mapper. Decisão pendente: é mudança de contrato de arquivo já consumido por terceiros — ver dívidas. |
| **PDF Visão Geral** | `VisaoGeralPdfModel.java:23` (`Kpis`), `:25-26` (`Unidade`), `:28-29` (`Equipamento`); `VisaoGeralPdfRenderer.java` — cabeçalhos das tabelas (~`:61`), `unidadeRows` (~`:87`), `equipamentoRows` (~`:95`), cartões `kpi` (~`:168`) | a coluna "Incidentes" vem do mesmo `incidentes` da tabela acima | **nada a fazer.** Mesma justificativa: o PDF conta quedas reais. |
| **KPI "notificações com falha"** | `VisaoGeralPdfRepository.java:26-27` | conta `notificacao` com `status = 'FALHA'` | **nada a fazer se a opção C da B.2 for adotada**; degradaria se a opção B (marcar `FALHA`) fosse escolhida. É o argumento decisivo daquela seção. |
| **MTTR / tempo médio de resolução** | — | — | **não existe em lugar nenhum.** |

Sobre o MTTR, explicitamente, porque a pergunta foi feita: `grep -rin "mttr\|tempo_medio\|tempoMedio\|duracaoMedia"` sobre
`infra-monitor-backend/src` e `infra-monitor-frontend/src` retorna **zero ocorrências**. A única média
calculada no projeto é `avg(md.latencia_ms)`, em `RelatorioService.java:79`, `:81` e
`VisaoGeralPdfRepository.java:31`. Não há nada a corrigir hoje.

Fica a regra para quando existir, e ela é o motivo de a coluna da B.1 ser necessária: **MTTR tem de
excluir `motivo_encerramento = 'MANUTENCAO'`**. A duração de um incidente encerrado por manutenção é
arbitrária — é o tempo até alguém clicar num botão — e não diz absolutamente nada sobre a capacidade
da equipe de resolver falhas. Misturá-la na média a torna uma métrica de disciplina de cadastro, não
de operação. Sem a coluna, esse filtro seria impossível de escrever.

---

## B.7 — Telas

### Onde o motivo do encerramento aparece

- **Drawer de detalhe** — `incidente-detalhe-drawer.component.html`. O cartão "Dados" traz Motivo
  (`:154`) e Observação (`:155`); o cartão "Janela da ocorrência" traz Iniciado em (`:163`), Encerrado
  em (`:164-168`), Reconhecido em (`:170`) e Reconhecido por (`:171`). O lugar natural do motivo de
  encerramento é **logo depois de "Encerrado em"**, dentro do cartão da janela, porque é lá que a
  narrativa do fim do incidente já está. Dois campos, não um: **"Encerrado por"** e **"Motivo do
  encerramento"**.

  Detalhe relevante: `fechadoPorNome` **já existe** em `core/models/incidente.ts:5`, com comentário
  próprio dizendo que nulo significa fechamento automático, e **não é renderizado em nenhum
  template** — o `grep` por `fechadoPorNome` em todo o front retorna só a definição do modelo. Ou
  seja, a UI hoje não distingue fechamento humano de automático apesar de receber o dado do backend
  desde a `V17`. Renderizá-lo é dívida pré-existente que esta mudança torna urgente, porque com três
  caminhos de fechamento a ausência de autor deixa de ser informativa sozinha.

- **Lista unificada** — `incidente-unificado-list.component.html:45` já tem onze colunas (`SEV`,
  `INCIDENTE`, `UNIDADE`, `EQUIPAMENTO`, `EVENTO`, `INÍCIO`, `DURAÇÃO`, `NOTIFICADO`, `STATUS`,
  `RECONHECIDO POR`, `AÇÕES`). **Proposta: não criar décima segunda coluna.** O sinal cabe junto do
  badge de `STATUS` (`:71`) como marca discreta, ou como `title` da célula. Uma coluna nova custa
  largura numa tabela que já rola no laptop, para um dado que só interessa depois de o operador ter
  escolhido um incidente — e aí ele está no drawer.

- **Histórico do equipamento** — `equipamento-detalhe-drawer.component.html:237` renderiza
  `incidente.motivo ?? 'Indisponibilidade consolidada'`, que é o motivo de **abertura**. É aqui que
  o motivo de encerramento importa mais do que em qualquer outro lugar: quem olha o histórico de um
  equipamento vê uma sequência de incidentes e precisa saber quais foram resolvidos e quais foram
  apenas interrompidos por manutenção. Mesma observação para
  `unidades/detalhe/incidentes-tab.component.html:28`, que repete o padrão.

- **Timeline** — `features/incidentes/timeline/timeline.ts`. **Este é um defeito ativo, não um
  adorno.** Em `:141-153` a timeline monta o fim do incidente com o rótulo fixo "Incidente fechado" e
  o detalhe `"${limiares.sucessosParaRecovery} respostas consecutivas restabeleceram o monitor"`
  (`:149-151`). Para um fechamento por manutenção isso é **falso**: não houve sequência de
  recuperação. Os eventos de recuperação em si somem sozinhos — `eventosDeRecuperacao` (`:190-193`)
  depende de `sequenciaDeFechamento` (`:175-187`), que procura a medição cujo `executadoEm` é
  exatamente `encerradoEm` (`:179`) e devolve `[]` quando não acha; o fechamento por manutenção usa o
  instante do clique, não o de uma medição, então não acha. Mas a frase de `:149-151` continua sendo
  impressa. **Precisa de ramo por `motivoEncerramento`.**

### A legenda "fora da leitura ICMP" é verdadeira?

`features/dashboard/dashboard.component.html:27`:
`<article class="kpi kpi--warn"><span>EM MANUTENÇÃO</span>…<small>fora da leitura ICMP</small></article>`

**Hoje: meia verdade, e a metade falsa é a que importa.**

Verdadeiro no sentido de que o equipamento sai da *projeção de status* do painel: `em_manutencao`
vence a precedência tanto no SQL (`DashboardReadRepository.java:34-35` — `EM_MANUTENCAO` é testado
logo depois de `DESABILITADO` e antes de `INDISPONIVEL`) quanto no Java
(`OperationalStatusResolver.java:38-39`, com o comentário `:35` "Manutencao planejada suprime a
leitura operacional: o equipamento nao conta como indisponivel"). Ele não engorda o KPI OFFLINE.

Falso em tudo o mais. `MonitorRepository.findActiveExecutionCandidates()` (`:35`) não olha
`em_manutencao`: **o equipamento continua sendo pingado**, as medições continuam entrando,
`IncidentProcessor` continua abrindo incidente, `NotificacaoService.criarParaIncidenteAberto`
continua enfileirando Telegram, e `DisponibilidadeSqlRepository` continua descontando a queda do SLA
porque a janela permanece aberta. Um operador que leia a legenda literalmente entende que colocou o
equipamento fora do radar; ele apenas o escondeu de um cartão.

**Depois da mudança proposta, a legenda passa a ser literalmente verdadeira** — e é a melhor
descrição de uma linha do que esta proposta faz. Recomendação: manter o texto exatamente como está.

### O comentário do mapa continua fazendo sentido?

`features/mapa/mapa.component.ts:70-80`, sobre `equipamentosAfetados`:

> "DESABILITADO fica de fora de propósito — equipamento desligado por decisão administrativa não é
> ocorrência. EM_MANUTENCAO entra, porque a janela de manutenção termina e alguém precisa ver."

**Continua, e fica mais forte.** O argumento nunca foi sobre ping: é sobre visibilidade de algo
temporário que precisa voltar. Hoje ele convive com a esquisitice de um equipamento que aparece como
"a acompanhar" no mapa enquanto, por baixo, está gerando incidente e Telegram como qualquer outro.
Depois da mudança o mapa passa a ser **o lugar onde o equipamento em manutenção ainda é visível**,
porque todos os outros canais — ping, incidente, notificação, SLA — silenciam. A distinção entre
`DESABILITADO` (permanente, não é ocorrência) e `EM_MANUTENCAO` (temporário, alguém precisa voltar)
vira a única coisa que impede a manutenção de virar um buraco negro operacional. Manter.

---

## Dívidas e perguntas em aberto

**Quem é o `fechado_por` de um fechamento por manutenção?** A `V17:15-20` afirma que
`fechado_por IS NULL` significa "fechamento automático". A entrada em manutenção é acionada por um
humano, e `ck_incidente_fechamento_coerente` permite gravar o autor. Recomendação: **gravar** o
operador que colocou o equipamento em manutenção, preservando a trilha e mantendo a afirmação da
`V17` verdadeira. Mas isso exige que `entrarEmManutencao` passe a receber o principal autenticado, o
que hoje não acontece (`EquipamentoService.java:112-117` só recebe o id) — e o tipo certo do
principal é `UsuarioPrincipal`, detalhe que já custou tempo no projeto. Decisão de produto pendente.

**A CHECK não garante que todo `FECHADO` novo tenha motivo.** Consequência aceita da escolha de
deixar o legado em `NULL` (B.1). Se um dia o legado for reclassificado ou expurgado, vale recriar a
constraint como biconditional (`(status='FECHADO') = (motivo_encerramento IS NOT NULL)`).

**Contrato do CSV.** Acrescentar `motivo_encerramento` ao cabeçalho de
`RelatorioExportService.java:112` muda o arquivo que alguém pode estar consumindo em planilha. Não se
sabe se há consumidor externo — **NÃO VERIFICADO**, é pergunta de produto, não de código. A mesma
exportação também **não** traz `fechado_por`, lacuna anterior a esta proposta.

**`fecharAutomaticamente` sem CAS.** `IncidenteService.java:84-97` continua read-modify-write. Com
`reconhecerSeAberto` (`IncidenteRepository.java:56-60`), `reserveForDispatch`
(`NotificacaoRepository.java:78-81`) e as duas guardas propostas na B.4, passa a ser a única escrita
de ciclo de vida sem proteção no banco. Fora de escopo aqui; anotado.

*Resolvido depois deste documento: `fecharAutomaticamente` usa CAS (`fecharAutomaticamenteSeEmAberto`) — ver `riscos-execucao-correcoes.md`, seção 1a.*

**`excluir` não fecha janela.** `MonitorService.java:115-125` e `EquipamentoService.java:134-141`
apagam sem tocar em `janela_monitoramento`. Na prática a exclusão só passa quando não há medição,
incidente nem monitor, então a janela órfã seria de um monitor sem dado — inócua, mas viola o
invariante da B.5. Fora de escopo.

*Resolvido depois deste documento: excluir monitor apaga as janelas dele na mesma transação (`CicloJanelaMonitoramentoService.apagarDoMonitor`), e excluir equipamento só é possível com zero monitores, logo sem janela — ver `riscos-execucao-correcoes.md`, seção 1c, e `ExclusaoEJanelaPostgresIntegrationTest`. Apaga, não fecha: a FK é `RESTRICT`.*

**Manutenção em equipamento inativo.** Linhas 4, 6 e 8 da matriz da B.5 são alcançáveis porque
`entrarEmManutencao` não valida `ativo`. Nada quebra, e a saída da manutenção reavalia o predicado
inteiro justamente por isso. Resta a pergunta de produto: a UI deve permitir colocar em manutenção
algo que já está desativado?

**Manutenção é do equipamento, nunca do monitor.** `em_manutencao` vive em `equipamento` (`V14:2-3`).
Toda esta proposta assume que não existe manutenção de um monitor isolado. Se aparecer a demanda, o
predicado da B.5 e as guardas da B.4 mudam de granularidade.

**Backfill do episódio de latência fica todo `NULL`**, e com ele perde-se a distinção — que já existe
hoje no código — entre o encerramento silencioso por incidente (`LatencyEpisodeProcessor.java:74-77`)
e a normalização real (`:115-117`). Aceito, pelo argumento de não gravar palpite. Vale registrar que
essa ambiguidade **não** foi criada por esta mudança: ela existe desde a `V15`.

**Quantas linhas o backfill da `V19` classifica em cada faixa: NÃO VERIFICADO.** Exigiria consultar o
banco, proibido nesta rodada. Contar antes de aplicar.
