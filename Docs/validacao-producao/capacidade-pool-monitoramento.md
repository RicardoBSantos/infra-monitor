# Capacidade do pool de monitoramento numa queda em massa

Data da medição: 2026-09-22. Branch `fix/icmp-nativo-windows`. Máquina de desenvolvimento,
Windows 11, 24 CPUs lógicas, Java 21.0.8 HotSpot, heap máximo ergonômico de 4,0 GB.

Pergunta que originou a medição: numa queda em massa, cada monitor que falha segura uma thread do
pool pelo timeout inteiro. O pool atual — 4 workers, fila 100 — aguenta?

**Resposta curta: não.** Com 100 dos 250 monitores caídos, os monitores saudáveis passam a ser
sondados com 20,8 s de atraso na mediana sobre o intervalo de 30 s. Com os 250 caídos, o pool de 4
não completou três ciclos de falha nem em 960 s simulados, e a fila de 100 rejeitou 80.269
submissões. Os números estão na tabela abaixo. **Nada foi alterado no pool nesta tarefa** — a
proposta está na seção 4 e depende de decisão.

---

## 1. O que foi medido e como

O arnês é
`infra-monitor-backend/src/test/java/br/com/inframonitor/monitoring/execution/CapacidadeQuedaEmMassaBenchTest.java`.

Rodar:

```bash
cd infra-monitor-backend
./mvnw -o test -Dexcluded.groups=rede-real -Dgroups=bench
```

Fica fora do `./mvnw test` por `@Tag("bench")` mais `<excluded.groups>rede-real,bench</excluded.groups>`
no `pom.xml`: ele segura threads de propósito e levou 419 s para as 9 células.

### O que é real e o que é falso

| Peça | Estado no arnês |
|---|---|
| `MonitorExecutionCoordinator` | **real** — a classe de produção, sem alteração |
| `ExecutorQueLogaFalhas` | **real** |
| `ThreadPoolExecutor` | **real**, montado igual a `MonitoringEngineConfiguration`: core = max = workers, fila `ArrayBlockingQueue(100)`, `AbortPolicy`, `ThreadFactory` com o mesmo padrão de nome |
| `MonitorRepository` | falso — devolve os 250 `MonitorCandidate` com `ultimaMedicaoEm` **vivo**, lido de um mapa em memória que o `MedicaoService` falso atualiza a cada `criar`. Sem isso o `isDue` nunca voltaria a ser falso e a medição de atraso não significaria nada |
| `MedicaoService` | falso — subclasse que sobrescreve `criar`, grava `ultimaMedicaoEm` e conta por status. Não toca banco |
| `MonitorExecutor` | falso — `supports()` devolve `ICMP`; o sucesso ocupa ~1 ms, a falha ocupa o timeout inteiro, que é o que o `IcmpSendEcho` faz quando o host não responde |

**Nenhum banco foi usado.** O Postgres de desenvolvimento na porta 5434 não foi tocado.

**O `MedicaoService` falso também retira ocupação real do modelo.** Em produção,
`MedicaoService.criar` roda *dentro* do worker que acabou de medir — `findById`, `save`, mais
`IncidentProcessor` e `LatencyEpisodeProcessor` — e esse tempo conta como thread ocupada. No arnês
ele virou um `put` em `ConcurrentHashMap`, que não segura a thread quase nada. O dimensionamento
que sai destas 9 células é, portanto, um **piso**: a ocupação real de produção por sondagem
bem-sucedida é maior do que o ~1 ms medido aqui, porque inclui banco e pós-processamento que o
arnês não modela. Isso não muda a conclusão sobre a falha (que já ocupa o timeout inteiro,
dominado pelo `IcmpSendEcho`, não pelo `MedicaoService`), mas afeta o caminho de sucesso: para
sucesso, a ocupação real é dominada pelo banco e pelo pós-processamento, não pelo timeout — ao
contrário da falha, cuja ocupação É aproximadamente linear no timeout (ver seção 5).

### O relógio, e por que ele é comprimido e não congelado

Um ciclo de produção é 30 s de intervalo com 2000 ms de timeout; três ciclos de falha de 250
monitores num pool de 4 levariam mais de 20 minutos reais por célula. Por outro lado o tempo que a
thread falha passa parada **é** a ocupação do pool: virtualizar isso destruiria a medição.

