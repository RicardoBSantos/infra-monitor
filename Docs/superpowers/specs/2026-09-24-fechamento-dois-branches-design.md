# Fechamento dos dois branches — riscos de execução, auditoria de concorrência, evidência do mapa, merge

Data: 2026-09-24. Branch de trabalho: `feat/manutencao-equipamento` (contém `fix/icmp-nativo-windows`
em linha reta; `origin/main` é ancestral dos dois).

Regras permanentes desta rodada: banco de dev (5434) intocado além de `SELECT` de conferência; motor
nunca ligado contra ele; Telegram real nunca acionado (sempre mock HTTP local). A árvore de trabalho
tem ~60 arquivos modificados/não rastreados que **não pertencem a esta rodada** (evidências de mapa,
`package.json` com dois scripts e2e, dois planos D18/D19): nenhum commit desta rodada os inclui —
stage sempre por caminho explícito.

## 1. Riscos de execução

### 1a. `fecharAutomaticamente` com CAS

**Hoje:** `IncidenteService.fecharAutomaticamente` lê a entidade, chama `incidente.fechar(...)` e faz
`saveAndFlush`. O `UPDATE` do Hibernate grava todas as colunas `WHERE id = ?`, sem versão. Corridas
possíveis, todas contra transações que escrevem o mesmo incidente:

- com `EquipamentoService.entrarEmManutencao` (`fecharPorManutencao`): o motor sobrescreve
  `motivo_encerramento = MANUTENCAO`/`fechado_por = operador` por `RECUPERACAO_AUTOMATICA`/`NULL`, e
  nascem **duas** notificações de encerramento (`INCIDENTE_ENCERRADO_MANUTENCAO` e `INCIDENTE_FECHADO`);
- com `IncidenteService.reconhecer` (CAS `reconhecerSeAberto`): o motor, com a instância carregada
  ainda sem reconhecimento, grava `reconhecido_em`/`reconhecido_por` de volta a `NULL` — a trilha de
  quem reconheceu some.

**Correção:** `IncidenteRepository.fecharAutomaticamenteSeEmAberto(id, encerradoEm, observacao, agora)`
— bulk update JPQL no idioma de `reconhecerSeAberto`/`fecharPorManutencao`:
`SET status = FECHADO, encerradoEm, observacao, motivoEncerramento = RECUPERACAO_AUTOMATICA,
fechadoPor = null, updatedAt WHERE id = :id AND status IN (ABERTO, RECONHECIDO)`, com
`clearAutomatically/flushAutomatically`. Só atualiza colunas de fechamento, então `reconhecido_*`
sobrevive. Retorno 0 = outra transação já fechou: **sem notificação**, devolve a releitura. Retorno 1:
relê por `findById` (grafo largo) e só então `criarParaIncidenteFechado`. A validação
`encerradoEm >= iniciadoEm` fica. A assinatura pública não muda de tipo (`Incidente`); o
`IncidentProcessor` continua igual, exceto pelo log (ver 1b).

**Prova:** em `ManutencaoPostgresIntegrationTest` (mesmo arnês, mesmo `CyclicBarrier`, 30 repetições):

1. `entrarEmManutencaoEFecharAutomaticamenteConcorrentes` — incidente ABERTO + notificação de abertura
   ENVIADA + janela aberta; thread A `entrarEmManutencao`, thread B `fecharAutomaticamente` com a
   instância carregada **antes** da barreira. Desfechos legítimos: (M) FECHADO/MANUTENCAO com
   `fechado_por = operador`, exatamente uma `INCIDENTE_ENCERRADO_MANUTENCAO` e nenhuma
   `INCIDENTE_FECHADO`; (R) FECHADO/RECUPERACAO_AUTOMATICA com `fechado_por NULL`, exatamente uma
   `INCIDENTE_FECHADO` e nenhuma `INCIDENTE_ENCERRADO_MANUTENCAO`. Qualquer outra combinação é ilegítima.
2. `reconhecerEFecharAutomaticamenteConcorrentes` — thread A `reconhecer`, thread B
   `fecharAutomaticamente`. Legítimos: (F) FECHADO sem reconhecimento e `reconhecer` recebeu 409;
   (RF) FECHADO **com** `reconhecido_em`/`reconhecido_por` preenchidos. Ilegítimo: FECHADO com
   reconhecimento perdido depois de `reconhecer` ter retornado sucesso, ou RECONHECIDO sobrevivendo.

