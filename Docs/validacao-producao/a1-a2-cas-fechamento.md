# A1 / A2 — CAS nos fechamentos

Data: 2026-09-24. Branch `main`, base `44e51b8`. Linhas da auditoria corrigidas:
`auditoria-concorrencia-ciclo-de-vida.md` A1 (Task 5) e A2/A2b (Task 6), neste documento.

## A1 — fechamento manual de incidente

### Defeito

`IncidenteService.fechar` lia o incidente, chamava `Incidente.fechar(...)` e fazia `saveAndFlush`.
O UPDATE do Hibernate grava todas as colunas `WHERE id = ?`, sem versão. Se o motor
(`fecharAutomaticamente`), a manutenção (`entrarEmManutencao`), `reconhecer` ou outro operador
commitasse entre a leitura e a escrita, o fechamento manual regravava a linha a partir da instância
velha:

- motor: `RECUPERACAO_AUTOMATICA` virava `FECHAMENTO_MANUAL`, e a `INCIDENTE_FECHADO` já criada pelo
  motor (que absorve a segunda pelo uq) continuava descrevendo a recuperação (`Fim:` do motor);
- manutenção: `MANUTENCAO` virava `FECHAMENTO_MANUAL`, e nasciam `INCIDENTE_ENCERRADO_MANUTENCAO`
  **e** `INCIDENTE_FECHADO`, dois avisos de encerramento;
- reconhecer: `reconhecido_em`/`reconhecido_por` voltavam a NULL;
- dois operadores: last-write-wins na linha, com a mensagem do Telegram descrevendo o primeiro.

### Correção

- `IncidenteRepository.fecharManualmenteSeEmAberto(id, encerradoEm, observacao, usuario, agora)`:
  bulk UPDATE `WHERE id = :id AND status IN (ABERTO, RECONHECIDO)`, só colunas de fechamento
  (`status`, `encerrado_em`, `observacao`, `motivo_encerramento = FECHAMENTO_MANUAL`, `fechado_por`,
  `updated_at`), irmão de `fecharAutomaticamenteSeEmAberto`. `reconhecido_*` não é tocado.
  A observação é `coalesce(:observacao, i.observacao)` (correção da revisão, rodada 1): a primeira
  versão do CAS gravava `observacao = :observacao` e apagava a observação de um incidente aberto
  à mão quando o fechamento vinha sem observação. `Incidente.fechar` só sobrescrevia com valor
  não nulo; o CAS agora repete essa regra.
- `IncidenteService.fechar`: mantém o retorno idempotente para quem já lê FECHADO e a validação
  `encerradoEm >= iniciadoEm`; troca `fechar()` + `saveAndFlush` pelo CAS. Retorno 0 devolve o
  estado atual relido, sem notificação; retorno 1 relê (o bulk update não atualiza a instância
  carregada) e notifica.
- `Incidente.fechar(...)` continua na entidade: é usado por dezenas de fixtures de teste
  (relatórios, notificação) para montar incidentes fechados.
- `IncidenteServiceTest.permiteNovoIncidenteAposFechamentoEBuscaExistente` passou a mockar o CAS
  (retorno 1) e a releitura, em vez de `saveAndFlush`. Novo
  `IncidenteServiceTest.fecharQuePerdeOCasNaoNotificaEDevolveEstadoRelido`: CAS devolvendo 0 →
  `never().criarParaIncidenteFechado`, resposta vinda da releitura (RECUPERACAO_AUTOMATICA). O javadoc de
  `NotificacaoConcorrenciaPostgresIntegrationTest.doisFecharConcorrentes...`, que dizia "fechar()
  não tem CAS", foi atualizado.

### Testes

`infra-monitor-backend/src/test/java/br/com/inframonitor/incidente/FechamentoManualConcorrenciaPostgresIntegrationTest.java`
— Testcontainers (PostgreSQL 16), `@EnabledIf("dockerDisponivel")`, harness de
`ManutencaoPostgresIntegrationTest`.

Determinísticos (a intercalação que discrimina o CAS, forçada): uma transação externa carrega o
incidente na sessão; outra thread executa e **commita** a ação concorrente (`join`); então
`incidenteService.fechar` roda dentro da transação externa e enxerga a instância velha em cache.

