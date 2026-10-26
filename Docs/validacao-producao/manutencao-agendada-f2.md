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

## Task 9 — E2E por clique e exercício no banco da carga

### Ambiente

- Backend do HEAD `d5f56fc` como jar na **8081**, contra o banco da carga (`inframonitor-carga`,
  127.0.0.1:5436, Flyway em `22 | t`, `21 | t`), `MANUTENCAO_AGENDADA_ENABLED=true`, intervalo 5000 ms,
  motor/Telegram/dispatcher **desligados** na 8081.
- Frontend do HEAD em `ng serve` na **4201**; `API_PORT=8081` reescreve `localhost:8080`.
- A stack diária do usuário (8080 + 4200, mesmo banco, motor/Telegram/dispatcher ligados, reconciliador
  de 30 s) seguiu no ar e não foi tocada.
- A lista de CORS da 8081 não inclui a 4201 (preflight `403`). Em vez de reiniciar o backend, o roteiro
  tem `MANUT_F2_ORIGEM_CORS=http://127.0.0.1:4200`: a rota do Playwright refaz o pedido com esse
  `Origin` e devolve `Access-Control-Allow-Origin` da página. Só os cabeçalhos de CORS mudam.
- Usuário `f2.manutencao@inframonitor.local` (ADMIN, criado pelo bootstrap só para o exercício).
  A senha não foi versionada e não aparece nas capturas nem no JSON (conferido por busca literal: 0
  ocorrências; o JSON também não tem nenhum `Authorization`, `bearer`, `senha` ou `password`).
- Equipamento **Swtich CPD** (id 8), unidade **Sesc Itabaiana** (id 2, 3 equipamentos ativos).
  "Servidor AD Core" e "Servidor AD2" não foram usados.

## E2E

```
$ MSYS_NO_PATHCONV=1 BASE=http://127.0.0.1:4201 API_PORT=8081 MANUT_F2_ORIGEM_CORS=http://127.0.0.1:4200 \
  MANUT_F2_EMAIL=f2.manutencao@inframonitor.local MANUT_F2_SENHA=… \
  MANUT_F2_UNIDADE="Sesc Itabaiana" MANUT_F2_EQUIPAMENTO="Swtich CPD" npm run e2e:manutencao-agendada-f2
46/46 OK
```

| Passo | Verificações | Resultado |
|---|---|---|
| login | login por formulário; depois disso toda navegação é por clique | 1 OK |
| 1. Menu da linha (Equipamentos) | unidade travada, equipamento marcado; Escape fecha e devolve o foco ao `…` da linha (`Ações de Swtich CPD`); POST 201; aviso `Janela #7 agendada.` | 5 OK |
| 2. Drawer | menu "Ver" → "Agendar manutenção": preset igual; Escape devolve o foco ao botão do drawer, e o drawer continua aberto | 3 OK |
| 3. Unidade | banner `Próxima: #7 em 26/10/2026 08:07 · E2E F2 linha`; unidade travada; os 3 marcados mostram "Todos marcados…"; Cancelar sem POST; foco volta ao "Agendar manutenção" | 5 OK |
| 4. Editar AGENDADA | carrega `Editar janela #7`, motivo e início; Escape devolve o foco ao `…`; PUT 200; `Janela #7 atualizada.`; `editada por F2 Manutencao às 26/10/2026 08:03`; foco no `…` depois de salvar | 7 OK |
| 5. ATIVA, prorrogar e 409 de dois operadores | ATIVA vista por recarga por clique; Escape no Alterar fim devolve o foco ao `…`; PATCH do "segundo operador" pela API (versão 2 → 3) com o diálogo aberto; envio da UI → 409 → `Fim atual atualizado; confira e envie de novo.` (fim atual 08:37); segundo envio 200 → `Fim da janela #7 alterado para 26/10/2026 08:42.`; `prorrogada por …`; foco no `…` | 10 OK |
| 6. Continuação | antecipar → 200 e `fim antecipado por …`; diálogo reaberto e mantido aberto por 131 s; envio → 409 → `Janela #7 concluída`, "concluiu às 08:08 … pingados por alguns segundos", foco em "Agendar continuação"; modal pré-preenchido (unidade travada, equipamento marcado, motivo, fim pedido 08:39); POST 201 `Janela #8 agendada.`; foco em "+ Agendar manutenção" (não no body) | 10 OK |
| 7. Mapa | Swtich CPD entre os afetados; gaveta com só `["Abrir histórico"]` | 2 OK |
| 8. Limpeza | `#8 Ativa → 200` por "Encerrar agora"; foco em "+ Agendar manutenção" quando a linha sai; nenhuma "E2E F2" em Vigentes | 2 OK |
| sem erros | console sem erro além dos 2 `409 (Conflict)` provocados de propósito (passos 5 e 6) | 1 OK |