Cada repetição imprime `[corrida-fechamento] desfecho=...`; o relatório traz a distribuição. **Prova
de reversão obrigatória:** rodar os dois testes com o `saveAndFlush` antigo restaurado temporariamente,
registrar quantas das 30 caem em ilegítimo, restaurar o CAS. Se o teste 2 não discriminar (0 ilegítimos
também no código antigo), dizer isso no relatório em vez de declarar cobertura.

### 1b. `lock_timeout` no motor e pool de conexões

**Onde há espera por lock no motor:** `IncidenteRepository.inserirSeElegivel` e
`MonitorEpisodioLatenciaRepository.inserirSeElegivel` (`FOR UPDATE OF e`), e os bulk updates de
fechamento (linha de incidente/episódio disputada com `entrarEmManutencao`). Todos rodam dentro das
transações `REQUIRES_NEW` de `IncidentProcessor.process` e `LatencyEpisodeProcessor.process`.

**Valor: 2 s** (`monitoring.engine.lock-timeout-ms`, default `2000`, env
`MONITORING_ENGINE_LOCK_TIMEOUT_MS`). Justificativa: quem segura a linha de equipamento são transações
curtas — `entrarEmManutencao` (flag + dois bulk updates + inserção de notificações, só banco),
`atualizar`/`ativar`/`desativar` de equipamento, e a abertura concorrente de outro monitor do mesmo
equipamento — todas na casa de milissegundos. 2 s é duas ordens de grandeza acima da espera legítima e
bem abaixo do menor intervalo de monitor (`@Min(10)` s), então um worker nunca fica preso além de um
ciclo nem segura conexão por mais que isso.

**Aplicação:** `SET LOCAL` (via `select set_config('lock_timeout', ?, true)`) como primeira instrução
das duas transações `REQUIRES_NEW` — vale só para a transação corrente, não vaza para a conexão
devolvida ao pool. Um único componente pequeno faz a chamada, usado pelos dois processors (dois
chamadores reais, não abstração especulativa).

**Decisão no estouro: pula o ciclo.** O Postgres devolve `55P03 lock_not_available`, o Spring traduz
para `PessimisticLockingFailureException` (`CannotAcquireLockException`), a transação do processor faz
rollback. A medição já foi persistida antes (fora dessa transação, `MedicaoService.criar` é
`NOT_SUPPORTED`), então nada se perde: a próxima medição do monitor reavalia a cauda inteira e abre ou
fecha no ciclo seguinte. Não registrar falha (a medição é verdadeira; o que falhou foi a
interpretação), não tentar de novo na hora (o detentor do lock é justamente a manutenção, e tentar de
novo prende o worker). `MedicaoService.criar` passa a capturar `PessimisticLockingFailureException`
separadamente e logar **WARN** ("lock não obtido em Xms; reavaliado na próxima medição"), em vez do
ERROR genérico de erro interno. Custo conhecido: uma abertura adiada um ciclo tem `iniciado_em` na
primeira falha da nova cauda (um intervalo depois) — registrado no relatório.

**Teste (Testcontainers):** transação externa segura `SELECT ... FROM equipamento WHERE id = ? FOR
UPDATE` por ~8 s; em paralelo, uma thread chama `MedicaoService.criar` com a 3ª falha consecutiva.
Asserções: a chamada volta em menos de ~4 s; a medição existe; nenhum incidente, nenhuma notificação;
depois de liberar o lock, a próxima falha abre o incidente. **Prova de reversão:** sem o `set_config`,
a chamada só volta depois dos ~8 s — o teste falha pela asserção de tempo.

**Pool:** `DB_POOL_SIZE` default 10. Detentores concorrentes de conexão em segundo plano, a confirmar
por leitura de código no plano: 4 workers do motor (um por vez cada — `MedicaoService.criar` é
`NOT_SUPPORTED` e cada etapa abre/fecha a sua), 1 thread do scheduler (`findActiveExecutionCandidates`),
1 poll do dispatcher, até 5 workers do dispatcher (só nas transações de estado, não durante o HTTP do
Telegram). Pico de segundo plano = **11 > 10** antes de qualquer requisição HTTP. Com `lock_timeout` de
2 s, os 4 workers podem segurar conexão por até 2 s cada. Decisão: default passa a **20** (11 de
segundo plano + 9 para HTTP), bem abaixo do `max_connections = 100` do Postgres; documentado em
`application.yml` com a conta. Se a leitura de código der número diferente de 11, a conta do
comentário e o default seguem o número real.

