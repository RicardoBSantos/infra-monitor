# Riscos de execução — correções da rodada de fechamento

Três riscos que ficaram abertos na revisão final do branch `feat/manutencao-equipamento`, corrigidos
com teste concorrente real (threads + `CyclicBarrier` + Postgres de Testcontainers + 30 repetições) e
prova de reversão. Desenho: [../superpowers/specs/2026-09-24-fechamento-dois-branches-design.md](../superpowers/specs/2026-09-24-fechamento-dois-branches-design.md).

## 1a. `fecharAutomaticamente` sem CAS

### Defeito

`IncidenteService.fecharAutomaticamente` carregava a entidade, chamava `incidente.fechar(...)` e fazia
`saveAndFlush`. O `UPDATE` do Hibernate grava todas as colunas `WHERE id = ?`, sem versão. Contra
transações que escrevem o mesmo incidente, isso dá dois desfechos ilegítimos concretos:

- com `EquipamentoService.entrarEmManutencao` (`fecharPorManutencao`): o motor sobrescreve
  `motivo_encerramento = MANUTENCAO` / `fechado_por = operador` por `RECUPERACAO_AUTOMATICA` / `NULL`,
  e o incidente fica com **duas** notificações de encerramento (`INCIDENTE_ENCERRADO_MANUTENCAO` e
  `INCIDENTE_FECHADO`);
- com `IncidenteService.reconhecer` (CAS `reconhecerSeAberto`): a instância carregada antes, ainda sem
  reconhecimento, grava `reconhecido_em`/`reconhecido_por` de volta a `NULL`.

### Segundo defeito, achado pela corrida: notificação de manutenção sobre id lido antes do bulk

Com o CAS no lugar, a corrida com a manutenção **continuou** 30/30 ilegítima, agora com outra forma:
linha `RECUPERACAO_AUTOMATICA`/`fechado_por NULL` (o motor ganhou a linha, legítimo) **mas** com uma
`INCIDENTE_ENCERRADO_MANUTENCAO` além da `INCIDENTE_FECHADO`. Causa: `entrarEmManutencao` lê os ids de
`abertosDoEquipamento` **antes** do `fecharPorManutencao` (SELECT simples, sem lock no incidente),
o motor fecha e commita no meio, o bulk update pula esse incidente (`status IN (ABERTO, RECONHECIDO)`
já não bate) — e a releitura por id chamava `tratarEncerramentoPorManutencao` para todos os ids lidos,
inclusive o que o motor fechou.

### Correção

1. `IncidenteRepository.fecharAutomaticamenteSeEmAberto(id, encerradoEm, observacao, agora)` — bulk
   update JPQL no idioma de `reconhecerSeAberto`/`fecharPorManutencao`: `SET status = FECHADO,
   encerradoEm, observacao, motivoEncerramento = RECUPERACAO_AUTOMATICA, fechadoPor = null, updatedAt
   WHERE id = :id AND status IN (ABERTO, RECONHECIDO)`, com `clearAutomatically`/`flushAutomatically`.
   Só toca colunas de fechamento, então `reconhecido_*` sobrevive. `fecharAutomaticamente` mantém
   assinatura e retorno: retorno 0 = outra transação já fechou → **sem notificação**, devolve a
   releitura; retorno 1 → relê por `findById` e só então `criarParaIncidenteFechado`. A validação
   `encerradoEm >= iniciadoEm` fica.
2. `EquipamentoService.entrarEmManutencao`: a releitura só notifica incidentes com
   `motivoEncerramento == MANUTENCAO`, isto é, os que **esta** manutenção fechou.

### Distribuição (30 repetições por teste, `ManutencaoPostgresIntegrationTest`)

Saídas completas em `.superpowers/sdd/2026-09-24-fechamento-dois-branches/`: `1a-antes.txt`,
`1a-reversao-so-cas.txt`, `1a-depois.txt`, `1a-suite.txt`. A rodada intermediária não ficou em
arquivo (o `1a-depois.txt` foi sobrescrito); a contagem dela foi colada do console.

**Antes — código antigo (`saveAndFlush`, sem filtro na manutenção):** `Tests run: 94, Failures: 30`

```
     30 [corrida-fechamento-manutencao] desfecho=ILEGITIMO motivo=RECUPERACAO_AUTOMATICA fechadoPor=null encerradasPorManutencao=1 fechadas=1
     30 [corrida-fechamento-reconhecer] desfecho=F-fechamento-ganhou recusado=true reconhecidoPor=null
```

**Intermediário — só o CAS, sem o filtro da manutenção:** 30/30 continuou `ILEGITIMO` com a mesma
forma (`motivo=RECUPERACAO_AUTOMATICA ... encerradasPorManutencao=1 fechadas=1`) — é o segundo
defeito acima, e também a prova de reversão do filtro.

**Reversão só do CAS — `saveAndFlush` antigo restaurado, filtro mantido:** `Tests run: 94, Failures: 1`

```
      1 [corrida-fechamento-manutencao] desfecho=ILEGITIMO motivo=RECUPERACAO_AUTOMATICA fechadoPor=null encerradasPorManutencao=1 fechadas=1
     29 [corrida-fechamento-manutencao] desfecho=R-recuperacao-ganhou motivo=RECUPERACAO_AUTOMATICA fechadoPor=null encerradasPorManutencao=0 fechadas=1
     30 [corrida-fechamento-reconhecer] desfecho=F-fechamento-ganhou recusado=true reconhecidoPor=null
```

Aqui o ilegítimo é o sobrescrito original: a manutenção fechou e notificou, o motor gravou por cima.

**Depois — CAS + filtro:** classe verde

```
     30 [corrida-fechamento-manutencao] desfecho=R-recuperacao-ganhou motivo=RECUPERACAO_AUTOMATICA fechadoPor=null encerradasPorManutencao=0 fechadas=1
     30 [corrida-fechamento-reconhecer] desfecho=F-fechamento-ganhou recusado=true reconhecidoPor=null
```

Zero ilegítimo em 30/30 nos dois testes.

### Limites da prova

- **O teste de reconhecer não discriminou.** No código antigo deu 0 ilegítimos em 30 — sempre
  `F-fechamento-ganhou` (o motor, com a instância já carregada, fecha antes de `reconhecer` chegar ao
  CAS). Ele fica como guarda de regressão, mas não prova que o CAS preserva `reconhecido_*` sob corrida;
  essa propriedade está coberta só pela construção do `UPDATE` (não toca `reconhecido_*`) e pelo teste
  de unidade `fechaAutomaticamenteAPartirDeReconhecido`.
- **Intercalação enviesada no teste de manutenção.** Com as duas correções, as 30 caíram em (R); o
  desfecho (M) não apareceu nesta rodada. A reversão só do CAS pegou o sobrescrito em 1/30 — o
  discriminador do CAS é fraco nesta bancada; o do filtro é 30/30.
