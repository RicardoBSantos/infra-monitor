# Pendências de produção (fora do deploy)

> Itens abertos que o estado de produção expôs e que **não** fazem parte da janela da V27. Ordem = prioridade. O estado
> que os originou está em `estado-atual.md` (conferência de 2026-11-18). Quando um item for tratado, ele sai daqui no
> commit da correção, com o link para onde ficou registrado.

**Marcação.** **[P]** provado: lido no código ou executado, com a fonte ao lado. **[P, ensaio]** lido no servidor no
ensaio de 2026-11-18 (resumo do responsável; ver `estado-atual.md`). **[P-lab]** executado em ambiente descartável.
**[E]** informado ou de documento de fase. **[I]** inferido.

| # | Item | Prioridade | Quando |
|---|---|---|---|
| P-01 | Um terço das notificações em `FALHA` | **1 — alerta que não chegou** | primeiro item depois da janela |
| P-02 | D-07: relatório de latência fora da meta; agregado por hora | **2 — trabalho a fazer, não fila** | começar depois da janela; prazo no item |
| P-03 | Retenção desligada com 102 monitores | **3 — tem data** | decidir até ~fev/2027 |

---

## P-01 — Um terço das notificações em `FALHA`

**Fato [P, ensaio, E8]:** `select status, count(*) from notificacao group by status` → **65 `ENVIADA`, 33 `FALHA`**
(98 no total, **34 %** de falha).

**Por que é prioridade 1:** cada notificação é um evento (abertura, recuperação, manutenção) que deveria ter chegado ao
grupo do Telegram. Uma `FALHA` é, até prova em contrário, **um alerta que não chegou em alguém**. É o produto falhando
na função principal, e não aparece na tela nem no health.

**Não investigado, de propósito** (decisão do responsável, 18/11). Nada abaixo é diagnóstico. Não se sabe ainda: se as
33 são antigas (configuração inicial do Telegram, por exemplo) ou recorrentes; se esgotaram as tentativas; qual o erro.

**Por onde começar, quando for tratado** (só leitura, sessão `Ler-Sql` do plano 1.0):

```sql
select tipo_evento, date_trunc('day', created_at) dia, count(*), max(tentativas) tentativas_max, left(erro, 160) erro
  from notificacao where status = 'FALHA' group by 1, 2, 5 order by 2, 1;
```

**Efeito na janela da V27, já registrado no plano:** a mensagem à equipe (3.6) não promete mais que o alerta "chega":
com esta taxa, não há como garantir.

---

## P-02 — D-07: o relatório de latência está fora da meta em produção

### O que mudou

A avaliação de 16/11 foi que o D-07 **não era urgente**, porque com **7 equipamentos** o relatório de latência de
30 dias daria poucos segundos. **Estava errada**: o inventário de produção não era de 7 equipamentos (o
`estado-atual.md` repetia o valor de 11/11). O ensaio de 18/11 leu **102 monitores ativos a 60 s** **[P, ensaio]**.
Com 102, o D-07 **já está fora da meta de 2 s em produção** e, em regime (30 dias de coleta dos 102), fica em torno de
**22 s**.

### Recalibração (2.1)

**Base [P, `D02.11-A.1-estabilizacao-operacional.md`, seção 6]:** Capacity Benchmark em runner do CI, 250 monitores a
60 s, carga de 31 dias (11,16 M linhas). O período de 30 dias tem 250 × 1.440 × 30 = **10,8 M** linhas.

| Endpoint, 30 dias | Benchmark, 250 monitores | **Produção, 102 monitores** (× 0,408) | Meta |
|---|---|---|---|
| `/relatorios/latencia` | 55,0 s (máx. 56,6) | **≈ 22,4 s** (máx. ≈ 23,1) | 2 s |
| PDF da visão geral | 25,7 s (máx. 27,1) | **≈ 10,5 s** (máx. ≈ 11,1) | 10 s |
| `/relatorios/latencia/unidades` | 4,7 s | **≈ 1,9 s** — no limite | 2 s |

Linhas no período em produção: 102 × 1.440 × 30 = **4,41 M** (a coleta real fica em ~99 % do teórico **[E,
`medicao-crescimento-e-retencao.md`, seção 4]**).

**A relação é linear? No número de monitores, sim; no período, não.** O motivo está no SQL:

- `/relatorios/latencia` agrupa **por monitor** (`group by u.id, …, m.id, m.nome`) **[P, `RelatorioService.latencia`]**.
  O `percentile_cont(0.95) within group (order by md.latencia_ms)` é um agregado de conjunto ordenado: o PostgreSQL
  ordena **os valores de cada grupo**, não a tabela inteira. Cada monitor tem k = 1.440 × dias linhas no período,
  **independente de quantos monitores existem**. Custo da ordenação: M grupos × k·log k. Com o período fixo, k·log k é
  constante e o custo é **linear em M**. A leitura das linhas também é linear em M (M × k linhas).