### 1c. Excluir monitor e equipamento × janela

**Achado que muda o enunciado:** `janela_monitoramento.monitor_id` é `REFERENCES monitor(id) ON DELETE
RESTRICT` (V13), e `MonitorService.criar`/`ativar` abrem janela. Logo, hoje, excluir um monitor ativo
recém-criado (sem medição nem incidente) **não deixa janela órfã — falha**: o `DELETE` estoura a FK e a
API devolve 409 `DATA_INTEGRITY_VIOLATION`. Na prática só é possível excluir monitor que nunca teve
janela. Exclusão física de equipamento exige zero monitores, logo zero janelas: a invariante não se
quebra ali. **Exclusão lógica não existe**: `deleted_at` está nas três tabelas de inventário desde a V2,
mas nenhum código Java lê ou grava a coluna — registrado na auditoria, não inventado aqui.

**Correção (monitor):** `MonitorService.excluir`, depois das duas guardas de medição/incidente,
remove as janelas do monitor (`JanelaMonitoramentoRepository.deleteByMonitorId` — bulk delete) e então
o monitor, na mesma transação. Apagar, e não fechar, porque um monitor sem medição e sem incidente não
tem período observado que o relatório precise preservar, e fechar não basta: a FK é `RESTRICT`. Se o
motor inserir uma medição entre a guarda e o `DELETE`, a FK de `medicao` estoura, a transação inteira
volta (janelas inclusive) e a API responde 409 — invariante preservada pelo banco. **Equipamento:**
nenhuma mudança de código; teste de integração que prova a invariante (equipamento com monitor → 409,
sem monitor → exclui, `janela_monitoramento` sem linha órfã).

**Testes (Testcontainers):** criar monitor via serviço (abre janela) → excluir → 204/sem exceção, zero
janelas, zero monitor. Monitor com medição → 409 e janela intacta. Prova de reversão: sem o
`deleteByMonitorId`, o primeiro teste falha com a violação de FK.

## 2. Auditoria de concorrência (documento, sem correção)

`Docs/validacao-producao/auditoria-concorrencia-ciclo-de-vida.md`. Inventário de **toda** escrita de
ciclo de vida/transição de estado: incidente (abrir manual, abrir automático, reconhecer, fechar manual,
fechar automático, fechar por manutenção), episódio de latência (abrir, fechar, encerrar por
manutenção), notificação (inserir pendente, reservar para despacho, completar, cancelar, recuperar
travadas), janela (abrir, fechar, fechar do equipamento, abrir do equipamento), manutenção
(entrar/sair), ativar/desativar de equipamento, monitor e tipo, usuário (criar, papel, ativar/desativar,
senha, último admin), conexão de hub da unidade. Para cada uma: arquivo:linha; guarda no banco (CAS,
`FOR UPDATE`, `ON CONFLICT`, índice parcial/constraint) ou ler-depois-escrever; teste concorrente real
(threads + barreira + banco real) ou só sequencial/mock; desfecho ilegítimo concreto possível;
classificação de risco (alto/médio/baixo) com o critério escrito. Nada é corrigido além do item 1; os
achados novos (ex.: `fechar` manual sem CAS, `MonitorService.atualizar` movendo monitor para
equipamento em manutenção sem reavaliar janela, `abrir` de janela ler-depois-escrever protegido só pelo
índice parcial) entram como linhas da tabela.

## 3. Evidência do mapa