| Teste | Esperado com CAS |
|---|---|
| `fecharManualComInstanciaVelhaNaoSobrescreveFechamentoAutomatico` | `RECUPERACAO_AUTOMATICA`, `fechado_por` NULL, 1 `INCIDENTE_FECHADO`; a resposta do `fechar` perdedor traz o estado atual (`RECUPERACAO_AUTOMATICA`, `encerradoEm` do motor) |
| `fecharManualComInstanciaVelhaNaoSobrescreveManutencao` | `MANUTENCAO`, 1 `INCIDENTE_ENCERRADO_MANUTENCAO`, 0 `INCIDENTE_FECHADO`; a resposta do perdedor traz `MANUTENCAO` |
| `fecharManualComInstanciaVelhaNaoApagaReconhecimento` | `FECHAMENTO_MANUAL` com `reconhecido_por` = operador e `reconhecido_em` preservados |

Sem corrida: `fecharManualSemObservacaoPreservaObservacaoDaAbertura` — incidente aberto com
observação "aberto pelo NOC", fechado à mão com observação nula: linha e resposta mantêm a
observação. Contra a primeira versão do CAS (sem `coalesce`), falha com
`expected: "aberto pelo NOC" but was: null` (verificado revertendo a linha por edição e restaurando).

`correr` e `emOutraThread` falham o teste se uma thread continua viva depois de `LIMITE` (10 s): o
`join` com prazo volta em silêncio, e sem isso um travamento seria lido como desfecho.

Corridas reais (`@RepeatedTest(30)`, duas threads, `CyclicBarrier`, jitter aleatório 0..N ms num dos
lados). Cada repetição imprime `[corrida-...] desfecho=`:

| Corrida | Legítimos | Critério de coerência adicional |
|---|---|---|
| `fecharManualEFecharAutomaticamenteConcorrentes` (jitter 0..8 ms no motor) | MAN: `FECHAMENTO_MANUAL`, `fechado_por` = operador, observação "manual". AUTO: `RECUPERACAO_AUTOMATICA`, `fechado_por` NULL, observação "Recuperacao detectada…" | exatamente 1 `INCIDENTE_FECHADO` e `Fim:` da mensagem = `encerrado_em` da linha |
| `doisFechamentosManuaisConcorrentes` (jitter 0..6 ms no segundo operador) | OP1 / OP2: `fechado_por`, observação e `encerrado_em` do mesmo operador | idem |
| `fecharManualEEntrarEmManutencaoConcorrentes` (jitter 0..4 ms no manual) | MANUTENCAO: só `INCIDENTE_ENCERRADO_MANUTENCAO`. MAN: `FECHAMENTO_MANUAL`, `fechado_por` = operador, observação "manual" e só `INCIDENTE_FECHADO` | nunca os dois avisos; no MAN, `Fim:` da mensagem = `encerrado_em` da linha (reforçado na revisão, rodada 1) |

O critério "`Fim:` da mensagem = `encerrado_em` da linha" foi necessário: sem ele, a regravação do
manual sobre o motor (ou sobre outro operador) parece um desfecho legítimo, porque a linha fica
internamente coerente e o uq absorve a segunda notificação. O que denuncia a regravação é o aviso
já criado descrever outro fechamento.

### Calibração do jitter (com a correção)

| Rodada | Motor | 2º operador | Manual × manutenção | Distribuição |
|---|---|---|---|---|
| 1 | 8 ms | 6 ms | 12 ms (no manual) | MAN 21 / AUTO 9 · OP1 26 / OP2 4 · MANUTENCAO 28 / MAN 2 |
| 2 | 8 ms | 6 ms | 20 ms (no manual) | MAN 24 / AUTO 6 · OP1 26 / OP2 4 · MANUTENCAO 29 / MAN 1 |
| 3 (final) | 8 ms | 6 ms | **4 ms** (no manual) | MAN 21 / AUTO 9 · OP1 27 / OP2 3 · MANUTENCAO 23 / MAN 7 |

Atrasar o manual favorece a manutenção (que já é o caminho mais longo até escrever no incidente);
o valor final é 4 ms. Nas três rodadas, as três corridas produziram os dois desfechos legítimos e
**zero ILEGITIMO**. A distribuição é desigual (OP1 ganha a maioria; o segundo operador é o atrasado),
mas os dois lados aparecem em todas as rodadas.

### Prova de reversão

Sem `git stash` (worktree compartilhado): `IncidenteService.fechar` foi editado de volta para
`incidente.fechar(...)` + `saveAndFlush`, a classe rodou, e a edição foi desfeita; `git diff` do
service conferido depois (só o CAS, o javadoc e o import removido).

Antes da correção (código original, rodada inicial do Step 1, manutenção a 12 ms) e na reversão
(valores finais de jitter), `./mvnw -q test -Dtest=FechamentoManualConcorrenciaPostgresIntegrationTest`:

| | Código original (Step 1) | Reversão (jitter final) |
|---|---|---|
| Resultado | Tests run: 93, Failures: 75 | Tests run: 93, Failures: 63 |
| (a) motor | FALHA: `motivo_encerramento` = FECHAMENTO_MANUAL (esperado RECUPERACAO_AUTOMATICA) | idem |
| (b) manutenção | FALHA: `motivo_encerramento` = FECHAMENTO_MANUAL (esperado MANUTENCAO) | idem |
| (c) reconhecer | FALHA: `reconhecido_por` = null (esperado 1) | idem |
| manual × motor | MAN 15 / **ILEGITIMO 15** | MAN 23 / **ILEGITIMO 7** |
| manual × manual | **ILEGITIMO 30** | OP1 1 / **ILEGITIMO 29** |
| manual × manutenção | MAN 3 / **ILEGITIMO 27** | MAN 6 / **ILEGITIMO 24** |

Linhas ILEGITIMO típicas sem o CAS:

```
[corrida-manual-motor] desfecho=ILEGITIMO motivo=FECHAMENTO_MANUAL fechadoPor=1 fechadas=1 mensagemCoerente=false
[corrida-manual-manual] desfecho=ILEGITIMO fechadoPor=2 observacao=op2 fechadas=1 mensagemCoerente=false
[corrida-manual-manutencao] desfecho=ILEGITIMO motivo=FECHAMENTO_MANUAL encerradasPorManutencao=1 fechadas=1
```

Sem o CAS nenhuma repetição da corrida manual × motor deu AUTO: quando o motor ganhava, o manual
regravava por cima.

### Suíte completa (com a correção)

`./mvnw test`: **Tests run: 542, Failures: 0, Errors: 0, Skipped: 0** — BUILD SUCCESS. Distribuição
das corridas A1 nessa execução: MAN 19 / AUTO 11 · OP1 23 / OP2 7 · MANUTENCAO 26 / MAN 4, zero
ILEGITIMO.

Depois da rodada 1 da revisão (`coalesce`, teste da observação, resposta do perdedor, predicado
MAN reforçado, prazo do `join`):

- classes de cobertura (`-Dtest=FechamentoManualConcorrenciaPostgresIntegrationTest,IncidenteServiceTest`):
  94 + 14 testes, 0 falhas; MAN 21 / AUTO 9 · OP1 27 / OP2 3 · MANUTENCAO 24 / MAN 6, zero ILEGITIMO;
- `./mvnw test` (já com os testes da Task 6): **Tests run: 577, Failures: 0, Errors: 0, Skipped: 0**
  — BUILD SUCCESS; MAN 28 / AUTO 2 · OP1 26 / OP2 4 · MANUTENCAO 24 / MAN 6, zero ILEGITIMO. AUTO
  caiu para 2/30 nessa execução (9 e 11 nas anteriores, com o mesmo jitter): a distribuição
  oscila com a carga da máquina, mas os dois desfechos continuaram aparecendo.

## A2 / A2b — encerramento do episódio de latência: normalização × manutenção

Task 6, base `10cc09b`. As duas metades do mesmo par, como no incidente: A2 é o lado do motor,
A2b o lado da manutenção. Uma não fecha a outra.

### Defeitos

- **A2 (motor).** `LatencyEpisodeProcessor.processarNormalizacao` lia o episódio aberto, chamava
  `encerrar(..., NORMALIZACAO)` e fazia `saveAndFlush` — UPDATE de todas as colunas `WHERE id = ?`,
  sem versão. Uma entrada em manutenção commitada entre a leitura e a escrita era regravada:
  `MANUTENCAO` virava `NORMALIZACAO`, `encerrado_em` virava o da medição, e o grupo recebia
  `LATENCIA_ENCERRADA_MANUTENCAO` **e** `LATENCIA_NORMALIZADA` (tipos distintos, o uq não barra).
- **A2b (manutenção).** `EquipamentoService.entrarEmManutencao` lê os ids dos episódios abertos
  (`abertosDoEquipamento`) **antes** do bulk `encerrarPorManutencao`. Se o motor normaliza e commita
  nesse intervalo, o bulk pula o episódio (já encerrado), mas a releitura notificava todos os ids
  lidos: `LATENCIA_ENCERRADA_MANUTENCAO` sobre uma linha que diz `NORMALIZACAO`. Na auditoria isto
  estava "por leitura de código"; agora foi observado (tabela de reversão abaixo).

### Correção

