# Fechamento do branch ICMP + manutenção de equipamento — desenho

Duas partes independentes, um desenho só porque a Parte B nasce a partir do branch que a Parte A
fecha. Regras invioláveis em todo o documento:

- o banco de dev (porta **5434**) fica **intocado**: nenhuma migration, nenhum INSERT, nenhum DELETE;
- o motor de monitoramento **nunca** liga contra o banco de dev;
- o Telegram real **nunca** é acionado; só um mock HTTP local.

---

# PARTE A — Fechamento de `fix/icmp-nativo-windows`

## A.1 — `/status` verdadeiro com o motor desligado

### O defeito

`IcmpAmbienteConfiguration.resolver` (`:41-44`) curto-circuita:

```java
if (escolhida != IcmpImplementacao.NATIVO_WINDOWS || !motorLigado) {
    return new IcmpAmbiente(pedida, escolhida, CargaNativa.NAO_TENTADA, null, motorLigado, null);
}
```

Com o motor desligado a carga nativa **nunca é tentada**, então `/api/v1/status` responde
`NAO_TENTADA` num processo que, se o motor fosse ligado, poderia falhar na subida. O diagnóstico só
aparece quando já é tarde.

### O desenho

A tentativa de carga passa a depender só do sistema operacional e da implementação resolvida, nunca
do motor. O motor decide o que acontece **depois da falha**, não se ela é descoberta.

| SO | `pedida` | motor | carga | `ativa` | subida |
|---|---|---|---|---|---|
| Windows | auto / nativo-windows | ligado | OK | `NATIVO_WINDOWS` | sobe |
| Windows | `auto` | ligado | FALHOU | `PROCESSO_PING` | sobe (log ERROR) — **inalterado** |
| Windows | `nativo-windows` | ligado | FALHOU | — | **estoura** `IllegalStateException` — **inalterado** |
| Windows | auto / nativo-windows | **desligado** | OK | `NATIVO_WINDOWS` | sobe — **novo** |
| Windows | `auto` | **desligado** | FALHOU | `PROCESSO_PING` | sobe (log ERROR) — **novo** |
| Windows | `nativo-windows` | **desligado** | FALHOU | `NATIVO_WINDOWS` | **sobe** (log ERROR) — **novo** |
| não-Windows | qualquer | qualquer | `NAO_TENTADA` | `PROCESSO_PING` | sobe — inalterado |

A última linha nova é a decisão aprovada: com o motor desligado, um pedido explícito de
`nativo-windows` que falha **não vira fallback silencioso**. `ativa` continua `NATIVO_WINDOWS` e
`cargaNativa=FALHOU` + `detalheFalha` dizem exatamente o que impediria ligar o motor. Cair para
`PROCESSO_PING` apagaria a diferença entre "pedi nativo e não deu" e "pedi processo-ping".

Invariante preservada: `IcmpRunnerConfiguration.criarRunner` continua exigindo `nativo() != null`
quando `ativa == NATIVO_WINDOWS`. Ela não regride porque o bean do runner vive sob o
`@ConditionalOnProperty` do motor — com motor desligado ele não é montado. O único ambiente novo
(`ativa=NATIVO_WINDOWS`, `nativo=null`, motor desligado) nunca chega lá. Isso já estava escrito no
comentário de `IcmpRunnerConfiguration:22-33` e continua verdade.

`CargaNativa.NAO_TENTADA` deixa de significar "motor desligado" e passa a significar apenas
"implementação de processo, ou SO não-Windows". O javadoc do enum muda junto.

### Prova de reversão

Teste que falha sem a mudança: `resolver(NATIVO_WINDOWS, windows=true, motorLigado=false, fabrica)`
com fábrica que sempre lança → hoje devolve `NAO_TENTADA`/sem detalhe e **não chama a fábrica**;
depois devolve `FALHOU` com `detalheFalha` preenchido e a fábrica é chamada exatamente uma vez.
Mais um teste com fábrica que conta invocações, para garantir "uma vez na subida, nunca por sondagem".

