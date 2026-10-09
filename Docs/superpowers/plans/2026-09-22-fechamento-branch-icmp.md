# Fechamento do branch `fix/icmp-nativo-windows` — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deixar `/api/v1/status` dizer a verdade sobre a carga nativa mesmo com o motor desligado, medir a capacidade real do pool numa queda em massa, documentar a topologia do git e extrair a evidência sanitizada.

**Architecture:** Uma mudança de comportamento pequena e cirúrgica (`IcmpAmbienteConfiguration.resolver`), um arnês de medição commitado mas fora do build padrão, e dois entregáveis de documentação. Nada de merge, nada de mudança de pool.

**Tech Stack:** Java 21, Spring Boot 4.1.0, Maven (`./mvnw`), JUnit 5, JNA.

**Spec:** `Docs/superpowers/specs/2026-09-22-manutencao-e-fechamento-icmp-design.md` (Parte A)

## Global Constraints

- Banco de dev (porta **5434**) **intocado**: nenhuma migration, nenhuma escrita.
- Motor de monitoramento **nunca** liga contra o banco de dev.
- Telegram real **nunca** é acionado.
- **Sem Lombok.** Classes e `record` explícitos.
- Datas: `Instant` e Java Time API. Persistência e tráfego em UTC.
- Trabalhar no branch `fix/icmp-nativo-windows`. **Não fazer merge.**
- Commits terminam com `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Rodar o backend exige `DB_PORT=5434` e `JWT_SECRET` (ver `Docs/`), mas nesta parte **nenhuma tarefa sobe a aplicação contra o banco de dev com o motor ligado**.

---

### Task 1: Carga nativa tentada com o motor desligado

**Files:**
- Modify: `infra-monitor-backend/src/main/java/br/com/inframonitor/monitoring/icmp/IcmpAmbienteConfiguration.java:40-66`
- Modify: `infra-monitor-backend/src/main/java/br/com/inframonitor/monitoring/icmp/CargaNativa.java:7-8` (javadoc do `NAO_TENTADA`)
- Test: `infra-monitor-backend/src/test/java/br/com/inframonitor/monitoring/icmp/IcmpAmbienteConfigurationTest.java`

**Interfaces:**
- Consumes: `IcmpAmbiente(IcmpImplementacao pedida, IcmpImplementacao ativa, CargaNativa cargaNativa, String detalheFalha, boolean motorLigado, Iphlpapi nativo)`; `IcmpAmbienteConfiguration.resolver(IcmpImplementacao pedida, boolean windows, boolean motorLigado, Supplier<Iphlpapi> fabrica)`.
- Produces: a mesma assinatura de `resolver` — nenhum chamador muda. Muda só o comportamento para `motorLigado == false`.

- [ ] **Step 1: Ler o teste existente para seguir o padrão do arquivo**

Run: `sed -n '1,60p' infra-monitor-backend/src/test/java/br/com/inframonitor/monitoring/icmp/IcmpAmbienteConfigurationTest.java`

Se o arquivo não existir, criar seguindo o padrão dos testes vizinhos em `monitoring/icmp/`.

- [ ] **Step 2: Escrever os testes que falham**

Acrescentar ao arquivo de teste:

```java
@Test
void tentaCargaNativaComMotorDesligadoERegistraFalha() {
    AtomicInteger invocacoes = new AtomicInteger();
    Supplier<Iphlpapi> fabricaQueFalha = () -> {
        invocacoes.incrementAndGet();
        throw new UnsatisfiedLinkError("Iphlpapi indisponivel no teste");
    };

    IcmpAmbiente ambiente = IcmpAmbienteConfiguration.resolver(
            IcmpImplementacao.AUTO, true, false, fabricaQueFalha);

    assertThat(invocacoes.get()).isEqualTo(1);
    assertThat(ambiente.cargaNativa()).isEqualTo(CargaNativa.FALHOU);
    assertThat(ambiente.ativa()).isEqualTo(IcmpImplementacao.PROCESSO_PING);
    assertThat(ambiente.detalheFalha()).contains("Iphlpapi indisponivel no teste");
    assertThat(ambiente.motorLigado()).isFalse();
}

