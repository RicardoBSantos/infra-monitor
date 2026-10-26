# Monitoramento parado: investigação

Data: 2026-10-09. Branch: `fix/pre-carga-real`. Item 3 da rodada curta antes da carga real
([desenho](../superpowers/specs/2026-10-09-rodada-curta-pre-carga-design.md)).

Só leitura: nenhum código, nenhuma migration, nenhum boot, nada escrito no banco de dev.
Toda afirmação sobre o comportamento atual cita `arquivo:linha` lido nesta tarefa. Caminhos Java
relativos a `infra-monitor-backend/src/main/java/br/com/inframonitor/`; migrations em
`infra-monitor-backend/src/main/resources/db/migration/`. O que é dedução, e não leitura de código,
está marcado **(raciocínio)**.

Pergunta: se o processo morre, a ausência de medição hoje se confunde com "nenhum monitor tem
candidato". A máquina pode hibernar ou reiniciar e o sistema ficar horas parado sem ninguém
perceber. O que se vê hoje, e o que custaria ver?

**Resposta curta:** hoje nada no sistema distingue motor parado de motor saudável. Se o processo
morre, o painel morre junto (mesma JVM). O verde falso aparece quando a API está viva e o motor
não mede: motor desligado por engano, e a volta de uma parada antes da primeira medição nova.
O SLA continua **subindo para 100 %** nos monitores sem incidente aberto, e somando
indisponibilidade nos que tinham incidente aberto. O `/actuator/health` responde `UP` com o motor
desligado, e o único canal de alerta (Telegram) mora no mesmo processo do motor. A combinação recomendada (seção 4) é barata
na primeira camada — idade da última medição no painel, sem schema — e só fica completa com um
vigia **fora** do processo e, idealmente, fora da máquina.

---

## 1. Estado atual verificado

### 1.1 As peças que importam

**Motor.** `MonitoringScheduler` só existe com `monitoring.engine.enabled=true`
(`monitoring/scheduler/MonitoringScheduler.java:9`) e roda `scheduleDueMonitors` em `fixedDelay`
de 1 s (`MonitoringScheduler.java:13-14`; default em `application.yml:88`). Cada tick lê os
candidatos com `max(md.executadoEm)` numa única consulta (`monitor/repository/MonitorRepository.java:29-38`)
e submete os vencidos (`monitoring/execution/MonitorExecutionCoordinator.java:47-61`). "Vencido" é
`ultimaMedicaoEm == null || now >= ultimaMedicaoEm + intervalo` (`MonitorExecutionCoordinator.java:63-65`).
Não há estado do motor fora da tabela `medicao`: o único rastro de que o motor rodou é a própria
medição gravada (`MonitorExecutionCoordinator.java:82`). Nenhum `ApplicationRunner` ou
`@EventListener` de subida existe além do bootstrap de admin (busca por `ApplicationReadyEvent`,
`ApplicationRunner`, `CommandLineRunner`, `@EventListener` em `src/main/java`).

**Painel.** A CTE `ESTADOS` pega a última medição de cada monitor **sem olhar idade**
(`dashboard/DashboardReadRepository.java:17-19`) e classifica: inativo → `DESABILITADO`; incidente
aberto → `INDISPONIVEL`; nenhuma medição **jamais** → `SEM_DADOS`; latência acima do limiar →
`DEGRADADO`; senão `DISPONIVEL` (`DashboardReadRepository.java:22-26`). O caminho Java do detalhe
faz o mesmo: `possuiMedicao` é só "existe medição" (`dashboard/DashboardService.java:144-147`,
`dashboard/OperationalStatusResolver.java:17-24`). `SEM_DADOS` portanto nunca volta a aparecer
depois da primeira medição. A única pista visual é a coluna "ÚLTIMA VERIFICAÇÃO" ("há X") dentro
da unidade **expandida** (`infra-monitor-frontend/src/app/features/dashboard/dashboard.component.html:138`,
`dashboard.component.ts:231-234`), em texto apagado. O painel não recarrega dados sozinho: o
`setInterval` de 30 s só atualiza o relógio do "há X" (`dashboard.component.ts:165`); dados novos
só com o botão atualizar (`dashboard.component.ts:169-175`).