Soma: login 1 + passos 5+3+5+7+10+10+2+2 = 44 + sem erros 1 = 46, as mesmas 46 verificações do JSON.
A origem CORS da 4201 **não foi exercitada**: o roteiro reescreveu os cabeçalhos (`MANUT_F2_ORIGEM_CORS`, opt-in)
e a F2 não mexeu na configuração de CORS.

Capturas em `infra-monitor-frontend/e2e/manutencao-agendada-f2-evidence/`: `01-modal-da-linha`,
`02-linha-agendada-aviso`, `03-modal-do-drawer`, `04-unidade-banner`, `05-unidade-todos-marcados`,
`06-editar-carregada`, `07-editada`, `08-linha-ativa`, `09-alterar-fim-409`, `10-prorrogada`,
`11-continuacao`, `12-continuacao-modal`, `13-continuacao-agendada`, `14-mapa-gaveta`, `15-vigentes-limpo`
(`.png`) e `manutencao-agendada-f2.json` (resultados, instantes e rede, sem cabeçalhos nem corpos).

Antes da execução registrada houve três tentativas: (1) preflight 403 de CORS, antes de qualquer
escrita; (2) seletor de URL errado na unidade (`/unidades/2/visao-geral`), que deixou a #4 AGENDADA,
cancelada pela API; (3) 45/46, em que só a verificação de console falhou porque o Chromium registra os
dois 409 provocados. Essa terceira execução criou as janelas #5 e #6, que aparecem no SQL abaixo.

### Intervalo da continuação

| Evento | Instante (UTC) |
|---|---|
| fim previsto da #7 (antecipado) | 11:08:00 |
| #7 `CONCLUIDA` pelo job (`encerrada_em`) | 11:08:03.817 |
| medição FALHA do Swtich CPD (motor da 8080) | 11:08:03.955 |
| clique em "Agendar" da continuação | 11:08:20.598 |
| #8 `ATIVA` (`ativada_em`, ativação imediata no POST) | 11:08:20.728 |

Intervalo observado: **16,9 s** entre a conclusão e a ativação da continuação. Quase todo esse tempo é
do operador (aqui, o roteiro), entre ver a tela de continuação e enviar. Houve uma medição nesse
intervalo, 0,14 s depois da conclusão. Na tentativa anterior: #5 concluída às 11:03:02.807, medição às
11:03:02.982, #6 ativada às 11:03:20.710 (17,9 s).

Não dá para saber, pelos logs, qual backend ativou ou concluiu cada janela. A 8081 só registra ativação
ou conclusão **atrasada** (`WARN`), e o `backend.log` dela não tem nenhuma. As conclusões vieram 2,8 s
e 3,8 s depois do fim previsto. Isso combina com o intervalo de 5 s da 8081, mas não exclui o
reconciliador de 30 s da 8080.

## Exercício no banco da carga (SQL no 5436)