A saída foi comprimir o experimento inteiro pelo mesmo fator. O `Clock` que o coordenador lê é um
`RelogioComprimido`: ancorado num instante fixo, ele anda `FATOR` vezes mais rápido que o relógio de
parede. Toda espera real do runner falso é dividida pelo mesmo `FATOR`. A **razão** entre ocupação de
thread e intervalo de agendamento — que é o que determina a saturação — fica idêntica à de produção,
e a ocupação do pool continua sendo tempo real de thread parada.

**`FATOR` = 4**, não 10. Com 10, a espera real de uma falha seria 200 ms e a de um sucesso 100 µs; o
relógio de espera do Windows tem granularidade de ~15 ms, e a primeira rodada mediu um "sucesso de
1 ms" ocupando **15,37 ms reais** — 15 vezes o pretendido. Com `FATOR` = 4 a falha espera 500 ms
reais, e a espera abaixo de 2 ms passou a girar (`Thread.onSpinWait`) em vez de dormir. O arnês
**mede** a ocupação efetiva de cada caminho em vez de assumir a nominal, e o resultado ficou fiel:

- sucesso: **0,25 ms reais = 1,0 ms virtual** (nominal 1 ms)
- falha: **504–510 ms reais = 2016–2038 ms virtuais** (nominal 2000 ms; +1 a +2%)

Todos os tempos reportados abaixo já estão em **tempo virtual**, ou seja, na escala de produção.

### Como as rejeições foram contadas

Por **decorador de `ExecutorService`** (`ExecutorQueContaRejeicoes`), não por `ListAppender` do
Logback. Motivo: o decorador conta o evento no ponto exato em que ele acontece, sem depender do nível
de log configurado nem do texto da mensagem — e o `MonitorExecutionCoordinator` engole a
`RejectedExecutionException` e só emite um WARN (`"Monitoring worker pool is saturated; monitor {}
will be retried"`), de modo que um `ListAppender` mediria a configuração de log tanto quanto o pool.
O decorador é a camada mais externa: por dentro dele a cadeia de produção
(`ExecutorQueLogaFalhas` → `ThreadPoolExecutor` → `AbortPolicy`) continua inteira.

### Parâmetros

250 monitores, intervalo 30 s, timeout 2000 ms, fila 100, `scheduler-delay` 1000 ms, alvo de 3 ciclos
de falha. Os K primeiros da lista falham, os 250 − K restantes respondem. Teto de segurança de 4
minutos reais (960 s virtuais) por célula.

---

## 2. As 9 células

`atraso` = `(instante da medição − ultimaMedicaoEm) − intervalo`, por monitor saudável, em ms
virtuais. Zero seria o monitor sondado exatamente no seu intervalo.

| K caídos | workers | 3º ciclo de falha de **todos** os K | Rejeições | Atraso dos saudáveis p50 / p95 / máx (ms) |
|---:|---:|---|---:|---|
| 25 | 4 | 79,9 s | 2.141 | 2.486 / 2.987 / 3.480 (n=450) |
| 100 | 4 | 152,9 s | 6.100 | **20.831 / 31.037 / 31.043** (n=192) |
| 250 | 4 | **não atingiu em 960,8 s** | **80.269** | — (não há saudáveis) |
| 25 | 16 | 68,9 s | 772 | 2.280 / 2.399 / 3.433 (n=450) |
| 100 | 16 | 81,5 s | 1.468 | 3.057 / 4.258 / 4.375 (n=300) |
| 250 | 16 | 99,9 s | 1.260 | — (não há saudáveis) |
| 25 | 32 | 66,9 s | 107 | **332 / 372 / 1.377** (n=450) |
| 100 | 32 | 73,0 s | 716 | 2.199 / 2.561 / 2.619 (n=300) |
| 250 | 32 | 83,4 s | 560 | — (não há saudáveis) |

O **piso** da coluna "3º ciclo" é ~62 s: a 1ª medição sai em t≈0, a 2ª em t≈30 s, a 3ª em t≈60 s,
mais os 2 s da sondagem. Tudo acima de 62 s é atraso induzido pela saturação.