@Test
void pedidoExplicitoQueFalhaComMotorDesligadoNaoDerrubaASubidaEMantemAtiva() {
    Supplier<Iphlpapi> fabricaQueFalha = () -> {
        throw new UnsatisfiedLinkError("Iphlpapi indisponivel no teste");
    };

    IcmpAmbiente ambiente = IcmpAmbienteConfiguration.resolver(
            IcmpImplementacao.NATIVO_WINDOWS, true, false, fabricaQueFalha);

    // Pedido explicito nao vira fallback silencioso: /status precisa mostrar
    // exatamente o que impediria ligar o motor neste processo.
    assertThat(ambiente.ativa()).isEqualTo(IcmpImplementacao.NATIVO_WINDOWS);
    assertThat(ambiente.cargaNativa()).isEqualTo(CargaNativa.FALHOU);
    assertThat(ambiente.nativo()).isNull();
}

@Test
void cargaNativaComMotorDesligadoQueFuncionaEntregaALigacao() {
    Iphlpapi ligacao = mock(Iphlpapi.class);

    IcmpAmbiente ambiente = IcmpAmbienteConfiguration.resolver(
            IcmpImplementacao.AUTO, true, false, () -> ligacao);

    assertThat(ambiente.cargaNativa()).isEqualTo(CargaNativa.OK);
    assertThat(ambiente.ativa()).isEqualTo(IcmpImplementacao.NATIVO_WINDOWS);
    assertThat(ambiente.nativo()).isSameAs(ligacao);
}

@Test
void pedidoExplicitoQueFalhaComMotorLIGADOContinuaDerrubandoASubida() {
    Supplier<Iphlpapi> fabricaQueFalha = () -> {
        throw new UnsatisfiedLinkError("Iphlpapi indisponivel no teste");
    };

    assertThatThrownBy(() -> IcmpAmbienteConfiguration.resolver(
            IcmpImplementacao.NATIVO_WINDOWS, true, true, fabricaQueFalha))
            .isInstanceOf(IllegalStateException.class);
}