Evidência exigida: log real de subida e corpo real de `GET /api/v1/status` nos dois modos.

## A.2 — Capacidade numa queda em massa

Medição **antes** de propor. Nada do pool muda nesta parte.

Arnês, commitado como teste JUnit com `@Tag("bench")` e **excluído do `./mvnw test` padrão** via
configuração do Surefire (`<excludedGroups>bench</excludedGroups>`), executável por
`./mvnw test -Dgroups=bench`:

- `MonitorExecutionCoordinator` **real**, com `MonitorRepository` e `MedicaoService` falsos em
  memória (o falso de `MedicaoService` registra `ultimaMedicaoEm` para que `isDue` funcione como em
  produção);
- `MonitorExecutor` falso: sucesso responde em ~1 ms; falha **segura a thread pelo timeout inteiro**
  do monitor (2000 ms), que é o que o `IcmpSendEcho` faz de verdade;
- N = 250 monitores, intervalo 30 s, timeout 2000 ms; K ∈ {25, 100, 250} caem ao mesmo tempo;
- pool ∈ {4, 16, 32} workers, fila 100 — 9 células.

Métricas por célula: tempo até o **3º ciclo de falha de todos os K** (quando é possível abrir
incidente para todos), contagem de `RejectedExecutionException` e atraso p50/p95/máx dos monitores
saudáveis em relação ao intervalo nominal. Mais o custo por thread parada (stack + estado do
`IcmpSendEcho`), medido, não estimado.

Saída: tabela + proposta de `worker-threads`/`queue-capacity` justificada pelos números, e um
parecer sobre baixar o timeout padrão de monitor novo. **Proposta, não alteração.**

## A.3 — Topologia do git

"`main..HEAD` traz 749 arquivos" significa: 749 arquivos diferem entre a `main` e a ponta deste
branch. A `main` está parada antes de toda a reforma. Entregável: `git log --oneline --graph
--decorate -40`, `git branch -a`, inventário de qual trabalho (Mapa, Incidentes, Relatórios, Auth,
ICMP) está ou não na `main`, e **proposta** de estratégia de merge. **Não executar merge.**

## A.4 — `.superpowers/`

**Já verificado: está em `.gitignore:31` e nunca foi versionado.** Não há caminho `C:\Users\…` nem
token vazando pelo repositório por esse caminho. Resta só extrair o que for relevante de
`.superpowers/sdd/`, **sanitizado** (caminhos absolutos → relativos, nenhuma credencial), para
`Docs/validacao-producao/evidencias/`.

---

# PARTE B — Manutenção de equipamento

Base: `Docs/validacao-producao/manutencao-proposta.md`, com os ajustes abaixo **prevalecendo** sobre
o documento.

## B.0 — Enums novos e a V19

`ck_notificacao_evento_coerente` (`V15:57-61`) amarra tipo de evento a âncora: um tipo único servindo
incidente **e** episódio afrouxaria a constraint nas duas direções. Por isso **dois** tipos novos:

| enum | valor novo | âncora |
|---|---|---|
| `StatusNotificacao` | `CANCELADA` | — |
| `TipoEventoNotificacao` | `INCIDENTE_ENCERRADO_MANUTENCAO` | `incidente_id` |
| `TipoEventoNotificacao` | `LATENCIA_ENCERRADA_MANUTENCAO` | `episodio_latencia_id` |

`notificacao.tipo_evento` é `VARCHAR(30)` (`V9:6`) e `INCIDENTE_ENCERRADO_MANUTENCAO` tem exatamente
30 caracteres — zero margem. A V19 alarga para `VARCHAR(40)`.

Conteúdo da V19, na ordem:

1. `incidente.motivo_encerramento VARCHAR(24)` + `ck_..._valor`
   (`RECUPERACAO_AUTOMATICA|FECHAMENTO_MANUAL|MANUTENCAO`) + `ck_..._coerente`
   (`NULL OR status='FECHADO'`);
