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

### Leitura

1. **K=250 / 4 workers é uma quebra, não uma lentidão.** Em 960,8 s virtuais o pool produziu 1.896
   medições de falha. A capacidade teórica de 4 workers nesse tempo é 960,8 / 2,03 × 4 = 1.893
   medições: **o pool entregou 100% do que podia**. Ainda assim nem todos os 250 monitores chegaram a
   3 falhas — e 1.896 medições seriam suficientes para 632 monitores. A conclusão não é falta de
   vazão, é **distribuição injusta**: o coordenador varre `findActiveExecutionCandidates()` sempre na
   mesma ordem e a `AbortPolicy` rejeita quem chega depois que a fila de 100 encheu. Os monitores do
   fim da lista foram sondados sistematicamente menos que os do começo — em uma queda em massa, os
   últimos equipamentos do inventário podem simplesmente não ser sondados.
2. **O ponto de virada está entre K=25 e K=100 com 4 workers.** Com 25 caídos o atraso mediano do
   saudável é 2,5 s sobre 30 s (tolerável). Com 100 caídos vai para 20,8 s, e o p95 para 31,0 s: na
   prática o intervalo efetivo de um monitor saudável **dobra**, de 30 s para ~61 s. A detecção de
   uma queda nova fica duas vezes mais lenta exatamente durante o incidente em que ela mais importa.
3. **A conta que prevê isso é simples e bateu com a medição.** Uma falha ocupa uma thread pelo
   timeout; em regime, a ocupação exigida é `K × timeout / intervalo` workers. Para K=250, timeout
   2 s e intervalo 30 s: **16,7 workers só para acompanhar as falhas**. Daí 4 workers não fecharem o
   ciclo (célula 3), 16 fecharem com folga zero (99,9 s contra piso de 62 s) e 32 fecharem com folga
   (83,4 s).
4. **A fila de 100 não cabe uma varredura.** Uma varredura submete até 250 monitores; com fila 100,
   pelo menos 146 são rejeitados na primeira passada de qualquer célula. A rejeição em si é
   inofensiva — o monitor volta na próxima varredura — mas é **ordenada**, e é ela que produz a
   injustiça do item 1.

---

## 3. Custo de uma thread parada no `IcmpSendEcho`

### CPU — medido

`ThreadMXBean.getThreadCpuTime` somado sobre as threads `monitor-worker-*`, ao fim de cada célula,
contra o tempo de parede da célula:

| Célula | CPU somada dos workers | Tempo de parede real | Fração de **um** worker |
|---|---:|---:|---:|
| K=25 / 4 | 109 ms | 20,0 s | 0,1% |
| K=100 / 4 | 0 ms | 38,2 s | 0,0% |
| K=250 / 4 | 547 ms | 240,2 s | 0,1% |
| K=250 / 16 | 203 ms | 25,0 s | 0,1% |
| K=250 / 32 | 344 ms | 20,9 s | 0,1% |

Com os 250 monitores caídos e 32 workers ocupados praticamente o tempo todo, as 32 threads juntas
consumiram 344 ms de CPU em 20,9 s — **0,1% de uma única CPU**. Uma thread parada esperando a
resposta ICMP não gira CPU; o custo dela é ocupar um slot do pool, não processador. Esse é o achado
que importa para o dimensionamento: **aumentar `worker-threads` compra vazão sem comprar CPU.**

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

O que **está** verificado é a contagem de threads: o processo ficou com `workers + 3` threads vivas
(7, 19 e 35 para 4, 16 e 32 workers), isto é, o pool não cria nada além dos seus workers, e subir de
4 para 32 acrescentou 28 threads a um processo que já roda dezenas.

---

## 4. Proposta de `worker-threads` e `queue-capacity`

Proposta, não mudança: nada em `application.yml` foi alterado.

### `worker-threads`: 4 → **32**

- A exigência analítica para acompanhar uma queda total do inventário atual é
  `250 × 2 s / 30 s = 16,7` workers. 16 é o mínimo que fecha a conta, e a medição confirma: a célula
  K=250/16 levou 99,9 s contra um piso de 62 s — passa, sem folga nenhuma.
- 32 dá o dobro da exigência: cobre crescer até ~480 monitores antes de voltar ao mesmo aperto, e é
  a única linha em que o monitor saudável foi sondado quase no horário mesmo com falhas em massa
  (K=25/32: atraso mediano de 0,33 s; K=100/32: 2,2 s, contra 20,8 s no pool de 4).
- O custo disso é 28 threads a mais. Pela seção 3, threads paradas em I/O não consomem CPU (0,1% de
  uma CPU para 32 threads ocupadas), e a máquina tem 24 CPUs lógicas. O custo de memória por thread
  não foi medido e continua sendo a incógnita desta proposta.

### `queue-capacity`: 100 → **300**

- Uma varredura submete até N monitores; enquanto a fila for menor que N, toda varredura rejeita, e
  rejeita sempre os mesmos — os do fim da lista. É esse o mecanismo por trás do item 1 da seção 2.
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

**Parecer: sim, baixar para 1000 ms é a alavanca mais barata que existe aqui — mas ela depende de um
número que este arnês não mediu.**

O número que sustenta o parecer: a ocupação medida de uma sondagem que falha é **2016–2038 ms
virtuais para um timeout de 2000 ms**, ou seja, a thread é segurada pelo timeout cheio, com no máximo
2% de sobra. A ocupação do pool numa queda em massa é, portanto, exatamente linear no timeout:
`K × timeout / intervalo`. Cair de 2000 para 1000 ms leva a exigência do pior caso de 16,7 para
**8,3 workers** — metade do pool, de graça, sem tocar em thread nenhuma.

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
   a API nativa. O 0,1% medido vale para a espera, não para a chamada nativa.
3. **A varredura é injusta por ordem** — `findActiveExecutionCandidates()` devolve sempre na mesma
   ordem e a `AbortPolicy` corta o fim da lista. Com fila ≥ N o problema some; sem ela, nenhum
   tamanho de pool o resolve sozinho.
4. **O `scheduler-delay` de 1000 ms não foi varrido**: foi mantido fixo em todas as 9 células.