@Test
void foraDoWindowsNaoTentaCargaNativa() {
    AtomicInteger invocacoes = new AtomicInteger();

    IcmpAmbiente ambiente = IcmpAmbienteConfiguration.resolver(
            IcmpImplementacao.AUTO, false, false, () -> {
                invocacoes.incrementAndGet();
                return mock(Iphlpapi.class);
            });

    assertThat(invocacoes.get()).isZero();
    assertThat(ambiente.cargaNativa()).isEqualTo(CargaNativa.NAO_TENTADA);
    assertThat(ambiente.ativa()).isEqualTo(IcmpImplementacao.PROCESSO_PING);
}
```

Imports necessários: `java.util.concurrent.atomic.AtomicInteger`, `java.util.function.Supplier`,
`static org.assertj.core.api.Assertions.assertThat`, `static org.assertj.core.api.Assertions.assertThatThrownBy`,
`static org.mockito.Mockito.mock`.

- [ ] **Step 3: Rodar os testes e confirmar a falha (prova de reversão)**

Run: `cd infra-monitor-backend && ./mvnw test -Dtest=IcmpAmbienteConfigurationTest`
Expected: FAIL. Os três primeiros testes falham porque hoje `resolver` devolve `NAO_TENTADA` e **não chama a fábrica** quando `motorLigado == false`. Guardar a saída: é a prova de reversão.

- [ ] **Step 4: Implementar**

Substituir o corpo de `resolver` em `IcmpAmbienteConfiguration.java`:

```java
    static IcmpAmbiente resolver(IcmpImplementacao pedida, boolean windows, boolean motorLigado,
                                 Supplier<Iphlpapi> fabrica) {
        IcmpImplementacao escolhida = IcmpRunnerConfiguration.escolher(pedida, windows);
        // A tentativa de carga NAO depende do motor: com o motor desligado o processo
        // ainda precisa dizer em /api/v1/status se a biblioteca nativa carregaria aqui.
        // Descobrir a falha so' quando alguem liga o motor e' descobrir tarde demais.
        if (escolhida != IcmpImplementacao.NATIVO_WINDOWS) {
            return new IcmpAmbiente(pedida, escolhida, CargaNativa.NAO_TENTADA, null, motorLigado, null);
        }
        try {
            return new IcmpAmbiente(pedida, escolhida, CargaNativa.OK, null, motorLigado, fabrica.get());
        } catch (RuntimeException | LinkageError falha) {
            // LinkageError e' obrigatorio: Native.load lanca UnsatisfiedLinkError,
            // que e' um Error e nao seria pego por catch (Exception).
            String detalhe = falha.getClass().getName() + ": " + falha.getMessage();
            if (pedida == IcmpImplementacao.NATIVO_WINDOWS && motorLigado) {
                throw new IllegalStateException(
                        "monitoring.icmp.implementacao=nativo-windows foi pedido explicitamente, mas a carga da "
                                + "biblioteca nativa Iphlpapi falhou: " + detalhe
                                + ". Suba com monitoring.icmp.implementacao=processo-ping para nao depender dela.",
                        falha);
            }
            if (pedida == IcmpImplementacao.NATIVO_WINDOWS) {
                // Motor desligado: a subida nao pode cair por causa de algo que este
                // processo nao vai usar. Mas o pedido explicito NAO vira fallback
                // silencioso — ativa continua NATIVO_WINDOWS para que /status mostre
                // exatamente o que impediria ligar o motor aqui.
                log.error("Carga da biblioteca nativa Iphlpapi falhou nesta subida e o motor esta desligado; "
                        + "ligar o motor neste processo derrubaria a subida. Detalhe: {}", detalhe, falha);
                return new IcmpAmbiente(pedida, IcmpImplementacao.NATIVO_WINDOWS, CargaNativa.FALHOU, detalhe,
                        false, null);
            }
            log.error("Carga da biblioteca nativa Iphlpapi falhou nesta subida; monitoring.icmp.implementacao=auto "
                    + "cai para processo-ping. Detalhe: {}", detalhe, falha);
            return new IcmpAmbiente(pedida, IcmpImplementacao.PROCESSO_PING, CargaNativa.FALHOU, detalhe,
                    motorLigado, null);
        }
    }
```

Atualizar o javadoc de `CargaNativa.NAO_TENTADA`:

```java
    /** Nao se aplica: implementacao de processo, ou sistema operacional nao-Windows. */
    NAO_TENTADA
```

- [ ] **Step 5: Rodar os testes e confirmar que passam**

Run: `cd infra-monitor-backend && ./mvnw test -Dtest=IcmpAmbienteConfigurationTest`
Expected: PASS, todos.

- [ ] **Step 6: Conferir que o guarda de `criarRunner` não regrediu**

Run: `cd infra-monitor-backend && ./mvnw test -Dtest=IcmpRunnerConfigurationTest`
Expected: PASS. Se não existir esse teste, rodar a suíte inteira no passo 8 cobre.

O ambiente novo (`ativa=NATIVO_WINDOWS`, `nativo=null`, motor desligado) **nunca** chega a
`criarRunner`, porque o bean do runner vive sob `@ConditionalOnProperty(monitoring.engine.enabled=true)`.
Confirmar que o comentário de `IcmpRunnerConfiguration:22-33` continua verdadeiro; se estiver
desatualizado, ajustá-lo no mesmo commit.

- [ ] **Step 7: Evidência real — log de subida e `/status` nos dois modos**

Subir contra um Postgres descartável, **nunca** o de dev. Se ainda não houver um de pé, pular para a
Task 5 do plano B e voltar, ou subir um só para isto:

```bash
docker run -d --name infra-status-evid -e POSTGRES_PASSWORD="$PGPASS_DESCARTAVEL" \
  -e POSTGRES_USER=inframonitor -e POSTGRES_DB=inframonitor -p 5435:5432 postgres:16
```

Motor **desligado** (padrão):

```bash
cd infra-monitor-backend
DB_PORT=5435 DB_PASSWORD="$PGPASS_DESCARTAVEL" JWT_SECRET="$JWT_SECRET_DESCARTAVEL" \
  ./mvnw spring-boot:run 2>&1 | tee /tmp/subida-motor-desligado.log
