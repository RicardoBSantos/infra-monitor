# Manutenção agendada F2 — Evidências da F2

Spec: `Docs/superpowers/specs/2026-10-23-manutencao-agendada-f2-design.md` (§4 corridas, MA26).

## Task 4 — Corridas reais e provas de reversão

Teste: `manutencao/ManutencaoAgendadaF2ConcorrenciaPostgresIntegrationTest` (PostgreSQL 16 real,
Testcontainers, `@RequerDocker`). Mesmo idioma da F1: cada corrida `@RepeatedTest(30)`, duas threads
reais alinhadas por `CyclicBarrier(2)`, cada lado nas suas próprias transações, atraso aleatório
pós-barreira calibrado (valores e medições de calibração em comentário nas constantes `ATRASO_C*_MS`).
Cada repetição imprime `[corrida-<nome>] desfecho=<RÓTULO>` e falha com `ILEGITIMO`; exceção em
qualquer thread também é `ILEGITIMO`. Mais dois testes sem corrida na mesma classe: equipamento movido
para fora da unidade sai na hora; equipamento excluído durante janela ATIVA de unidade não quebra a
conclusão.

### Corridas

2026-10-23, Docker local, nenhuma classe pulada (sem linha `!!`).

```
$ ./mvnw test -Dtest=ManutencaoAgendadaF2ConcorrenciaPostgresIntegrationTest > target/f2-final.log 2>&1
$ grep -o '\[corrida-[a-z-]*\] desfecho=[A-Z_]*' target/f2-final.log | sort | uniq -c
     19 [corrida-dois-fins] desfecho=B
     11 [corrida-dois-fins] desfecho=C
     18 [corrida-duas-edicoes] desfecho=B
     12 [corrida-duas-edicoes] desfecho=C
     12 [corrida-editar-ativar] desfecho=EDICAO
     18 [corrida-editar-ativar] desfecho=JOB
     17 [corrida-prorrogar-concluir] desfecho=CONCLUIU
     13 [corrida-prorrogar-concluir] desfecho=PRORROGOU
     12 [corrida-unidade-criacao] desfecho=DIRETO
     18 [corrida-unidade-criacao] desfecho=UMA_PASSADA
[INFO] Tests run: 152, Failures: 0, Errors: 0, Skipped: 0
```

| # | Corrida (`[corrida-…]`) | Desfechos legítimos | Distribuição (30) | Atraso pós-barreira |
|---|---|---|---|---|
| C1 | editar AGENDADA (troca A→B, mantém o início devido) × `reconciliar` (`editar-ativar`) | EDICAO: ATIVA com B, B em manutenção, A fora, 1 alteração · JOB: edição → 409, ATIVA com A, A em manutenção, B fora, 0 alteração | EDICAO 12 / JOB 18 | edição 0–1 ms |
| C2 | alterar fim (+1 h) × `reconciliar` com fim vencido (`prorrogar-concluir`) | PRORROGOU: ATIVA, fim novo, dentro, 1 alteração · CONCLUIU: 409, CONCLUIDA, fim antigo, fora, 0 alteração | PRORROGOU 13 / CONCLUIU 17 | alterar fim 0–4 ms |
| C3a | duas edições com a mesma `versao` (`duas-edicoes`) | exatamente um vence (o outro → 409), estado final inteiro dele (motivo, ligação, início), 1 alteração, `versao + 1` | B 18 / C 12 | 2º pedido 0–1 ms |
| C3b | duas alterações de fim com a mesma `versao` (`dois-fins`) | exatamente um vence, fim dele, 1 alteração | B 19 / C 11 | 2º pedido 0–1 ms |
| C4 | janela UNIDADE concluindo × equipamento criado na unidade (`unidade-criacao`) | após no máximo UMA passada extra, zero divergentes e o novo fora de manutenção · DIRETO: já convergido ao fim das threads · UMA_PASSADA: precisou da passada extra | DIRETO 12 / UMA_PASSADA 18 | reconciliador 0–8 ms |

Zero `ILEGITIMO`. Em C1 e C2 o atraso fica no lado do operador: atrasando o reconciliador, o lock da
edição (primeira instrução) chegava antes em quase todas as repetições, e em C2 dava 30/30 PRORROGOU
(`concluirVencidas` é o terceiro CAS da passada). As medições estão nos comentários das constantes.

**C4 não é CAS.** A criação do equipamento e a conclusão da janela de escopo UNIDADE não dividem lock:
a criação lê a cobertura (janela ainda ATIVA), entra em manutenção e commita depois que a passada já
concluiu a janela e já leu `cobertosPor`/`divergentes()` sem ver a linha nova. A garantia (MA26) é o
reconciliador de **nível**: a passada seguinte encontra o equipamento em `divergentes()` e o tira de
manutenção. O teste não afirma “nunca diverge”; afirma “no máximo uma passada extra converge”, e a
distribuição mostra que a divergência transitória é o caso comum (18/30) neste cenário.

Nota sobre a revisão da T2 (`gravarFim` compara `:fim > :agora` com dois parâmetros sem tipo, que o
Postgres resolve como texto): não influenciou nenhuma corrida. Em C2 o novo fim está uma hora à frente
de `agora`, e a recusa do lado perdedor vem do `travar` (status/versão), antes do UPDATE.

### Provas de reversão

Cada reversão aplicada localmente, só a corrida em questão rodada (`-Dtest=…#método`), arquivo(s)
restaurado(s) com `git checkout -- <arquivo>` em seguida (`git status --short src/main/java` vazio
depois de cada uma). Linhas `[corrida-…]` agrupadas com `sort | uniq -c` e a linha `Tests run`.