**Nota sobre a coluna de atraso: em uma célula o `n` é um piso, não uma amostra completa.** O laço
para quando os K falhos atingem 3 falhas cada, e o atraso de um saudável só é registrado quando já
existe uma medição anterior dele — então, se a célula não rodou tempo suficiente para que todos os
`(N−K)` saudáveis completassem `(ciclos−1)` = 2 medições, os monitores mais famintos (os de pior
atraso) não contribuem amostra nenhuma, e ficam justamente de fora. Isso é visível na linha K=100/4:
esperado `n = 150 × 2 = 300`, medido `n = 192`. O acúmulo de p95=31.037 contra max=31.043 nessa
linha é a assinatura de um **teto de um ciclo perdido**, não de uma cauda estatística — quando
`n < saudáveis × (ciclos−1)`, leia p95/máx da linha como **piso do atraso real**, não como
percentil confiável. As demais linhas completaram a amostra esperada (n=450 para K=25 em todos os
pools; n=300 para K=100/16 e K=100/32).

### Leitura

1. **K=250 / 4 workers é uma quebra, não uma lentidão.** Em 960,8 s virtuais o pool produziu 1.896
   medições de falha. A capacidade teórica de 4 workers nesse tempo é 960,8 / 2,03 × 4 = 1.893
   medições: **o pool entregou 100% do que podia**. Ainda assim nem todos os 250 monitores chegaram a
   3 falhas — e 1.896 medições seriam suficientes para 632 monitores. A conclusão não é falta de
   vazão, é **distribuição injusta**, mas o alcance do achado precisa ficar restrito ao que o
   repositório real sustenta: `MonitorRepository.findActiveExecutionCandidates()` é um `group by`
   **sem `ORDER BY`** (confira em `monitor/repository/MonitorRepository.java`). A ordem em que ele
   devolve os candidatos é a que o plano de execução do Postgres produzir — estável na prática, não
   garantida por contrato. O que é sustentável dizer: com fila menor que N e o pool saturado,
   **alguém é sistematicamente preterido** pela `AbortPolicy` a cada varredura; **quem** depende da
   ordem que o banco devolver. No arnês, os K falhos são sempre os ids 1..k, então ficam na cabeça de
   toda varredura (pela ordem de inserção do estado falso) e agarram o pool antes dos saudáveis em
   toda passada — isso é o **pior caso** possível para a injustiça, não necessariamente o caso real
   de produção, onde a ordem de retorno do Postgres não segue a ordem dos ids. Em produção, o efeito
   de "alguém fica sem sondagem" é o mesmo; **quem** fica de fora pode variar entre varreduras se o
   plano do banco não for estável.
2. **O ponto de virada está entre K=25 e K=100 com 4 workers.** Com 25 caídos o atraso mediano do
   saudável é 2,5 s sobre 30 s (tolerável). Com 100 caídos vai para 20,8 s (piso — ver nota acima), e
   o p95 para 31,0 s: na prática o intervalo efetivo de um monitor saudável **dobra**, de 30 s para
   ~61 s. A detecção de uma queda nova fica duas vezes mais lenta exatamente durante o incidente em
   que ela mais importa.
3. **A conta que prevê isso é simples e bateu com a medição.** Uma falha ocupa uma thread pelo
   timeout; em regime, a ocupação exigida é `K × timeout / intervalo` workers. Para K=250, timeout
   2 s e intervalo **30 s** (o intervalo usado nesta medição — ver a reconciliação com o padrão de
   60 s do formulário na seção 5): **16,7 workers só para acompanhar as falhas**. Daí 4 workers não
   fecharem o ciclo (célula 3), 16 fecharem com folga zero (99,9 s contra piso de 62 s) e 32
   fecharem com folga (83,4 s).
4. **A fila de 100 não cabe uma varredura, mas quanto sobra depende do pool.** Uma varredura submete
   até 250 monitores; a capacidade imediata de uma passada é `workers + fila`. Com fila 100 e 4
   workers, cabem 104 e **ao menos 146 são rejeitados** na primeira passada — esse número (o do
   documento original) só vale para 4 workers. Com 32 workers cabem 132, e o piso de rejeitados cai
   para `250 − 132 = 118`. A rejeição em si é inofensiva — o monitor volta na próxima varredura —
   mas é **ordenada** pelo que o repositório devolver, e é ela que produz a injustiça do item 1.

---

## 3. Custo de uma thread parada no `IcmpSendEcho`

### CPU — medido

`ThreadMXBean.getThreadCpuTime` somado sobre as threads `monitor-worker-*`, ao fim de cada célula,
contra o tempo de parede da célula:

| Célula | CPU somada dos workers | Tempo de parede real | Fração de **uma CPU** (CPU somada ÷ parede) |
|---|---:|---:|---:|
| K=25 / 4 | 109 ms | 20,0 s | 0,5% |
| K=100 / 4 | 0 ms | 38,2 s | 0,0% |
| K=250 / 4 | 547 ms | 240,2 s | 0,2% |
| K=250 / 16 | 203 ms | 25,0 s | 0,8% |
| K=250 / 32 | 344 ms | 20,9 s | 1,6% |

A coluna é CPU somada dividida pelo tempo de parede — fração de **uma** CPU, não do pool inteiro.
(A versão anterior deste documento dividia também por `workers`, o que media fração do pool e não
de uma CPU; o rótulo estava 32x deslocado na célula mais pesada. O achado não muda: 1,6% de uma CPU
continua desprezível, só o número publicado estava errado.)

Com os 250 monitores caídos e 32 workers ocupados praticamente o tempo todo, as 32 threads juntas
consumiram 344 ms de CPU em 20,9 s — **1,6% de uma CPU** (equivalente a 0,05% do pool de 32 CPUs
lógicas, se todas fossem dedicadas ao teste). Uma thread parada esperando a resposta ICMP não gira
CPU; o custo dela é ocupar um slot do pool, não processador. Esse é o achado que importa para o
dimensionamento: **aumentar `worker-threads` compra vazão sem comprar CPU.**

Duas ressalvas de honestidade:

- O número medido é um **teto**, não um piso: ele inclui o giro de até 2 ms do próprio arnês no fim
  de cada espera (a correção da granularidade do relógio do Windows). O custo real é menor ainda.
- A medição tem quantização de ~15,6 ms por thread no Windows, e é por isso que uma célula marcou
  0 ms. O valor verdadeiro está no piso do instrumento, não abaixo de zero.
- O arnês **estaciona** a thread; ele não chama o `IcmpSendEcho`. Que a chamada nativa real também
  bloqueie sem girar CPU é o comportamento esperado de uma espera de I/O, mas **isso não foi medido
  aqui**: NÃO VERIFICADO para o caminho nativo.

### Memória — NÃO VERIFICADO

O arnês mediu o heap antes e no pico de cada célula:

| Célula | Heap antes | Heap pico | Δ | Threads vivas no pico |
|---|---:|---:|---:|---:|
| K=25 / 4 | 15,1 MB | 45,1 MB | 30,0 MB | 7 |
| K=25 / 32 | 15,7 MB | 25,0 MB | 9,3 MB | 35 |
| K=250 / 4 | 15,7 MB | 49,7 MB | 34,0 MB | 7 |
| K=250 / 32 | 15,7 MB | 30,3 MB | 14,7 MB | 35 |

**Esses números não medem o custo de uma thread parada e não devem ser usados para isso.** O delta
de heap é *maior* com 4 workers (30,0 e 34,0 MB) do que com 32 (9,3 e 14,7 MB): ele é dominado pelo
lixo que o próprio arnês produz — uma lista nova de 250 `MonitorCandidate` a cada varredura, e com 4
workers o teste varre por muito mais tempo. Não dá para separar dali o custo por thread.

O que a pilha de uma thread custa também não sai deste arnês: a pilha é memória **fora do heap**,
reservada em espaço de endereçamento e comprometida sob demanda, e a flag `ThreadStackSize` desta JVM
lê `0`, que significa "padrão da plataforma" e não um tamanho apurado. **NÃO VERIFICADO: memória por
thread parada.** Medir isso exige `NativeMemoryTracking` (`-XX:NativeMemoryTracking=summary` mais
`jcmd VM.native_memory`), que não faz parte deste arnês.

O que **está** verificado é a contagem de threads — com uma ressalva de instrumento: o arnês usa
`Thread.activeCount()`, que conta o **grupo de threads corrente** (o do teste), não o processo
inteiro. Nesta JVM de teste isso coincide na prática com as threads relevantes, mas a frase correta
é: o grupo de threads do teste ficou com `workers + 3` threads vivas (7, 19 e 35 para 4, 16 e 32
workers), isto é, o pool não cria nada além dos seus workers, e subir de 4 para 32 acrescentou 28
threads a esse grupo.

---

## 4. Proposta de `worker-threads` e `queue-capacity`