curl -s localhost:8080/api/v1/status | tee /tmp/status-motor-desligado.json
```

Motor **ligado** contra o mesmo banco descartável:

```bash
DB_PORT=5435 DB_PASSWORD="$PGPASS_DESCARTAVEL" JWT_SECRET="$JWT_SECRET_DESCARTAVEL" \
  MONITORING_ENGINE_ENABLED=true ./mvnw spring-boot:run 2>&1 | tee /tmp/subida-motor-ligado.log
curl -s localhost:8080/api/v1/status | tee /tmp/status-motor-ligado.json
```

Copiar as duas linhas `Implementacao ICMP ativa: …` e os dois JSON para
`Docs/validacao-producao/icmp-revisao-branch-relatorio.md`, numa seção nova "A.1 — /status verdadeiro
com o motor desligado". Nenhuma senha vai para o documento.

- [ ] **Step 8: Suíte completa**

Run: `cd infra-monitor-backend && ./mvnw test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add infra-monitor-backend/src/main/java/br/com/inframonitor/monitoring/icmp/IcmpAmbienteConfiguration.java \
        infra-monitor-backend/src/main/java/br/com/inframonitor/monitoring/icmp/CargaNativa.java \
        infra-monitor-backend/src/test/java/br/com/inframonitor/monitoring/icmp/IcmpAmbienteConfigurationTest.java \
        Docs/validacao-producao/icmp-revisao-branch-relatorio.md
git commit -m "$(cat <<'EOF'
fix(icmp): tentar a carga nativa tambem com o motor desligado

/api/v1/status respondia NAO_TENTADA num processo em que a biblioteca
nativa poderia falhar, porque resolver curto-circuitava em !motorLigado.
A tentativa passa a depender so do SO e da implementacao resolvida.

Com o motor desligado a falha nunca derruba a subida. Um pedido explicito
de nativo-windows que falha mantem ativa=NATIVO_WINDOWS com carga=FALHOU,
para que /status mostre o que impediria ligar o motor neste processo, em
vez de virar um fallback silencioso.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Arnês de medição de capacidade numa queda em massa

**Files:**
- Create: `infra-monitor-backend/src/test/java/br/com/inframonitor/monitoring/execution/CapacidadeQuedaEmMassaBenchTest.java`
- Modify: `infra-monitor-backend/pom.xml` (Surefire: `<excludedGroups>bench</excludedGroups>`)
- Create: `Docs/validacao-producao/capacidade-pool-monitoramento.md`

**Interfaces:**
- Consumes: `MonitorExecutionCoordinator(MonitorRepository, MedicaoService, ExecutorService, Clock, List<MonitorExecutor>)`; `MonitorCandidate(Long monitorId, TipoMonitor tipo, int intervaloSegundos, int timeoutMs, String ip, Instant ultimaMedicaoEm)` — **conferir a ordem exata dos campos em `monitoring/execution/MonitorCandidate.java` antes de escrever**; `MonitorExecutor.execute(MonitorCandidate)` e `MonitorExecutor.supports()`; `MonitorExecutionResult`.
- Produces: `Docs/validacao-producao/capacidade-pool-monitoramento.md` com a tabela de 9 células e a proposta de pool/fila/timeout. **Nenhuma mudança em `application.yml`.**

- [ ] **Step 1: Ler as assinaturas exatas**

Run:
```bash
cat infra-monitor-backend/src/main/java/br/com/inframonitor/monitoring/execution/MonitorCandidate.java \
    infra-monitor-backend/src/main/java/br/com/inframonitor/monitoring/execution/MonitorExecutor.java \
    infra-monitor-backend/src/main/java/br/com/inframonitor/monitoring/execution/MonitorExecutionResult.java
```

Escrever o arnês com os nomes que o `cat` mostrar, não com os deste plano.

- [ ] **Step 2: Escrever o arnês**

Criar `CapacidadeQuedaEmMassaBenchTest.java`. Estrutura obrigatória:

```java
@Tag("bench")
class CapacidadeQuedaEmMassaBenchTest {

    private static final int N = 250;
    private static final int INTERVALO_SEGUNDOS = 30;
    private static final int TIMEOUT_MS = 2000;
    private static final int FILA = 100;
    private static final int CICLOS_DE_FALHA_ALVO = 3;

    // Relogio virtual: o teste nao pode levar 30 s reais por ciclo. O tempo anda
    // quando o arnes manda, e o coordenador real le esse mesmo Clock.
    private MutableClock clock;

    @ParameterizedTest(name = "K={0} workers={1}")
    @CsvSource({
        "25,4", "100,4", "250,4",
        "25,16", "100,16", "250,16",
        "25,32", "100,32", "250,32"
    })
    void quedaEmMassa(int k, int workers) throws Exception {
        // 1. Monta N candidatos; os K primeiros falham (seguram a thread por TIMEOUT_MS),
        //    os N-K restantes respondem em ~1 ms.
        // 2. Roda o coordenador REAL em ciclos de scheduler-delay (1 s virtual + real
        //    para o pool drenar), ate que todos os K tenham 3 medicoes FALHA.
        // 3. Coleta: instante do 3o ciclo de falha de TODOS os K, contagem de
        //    RejectedExecutionException, atraso p50/p95/max dos saudaveis.
    }
}
```

Regras do arnês, todas obrigatórias:

- **`MonitorRepository` falso**: devolve os `MonitorCandidate` com `ultimaMedicaoEm` **vivo**, lido de um
  `ConcurrentHashMap<Long, Instant>` que o `MedicaoService` falso atualiza a cada `criar`. Sem isso
  `isDue` nunca vira falso e a medição do atraso não significa nada.
- **`MedicaoService` falso**: `criar(CreateMedicaoRequest)` grava `ultimaMedicaoEm` e conta medições por
  monitor e por status. Não toca em banco.
- **`MonitorExecutor` falso**: `supports()` devolve `TipoMonitor.ICMP`; sucesso dorme ~1 ms; falha dorme
  `TIMEOUT_MS` inteiro — é isso que o `IcmpSendEcho` faz quando o host não responde.
- **Contagem de `RejectedExecutionException`**: o coordenador engole a exceção e só loga
  (`MonitorExecutionCoordinator:72-75`). Capturar com um `ExecutorService` decorador que conta as
  rejeições antes de repassar, **ou** com um `ListAppender` do Logback no logger do coordenador.
  Escolher um e registrar qual no documento.
- **Atraso dos saudáveis**: para cada monitor não-K, `atraso = (instanteDaMedicao - ultimaMedicaoEm) -
  intervalo`. Reportar p50, p95 e máximo.
- **Pool montado igual ao de produção**: `ThreadPoolExecutor(workers, workers, 0, MILLISECONDS,
  new ArrayBlockingQueue<>(FILA), factory, new ThreadPoolExecutor.AbortPolicy())` embrulhado em
  `ExecutorQueLogaFalhas`, exatamente como `MonitoringEngineConfiguration:23-33`.

- [ ] **Step 3: Excluir a tag `bench` do build padrão**

Em `infra-monitor-backend/pom.xml`, no `maven-surefire-plugin` (criar o bloco `<configuration>` se não
houver):

```xml
<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-surefire-plugin</artifactId>
  <configuration>
    <!-- O arnes de capacidade leva minutos e segura threads de proposito.
         Roda sob demanda: ./mvnw test -Dgroups=bench -->
    <excludedGroups>bench</excludedGroups>
  </configuration>
</plugin>
```

- [ ] **Step 4: Confirmar que a suíte padrão NÃO roda o arnês**

Run: `cd infra-monitor-backend && ./mvnw test`
Expected: PASS, e **nenhuma** linha `CapacidadeQuedaEmMassaBenchTest` na saída.

- [ ] **Step 5: Rodar a medição**

Run: `cd infra-monitor-backend && ./mvnw test -Dgroups=bench 2>&1 | tee /tmp/bench-capacidade.log`
Expected: as 9 células rodam e imprimem as métricas.

- [ ] **Step 6: Medir o custo por thread parada**