Ambiente descartável, mesmo desenho de `manutencao-verificacao-ponta-a-ponta.md`: Postgres 16 em
container na **5435**, mock HTTP do Telegram em **8099**, backend com `DB_PORT=5435`,
`TELEGRAM_API_BASE_URL=http://localhost:8099`, motor e dispatcher ligados durante a preparação.
Cadastro: unidade de teste **com latitude/longitude** (ponto dentro da área que o mapa enquadra),
equipamentos em TEST-NET-1 (`192.0.2.x`), monitor ICMP por equipamento. Uma unidade cujo único
equipamento está em manutenção, para que o marcador da unidade assuma o status agregado de manutenção
sem ser mascarado por outro equipamento. A cor esperada é **derivada do código antes da captura**
(regra de agregação em `OperationalStatusResolver` + token de cor do status no frontend) e escrita no
relatório; o roteiro Playwright (login e navegação por clique, sem `page.goto` pós-login, sem `catch`
mudo, log em `finally`) lê a cor computada do marcador e compara. Clique no marcador abre o painel com
o equipamento e o badge "Em manutenção". **Se a cor não corresponder, reporta — não ajusta código
nem CSS.** Ao final: ambiente destruído, e contagens do banco de dev (5434) antes/depois idênticas.
Documento: seção nova em `manutencao-verificacao-ponta-a-ponta.md` substituindo a limitação da tela 5.

## 4. Merge

Pré-condição: itens 1 e 3 fechados. Em **worktree separado** (a árvore principal tem mudanças que não
são desta rodada e bloqueariam `checkout main`):

0. `git fetch origin`; na main: `git merge --ff-only origin/main`.
1. Suítes completas no ponta de `feat/manutencao-equipamento` (backend `./mvnw test`, frontend
   `npx ng test --watch=false`), com contagens.
2. `git merge --no-ff fix/icmp-nativo-windows` na main; depois `git merge --no-ff
   feat/manutencao-equipamento`. É a opção B do `topologia-git-e-estrategia-de-merge.md` na forma
   executável sem reescrever histórico: um merge por frente que já existe como branch, na ordem de
   dependência. O recorte mais fino da opção B (Auth, Mapa, Relatórios em PRs separados) exigiria
   cherry-pick, que o próprio documento marcou como sujeito a erro — não executado, e isso é dito.
3. Conflitos: não esperados (`origin/main` é ancestral). Se houver, cada um é mostrado com a resolução.
4. Depois do merge: mesmas suítes com contagens + `npx ng build`.
5. **Sem push.** Relatório ao usuário.

## 5. Dívidas

`Docs/validacao-producao/dividas-fechamento-branches.md`, com evidência verificada no código atual
(não copiada da memória): os dois testes da gaveta que não discriminam o bug antigo (reidentificados
por reversão da guarda de `06413cd`); o motivo de encerramento do **episódio** não projetado na lista
unificada (`DashboardIncidenteReadRepository`, ramo episódio); `motivoEncerramento` como enum em
`IncidenteResponse` e `String` em `DashboardIncidenteResponse`/`HistoricoIncidenteResponse`; o
`@ConditionalOnMissingBean` vestigial (verificar estado atual — o comentário em
`MonitoringClockConfiguration` sugere que já saiu; documentar o que o código mostra hoje); os três
pares de testes sobrepostos (M3 `IcmpAmbienteConfigurationTest:75/:152`, M4
`MonitoringEngineConfigurationTest:26/:37`, e o terceiro par — o "achado conhecido 5" da revisão —
reidentificado no código); memória por thread parada **NÃO VERIFICADO**
(`capacidade-pool-monitoramento.md`). **Em destaque, no topo:** testes de concorrência sequenciais
(mesma thread, duas chamadas em fila) passam sobre código quebrado — 9bac9f0 registrou 0/30 legítimos
no teste real enquanto os sequenciais estavam verdes; toda afirmação de segurança concorrente daqui em
diante exige teste com threads reais, barreira, banco real, repetição e prova de reversão.

Índice `validacao-producao.md` atualizado no mesmo commit de cada documento novo.

## Ordem e paralelismo

- Onda A (em paralelo): **1a → 1b → 1c** sequenciais na árvore principal (um implementador por vez —
  mesmo `target/` do Maven e mesmo índice git); **auditoria (2)** e **dívidas (5)** em paralelo, só
  leitura de código + escrita de arquivo em `Docs/`, sem commit (o controlador commita).
- Onda B: **evidência do mapa (3)**, depois da onda A, com o jar empacotado copiado para o scratchpad
  (não disputa `target/` com ninguém).
- Onda C: **merge (4)**.