Proposta, não mudança: nada em `application.yml` foi alterado.

### `worker-threads`: 4 → **32**

- A exigência analítica para acompanhar uma queda total do inventário atual, **com o intervalo de
  30 s usado nesta medição**, é `250 × 2 s / 30 s = 16,7` workers. 16 é o mínimo que fecha a conta, e
  a medição confirma: a célula K=250/16 levou 99,9 s contra um piso de 62 s — passa, sem folga
  nenhuma. Com o intervalo real do formulário (60 s), a exigência cai para 8,3 workers — ver a
  reconciliação na seção 5. A proposta de 32 workers abaixo usa o pior caso (30 s) de propósito.
- 32 dá o dobro da exigência de 30 s (e ~4x a exigência de 60 s): cobre crescer até ~480 monitores
  antes de voltar ao mesmo aperto em 30 s, e é a única linha em que o monitor saudável foi sondado
  quase no horário mesmo com falhas em massa (K=25/32: atraso mediano de 0,33 s; K=100/32: 2,2 s,
  contra 20,8 s no pool de 4).
- O custo disso é 28 threads a mais. Pela seção 3, threads paradas em I/O não consomem CPU
  significativa (1,6% de uma CPU para 32 threads ocupadas na célula mais pesada), e a máquina tem
  24 CPUs lógicas. O custo de memória por thread não foi medido e continua sendo a incógnita desta
  proposta.

### `queue-capacity`: 100 → **300**

- Uma varredura submete até N monitores; enquanto a fila for menor que N, toda varredura rejeita
  alguém. **No arnês** os rejeitados são sempre os do fim da lista de ids, porque o repositório
  falso devolve na ordem 1..N; **em produção**, quem é rejeitado depende da ordem que
  `findActiveExecutionCandidates()` devolver — um `group by` sem `ORDER BY`, não garantida por
  contrato (seção 2, item 1). O mecanismo ("alguém sempre fica de fora enquanto fila < N") é o
  mesmo; só "quem" não está provado para produção.
- 300 > 250 faz caber uma varredura inteira com folga, e a rejeição volta a ser o que ela deveria
  ser: sinal de que o pool não vazou uma varredura inteira antes da seguinte, não um sorteio viciado
  por posição na lista.
- A fila não substitui workers: com fila 300 e 4 workers, a espera só mudaria de lugar. As duas
  mudanças andam juntas.

### O que a medição **não** autoriza a concluir

Que 32/300 é ótimo. O arnês varreu três tamanhos de pool, não um espaço contínuo, e a máquina de
medição não é o servidor de produção. 32/300 é a menor configuração testada que mantém o atraso do
saudável na casa de 2 s durante uma queda de 40% do inventário.

---

## 5. Parecer sobre baixar o timeout padrão de monitor novo

Hoje o formulário de criação de monitor (`monitor-management.component.ts`) propõe `timeoutMs: 2000`
com `intervaloSegundos: 60`; o banco aceita de 100 a 60.000 ms (`ck_monitor_timeout_faixa`, V5). Não
existe padrão no backend: o timeout é obrigatório na requisição.

**Reconciliação de intervalo, antes do parecer: este arnês mediu com 30 s, o formulário propõe 60 s
— os dois números não são o mesmo, e a exigência de pool muda por um fator de 2 entre eles.** O
`INTERVALO_SEGUNDOS = 30` do arnês veio do enunciado da tarefa, não é erro de medição, mas a conta
de "16,7 workers" da seção 2 e a proposta de 32 workers da seção 4 foram derivadas com esse 30 s.
Com o intervalo real do formulário (60 s), a exigência de pior caso para K=250 e timeout 2000 ms
cai pela metade: `250 × 2 / 60 = 8,3 workers`, não 16,7. Nesse cenário a folga do pool proposto de
32 workers vira **~4x** a exigência de pior caso, não ~2x como a seção 4 registra para 30 s. As 9
células medidas continuam válidas como estão — são uma medição de 30 s, não de 60 s —, mas qualquer
decisão de dimensionamento de produção precisa aplicar o intervalo real (60 s) na conta, não o do
arnês.

**Parecer sobre baixar o timeout padrão: sim, baixar para 1000 ms é a alavanca mais barata que existe
aqui — mas ela depende de um número que este arnês não mediu.**