2. backfill em duas passadas (da certeza para a dúvida), legado ambíguo fica `NULL`;
3. `monitor_episodio_latencia.motivo_encerramento VARCHAR(24)` + as duas CHECKs
   (`NORMALIZACAO|INCIDENTE|MANUTENCAO`), **sem backfill**, de propósito;
4. `ALTER … tipo_evento TYPE VARCHAR(40)`;
5. recriar `ck_notificacao_status` com `CANCELADA`;
6. recriar `ck_notificacao_tipo_evento` e `ck_notificacao_evento_coerente` com os dois tipos novos,
   cada um na sua âncora.

Tudo o que a proposta descartou continua descartado, pelos motivos que ela registra: sentinela
`INDETERMINADO`, reaproveitar `motivo` ou `observacao`, inferir o caso ambíguo por proximidade de
medição, contador em memória, apagar medições, coluna `manutencao_saiu_em`.

**B.e**: antes de aplicar, a consulta de diagnóstico do backfill (contagens por faixa) roda contra
uma **cópia** do banco de dev restaurada num Postgres descartável. Nunca no de dev. `pg_dump` do
banco de dev é leitura; a restauração é noutra instância, noutra porta.

## B.a — Notificação no encerramento por manutenção

A regra é por **estado da notificação de abertura**, não por tipo de evento:

| estado da abertura | abertura | encerramento |
|---|---|---|
| `PENDENTE` | **CANCELADA** (`UPDATE … WHERE status='PENDENTE'`, CAS) | **nenhum** |
| `ENVIANDO` | intocada — a chamada pode estar em voo | **cria** |
| `ENVIADA` | intocada | **cria** |
| `FALHA` | intocada | **nenhum** |
| inexistente | — | **nenhum** |

`ENVIANDO` foi decidido assim: tratamos como "vai sair". Se sair, o grupo recebe abertura e
encerramento. Se terminar em `FALHA`, chega um encerramento sem abertura — ruído menor que um
incidente aberto que nunca encerra, que é exatamente o que a manutenção existe para evitar. Marcar
`CANCELADA` sobre algo possivelmente já enviado seria mentira num campo auditado.

Regra derivada, curta: **só `PENDENTE` cancela; só `ENVIANDO` e `ENVIADA` geram encerramento.**

Texto do encerramento: **"Incidente encerrado: equipamento entrou em manutenção"** — nunca o texto
nem o tipo de `INCIDENTE_FECHADO`. O episódio de latência segue a mesma matriz, com
`LATENCIA_ENCERRADA_MANUTENCAO`.

Armadilha registrada na proposta e mantida: supressão por "não chamar" é revogável por descuido —
`uq_notificacao_incidente_canal_evento` só protege linhas que existem.

## B.b — Auditoria obrigatória dos enums novos

Antes de escrever o valor novo, inventário exaustivo de todo ponto que lê os enums, com
classificação registrada em `Docs/validacao-producao/`: **entra**, **fica de fora**, ou **exige
tratamento próprio**. Nada de buscar-e-substituir cego.

Pontos já mapeados que a auditoria tem de cobrir (a lista final sai do grep, não daqui):

- `NotificationDispatcher:49` (`findIdsReadyForDispatch` filtra `PENDENTE`) — **fica de fora**, e é
  justamente por isso que `CANCELADA` é seguro;
- `NotificacaoRepository:78-86` (`reserveForDispatch`, `releaseStaleSending`) — **fica de fora**;
- `VisaoGeralPdfRepository:26-27` (KPI "notificações com falha", conta `FALHA`) — **fica de fora**;
  é o argumento decisivo contra marcar `FALHA`;
- `NotificacaoService.listar` (filtro por status/tipo) e `NotificacaoController` — **entram**;
- `NotificacaoMessageBuilder:18-61` — **tratamento próprio**: ramo novo por tipo;
- `Notificacao.java:92-139` (transições de estado) — **tratamento próprio**;
- exportações e relatórios de notificação — classificar um a um;
- frontend: `core/models/api-enums.ts`, filtros do histórico
  (`features/notificacoes/notificacao-list.component.html`), `notificacao-detail`,
  `incidente-unificado-list` — **entram**;
