# Dívidas do fechamento dos dois branches

Data: 2026-09-24. Branch: `feat/manutencao-equipamento` (contém `fix/icmp-nativo-windows` em linha
reta). Cada item abaixo foi conferido agora no código atual (arquivo:linha lido nesta data) ou, quando
não foi possível confirmar, marcado como "não reidentificado" com o que foi tentado — nada aqui foi
inventado a partir só da memória do transcript da revisão anterior.

## ⚠ Achado metodológico: teste sequencial de concorrência passa sobre código quebrado

Este é o item que mais importa desta lista, porque é sobre método, não sobre um bug pontual — e
qualquer prova de segurança concorrente escrita depois deste branch tem de responder a ele.

**A corrida real.** Commit `9bac9f0` (`test(manutencao): integracao real contra Postgres com a V19
aplicada`) introduziu `ManutencaoPostgresIntegrationTest` alinhando duas transações físicas reais
contra um Postgres real (Testcontainers) com `CyclicBarrier`, 30 repetições. Resultado registrado no
próprio corpo do commit: **0/30 legítimas, 30/30 em desfecho ilegítimo** (28x incidente `ABERTO`
sobrevivendo à manutenção, 2x notificação `PENDENTE` órfã). O código de produção não tinha mudado —
o bug já existia antes deste teste nascer. O que faltava era `SELECT ... FOR UPDATE` travando a linha
de `equipamento` no `INSERT...SELECT` de elegibilidade (`IncidenteRepository.inserirSeElegivel` e
`MonitorEpisodioLatenciaRepository.inserirSeElegivel`); sob `READ COMMITTED`, sem o lock, a leitura de
`em_manutencao=false` nunca serializava com o `UPDATE` que trava a mesma linha em
`entrarEmManutencao`.

**A correção e a prova de reversão.** Commit `8ce49f5` (`fix(incidente): trava equipamento no SELECT
de abertura automatica...`) acrescentou `FOR UPDATE OF e` aos dois `SELECT`. Corpo do commit: **30/30
repetições em desfecho legítimo** depois da correção (12x manutenção ganha sem incidente, 18x
incidente abre e é fechado por manutenção). Suíte completa: 380 testes, 0 falhas.

**Por que um teste sequencial não teria pego isso.** O Javadoc da classe
(`infra-monitor-backend/src/test/java/br/com/inframonitor/equipamento/ManutencaoPostgresIntegrationTest.java:35-40`,
lido nesta data) é explícito:

> "Existe porque os testes de unidade e de corrida sequencial (mesma thread, duas chamadas em fila)
> não provam nada sobre concorrência real: eles passam mesmo sem o CAS de
> `marcarEmManutencaoSeNaoEstiver`, porque o filtro de status das leituras já resolve o caso
> sequencial."

Ou seja: já existiam testes de "corrida" na suíte, escritos como duas chamadas sequenciais na mesma
thread, e eles passavam — verde — tanto antes quanto depois da correção de `8ce49f5`. Um teste
sequencial não detecta interleaving real entre transações físicas porque não há duas transações
disputando a mesma linha ao mesmo tempo; ele só prova que a lógica funciona quando as chamadas não se
sobrepõem, o que é precisamente o caso que a proteção contra corrida deveria cobrir e não cobre.

**Regra daqui para frente.** Toda afirmação de segurança concorrente neste projeto exige: threads
reais (não chamadas sequenciais na mesma thread), uma barreira (`CyclicBarrier` ou equivalente)
alinhando o ponto de disputa, banco real (não H2, não mock de repositório), repetição (uma única
corrida pode não expor uma janela estreita) e prova de reversão (o teste tem de ir de vermelho para
verde quando a correção entra, não nascer já verde). Um teste sequencial pode continuar existindo —
ele ainda documenta a lógica de negócio — mas não conta como prova de ausência de corrida.

**Primeira aplicação da regra.** As próprias corridas desta tarefa (`entrarEmManutencaoEFecharAutomaticamenteConcorrentes`
e `reconhecerEFecharAutomaticamenteConcorrentes`, descritas na Seção 1 de
`Docs/validacao-producao/validacao-producao.md`, "Prova" do item 1a) já seguem esse desenho: mesmo
arnês, mesmo `CyclicBarrier`, 30 repetições, contra `ManutencaoPostgresIntegrationTest` real — a
primeira vez que a regra nascida deste achado foi aplicada a um caso novo.

