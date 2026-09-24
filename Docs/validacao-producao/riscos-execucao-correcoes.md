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

### Prova

Em `ManutencaoPostgresIntegrationTest`, quatro testes:

- **Duas corridas** (`@RepeatedTest(30)`, `CyclicBarrier`): manutenção × fechamento automático e
  reconhecer × fechamento automático. A instância que o motor fecha é carregada antes da barreira, como
  no `IncidentProcessor`. Depois da barreira o motor dorme um atraso aleatório de 0..12 ms (manutenção)
  ou 0..4 ms (reconhecer). Sem o atraso, o `UPDATE` único do motor commitava sempre primeiro e só um
  desfecho legítimo aparecia (30 R e 30 F). Os limites foram calibrados até os dois desfechos
  aparecerem.
- **Duas ordens fixas, sem corrida:** motor carrega → manutenção roda inteira (ou `reconhecer` responde
  sucesso) → motor fecha com a instância velha. É a intercalação que discrimina o CAS de forma
  determinística: `fecharAutomaticamenteComInstanciaVelhaNaoSobrescreveFechamentoPorManutencao` exige
  MANUTENCAO/operador, uma `INCIDENTE_ENCERRADO_MANUTENCAO` e nenhuma `INCIDENTE_FECHADO`;
  `fecharAutomaticamenteComInstanciaVelhaNaoApagaReconhecimento` exige `reconhecido_em`/`reconhecido_por`
  preenchidos.

As saídas completas ficaram só na máquina local de quem executou (diretório de trabalho fora do git).
As contagens abaixo foram coladas delas.

### Distribuição

**Código antigo (`saveAndFlush`, sem filtro na manutenção), corridas ainda sem atraso:**
`Tests run: 94, Failures: 30`

```
     30 [corrida-fechamento-manutencao] desfecho=ILEGITIMO motivo=RECUPERACAO_AUTOMATICA fechadoPor=null encerradasPorManutencao=1 fechadas=1
     30 [corrida-fechamento-reconhecer] desfecho=F-fechamento-ganhou recusado=true reconhecidoPor=null
```

**Só o CAS, sem o filtro da manutenção, corridas sem atraso:** as 30 da manutenção continuaram
`ILEGITIMO`, com a mesma forma (`motivo=RECUPERACAO_AUTOMATICA ... encerradasPorManutencao=1 fechadas=1`).
É o segundo defeito acima e também a prova de reversão do filtro.

**Reversão só do CAS (`saveAndFlush` antigo restaurado, filtro mantido), versão final dos testes:**
`Tests run: 96, Failures: 41`

```
     18 [corrida-fechamento-manutencao] desfecho=ILEGITIMO motivo=RECUPERACAO_AUTOMATICA fechadoPor=null encerradasPorManutencao=1 fechadas=1
     12 [corrida-fechamento-manutencao] desfecho=R-recuperacao-ganhou motivo=RECUPERACAO_AUTOMATICA fechadoPor=null encerradasPorManutencao=0 fechadas=1
      9 [corrida-fechamento-reconhecer] desfecho=F-fechamento-ganhou recusado=true reconhecidoPor=null
     21 [corrida-fechamento-reconhecer] desfecho=ILEGITIMO recusado=false reconhecidoPor=null
```

Os dois testes de ordem fixa também falharam:

```
fecharAutomaticamenteComInstanciaVelhaNaoApagaReconhecimento
  {"reconhecido_em"=null, "reconhecido_por"=null, "status"="FECHADO"}
fecharAutomaticamenteComInstanciaVelhaNaoSobrescreveFechamentoPorManutencao
  {"fechado_por"=null, "motivo_encerramento"="RECUPERACAO_AUTOMATICA", "status"="FECHADO"}
```

41 = 18 + 21 + 2. Sem o CAS, a manutenção fecha e notifica e o motor grava por cima. `reconhecer`
responde sucesso e o motor apaga o reconhecimento.

**Depois (CAS + filtro), versão final dos testes:** `Tests run: 96, Failures: 0`

```
     23 [corrida-fechamento-manutencao] desfecho=M-manutencao-ganhou motivo=MANUTENCAO fechadoPor=1 encerradasPorManutencao=1 fechadas=0
      7 [corrida-fechamento-manutencao] desfecho=R-recuperacao-ganhou motivo=RECUPERACAO_AUTOMATICA fechadoPor=null encerradasPorManutencao=0 fechadas=1
     14 [corrida-fechamento-reconhecer] desfecho=F-fechamento-ganhou recusado=true reconhecidoPor=null
     16 [corrida-fechamento-reconhecer] desfecho=RF-reconhecido-e-fechado recusado=false reconhecidoPor=1
```

Zero ilegítimo em 30/30 nas duas corridas. Os dois desfechos legítimos aparecem em cada uma. Durante a
calibração, com o código corrigido: 12/4 ms deu 15 M / 15 R e 9 F / 21 RF; 25/8 ms deu 24 M / 6 R e
5 F / 25 RF. Com 40 ms nas duas corridas, deu 24 M / 6 R e 30 RF / 0 F.

### Limites da prova

- A proporção entre os desfechos depende da máquina, porque o atraso foi calibrado contra a latência
  local. O que discrimina o CAS de forma determinística são os dois testes de ordem fixa. As corridas
  ficam como guarda contra intercalações que a ordem fixa não cobre.