O número que sustenta o parecer: a ocupação medida de uma sondagem que **falha** é **2016–2038 ms
virtuais para um timeout de 2000 ms**, ou seja, a thread é segurada pelo timeout cheio, com no máximo
2% de sobra. Para o caminho de falha, a ocupação do pool numa queda em massa é, portanto,
aproximadamente linear no timeout: `K × timeout / intervalo`. Isso vale só para a falha — para o
**sucesso**, o arnês mede ~1 ms porque o `MedicaoService` falso é um `put` em mapa (ver seção 1); em
produção o sucesso é dominado pelo banco e pelo pós-processamento (`IncidentProcessor`,
`LatencyEpisodeProcessor`), não pelo timeout, então baixar o timeout não afeta a ocupação do
caminho de sucesso. Cair de 2000 para 1000 ms leva a exigência do pior caso **de falhas** de 16,7
para **8,3 workers** com intervalo de 30 s (ou de 8,3 para 4,2 workers com o intervalo real de
60 s) — de qualquer forma, metade do pool exigido, de graça, sem tocar em thread nenhuma.

A ressalva é que o timeout é o que separa "lento" de "caído", e essa fronteira **não foi medida
aqui**: o arnês não sonda rede nenhuma. A medição de rede real deste branch
([icmp-falsos-positivos.md](icmp-falsos-positivos.md)) registrou RTT `<1 ms` nos alvos da LAN, o que
deixa 1000 ms com três ordens de grandeza de folga — mas só para esses alvos. **NÃO VERIFICADO: o
RTT p99 dos alvos reais em WAN.** Antes de mudar o padrão, esse p99 precisa sair das medições já
gravadas em `medicao.latencia_ms`; um alvo cujo p99 encoste em 1000 ms passaria a gerar falha falsa,
que é um erro pior que um pool apertado.

---

## 6. O que não foi alterado

- **`application.yml`**: nada. `worker-threads` continua 4 e `queue-capacity` continua 100.
- **O pool**: `MonitoringEngineConfiguration` não foi tocado.
- **O coordenador**: `MonitorExecutionCoordinator` não foi tocado — ele foi medido, não corrigido.
  A injustiça de ordem da seção 2 é um achado registrado, não um bug consertado nesta tarefa.
- **O padrão de timeout** do formulário de monitor: continua 2000 ms.
- **O banco**: nenhuma migration, nenhuma conexão. O Postgres de desenvolvimento não foi acessado.
- **A suíte padrão**: **314 testes antes e 314 depois**, nenhuma falha, e nenhum relatório de
  `CapacidadeQuedaEmMassaBenchTest` em `target/surefire-reports`. O arnês fica fora por tag.
  (O "antes" foi medido com o arnês removido da árvore e o `pom.xml` revertido, não por inferência.
  Se em algum lugar o número anotado for 319, ele está somando os 5 testes de `IcmpRedeRealIT`, que
  a tag `rede-real` mantém fora da execução padrão desde antes desta tarefa.)

## Dívidas que esta medição deixa registradas

1. **Memória por thread parada** — NÃO VERIFICADO. Exige `NativeMemoryTracking`, fora do escopo do
   arnês.
2. **Custo de CPU do `IcmpSendEcho` nativo bloqueado** — o arnês estaciona a thread em vez de chamar
   a API nativa. O 1,6% medido (célula mais pesada) vale para a espera simulada, não para a chamada
   nativa.
3. **A varredura preterindo alguém quando saturada** — sustentável: `findActiveExecutionCandidates()`
   é um `group by` **sem `ORDER BY`**, então a ordem que o Postgres devolve não é garantida por
   contrato, só estável na prática. Com fila < N e pool saturado, alguém fica sistematicamente sem
   sondagem numa varredura; **quem** é isso depende da ordem do banco, que o arnês não reproduz
   (no arnês são sempre os ids 1..k, o pior caso). Com fila ≥ N o problema some; sem ela, nenhum
   tamanho de pool o resolve sozinho.
4. **Intervalo de 30 s do arnês × 60 s do formulário de produção não estavam reconciliados** — a
   seção 5 agora traz os dois números lado a lado; a exigência de pior caso de pool cai de 16,7 para
   8,3 workers com o intervalo real, e a folga de 32 workers vira ~4x, não ~2x.
5. **O `scheduler-delay` de 1000 ms não foi varrido**: foi mantido fixo em todas as 9 células.