## Dívidas item a item

### 1. Dois testes da gaveta de incidente que não discriminam o bug antigo

Commit `06413cd` (`fix(manutencao): gaveta para de afirmar encerramento falso...`) trocou a guarda de
`item.tipo === IncidentKind.Incident` para `item.encerradoEm` em
`infra-monitor-frontend/src/app/features/incidentes/incidente-detalhe-drawer.component.html:169-174`
e acrescentou quatro testes novos em
`infra-monitor-frontend/src/app/features/incidentes/incidente-detalhe-drawer.component.spec.ts`. Lidos
o guard antigo e os quatro testes (não executados — leitura estática contra o diff de `06413cd`):

O objeto `incidente` padrão do spec (`:11-18`) já vem com `status: IncidentStatus.Open,
encerradoEm: null`. Com a guarda **antiga** (`tipo === Incident`), o bloco "Encerrado por"/"Motivo do
encerramento" aparecia sempre que `tipo === Incident`, independente de `status`/`encerradoEm`; o texto
de "Encerrado por" era sempre `item.fechadoPorNome ?? 'Motor de monitoramento'`.

- **Discrimina o bug** — `'não afirma quem encerrou nem o motivo quando o incidente está aberto'`
  (`:272-280`): monta com o `incidente` padrão (`Open`/`encerradoEm: null`) e espera que o texto NÃO
  contenha "Encerrado por"/"Motivo do encerramento". Com a guarda antiga o bloco aparecia mesmo assim
  (`tipo === Incident` é verdadeiro para um incidente aberto) — esse teste falharia contra o código
  antigo. Discrimina o bug.
- **Discrimina o bug** — `'mostra travessão para incidente legado fechado sem autor e sem motivo'`
  (`:317-329`): `status: Closed`, `fechadoPorNome: null`, `motivoEncerramento: null`, espera `'—'`.
  Com a guarda antiga a expressão `item.fechadoPorNome ?? 'Motor de monitoramento'` sempre caía no
  fallback quando `fechadoPorNome` é `null` — o texto seria `'Motor de monitoramento'`, não `'—'`.
  Esse teste também falharia contra o código antigo. Discrimina o bug.
- **NÃO discrimina o bug** — `'mostra o motivo de manutenção quando o incidente foi fechado pela
  entrada em manutenção'` (`:282-292`): `status: Closed`, `motivoEncerramento: Maintenance`. A guarda
  antiga também renderiza o bloco para um incidente fechado (`tipo === Incident` continua verdadeiro),
  e o texto do motivo (`rotuloDoMotivoDeEncerramento(...)`) é o mesmo nos dois caminhos — o teste passa
  igual com a guarda antiga ou a nova.
- **NÃO discrimina o bug** — `'atribui ao motor de monitoramento só quando o motivo registrado é
  recuperação automática'` (`:294-304`): `status: Closed`, `fechadoPorNome: null`,
  `motivoEncerramento: AutomaticRecovery`. Guarda antiga: bloco aparece (fechado, `tipo === Incident`),
  texto = `fechadoPorNome ?? 'Motor de monitoramento'` = `'Motor de monitoramento'` — mesmo resultado
  do código novo. Não discrimina.

Os dois testes que não discriminam cobrem casos onde o incidente já está `Closed` e onde o valor
produzido coincide nos dois caminhos; eles continuam válidos como regressão do comportamento correto,
mas não são a prova de que a guarda `tipo === Incident` foi trocada — quem prova isso são os dois
primeiros.

### 2. Motivo de encerramento do episódio não projetado na lista unificada

`infra-monitor-backend/src/main/java/br/com/inframonitor/dashboard/dto/DashboardIncidenteResponse.java:14-17`
(Javadoc lido nesta data):

> "`motivoEncerramento` só vem preenchido em linha de incidente; episódio de latência tem coluna
> própria no banco mas esta projeção não a expõe ainda. Nulo é o caso comum, não exceção..."