**Achado: em C1 e C2 a guarda é dupla.** Toda transição do reconciliador incrementa `versao` (MA26:
`ativarDevidas`, `ativarSeDevida`, `concluirVencidas`, …). Uma edição preparada sobre a versão `v`
perde, portanto, para a ativação/conclusão de dois jeitos independentes: pelo `status` no WHERE e pela
`versao` que mudou. Remover só o `status` (a reversão que a spec §4 lista) deixa o teste verde — a
versão segura sozinha. Para provar que o teste enxerga a corrida, a reversão foi reforçada removendo as
duas guardas; e, para mostrar que o `status` também segura sozinho, uma terceira rodada remove só o
incremento de versão da transição.

**C1a — `travar` e `gravarEdicao` sem `status`** (`EdicaoManutencao`) — **verde, esperado**

```
      7 [corrida-editar-ativar] desfecho=EDICAO
     23 [corrida-editar-ativar] desfecho=JOB
[INFO] Tests run: 30, Failures: 0, Errors: 0, Skipped: 0
```

A ativação commitou `versao = v + 1`; o `travar` com `versao = v` volta vazio e a edição recebe 409.

**C1b — C1a + `ativarDevidas`/`ativarSeDevida` sem `versao = versao + 1`** (`EdicaoManutencao`, `CoberturaManutencao`) — **vermelho**

```
      8 [corrida-editar-ativar] desfecho=EDICAO
     22 [corrida-editar-ativar] desfecho=ILEGITIMO
[corrida-editar-ativar] desfecho=ILEGITIMO situacao=ATIVA ligados=[2] emA=true emB=false recusado=false falhas=[]
[ERROR] Tests run: 30, Failures: 22, Errors: 0, Skipped: 0
```

Sem as duas guardas a edição alcança a janela já ATIVA: a ligação passa a dizer B, mas os efeitos de
entrada foram aplicados em A (A em manutenção, B fora) — exatamente o ilegítimo da spec.

**C1c — só a ativação sem `versao = versao + 1`** (`status` mantido) — **verde**

```
     10 [corrida-editar-ativar] desfecho=EDICAO
     20 [corrida-editar-ativar] desfecho=JOB
[INFO] Tests run: 30, Failures: 0, Errors: 0, Skipped: 0
```

**C2a — `travar` e `gravarFim` sem `status`** (`EdicaoManutencao`) — **verde, esperado** (mesma razão de C1a)

```
     13 [corrida-prorrogar-concluir] desfecho=CONCLUIU
     17 [corrida-prorrogar-concluir] desfecho=PRORROGOU
[INFO] Tests run: 30, Failures: 0, Errors: 0, Skipped: 0
```

**C2b — C2a + `concluirVencidas` sem `versao = versao + 1`** — **vermelho**

```
     20 [corrida-prorrogar-concluir] desfecho=ILEGITIMO
     10 [corrida-prorrogar-concluir] desfecho=PRORROGOU
[corrida-prorrogar-concluir] desfecho=ILEGITIMO situacao=CONCLUIDA fim=2026-10-23T17:04:46.409Z em=false recusado=false falhas=[]
[ERROR] Tests run: 30, Failures: 20, Errors: 0, Skipped: 0
```

História reescrita: a janela já CONCLUIDA recebe o fim novo (+1 h) e uma linha de alteração, e o
operador recebe 200.

**C2c — só `concluirVencidas` sem `versao = versao + 1`** (`status` mantido) — **verde**

```
     13 [corrida-prorrogar-concluir] desfecho=CONCLUIU
     17 [corrida-prorrogar-concluir] desfecho=PRORROGOU
[INFO] Tests run: 30, Failures: 0, Errors: 0, Skipped: 0
```

**C3 — `travar`, `gravarEdicao` e `gravarFim` sem `versao = :versao`** (`EdicaoManutencao`) — **vermelho**

```
     30 [corrida-dois-fins] desfecho=ILEGITIMO
     30 [corrida-duas-edicoes] desfecho=ILEGITIMO
[corrida-duas-edicoes] desfecho=ILEGITIMO motivo=Pedido B ligados=[2] alteracoes=2 falhas=[]
[corrida-dois-fins] desfecho=ILEGITIMO fim=2026-10-23T19:05:53.464Z alteracoes=2 falhas=[]
[ERROR] Tests run: 60, Failures: 60, Errors: 0, Skipped: 0
```

O `FOR UPDATE` sozinho só serializa: o segundo pedido espera, relê a linha e grava por cima. Os dois
recebem 200, duas alterações registradas, o primeiro perdido em silêncio (lost update). Vermelho em
todas as repetições, nas duas variantes.

**C4 — `reconciliar` sem `alvos.addAll(cobertura.divergentes())`** (`ReconciliadorManutencao`) — **vermelho**

```
      7 [corrida-unidade-criacao] desfecho=DIRETO
     23 [corrida-unidade-criacao] desfecho=ILEGITIMO
[corrida-unidade-criacao] desfecho=ILEGITIMO divergentesAntes=1 divergentesDepois=1 falhas=[]
[ERROR] Tests run: 30, Failures: 23, Errors: 0, Skipped: 0
```

Sem a varredura de nível, a passada extra só reavalia os cobertos por janelas que transitaram nela —
nenhuma — e o equipamento criado fica em manutenção para sempre sob uma janela CONCLUIDA. As 7 DIRETO
são as repetições em que a corrida não deixou divergência (a criação leu a cobertura depois da
conclusão, ou commitou a tempo de a própria passada da corrida a ver em `cobertosPor`).

**Restauração.** Depois de cada reversão, `git checkout -- <arquivo>`; `git status --short src/main/java`
vazio. A classe inteira rodada em seguida com o código restaurado é a seção Corridas acima
(`Tests run: 152, Failures: 0`).