```
select id, status, versao, inicio_previsto, fim_previsto, ativada_em, encerrada_em, encerrada_por_id
  from manutencao_agendada where motivo like 'E2E F2%' order by id;
 id |  status   | versao |    inicio_previsto     |      fim_previsto      |          ativada_em           |         encerrada_em          | encerrada_por_id
----+-----------+--------+------------------------+------------------------+-------------------------------+-------------------------------+------------------
  4 | CANCELADA |      1 | 2026-10-26 11:01:00+00 | 2026-10-26 11:21:00+00 |                               |                               |
  5 | CONCLUIDA |      6 | 2026-10-26 11:01:00+00 | 2026-10-26 11:03:00+00 | 2026-10-26 11:01:02.419622+00 | 2026-10-26 11:03:02.807301+00 |
  6 | CONCLUIDA |      2 | 2026-10-26 11:03:00+00 | 2026-10-26 11:34:00+00 | 2026-10-26 11:03:20.710142+00 | 2026-10-26 11:03:26.354296+00 |                5
  7 | CONCLUIDA |      6 | 2026-10-26 11:06:00+00 | 2026-10-26 11:08:00+00 | 2026-10-26 11:06:03.394535+00 | 2026-10-26 11:08:03.816842+00 |
  8 | CONCLUIDA |      2 | 2026-10-26 11:08:00+00 | 2026-10-26 11:39:00+00 | 2026-10-26 11:08:20.728441+00 | 2026-10-26 11:08:24.522596+00 |                5
(5 rows)

select manutencao_id, tipo, alterado_em, antes->>'motivo' a, depois->>'motivo' d,
       antes->>'fimPrevisto' fa, depois->>'fimPrevisto' fd from manutencao_agendada_alteracao order by id;
 manutencao_id |    tipo     |          alterado_em          |       a        |       d        |          fa          |          fd
---------------+-------------+-------------------------------+----------------+----------------+----------------------+----------------------
             5 | EDICAO      | 2026-10-26 10:58:32.84739+00  | E2E F2 linha   | E2E F2 editada | 2026-10-26T11:22:00Z | 2026-10-26T11:22:00Z
             5 | PRORROGACAO | 2026-10-26 11:01:03.898223+00 | E2E F2 editada | E2E F2 editada | 2026-10-26T11:22:00Z | 2026-10-26T11:32:00Z
             5 | PRORROGACAO | 2026-10-26 11:01:04.335126+00 | E2E F2 editada | E2E F2 editada | 2026-10-26T11:32:00Z | 2026-10-26T11:37:00Z
             5 | ANTECIPACAO | 2026-10-26 11:01:05.153211+00 | E2E F2 editada | E2E F2 editada | 2026-10-26T11:37:00Z | 2026-10-26T11:03:00Z
             7 | EDICAO      | 2026-10-26 11:03:56.219834+00 | E2E F2 linha   | E2E F2 editada | 2026-10-26T11:27:00Z | 2026-10-26T11:27:00Z
             7 | PRORROGACAO | 2026-10-26 11:06:07.431132+00 | E2E F2 editada | E2E F2 editada | 2026-10-26T11:27:00Z | 2026-10-26T11:37:00Z
             7 | PRORROGACAO | 2026-10-26 11:06:07.850596+00 | E2E F2 editada | E2E F2 editada | 2026-10-26T11:37:00Z | 2026-10-26T11:42:00Z
             7 | ANTECIPACAO | 2026-10-26 11:06:08.66763+00  | E2E F2 editada | E2E F2 editada | 2026-10-26T11:42:00Z | 2026-10-26T11:08:00Z
(8 rows)
-- autor: as 8 linhas têm alterado_por_id = 5 (f2.manutencao@inframonitor.local). Em cada janela, a 1ª
-- PRORROGACAO é o "segundo operador" (PATCH pela API) e a 2ª é o reenvio da UI depois do 409.

select id, nome, em_manutencao, manutencao_manual from equipamento where id = 8;
 id |    nome    | em_manutencao | manutencao_manual
----+------------+---------------+-------------------
  8 | Swtich CPD | f             | f

select count(*) from incidente where monitor_id in (select id from monitor where equipamento_id = 8)
  and iniciado_em > '2026-10-26 10:57:00+00';
 count
-------
     1

select count(*) from equipamento e where e.em_manutencao <> (e.manutencao_manual or exists (...));
 count
-------
     0
```

A versão 6 das janelas #5 e #7 vem de 4 alterações registradas e 2 transições (ativar e concluir).
#6 e #8 (continuações) foram encerradas por "Encerrar agora" (`encerrada_por_id = 5`). O equipamento
terminou fora de manutenção, e nenhum equipamento ficou divergente.

**O incidente.** O Swtich CPD está **realmente fora do ar**: só tem `FALHA` desde antes do exercício,
com um incidente aberto desde 23/10. O motor e o dispatcher da 8080 do usuário estavam ligados. O
incidente apareceu assim:

```
 id | status  |          iniciado_em          |         encerrado_em          | motivo_encerramento
  3 | FECHADO | 2026-10-23 15:38:38.166037+00 | 2026-10-26 11:01:02.445623+00 | MANUTENCAO   <- fechado pela ativação da #5
  4 | FECHADO | 2026-10-26 11:04:03.07186+00  | 2026-10-26 11:06:03.404354+00 | MANUTENCAO   <- aberto no intervalo entre #6 e #7
notificacao: 6 (inc 3, 11:01:02), 7 (inc 4, 11:05:10), 8 (inc 4, 11:06:03) — ENVIADA, pela 8080
```

O incidente #4 foi aberto pela 3ª falha seguida, às 11:04:03. A contagem juntou uma falha de 11:00:51,
anterior à #5, com 11:03:02 e 11:04:03: os 2 min da #5 não zeraram o contador. Com o equipamento
fora do ar desde antes, a regra das 3 falhas está correta. Depois da limpeza (11:08:24) as medições
seguem em FALHA, e a 8080 deve reabrir um incidente na 3ª falha.

**Achado fora do escopo da F2 (vem da F1).** Na captura `14-mapa-gaveta`, a gaveta do Mapa mostra
"Origem da manutenção: Origem desconhecida" com a janela #8 ATIVA. A causa é a `linha` que o Mapa monta
(`resumoDoEquipamento()` em `mapa.component.ts`): ela não leva `manutencaoManual` nem
`janelaAtivaId`/`janelaAtivaFim`. A F2 não mudou esse código. Fica registrado como pendência.

### Limpeza

- Nenhuma janela "E2E F2" em AGENDADA ou ATIVA (captura `15-vigentes-limpo`).
- Usuário de exercício desativado:

```
update usuarios set ativo=false where email='f2.manutencao@inframonitor.local';
UPDATE 1
 id |              email               | ativo
----+----------------------------------+-------
  5 | f2.manutencao@inframonitor.local | f
```

## Efeito colateral no ambiente real

O equipamento escolhido para o exercício, **Swtich CPD (id 8)**, estava **realmente OFFLINE**, com o
incidente real #3 aberto desde 2026-10-23 15:38 UTC. As janelas do exercício o fecharam com motivo
`MANUTENCAO` (`fechado_por` = usuário f2, id 5). O backend do usuário na 8080 (mesmo banco da carga, motor,
dispatcher e Telegram **ligados**) mandou notificações reais ao grupo:

| notificacao | evento | incidente | instante (UTC) |
|---|---|---|---|
| 6 | `INCIDENTE_ENCERRADO_MANUTENCAO` | 3 | 11:01:02 |
| 7 | `INCIDENTE_ABERTO` | 4 | 11:05:10 |
| 8 | `INCIDENTE_ENCERRADO_MANUTENCAO` | 4 | 11:06:03 |
| 9 | `INCIDENTE_ABERTO` | 5 | 11:11:06 |

A 9 é o motor reabrindo o incidente depois do fim das janelas; o #5 segue ABERTO e reflete o estado real do
equipamento. Quatro execuções (3 tentativas que falharam + a final) produziram as janelas #4 a #9, todas
em estado final.

**Causa raiz:** a escolha do equipamento não aplicou o critério da F1 (online, sem incidente aberto,
medições SUCCESS recentes). **Lição:** antes de qualquer exercício no banco da carga com motor e
Telegram ligados em outro processo, escolher equipamento que cumpra esse critério, ou avisar o grupo.

## Suítes

Medidas no snapshot limpo do HEAD `d5f56fc`. Desde `2df02a1` nada em `src` mudou (a Task 9 só
acrescentou e2e e documentação), então os números valem para o código final.

| Suíte | Resultado |
|---|---|
| Backend, com Docker (`./mvnw test`) | `Tests run: 1165, Failures: 0, Errors: 0, Skipped: 0`, BUILD SUCCESS, nenhuma linha `!!` (era 656 na F1). Classe de corridas da F2: 152/152 |
| Frontend (`npx ng test --watch=false`) | 61 arquivos, **682/682** |
| `ng build` | OK; só o aviso preexistente de orçamento de `mapa.component.scss` (97,34 kB contra 6 kB) |

**Nota de ambiente.** No checkout de trabalho do usuário, `ng test` falha em cerca de 235 specs **apenas**
porque o `environment.ts` local, não versionado, aponta `apiUrl` para `http://10.79.20.163:8080` e os specs
esperam `localhost:8080`. Não é defeito de código; com o `environment.ts` versionado a suíte passa.