O campo `motivoEncerramento` no record é `String` (`:30`). Confirmado em
`infra-monitor-backend/src/main/java/br/com/inframonitor/dashboard/DashboardIncidenteReadRepository.java`
(union query, lida nesta data): o ramo de incidente projeta `i.motivo_encerramento`, o ramo de
episódio de latência não seleciona a coluna equivalente — ela sai `NULL` para toda linha de episódio
na lista unificada, mesmo quando o episódio tem motivo de encerramento gravado no banco (o comentário
confirma que a coluna existe em `monitor_episodio_latencia`, só não é exposta nesta projeção).
Consequência prática: a marca visual de "encerrado por manutenção" na lista unificada
(`incidente-unificado-list.component.html`, comparação contra `IncidentClosureReason.Maintenance`)
nunca aparece para um episódio de latência fechado por manutenção, só para incidentes.

### 3. `motivoEncerramento`: enum num DTO, `String` nos outros dois

- `infra-monitor-backend/src/main/java/br/com/inframonitor/incidente/dto/IncidenteResponse.java:25` —
  tipo `MotivoEncerramentoIncidente` (enum), último campo do record.
- `infra-monitor-backend/src/main/java/br/com/inframonitor/dashboard/dto/DashboardIncidenteResponse.java:30`
  — tipo `String`.
- `infra-monitor-backend/src/main/java/br/com/inframonitor/relatorio/dto/HistoricoIncidenteResponse.java:6`
  — tipo `String`.

Os três DTOs representam o mesmo valor de domínio (o motivo de encerramento de um incidente) com dois
tipos diferentes de serialização. Não é necessariamente um bug — os dois `String` vêm de projeções
nativas/`Tuple` de leitura, onde o valor sai direto da coluna do banco sem passar pela entidade JPA —
mas é uma inconsistência de contrato de API: o mesmo motivo (`MANUTENCAO`, `RECUPERACAO_AUTOMATICA`,
etc.) chega ao frontend tipado num endpoint e como string solta nos outros dois, e qualquer validação
de valor permitido no cliente TypeScript (`IncidentClosureReason`) depende de manter os literais
sincronizados manualmente com o enum Java nos dois DTOs de projeção.

### 4. `@ConditionalOnMissingBean` vestigial — RESOLVIDO

`grep -rn ConditionalOnMissingBean infra-monitor-backend/src` hoje só encontra um comentário
(`infra-monitor-backend/src/main/java/br/com/inframonitor/monitoring/config/MonitoringClockConfiguration.java:12`),
não a anotação em uso. `git log -S"ConditionalOnMissingBean" --oneline` mostra o commit que a removeu:
`acf9266` (`docs(icmp): corrigir achados da revisao final e ajustar dois pontos de codigo`), listado
no próprio corpo do commit como item **K1**. O diff desse commit remove
`@ConditionalOnMissingBean(name = "monitoringClock")` do método `monitoringClock()` e troca por um
comentário explicando por quê: entre `@Configuration` de usuário a ordem de registro não é garantida,
então a anotação faria back-off silencioso se outro lugar declarasse um bean com o mesmo nome — o
oposto da proteção que sugere. A garantia real contra duplicação passou a ser o teste
`MonitoringEngineConfigurationTest.engineHabilitadoComMonitoringClockConfigurationNaoDuplicaBean`
(linha 27), não uma anotação. **Estado atual: resolvido, sem pendência.**

### 5. Três pares de testes sobrepostos

- **Par 1** — `infra-monitor-backend/src/test/java/br/com/inframonitor/monitoring/icmp/IcmpAmbienteConfigurationTest.java:75`
  (`motorDesligadoAindaAssimTentaACarga`) e `:152`
  (`cargaNativaComMotorDesligadoQueFuncionaEntregaALigacao`): os dois chamam
  `IcmpAmbienteConfiguration.resolver(IcmpImplementacao.AUTO, true, false, <fábrica que funciona>)` —
  mesma entrada (`AUTO`, `windows=true`, `motorLigado=false`, carga bem-sucedida) — e ambos afirmam
  `ambiente.cargaNativa() == OK` e `ambiente.ativa() == NATIVO_WINDOWS`. O primeiro acrescenta a
  contagem de chamadas à fábrica e `motorLigado() == false`; o segundo acrescenta
  `ambiente.nativo()` ser a mesma instância mockada. Sobreposição real: o núcleo da asserção
  (`cargaNativa`/`ativa`) é redundante entre os dois.