- `MonitorEpisodioLatenciaRepository.encerrarPorNormalizacaoSeAberto(id, encerradoEm, agora)`: bulk
  UPDATE `WHERE e.id = :id AND e.encerradoEm IS NULL`, só `encerrado_em`, `motivo_encerramento =
  NORMALIZACAO` e `updated_at`; `clearAutomatically`/`flushAutomatically` como o
  `encerrarPorManutencao` irmão.
- `LatencyEpisodeProcessor.processarNormalizacao`: CAS no lugar de `encerrar()` + `saveAndFlush`.
  Retorno 0 → `return` sem notificação (o encerramento commitado vale). Retorno 1 → releitura por
  `findById` (grafo largo `monitor.equipamento.unidade`, o que `construirParaEpisodio` usa) e
  `criarParaLatenciaNormalizada` com a instância relida — o bulk update não repropaga.
- `EquipamentoService.entrarEmManutencao`: a releitura `findAllById(episodiosAfetadosIds)` passou a
  filtrar `motivoEncerramento == MANUTENCAO`, mesmo filtro que a releitura de incidentes já tinha.
- `LatencyEpisodeProcessorTest`: `episodioAbertoNormalizaNoSegundoCicloDentroDoLimiar` mocka o CAS
  (1) e a releitura, e verifica que a notificação sai da instância relida e que `saveAndFlush` não é
  chamado; novo `normalizacaoPerdidaParaOutroEncerramentoNaoNotifica` (CAS 0 → sem
  `LATENCIA_NORMALIZADA`).
- Fora do escopo, sem mudança: o ramo "incidente aberto encerra o episódio em silêncio" do mesmo
  processor continua por dirty checking (A3, documentado sem correção nesta rodada).

### Testes

`infra-monitor-backend/src/test/java/br/com/inframonitor/monitoring/latency/EpisodioLatenciaConcorrenciaPostgresIntegrationTest.java`
— Testcontainers (PostgreSQL 16), `@EnabledIf("dockerDisponivel")`, mesmo harness de
`FechamentoManualConcorrenciaPostgresIntegrationTest`. Cenário comum: equipamento e monitor ativos,
episódio aberto com `LATENCIA_ALTA` já `ENVIADA` (a manutenção então avisa em vez de só cancelar),
janela aberta e duas medições `SUCESSO` com latência = limiar/2. O limiar e o número de ciclos são
lidos das mesmas propriedades que o processor recebe (`monitoring.latencia-degradada-ms`, 250;
`monitoring.latencia-ciclos`, 2 — o teste afirma 2).

**Gancho determinístico.** `@MockitoSpyBean` em `MedicaoRepository` e
`MonitorEpisodioLatenciaRepository` funciona no Spring Boot 4.1 / Spring Framework 7, com um
detalhe: `invocation.callRealMethod()` **não** serve, porque o bean é um proxy JDK do Spring Data e
o método da interface é abstrato (na primeira tentativa a thread falhava antes de sinalizar e o
teste esperava 10 s pelo gancho). O gancho chama a resposta padrão que o próprio spy do Spring
configurou (`mockingDetails(mock).getMockCreationSettings().getDefaultAnswer().answer(invocacao)`),
que chega ao repositório real. O `doAnswer` só pausa na thread de nome combinado; qualquer outra
thread passa direto. Nenhum código de produção mudou por causa do teste.

| Teste | Intercalação forçada | Esperado com a correção |
|---|---|---|
| `normalizacaoComLeituraVelhaNaoSobrescreveManutencao` (A2) | thread "motor" já leu o episódio aberto e pausa em `findByMonitorIdOrderByExecutadoEmDescIdDesc` (leitura das medições, antes da escrita); a principal roda `entrarEmManutencao` e commita; o motor segue | `MANUTENCAO`, `encerrado_em` ≠ o da medição, 1 `LATENCIA_ENCERRADA_MANUTENCAO` com `Fim:` = `encerrado_em` da linha, 0 `LATENCIA_NORMALIZADA` |
| `manutencaoComLeituraVelhaNaoAvisaEpisodioNormalizado` (A2b) | thread "manutencao" pausa depois de `abertosDoEquipamento`; a principal roda `processor.process` e commita; a manutenção segue | `NORMALIZACAO`, `encerrado_em` = `executado_em` da última medição, 1 `LATENCIA_NORMALIZADA` com o `Fim:` da linha, 0 `LATENCIA_ENCERRADA_MANUTENCAO`; `em_manutencao = true` |

Em nenhum dos dois o gancho virou espera em lock: o motor não trava nada antes do ponto de pausa (só
SELECTs), e a normalização não precisa da linha do equipamento que a manutenção trava.