- `shared/status-badge/status-badge.component.ts` — **recebe os valores novos**. Proibido criar badge
  local; a decisão já registrada no projeto é que valores novos entram no componente compartilhado.

## B.c — Corrida (B.4)

Guarda condicional de abertura vale para o **incidente e para o episódio de latência** — a proposta
só cobria o incidente.

Entrada em manutenção em **uma única transação**, nesta ordem:

1. `UPDATE equipamento SET em_manutencao=true … WHERE id=:id AND em_manutencao=false` — CAS; retorno
   0 encerra tudo (idempotente, ninguém roda efeito colateral duas vezes);
2. `fecharPorManutencao(equipamentoId, usuario, agora)` — bulk CAS `status IN (ABERTO, RECONHECIDO)`,
   grava `motivo_encerramento=MANUTENCAO` e **`fechado_por` = operador autenticado**;
3. encerrar episódios de latência abertos com `motivo_encerramento=MANUTENCAO`;
4. `cicloJanela.fecharEquipamento(id)` — fecha as janelas;
5. cancelar notificações de abertura `PENDENTE` (CAS) e criar os avisos de encerramento para as que
   estavam `ENVIANDO`/`ENVIADA`.

Flag **primeiro** é deliberado: qualquer processor a caminho encontra `em_manutencao=true` e não abre
nada; quem abriu antes do flag é fechado pelo passo 2. A ordem só funciona com as guardas de
abertura sendo `INSERT … SELECT … WHERE … AND e.em_manutencao = false` / `ON CONFLICT DO NOTHING`,
que também elimina o `catch (DataIntegrityViolationException)` de `IncidenteService:78-80`.

Retorno 0 do INSERT condicional ⇒ **não criar notificação**. Hoje `criarParaIncidenteAberto` é
chamado logo após o save sem olhar se algo foi inserido: esse é o defeito que a corrida expõe.

`fechado_por` do fechamento por manutenção é o **operador autenticado** (decisão aprovada): mantém
verdadeira a afirmação da `V17` ("NULL = automático") e preserva a trilha. Custo: `entrarEmManutencao`
passa a receber `UsuarioPrincipal` — e o tipo é `UsuarioPrincipal`, não `Usuario`, detalhe que já
custou tempo neste projeto.

Medição atrasada continua **gravada**: descarta-se a interpretação, nunca o dado.

## B.d — CSV

`motivo_encerramento` entra **no fim** do cabeçalho e do mapper de `RelatorioExportService` (`:112`,
`:113`). A dívida "contrato de arquivo consumido por terceiros" da proposta **está resolvida**: não
há consumidor externo, o sistema não está em produção.

## B.3 / B.5 — Janela como âncora

Guarda simétrica em `processarAbertura`: medição anterior ao início da janela aberta não sustenta
abertura. Sem ela, a cauda congelada pela manutenção abre incidente retroativo na primeira falha
nova depois da saída.

Invariante da B.5, verificada pela matriz completa: **existe janela aberta para um monitor se e
somente se aquele monitor é candidato à execução** — `equipamento.ativo AND monitor.ativo AND NOT
equipamento.em_manutencao`, a mesma expressão do `WHERE` de `findActiveExecutionCandidates`.
Consequência contraintuitiva e explícita: **ativar equipamento ou monitor em manutenção NÃO abre
janela**. A guarda mora dentro de `CicloJanelaMonitoramentoService.abrir(Monitor)`, não nos três
chamadores.

## B.7 — Telas

Drawer do incidente ganha **"Encerrado por"** e **"Motivo do encerramento"** depois de "Encerrado em"
(`fechadoPorNome` já existe no modelo desde a V17 e nunca foi renderizado). Lista unificada: **sem
décima segunda coluna** — marca discreta junto do badge de status. Timeline: ramo por
`motivoEncerramento`, porque hoje ela imprime "N respostas consecutivas restabeleceram o monitor"
para um fechamento em que isso é **falso**. Legenda "fora da leitura ICMP" do painel: **manter o
texto**; depois desta mudança ela passa a ser literalmente verdadeira. Comentário do mapa: manter.