- **Par 2** — `infra-monitor-backend/src/test/java/br/com/inframonitor/monitoring/config/MonitoringEngineConfigurationTest.java:27`
  (`engineHabilitadoComMonitoringClockConfigurationNaoDuplicaBean`) e `:43`
  (`engineHabilitadoCriaExecutorComMonitoringClockMesmoComNotificationClock`): os dois registram
  `MonitoringClockConfiguration` + `MonitoringEngineConfiguration` com
  `monitoring.engine.enabled=true` e afirmam `context.hasBean("monitoringClock")`. O segundo é
  estritamente mais amplo (acrescenta `NotificationDispatcherConfiguration`, beans de
  `IcmpCommandRunner`/`IcmpMonitorExecutor`, e verifica qual `Clock` o executor recebeu) — o teste de
  `:27` está contido no de `:43` para o que diz respeito à detecção de bean duplicado.
- **Terceiro item — não é um terceiro par distinto, é o mesmo Par 1 sob outro nome.** O brief pede um
  "terceiro par" citando o "achado conhecido 5" de uma revisão anterior (a do branch
  `fix/icmp-nativo-windows`). Reidentificado no transcript
  (`~/.claude/projects/.../3ba51cb4-....jsonl`): a descrição original do achado conhecido 5 é
  "Sobreposição de cobertura entre dois testes de `IcmpAmbienteConfigurationTest` que exercitam a
  mesma combinação de entradas com asserções diferentes" — sem citar linhas. Na revisão do branch
  atual, o mesmo achado foi relatado de novo como "M3", desta vez com linhas concretas: `:75` e
  `:152` — as mesmas do Par 1 acima. Lido o arquivo completo
  (`IcmpAmbienteConfigurationTest.java`, 22 a ~175, todos os `@Test`) para confirmar: **não existe
  nenhum outro par de testes com entrada idêntica nesse arquivo.** Ou seja, "achado conhecido 5" e
  "M3" são a mesma sobreposição, relatada em dois documentos diferentes com dois nomes diferentes —
  não uma terceira instância. Registrando isso como o fato verificado, em vez de inventar um terceiro
  par que não existe no código: **há dois pares reais de testes sobrepostos**, não três.
  (Nota lateral, mesmo transcript: o "M5" da mesma revisão — amostragem de `heapPico`/`threadsPico`
  em `CapacidadeQuedaEmMassaBenchTest.java:139-140` só entre varreduras — não é um par de testes
  sobreposto; é um problema de amostragem, categoria diferente. Não entra nesta lista por não ser o
  que o item pediu.)

### 6. Memória por thread parada — NÃO VERIFICADO

`Docs/validacao-producao/capacidade-pool-monitoramento.md`:
- `:202` — cabeçalho da seção "Memória — NÃO VERIFICADO".
- `:220-221` — "NÃO VERIFICADO: memória por thread parada. Medir isso exige `NativeMemoryTracking`
  (`-XX:NativeMemoryTracking=summary` mais...)".
- `:336` — item 1 do resumo de pendências: "Memória por thread parada — NÃO VERIFICADO. Exige
  `NativeMemoryTracking`, fora do escopo do...".

Continua não verificado nesta rodada: nenhum comando com `-XX:NativeMemoryTracking` foi executado
como parte desta tarefa (fora do escopo — Tasks 1-3 tratam de outras dívidas; esta é só o documento).
Falta, para fechar: subir a JVM com `-XX:NativeMemoryTracking=summary`, rodar o mesmo cenário de queda
em massa do arnês de capacidade, e comparar `jcmd <pid> VM.native_memory summary` antes/depois para
isolar o custo de memória nativa por thread parada do pool (threads ociosas ainda retêm sua pilha
alocada mesmo sem CPU).