Corrida real `normalizacaoEEntrarEmManutencaoConcorrentes` (`@RepeatedTest(30)`, `CyclicBarrier`,
jitter 0..3 ms na manutenção), imprime `[corrida-latencia-manutencao] desfecho=`:

- **MANUTENCAO** legítimo: motivo `MANUTENCAO`, exatamente 1 `LATENCIA_ENCERRADA_MANUTENCAO` com
  `Fim:` = `encerrado_em` da linha, 0 `LATENCIA_NORMALIZADA`.
- **NORMALIZACAO** legítimo: motivo `NORMALIZACAO`, `encerrado_em` = `executado_em` da última
  medição, exatamente 1 `LATENCIA_NORMALIZADA` (`criarParaLatenciaNormalizada` cria sempre uma
  PENDENTE, e o uq absorve repetição) com `Fim:` = `encerrado_em`, 0 `LATENCIA_ENCERRADA_MANUTENCAO`.

O critério do `Fim:` segue a lição da A1: sem ele, uma regravação pode deixar a linha coerente e só
o aviso já criado denunciar o outro vencedor.

### Calibração do jitter (com a correção)

| Jitter | Distribuição |
|---|---|
| 0..4 ms no motor | MANUTENCAO 29 / NORMALIZACAO 1 |
| 0..6 ms na manutenção | MANUTENCAO 6 / NORMALIZACAO 24 |
| **0..3 ms na manutenção (final)** | MANUTENCAO 12 / NORMALIZACAO 18 (só a corrida) · MANUTENCAO 26 / NORMALIZACAO 4 (classe inteira + `LatencyEpisodeProcessorTest`) |

O motor faz cinco leituras antes do CAS; atrasá-lo faz a manutenção vencer quase sempre. A
distribuição varia entre execuções (a mesma configuração deu 12/18 e 26/4), mas os dois desfechos
legítimos apareceram em todas as execuções com a correção, e **zero ILEGITIMO**.

### Prova de reversão

Sem `git stash`. Cada arquivo tinha só a mudança desta task: foi copiado para fora do repositório,
voltado ao conteúdo de `HEAD` com `git checkout -- <arquivo>`, a classe rodou, e a cópia foi
restaurada; `git diff --stat` conferido antes e depois. Uma reversão por vez.

| | Código original (Step 1) | Sem o CAS do processor | Sem o filtro da manutenção |
|---|---|---|---|
| Resultado | Tests run: 32, Failures: 32 | Tests run: 32, Failures: 25 | Tests run: 32, Failures: 12 |
| (a) A2 | FALHA: `motivo_encerramento` = NORMALIZACAO (esperado MANUTENCAO) | FALHA (idem) | passa |
| (b) A2b | FALHA: `LATENCIA_ENCERRADA_MANUTENCAO` = 1 (esperado 0) | passa | FALHA (idem) |
| corrida | **ILEGITIMO 30** (jitter 0..4 ms no motor) | NORMALIZACAO 6 / **ILEGITIMO 24** | MANUTENCAO 19 / **ILEGITIMO 11** |

No Step 1, a primeira execução de (a)/(b) falhou por outro motivo (gancho com `callRealMethod`, ver
acima); os motivos da tabela são da segunda execução, já com o gancho corrigido e o código de
produção ainda original. Linha ILEGITIMO típica sem correção:

```
[corrida-latencia-manutencao] desfecho=ILEGITIMO motivo=NORMALIZACAO encerradasPorManutencao=1 normalizadas=1 encerradoEm=2026-09-01 05:03:00.0
```

(`encerradoEm` impresso no fuso da JVM: 05:03 local = 08:03Z = `executado_em` da última medição.)
Sem o CAS nenhuma repetição deu MANUTENCAO: quando a manutenção ganhava, o motor regravava por cima.
Sem o filtro nenhuma deu NORMALIZACAO: quando o motor ganhava, a manutenção avisava assim mesmo.

### Suíte completa (com a correção)

`./mvnw test`: **Tests run: 575, Failures: 0, Errors: 0, Skipped: 0** — BUILD SUCCESS (542 da Task 5 + 32 da classe nova + 1 unitário novo). Corrida A2/A2b nessa execução: MANUTENCAO 17 / NORMALIZACAO 13, zero ILEGITIMO. As corridas A1 na mesma execução: MAN 26 / AUTO 4 · OP1 27 / OP2 3 · MANUTENCAO 27 / MAN 3, zero ILEGITIMO.