Com o arnês rodando na célula mais pesada (K=250, workers=32), coletar do próprio processo:
`Runtime.getRuntime().totalMemory() - freeMemory()` antes e no pico, o número de threads vivas
(`Thread.activeCount()`), e o tamanho de stack configurado. Reportar **memória por thread parada** e o
que a CPU faz enquanto elas esperam (`IcmpSendEcho` bloqueia em espera de I/O: a thread não gira CPU;
o custo é memória e ocupação de slot do pool). Medir, não estimar — se um número não for medível com o
arnês, escrever **NÃO VERIFICADO** em vez de chutar.

- [ ] **Step 7: Escrever o documento**

Criar `Docs/validacao-producao/capacidade-pool-monitoramento.md` com, nesta ordem:

1. o que foi medido e como (runner falso, relógio virtual, pool igual ao de produção);
2. a tabela de 9 células: `K | workers | tempo até o 3º ciclo de falha de todos os K | RejectedExecution | atraso p50 / p95 / máx dos saudáveis`;
3. custo de memória e CPU por thread parada no `IcmpSendEcho`;
4. **proposta** de `worker-threads` e `queue-capacity` justificada pelos números;
5. parecer sobre baixar o timeout padrão de monitor novo, com o número que sustenta o parecer;
6. o que **não** foi alterado: nada em `application.yml`, nada no pool.

- [ ] **Step 8: Commit**

```bash
git add infra-monitor-backend/src/test/java/br/com/inframonitor/monitoring/execution/CapacidadeQuedaEmMassaBenchTest.java \
        infra-monitor-backend/pom.xml Docs/validacao-producao/capacidade-pool-monitoramento.md
git commit -m "$(cat <<'EOF'
test(capacidade): medir o pool de monitoramento numa queda em massa

Arnes com runner falso que imita a latencia real - sucesso em ~1 ms, falha
segurando a thread pelo timeout inteiro - sobre o coordenador real, com
250 monitores e K em 25/100/250, pool em 4/16/32 e fila 100.

Fica fora do ./mvnw test por @Tag("bench"): segura threads de proposito e
leva minutos. Roda com ./mvnw test -Dgroups=bench.

Nada do pool foi alterado: a proposta de tamanho esta no documento e
depende dos numeros, nao do palpite.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Topologia do git

**Files:**
- Create: `Docs/validacao-producao/topologia-git-e-estrategia-de-merge.md`

**Interfaces:**
- Consumes: nada.
- Produces: documento com o inventário e a proposta de merge. **Nenhum comando de merge é executado.**

- [ ] **Step 1: Coletar**

```bash
git log --oneline --graph --decorate -40 | tee /tmp/git-graph.txt
git branch -a | tee /tmp/git-branches.txt
git diff --stat main..HEAD | tail -1
git log --oneline main..HEAD | wc -l
git log --oneline main..HEAD --format='%s' | cut -d'(' -f2 | cut -d')' -f1 | sort | uniq -c | sort -rn
```

- [ ] **Step 2: Mapear qual trabalho está na `main`**

Para cada frente — Mapa, Incidentes, Relatórios, Auth, ICMP, Notificações, Unidades, Equipamentos —
responder com comando, não de memória:

```bash
for alvo in mapa incidentes relatorios auth icmp notificacoes; do
  echo "== $alvo =="
  git log --oneline main --grep="$alvo" -i | head -3
done
git ls-tree -r --name-only main | grep -c "infra-monitor-frontend/src/app/features/mapa" || echo "mapa ausente na main"
```

- [ ] **Step 3: Escrever o documento**

`Docs/validacao-producao/topologia-git-e-estrategia-de-merge.md`, com:

1. **O que "`main..HEAD` traz 749 arquivos" significa**, em uma frase sem jargão: são os arquivos que
   diferem entre a ponta da `main` e a ponta deste branch — a `main` está parada antes de toda a
   reforma, então quase todo o projeto conta como diferença. **Não** são 749 arquivos "modificados por
   este branch" no sentido de trabalho feito aqui.
2. `git log --oneline --graph --decorate -40` colado.
3. `git branch -a` colado, apontando que `feat/unidade-hub` e `spike/n01-maplibre` são **locais**, sem
   correspondente em `origin`.
4. Tabela: frente de trabalho × está na `main`? × onde está.
5. **Proposta** de estratégia de merge, com os riscos de cada opção (merge direto do branch longo;
   série de merges por frente; rebase). Recomendar uma e dizer por quê.
6. Em destaque: **nada foi executado.**

- [ ] **Step 4: Commit**

```bash
git add Docs/validacao-producao/topologia-git-e-estrategia-de-merge.md
git commit -m "$(cat <<'EOF'
docs(git): topologia dos branches e proposta de estrategia de merge