**Janela de monitoramento.** Só abre e fecha por ação administrativa: `abrir` quando o monitor
vira candidato, `fechar`/`fecharEquipamento` quando deixa de ser
(`relatorio/service/CicloJanelaMonitoramentoService.java:26-32`). O relógio dela fica fora do
`@ConditionalOnProperty` do motor de propósito (`monitoring/config/MonitoringClockConfiguration.java:7-10`).
Nada no ciclo de vida do processo toca a janela: queda, hibernação e reinício a deixam aberta.

**SLA.** O tempo monitorado de uma janela vai de `greatest(:inicio, j.inicio_em, min(md.executado_em))`
até `least(:fim, coalesce(j.fim_em, :fim))` (`relatorio/service/DisponibilidadeSqlRepository.java:44-52`).
Janela aberta conta até `:fim`, haja medição ou não no meio. O tempo indisponível é a interseção
dos incidentes com essas faixas, com incidente aberto contando até `:fim`
(`DisponibilidadeSqlRepository.java:62-69`). Disponibilidade = `(monitorado − indisponível) / monitorado`
(`DisponibilidadeSqlRepository.java:86`); a série diária usa as mesmas faixas
(`DisponibilidadeSqlRepository.java:119-140`). Consequência direta: **tempo sem medição dentro de
janela aberta entra no denominador**, e no numerador como disponível se não havia incidente
aberto, ou como indisponível se havia.

**Incidentes.** Abertura exige as últimas `falhas_para_incidente` medições todas `FALHA`
(`monitoring/incident/IncidentProcessor.java:66-72`), nenhuma anterior ao início da observação
(`IncidentProcessor.java:77-85`), e o incidente nasce em `executado_em` da **primeira** falha da
sequência (`IncidentProcessor.java:86-87`). Fechamento exige as últimas `sucessos_para_recovery`
todas `SUCESSO` e posteriores ao `iniciado_em` (`IncidentProcessor.java:95-102`), e fecha em
`executado_em` da medição atual (`IncidentProcessor.java:103`). **Nenhuma das duas verifica o
espaçamento entre as medições**: a sequência pode atravessar um buraco de horas. Defaults 3 e 2
(`V8__add_incident_thresholds_to_monitor.sql:3-4`). Episódio de latência segue o mesmo padrão
(`monitoring/latency/LatencyEpisodeProcessor.java:113`, `:136`).

**Telegram.** O `NotificationDispatcher` é um `@Component` sem condição de classe
(`notificacao/dispatcher/NotificationDispatcher.java:26`), no mesmo processo, e só envia com
`notification.dispatcher.enabled` e `notification.telegram.enabled` ligados
(`NotificationDispatcher.java:46`; `application.yml:101`, `:112`). Ele usa a **mesma thread de
agendamento** do motor (`application.yml:14-17`, comentário do pool). Notificação só existe ancorada
em incidente ou episódio (`V15__create_episodio_latencia.sql:44-45`) e com `tipo_evento` fechado
num CHECK, hoje na forma da V19 (`V19__add_motivo_encerramento_e_eventos_manutencao.sql:67-82`; enum em
`notificacao/entity/TipoEventoNotificacao.java:3-11`): **não existe hoje como representar um
alerta "monitoramento parado"** sem migration. Pendentes sobrevivem à queda e saem na volta;
`ENVIANDO` antigas são devolvidas à fila (`NotificationDispatcher.java:47`).

**Health.** Só `health` exposto (`application.yml:67-72`), com indicador de banco
(`application.yml:76-78`), público (`security/SecurityConfiguration.java:11`), sem detalhes em
produção (`application-prod.yml:9`). Não há `HealthIndicator` do motor (nenhuma implementação em
`src/main/java`). `/api/v1/status` informa `motorLigado` (`common/api/StatusController.java:38-45`,
`:57-58`), mas exige token e o frontend não lê o campo (nenhuma ocorrência de `motorLigado` em
`infra-monitor-frontend/src`).