- **Onde a ordenação não escala linearmente: no eixo do período.** Triplicar o período (30 → 90 dias, que o endpoint
  aceita) triplica k e multiplica o termo da ordenação por 3 × log(3k)/log(k) ≈ 3 × 17,0/15,4 ≈ **3,3**, não 3. E há um
  degrau possível: com `work_mem` de 4 MB, a ordenação de um grupo de 129.600 valores (90 dias) fica perto do limite da
  memória e pode ir para disco **[I, não medido]**. Estimativa de 90 dias com 102 monitores: **≥ 67 s** (3 × 22,4, mais
  o excesso da ordenação) **[I]**. O ARR corta em 2 min **[E, D02.11-A.1]**.
- `/relatorios/latencia/unidades` **não tem** `percentile_cont` **[P]**: é só leitura e agregação, linear nos dois eixos.

**O que pode afastar o número absoluto da conta linear (e para que lado):**

| Fator | Efeito |
|---|---|
| **Hardware.** O benchmark rodou num runner do CI; produção é um Windows 11 com 15,7 GiB **[E, D02.10-B]** | Desconhecido. Outra medição do repositório dá **~1,1 s por milhão** de linhas (`medicao-crescimento-e-retencao.md`, ambiente local), contra **5,1 s/M** do benchmark: **4,6× de diferença entre ambientes**. Com 1,1 s/M, produção em regime daria **≈ 4,8 s**. **Mesmo assim, acima da meta** |
| **Cache.** 30 dias de `medicao` com índices: 1,77 GB no benchmark **[P]**; ≈ 0,7–0,9 GB em produção (P-03) | Conjunto menor cabe mais facilmente em memória: tende a deixar produção **mais rápida** que a conta linear |
| **Duas execuções por chamada.** `page()` roda o SQL inteiro uma vez dentro de `select count(*) from (…)` e outra para a página **[P, `RelatorioService.page`]** | Não muda a escala (vale nos dois lados); é um fator ~2 recuperável na correção |
| **Plano genérico** (o que o PR #40 tratava). Produção roda `r-921dd90`, sem o #40 | Um ensaio de 2026-11-11 viu 30 s com 7 monitores depois de ~10 execuções na mesma conexão; **não reproduziu** no benchmark do #40 (efeito de ~100 ms, misto) **[P-lab]**. Fora da estimativa; só pioraria |

**Quando produção cruza os 2 s:** com a calibração do benchmark, a partir de ≈ 0,39 M linhas no período, ou seja,
**≈ 2,7 dias** de coleta dos 102. Com a calibração local (1,1 s/M), ≈ 1,8 M linhas, **≈ 12 dias**.

**"Já está fora da meta hoje" — o que é prova e o que é conta:** em **regime** (30 dias de coleta dos 102) está fora da
meta nas **duas** calibrações, de ~5 s a ~22 s contra 2 s **[I, conta sobre P]**. **Hoje** depende de quantos dias de
medição dos 102 já existem, que o ensaio não leu: se o inventário foi cadastrado há mais de ~3 dias, a calibração do
benchmark já põe o relatório acima de 2 s. Para tirar a dúvida, a consulta de medições do `estado-atual.md` (linhas em
30 dias, por dia), e cronometrar uma chamada de `/relatorios/latencia` de 30 dias.

### O que isto não reabre (2.3)

**O PR #40 continua revertido (PR #45).** O ganho medido dele era de ~100 ms e misto: sem ele, a latência de 1 dia fica 21 % mais lenta
e o CSV de latência 46 % mais lento, mas a latência por unidade de 1 dia fica 27 % **mais rápida** **[P-lab, PR #45]**. Isso **independe do volume**: o #40 troca o plano genérico pelo
custom (cache de plano), não a quantidade de linhas lidas e ordenadas. Os 22 s são volume.

### O trabalho: agregado por hora, com p95 exato

Correção já proposta na D02.11-A.1 (D-07 e D-08) e **não implementada**. Deixa de ser item de fila: é o próximo trabalho
de backend depois da janela e do P-01.

**Ponto de partida, já provado em protótipo [P-lab, 2026-11-11, banco descartável; scripts fora do repositório]:**
`latencia_ms` é `INTEGER`, então um **histograma por valor** (contagem por milissegundo) dá o p95 **exato**. Desenho
testado: agregado diário + horário por monitor, mais as medições brutas só nas bordas do período. Resultado com 250
monitores × 30 dias: **431 ms**, **0 divergências** em 10.000 comparações contra `percentile_cont`. Custo na ingestão,
com trigger por instrução: −22 % de inserções/s (7,8 mil → 6,1 mil/s), contra uma necessidade de **1,7/s** com 102
monitores.

**Escopo:**
1. Migration com as tabelas de agregado e o backfill do histórico existente.
2. Alimentação incremental (trigger por instrução, ou na própria gravação da medição; decidir com medição).
3. As **três** cópias do SQL de latência passam a ler o agregado: `RelatorioService` (`latencia` e
   `latenciaUnidades`), `VisaoGeralPdfRepository` (D-08) e `RelatorioExportService` (CSV) **[P, as três usam
   `percentile_cont`]**.
4. `page()` sem a segunda execução do SQL inteiro.
5. Bordas do período sem `OR` contra CTE: limites como parâmetros, um intervalo por borda (lição do protótipo).
6. Compatível com a retenção (P-03): o agregado é o que permite apagar o bruto sem perder p95.

**Critério de aceite:** no Capacity Benchmark (250 × 30 dias), `/relatorios/latencia` de 30 dias **< 2 s**, PDF
**< 10 s**; 90 dias medido e registrado; p95, mín., máx., média e contagem **idênticos** ao cálculo atual em comparação
exaustiva; teste de reversão da migration.

**Prazo:** antes de produção completar 30 dias de coleta dos 102 (~22 s). Até lá, se o relatório for usado e prender
conexões, o paliativo da D02.11-A.1 (limitar o período e `statement_timeout` nessas consultas) é a contenção.

---

## P-03 — Retenção desligada, agora com 102 monitores

**Fatos:** retenção **desligada** (`RETENTION_ENABLED` ausente) **[P, ensaio]**; 102 monitores a 60 s **[P, ensaio]**;
o PostgreSQL guarda os dados em `C:\InfraMonitor\pgdata`, no **mesmo** volume `C:` da raiz de implantação **[E,
D02.10-B]**; espaço livre: **34 GiB** na última medição **[E, D02.11-A.1]**, antes do inventário de 102 — **A CONFERIR**.

**Ritmo de crescimento (2.4):**

| | Medições | Disco (159–205 B por medição, com índices) | Com +20 % de inchaço |
|---|---|---|---|
| Por dia | ≈ 145 mil | ≈ 22–28 MiB | — |
| **Por mês** | ≈ 4,4 M | ≈ **0,66–0,85 GiB** | ≈ **0,79–1,01 GiB** |
| **Por ano** | ≈ 53 M | ≈ **7,9–10,1 GiB** | ≈ **9,4–12,2 GiB** |

Bytes por medição: **159 B** no benchmark (1,77 GB ÷ 11,16 M, tabela e índices) **[P, D02.11-A.1]** e **205 B** na
carga real **[P, `medicao-crescimento-e-retencao.md`]**. Ritmo: 102 × 1.440 × 99 %. O crescimento é **linear** (cada dia
soma o mesmo número de linhas); não há aceleração, só acúmulo. Sem backup local (decisão de 2026-11-11), não há o termo
de dumps.

**Quando aperta — três limites, em ordem de chegada:**

1. **Gatilho do próprio repositório para ligar a retenção** (10 M linhas ou 2 GB em `medicao`, o que vier antes **[E,
   `medicao-crescimento-e-retencao.md`, seção 6]**): **≈ 2,2 a 2,9 meses** de coleta dos 102, ou seja, entre o
   **fim de janeiro e o começo de fevereiro de 2027**. É a data para a decisão, não um problema de disco.
2. **O ferramental de release para de funcionar.** `Test-FreeSpacePolicy` recusa quando o livre projetado fica abaixo
   de 22 GiB, com pico operacional de 3 GiB **[P, `ReleaseTools.psm1`]**: **Stage, Switch e Rollback** são recusados
   com menos de **~25 GiB livres**, antes de qualquer ação, **inclusive o rollback de emergência**. De 34 GiB, sobram
   **~9 GiB**: **≈ 9 a 14 meses** de coleta (com e sem inchaço), ou seja, entre **agosto de 2027 e janeiro de 2028**. Este é o
   limite que realmente aperta.
3. **Disco cheio:** ≈ 34 a 43 meses, longe.

A conta parte dos 34 GiB antigos; outras ocupações do mesmo volume (logs, pacotes em `C:\src\packages`, sobras de
`staging\`, Windows) antecipam as datas. O J2 da janela mede o livre de verdade.

**Decisões pendentes antes de ligar** (todas já registradas em `medicao-crescimento-e-retencao.md`, seções 6 e 7, e na
D02.9): prazo de retenção (a D02.9 exige no mínimo 30 dias); se o p95 de períodos longos é requisito (se for, a
retenção depende do agregado do P-02); ligar é ato explícito do responsável.