---

# Testes, com prova de reversão para cada um

Cada teste tem de **falhar antes** da mudança e passar depois; a prova de reversão é registrada.

- **A.1** — carga nativa tentada com motor desligado; subida não cai no pedido explícito.
- **B.3** — sem a âncora da janela, uma falha nova depois da saída da manutenção reabre incidente
  usando a cauda congelada de falhas antigas.
- **B.4** — corrida simulada entre a entrada em manutenção e uma medição em andamento: nenhum
  incidente **e nenhum episódio** abre depois da entrada.
- **B.5** — matriz completa (`ativo` × `monitor.ativo` × `em_manutencao` × transições) respeita a
  invariante.
- **B.a** — os quatro casos de notificação (abertura `PENDENTE`, `ENVIANDO`, `ENVIADA`; episódio).
- **Integração real** contra Postgres por Testcontainers.

# Verificação ponta a ponta

Postgres 16 descartável em **outra porta (5435)**, migrations do zero, admin pelo bootstrap, senha por
variável de ambiente fora do repositório. Mock HTTP local da API do Telegram (responde `ok` a
`sendMessage` e **registra o corpo recebido**), com `TELEGRAM_API_BASE_URL` apontado para ele e o
dispatcher ligado. Motor ligado **somente** contra esse banco. Cadastro via API: 1 unidade, 2
equipamentos em `192.0.2.10` e `192.0.2.11` (TEST-NET-1, nunca roteado), monitores com intervalo 10 s.

Roteiro: (1) abertura dos incidentes e envio pelo mock; (2) `.10` em manutenção → incidente `FECHADO`
com `MANUTENCAO`, mensagem específica no mock, janela fechada, nenhuma medição nova de `.10`; (3) com
o dispatcher **desligado**, `.11` abre incidente com notificação `PENDENTE` e entra em manutenção →
`CANCELADA` e **nada** no mock; (4) `.10` sai da manutenção → janela reaberta, incidente novo só
depois de **3 falhas novas**, não na primeira.

Evidência de cada passo: consultas SQL e corpos recebidos pelo mock. Telas por Playwright, navegando
**por clique** (nunca `page.goto` pós-login) e com credencial por variável de ambiente: drawer do
incidente, timeline, lista unificada, painel, mapa, histórico de notificações com `CANCELADA` e os
tipos novos nos badges.

Ao final: destruir banco descartável e mock, e **provar** que o banco de dev continua com as mesmas
contagens do relatório de investigação.

# Entrega

Branch novo a partir de `fix/icmp-nativo-windows`. `Docs/validacao-producao/` atualizado **no mesmo
commit** das mudanças. **Sem merge.**

# Dívidas que este desenho NÃO resolve

`fecharAutomaticamente` continua read-modify-write sem CAS (`IncidenteService:84-97`); `excluir` de
monitor e equipamento não fecha janela; a CHECK não consegue exigir `motivo_encerramento NOT NULL`
em `FECHADO` enquanto o legado for `NULL`; manutenção é sempre do equipamento, nunca de um monitor
isolado.

*Resolvido depois deste documento: `fecharAutomaticamente` usa CAS (`fecharAutomaticamenteSeEmAberto`) — ver `riscos-execucao-correcoes.md`, seção 1a.*

*Resolvido depois deste documento: excluir monitor apaga as janelas dele na mesma transação (`CicloJanelaMonitoramentoService.apagarDoMonitor`), e excluir equipamento só é possível com zero monitores, logo sem janela — ver `riscos-execucao-correcoes.md`, seção 1c, e `ExclusaoEJanelaPostgresIntegrationTest`. Apaga, não fecha: a FK é `RESTRICT`.*