**Implantação.** O sistema operacional de produção **não está confirmado** no repositório. A
máquina de desenvolvimento é Windows (ICMP nativo via `IcmpSendEcho`), mas o `CLAUDE.md:124` fala
em "Docker/Linux/Nginx (deploy futuro)" e
[icmp-falsos-positivos.md](icmp-falsos-positivos.md) (linha 41) em "ambiente Linux alvo". Por isso,
cada item operacional abaixo traz as duas variantes, Windows e Linux. O Postgres roda em Docker
com `restart: unless-stopped` (`infra-monitor-backend/compose.yml:21`). Não há no
repositório artefato de instalação do backend como serviço (busca por `nssm`, `WinSW`, "serviço do
Windows", `Task Scheduler` em `Docs/` e na raiz, e por arquivos `.service`, `.timer` e `Dockerfile` versionados: nada).

### 1.2 Cenários

| Cenário | Painel | SLA | Incidentes | Telegram |
|---|---|---|---|---|
| **(a) Processo cai** | Congela no último estado. Monitor que estava bem fica `DISPONIVEL` para sempre (`DashboardReadRepository.java:22-26`). Painel e API morrem junto com o processo (mesmo JVM) — quem abre o painel vê erro de conexão, **não** verde. O verde falso aparece nos cenários em que a API segue viva: (e), e a volta de (a)/(b)/(c) antes da primeira medição nova | Janela segue aberta (`CicloJanelaMonitoramentoService.java:26-32`); horas paradas contam como monitoradas e disponíveis, ou indisponíveis se havia incidente aberto (`DisponibilidadeSqlRepository.java:44-52`, `:62-69`) | Incidente aberto fica aberto. Na volta, fecha após N sucessos com `encerrado_em` = agora (`IncidentProcessor.java:103`): **duração inflada pelo tempo parado**. Falhas de antes da queda somam com as de depois e abrem incidente com `iniciado_em` de antes da queda (`IncidentProcessor.java:87`) | Nada: o dispatcher morreu junto. Pendentes saem atrasadas na volta, sem dizer que houve parada |
| **(b) Máquina hiberna/suspende** | Igual a (a) enquanto suspensa (JVM congelada, nada responde). Na volta o painel antigo aberto num navegador de outra máquina continua mostrando o que tinha, sem recarregar (`dashboard.component.ts:165`, `:169-175`) | Igual a (a) | Igual a (a). **(raciocínio)** Na retomada todos os monitores estão vencidos ao mesmo tempo (`MonitorExecutionCoordinator.java:63-65`); pool de 4 com fila 100 rejeita o excedente e reprocessa nos ticks seguintes (`MonitorExecutionCoordinator.java:72-75`; capacidade medida em [capacidade-pool-monitoramento.md](capacidade-pool-monitoramento.md)). Se a rede (Wi-Fi, VPN) demora mais que `falhas × intervalo` para voltar, todos os monitores falham juntos e abre-se **incidente em massa falso** | **(raciocínio)** Com o incidente em massa falso, rajada de `INCIDENTE_ABERTO` seguida de `INCIDENTE_FECHADO` |
| **(c) Reinício com subida automática** | Igual a (a) no intervalo. Na subida, antes da primeira medição nova, o painel mostra o último estado pré-queda como atual | Igual a (a) | Igual a (a) e (b): rajada de vencidos, risco de incidente em massa se a rede sobe depois do serviço. **(raciocínio)** Se o backend subir antes do Postgres do Docker, o Flyway falha no boot (`application.yml:30-32`) e o processo não sobe — sem retry | Igual a (a), e nenhuma mensagem "voltei" |
| **(d) Banco cai, processo vivo** | API falha (toda leitura é no banco); painel mostra erro, não verde | Nada é gravado; mesma lacuna de (a) na volta do banco | `findActiveExecutionCandidates` falha a cada tick (**raciocínio**: o `@Scheduled` loga e tenta de novo no tick seguinte) | Dispatcher também lê o banco: nada sai. `/actuator/health` fica `DOWN` (`application.yml:76-78`) — **é o único cenário que o health de hoje detecta** |
| **(e) `MONITORING_ENGINE_ENABLED=false` por engano** | **Verde para sempre**, com API viva: nenhum bean do motor existe (`MonitoringScheduler.java:9`, `MonitoringEngineConfiguration.java:20`), as últimas medições ficam como estão | Janelas abertas continuam acumulando tempo disponível: SLA tende a 100 % (`DisponibilidadeSqlRepository.java:44-52`). Pior caso da lista: dados errados com aparência de saudáveis | Nenhum abre nem fecha | Nada a enviar. `/actuator/health` = `UP`. `/api/v1/status` diz `motorLigado=false` (`StatusController.java:42-43`), mas ninguém olha |

O achado principal confirma a pista do desenho: `ESTADOS` não tem idade, então tudo o que a API
serve depois de um buraco de medições é o mundo de antes do buraco, apresentado como presente.

---

## 2. Opções

Convenções: "ciclo" = tick do scheduler (1 s). Custo em código, schema e operação; impacto em
escrita e carga. Toda opção que exige migration nova esbarra na regra desta rodada (única mudança
de schema permitida é a V20) e fica para depois dela.

### (a) Heartbeat gravado a cada ciclo

Tabela de uma linha (`motor_heartbeat(id, visto_em, instancia)`) e `UPDATE ... SET visto_em = now()`
no fim de `scheduleDueMonitors`.

- **Custo:** migration nova; ~20 linhas (repositório + chamada no scheduler); um teste.
- **Impacto:** 86.400 `UPDATE`/dia numa linha só a 1 s. Atualização HOT, inofensiva para o
  Postgres, mas é ruído desnecessário: gravar no máximo a cada 30 s (comparar com o último
  `visto_em` em memória) basta, já que o menor intervalo de monitor é 10 s
  (`V5__create_monitor.sql:14`).
- **Detecta:** processo morto, JVM congelada (hibernação), motor desligado (a linha para de andar),
  thread de agendamento travada.
- **Não detecta sozinho:** nada — o heartbeat é um **sinal**, não um alarme. Alguém precisa lê-lo
  (opções c, d). Também não detecta workers travados com o scheduler vivo (o tick roda, mas nenhuma
  medição sai); para isso o sinal certo é a medição, não o tick.
- **Alternativa sem schema (raciocínio):** `max(executado_em)` de `medicao` já é um heartbeat de
  saída — prova que medições estão **sendo gravadas**, que é o que importa. Custo: uma consulta
  que o índice `ix_medicao_executado_em (executado_em DESC)` resolve sem varrer a tabela
  (`V6__create_medicao.sql:24`); a versão por monitor usa `ix_medicao_monitor_executado_em`
  (`V6__create_medicao.sql:21`). A tabela própria só
  ganha quando "nenhum monitor ativo" é legítimo (heartbeat anda, medição não).
- **Hibernação/reinício:** para durante o sono, volta na retomada. O buraco fica registrado só
  implicitamente (último valor antes do salto), não como evento.

### (b) Verificação na subida

No `ApplicationReadyEvent`, comparar o último `executado_em` (global e por monitor) com o intervalo
esperado; se a lacuna passa de `k × intervalo`, registrar "monitoramento ficou parado de X a Y" e
notificar.

- **Custo:** listener + consulta, ~40 linhas. Registrar a lacuna e mandar Telegram exige migration:
  a notificação precisa de âncora em incidente ou episódio (`V15__create_episodio_latencia.sql:44-45`)
  e de `tipo_evento` nos CHECKs de tipo e de coerência tipo × âncora (`V19__add_motivo_encerramento_e_eventos_manutencao.sql:67-82`). Alternativa sem schema: só log `WARN` na subida (custo
  quase zero, mas só serve a quem lê log).
- **Impacto:** uma consulta por boot.
- **Detecta:** (a), (c), e (d) se o processo for reiniciado depois. É o único que **data a lacuna**
  ("de X a Y") de forma explícita, e o dado de entrada para a opção (e).
- **Não detecta:** hibernação (o processo não reinicia — **raciocínio**: a retomada não dispara
  evento de subida no Spring); motor desligado (o listener do motor não existiria, ou rodaria e
  veria lacuna mas o motor continuaria parado); nada **enquanto** está parado — só avisa depois que
  voltou, horas tarde.
- **Variante que cobre hibernação (raciocínio):** a mesma verificação dentro do tick, comparando
  `now` com o tick anterior em memória; salto acima de, digamos, 60 s = o processo esteve congelado.
  Sem schema para detectar; com schema para registrar.

### (c) Idade da última medição no painel

Status novo `DESATUALIZADO` quando `now() - executado_em > k × intervalo_segundos` do monitor,
calculado em `ESTADOS` (`DashboardReadRepository.java:22-26`) e espelhado no caminho Java
(`OperationalStatusResolver.java:17-24`, `DashboardService.java:144-147`).

- **Custo:** sem schema. SQL (`m.intervalo_segundos` já está na tabela `monitor`), resolver puro,
  enum novo em `StatusOperacionalMonitor`/`StatusOperacionalEquipamento`/`StatusOperacionalUnidade`,
  precedência nova no resolver de unidade (`OperationalStatusResolver.java:59-74`), badge e
  contador no frontend, testes. Médio: toca as três camadas de status e o PDF/visão geral se eles
  reusam o mesmo enum. Decisão de produto: `DESATUALIZADO` ganha de `INDISPONIVEL`? (raciocínio:
  não — incidente aberto é fato registrado; mas o incidente também está desatualizado.)
- **Variante mínima:** uma faixa global no topo do painel, "última medição do sistema há X min",
  com `max(executado_em)` contra o menor intervalo ativo. Uma consulta, sem enum novo. Corrige a
  percepção sem reclassificar nada.
- **Impacto:** nenhuma escrita; `ESTADOS` já lê `executado_em`.
- **Detecta:** tudo o que impede medições novas **enquanto a API está viva**: (e) motor desligado,
  workers travados, volta de (a)/(b)/(c) antes da primeira medição. Corrige o verde falso.
- **Não detecta:** processo morto (a API também morreu — o painel nem carrega); ninguém olhando o
  painel; painel aberto que não recarrega (`dashboard.component.ts:165`) — o "há X" do relógio
  continua andando, mas o **status** só muda após atualizar.
- **Hibernação/reinício:** acerta sozinho na volta, porque é calculado na leitura.
- `k`: com `fixedDelay` de 1 s e pool saturável, atraso de um ciclo é normal; `k = 3` evita piscar
  e casa com o default de `falhas_para_incidente` (`V8__add_incident_thresholds_to_monitor.sql:3`).

### (d) Vigia externo ao processo

Um agendador do próprio sistema operacional (o de produção não está confirmado, ver 1.1): no
Windows, o Agendador de Tarefas com script PowerShell; no Linux, um systemd timer (ou cron) com
script shell. Se o backend for conteinerizado, o `healthcheck` do Docker pode fazer a checagem,
mas sozinho só marca o container como `unhealthy` e não alerta ninguém; o alerta continua sendo
um script do host. O vigia lê o heartbeat (ou `max(executado_em)`) no Postgres, ou um `/actuator/health`
que reflita o motor, e manda Telegram **por conta própria** (curl na API do Bot).

- **Custo:** script pequeno (PowerShell + `psql`/`Invoke-RestMethod` no Windows; shell + `psql`/`curl` no Linux), credencial do bot e do
  banco fora do processo, procedimento de instalação. Para ler pelo health, um `HealthIndicator`
  do motor (~30 linhas, sem schema se usar `max(executado_em)`), que hoje não existe.
- **Impacto:** uma consulta a cada N minutos.
- **Detecta:** processo morto, motor desligado, banco fora, travamento — tudo o que acontece com a
  **máquina ligada**. Avisa **durante** a parada, que nenhuma opção interna faz.
- **Não detecta:** a própria máquina hibernada, desligada ou sem rede — o vigia dorme junto
  (raciocínio: nem a tarefa agendada do Windows nem o timer ou cron do Linux rodam com a máquina
  suspensa; ao acordar, roda e alerta
  tarde, o que ainda é útil). Também não detecta falha no Telegram.
- **Hibernação/reinício:** detecta tarde (na retomada). Em reinício, alerta se o serviço não subir.

### (e) Lacuna tratada no SLA

Tempo sem observação deixa de contar como monitorado (sai do denominador) ou passa a ser marcado.

- **Custo:** alto. Hoje a faixa monitorada é contínua da primeira medição até o fim da janela
  (`DisponibilidadeSqlRepository.java:44-52`); recortar buracos exige ou (1) derivar lacunas das
  próprias medições (`lead(executado_em) - executado_em > k × intervalo`, por monitor, no período —
  sem schema, mas pesa no relatório sobre a tabela `medicao` inteira), ou (2) gravar lacunas numa
  tabela (com a opção b) e subtraí-las das faixas com `range_agg`, que já está em uso
  (`DisponibilidadeSqlRepository.java:54`). Muda número homologado de SLA, então exige revisão do
  relatório e do PDF, e decisão de produto: lacuna com incidente aberto é indisponível ou "não
  observado"?
- **Detecta:** nada em tempo real. É **correção de histórico**, não alarme.
- **Corrige:** SLA inflado (lacuna como disponível) e duração de incidente inflada pela lacuna
  (`IncidentProcessor.java:103`) — esta última precisaria de regra própria no `IncidentProcessor`
  (não aceitar sequência que atravessa lacuna), o que é uma mudança de semântica de incidente.

### (f) Outras que a leitura revelou

1. **Dead man's switch fora da máquina.** O processo faz um GET a cada N minutos num serviço
   externo (do tipo healthchecks.io, ou um endpoint de outra máquina da rede); o serviço alerta
   quando os pings **param**. Custo: ~15 linhas e uma dependência externa (internet ou segundo
   host). É a **única** opção que cobre máquina desligada, hibernada, sem rede, e Telegram local
   indisponível. Detecta motor parado se o ping sair do tick do motor (não de um timer separado).
2. **Operação: serviço com reinício automático e plano de energia sem suspensão.** O SO de produção não está
   confirmado, então seguem as duas variantes:
   - **Windows:** serviço com restart on failure (WinSW, NSSM ou equivalente), início atrasado ou
     dependência do Docker, e plano de energia sem suspensão nem hibernação.
   - **Linux:** unidade systemd com `Restart=always` e `After=`/`Wants=` de `docker.service` (ou
     `postgresql.service`, se o banco for nativo), e
     `systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target`.
   - **Conteinerizado:** `restart: unless-stopped` (como o Postgres já tem,
     `infra-monitor-backend/compose.yml:21`), `depends_on` com `condition: service_healthy` sobre o
     healthcheck do Postgres, e `healthcheck` próprio no backend.
   Custo: procedimento, sem código. Não detecta nada — **reduz**
   a frequência de (a), (b) e (c). Deveria vir antes de qualquer alarme.
3. **Mensagem "monitoramento retomado" na subida.** Variação de (b) com envio direto pelo
   `TelegramClient`, fora da fila `notificacao` para não precisar de migration. Detecta (a)/(c)
   depois do fato; não deixa histórico consultável.
4. **Recusar sequência que atravessa lacuna no `IncidentProcessor`.** Não é detecção, mas evita os
   dois efeitos colaterais do retorno: incidente com `iniciado_em` de antes da parada
   (`IncidentProcessor.java:87`) e incidente em massa falso quando a rede volta depois do motor.
   Mudança de semântica de incidente — fora do escopo desta rodada.
5. **Proteção contra (e):** exibir `motorLigado` de `/api/v1/status` (`StatusController.java:42-43`)
   no frontend, ou fazer o `HealthIndicator` reportar `DOWN` com motor desligado na instância que
   deveria monitorar. Custo baixo; cobre exatamente o engano de configuração.

---

## 3. Matriz

D = detecta; T = detecta tarde (só depois que volta ou quando alguém olha); N = não detecta.

| Opção \ cenário | (a) processo cai | (b) hiberna | (c) reinicia | (d) banco cai | (e) motor desligado | máquina off/sem rede |
|---|---|---|---|---|---|---|
| Hoje | N | N | N | D (health `DOWN`, sem alerta) | N | N |
| (a) heartbeat sozinho | N (sinal sem leitor) | N | N | N | N | N |
| (b) verificação na subida | T | N (T na variante do tick) | T | T (se reiniciar) | N | T (na volta) |
| (c) idade no painel | N (painel morre junto); T na volta | T (na volta) | T (na volta) | N (API morre) | **D** (com alguém olhando) | N |
| (d) vigia externo local | **D** | T | D se o serviço não subir | **D** | **D** | N |
| (e) lacuna no SLA | T (corrige histórico) | T | T | T | N (sem lacuna detectável se o motor nunca rodou) | T |
| (f1) dead man's switch externo | **D** | **D** | **D** | D (se o ping depende do tick que lê o banco) | **D** | **D** |
| (f2) serviço + sem suspensão | reduz | evita | reduz | — | — | — |
| (f5) `motorLigado` visível / health | N | N | N | — | **D** | N |

---

## 4. Recomendação

Em ordem de custo/benefício:

1. **Operação primeiro (f2), custo zero de código.** Backend como serviço com reinício automático e
   dependência ou retry de subida até o Postgres responder (o boot hoje falha se o banco não
   estiver pronto: `application.yml:30-32`), e máquina sem suspensão. No Windows: WinSW/NSSM com
   restart on failure e plano de energia sem suspensão. No Linux: systemd com `Restart=always`,
   `After=docker.service` (ou `postgresql.service`) e `systemctl mask sleep.target suspend.target
   hibernate.target hybrid-sleep.target`. Em container: restart policy, `depends_on` com
   `service_healthy` e healthcheck (detalhes em (f2)). O SO de produção não está confirmado
   (seção 1.1). Isso tira (b) da mesa e encurta (a) e (c).
2. **Idade da última medição no painel (c), variante mínima.** Faixa global "última medição há X"
   e, depois, o status `DESATUALIZADO` por monitor. Sem schema. Corrige o verde falso, que é o
   defeito mais enganoso do estado atual, e cobre (e) para quem olha o painel. Na mesma passada,
   (f5): `HealthIndicator` do motor baseado em `max(executado_em)`, para o health deixar de dizer
   `UP` com o motor parado.
3. **Vigia externo (d) lendo esse health**, com Telegram próprio: Agendador de Tarefas no
   Windows, systemd timer ou cron no Linux. Pequeno, e é o primeiro item que
   **avisa durante** a parada sem ninguém olhando. Não precisa da tabela de heartbeat se o
   indicador usar `max(executado_em)`.
4. **Dead man's switch fora da máquina (f1)**, se houver serviço externo aceitável. Único que
   cobre máquina desligada, hibernada ou isolada da rede.
5. **Verificação na subida (b) com registro da lacuna**, e só então **(e) lacuna no SLA** e
   **(f4) sequência que não atravessa lacuna**. Os três precisam de migration e mudam número
   homologado ou semântica de incidente; ficam para depois da carga real, com decisão de produto.

A tabela de heartbeat (a) só se justifica se "nenhum monitor ativo" virar caso legítimo de
produção — aí `max(executado_em)` para de andar sem que o motor esteja parado.

### O que continua sem cobertura mesmo com tudo acima

- **Processo e Telegram caindo juntos, com vigia local na mesma máquina desligada:** sem (f1)
  ninguém é avisado. Com (f1), o aviso depende do serviço externo e da internet.
- **Telegram fora do ar ou bot bloqueado:** nenhum alerta chega e nada avisa que não chegou; o
  dispatcher registra `FALHA` após as tentativas, mas isso só se vê na tela de notificações.
- **Painel aberto há horas sem atualizar:** mostra o estado da última carga
  (`dashboard.component.ts:165`, `:169-175`). Só o "há X" anda.
- **Histórico já gravado:** períodos parados antes de qualquer correção continuam contados como
  disponíveis (ou indisponíveis, se havia incidente aberto) no SLA. (e) não é retroativo a menos
  que derive lacunas das medições existentes.
- **Rede da máquina volta depois do motor (hibernação, reinício):** incidente em massa falso e
  rajada no Telegram continuam possíveis até (f4).

### Sinal parcial: atraso de janela de manutenção (2026-10-22)

A manutenção agendada (`Docs/manutencao-agendada-architecture/`, MA08) grava separadamente o horário
previsto e o real de cada transição: `ativada_em` × `inicio_previsto` e `encerrada_em` × `fim_previsto`.
O reconciliador roda a cada 30 s; atraso acima de dois intervalos só acontece se o processo esteve
fora (ou o reconciliador, desligado) no horário previsto. Uma janela `EXPIRADA` diz que o sistema
esteve fora durante a janela inteira. É a primeira coisa no sistema que **data** uma parada a partir
de um dado gravado, e a tela a mostra ("ativada com 47 min de atraso").

**Não substitui a detecção.** O sinal só existe quando havia uma janela agendada justamente no
horário da parada; só aparece depois que o sistema volta; não avisa ninguém enquanto está parado; e
não corrige o SLA nem os incidentes do período (cenários (a)–(e) de §1.2 continuam como estão). É
evidência lateral para quem investiga, não alarme. As opções de §2 continuam necessárias.

### Nota lateral

Durante a leitura: `NotificationDispatcher.java:67-70` desreferencia `getIncidente().getId()` no
log, e notificação de episódio tem `incidente_id` nulo (`V15__create_episodio_latencia.sql:36`).
O envio já foi marcado antes (`:66`) e o segundo `complete` é inócuo
(`notificacao/dispatcher/NotificationDispatchStateService.java:22-23`), mas cada notificação de
latência gera um `ERROR` "Erro interno ao processar notificacao" no log — ruído que atrapalha
justamente quem for diagnosticar uma parada pelo log. Já registrado em
[auditoria-concorrencia-ciclo-de-vida.md](auditoria-concorrencia-ciclo-de-vida.md) (linha 136).