A main esta parada antes da reforma inteira: os 749 arquivos de diferenca
sao o tamanho da distancia, nao o tamanho do trabalho deste branch.

Proposta apenas. Nenhum merge executado.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Evidência sanitizada de `.superpowers/`

**Files:**
- Create: `Docs/validacao-producao/evidencias/` (diretório e os arquivos sanitizados)
- Modify: `Docs/validacao-producao/icmp-revisao-branch-relatorio.md` (seção A.4)

**Interfaces:**
- Consumes: `.superpowers/sdd/` (não versionado).
- Produces: arquivos sanitizados em `Docs/validacao-producao/evidencias/`.

- [ ] **Step 1: Confirmar o estado, por comando**

```bash
git check-ignore -v .superpowers
git log --all --oneline -- .superpowers | head
git ls-files .superpowers | head
```

Expected: `.gitignore:31:.superpowers/`, e as duas últimas saídas **vazias** — nunca foi versionado.
Se alguma delas trouxer algo, o diagnóstico muda e a tarefa vira remoção de histórico: parar e relatar.

- [ ] **Step 2: Varrer o conteúdo por dado sensível**

```bash
grep -rIl "C:\\\\Users\\\\\|/c/Users/\|BOT_TOKEN\|JWT_SECRET\|password\|senha" .superpowers/ | head -20
```

- [ ] **Step 3: Selecionar e sanitizar**

Copiar para `Docs/validacao-producao/evidencias/` apenas o que sustenta uma afirmação dos relatórios.
Sanitização obrigatória em cada arquivo copiado:

- `C:\Users\<qualquer>\Documents\infra-monitor` e `/c/Users/<qualquer>/Documents/infra-monitor` → caminho relativo ao repositório;
- qualquer token, senha, segredo JWT ou chat id → removido, não mascarado com o valor ao lado;
- nomes de pessoas → papel ("o operador", "quem revisou").

Conferir depois de copiar:

```bash
grep -rIn "C:\\\\Users\|/c/Users/\|BOT_TOKEN\|JWT_SECRET" Docs/validacao-producao/evidencias/
```
Expected: saída vazia.

- [ ] **Step 4: Escrever a seção A.4**

Em `Docs/validacao-producao/icmp-revisao-branch-relatorio.md`, seção "A.4 — `.superpowers/`":
o diretório **está em `.gitignore:31` e nunca foi versionado** (com as saídas do Step 1 coladas como
prova), logo não houve vazamento de caminho ou token por esse caminho; a evidência relevante foi
copiada sanitizada para `Docs/validacao-producao/evidencias/`, com a lista do que foi copiado e o que
foi deliberadamente deixado de fora.

- [ ] **Step 5: Commit**

```bash
git add Docs/validacao-producao/evidencias Docs/validacao-producao/icmp-revisao-branch-relatorio.md
git commit -m "$(cat <<'EOF'
docs(validacao): evidencia sanitizada e o estado real de .superpowers/

.superpowers/ esta em .gitignore:31 e nunca foi versionado - nenhum caminho
de usuario ou token vazou por ali. A evidencia que sustenta afirmacao de
relatorio foi copiada sanitizada para Docs/validacao-producao/evidencias/.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Fechamento do plano A

Ao terminar as 4 tarefas: `./mvnw test` verde, `/api/v1/status` com evidência real colada,
`Docs/validacao-producao/` com três documentos novos, e **nenhum merge executado**. O plano B parte
daqui, em branch novo.
