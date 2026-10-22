# Manutenção agendada — investigação e desenho

Data: 2026-10-22 · Base: `main` 2176cd1 (PR #17 mergeado) · Só desenho: nenhum código, nenhuma migration.

Decisões numeradas em [manutencao-agendada-decisoes.md](manutencao-agendada-decisoes.md) (MA-NN);
o que depende de você está em [manutencao-agendada-pendencias.md](manutencao-agendada-pendencias.md) (P-NN).

---

## 0. O que existe hoje (verificado no código)

| Peça | Onde | O que faz |
|---|---|---|
| `equipamento.em_manutencao` | `V14__add_em_manutencao_to_equipamento.sql` | Booleano, sem data, motivo, autor nem histórico |
| Entrada | `EquipamentoService.entrarEmManutencao` (`EquipamentoService.java:146`) | CAS no flag; fecha incidentes (`motivo_encerramento = MANUTENCAO`, `fechado_por` = usuário); encerra episódios de latência; fecha `janela_monitoramento`; cancela notificação pendente ou gera aviso de encerramento |
| Saída | `EquipamentoService.sairDeManutencao` (`:193`) | CAS no flag; reabre janela reavaliando o predicado inteiro |
| Motor | `MonitorRepository.findActiveExecutionCandidates` (`MonitorRepository.java:35`) | `m.ativo AND e.ativo AND NOT e.emManutencao` — **ignora `unidade.ativo`** |
| Abertura de incidente | `IncidenteRepository.inserirSeElegivel` (`:128-135`) | INSERT condicional com `FOR UPDATE OF e`: o lock da linha do equipamento é o ponto de serialização com a entrada em manutenção |
| Abertura de episódio | `MonitorEpisodioLatenciaRepository.java:38` | Mesmo predicado |
| Incidente manual (M7) | `IncidenteRepository.travarElegibilidadeParaAbertura` (`:156-162`) | Mesmo predicado, mesmo lock |
| Janela de SLA | `CicloJanelaMonitoramentoService.abrir` (`:26`) | Invariante: janela aberta ⇔ candidato do motor |
| Âncora de observação | `InicioDaObservacao.doMonitor` | `max(início da janela aberta, último fechamento)`: medição de antes da manutenção não sustenta incidente depois dela |
| Painel | `DashboardReadRepository.java:23,30,39` e `OperationalStatusResolver` | `EM_MANUTENCAO` no equipamento; unidade só fica `EM_MANUTENCAO` quando nenhum equipamento monitorado sobra |
| Interface | `equipamento-list.component.ts:351,405,439`, drawer `:267` | **Botão manual já existe** (PR #17, commits `d674fed`, `27ad409`) |
| Agendamento | `MonitoringEngineConfiguration.java:18`, `NotificationDispatcherConfiguration.java:20` | `NotificationDispatcherConfiguration` **não** é condicional: `@EnableScheduling` vale sempre; são os beans `@Scheduled` que são condicionais. Pool de agendamento de 1 thread, compartilhada (`application.yml`, comentário do Hikari). *Corrigido em 2026-10-22: a primeira versão desta linha dizia que nenhum `@Scheduled` rodaria com motor e dispatcher desligados.* |
| Segurança | `SecurityConfiguration.java:13-18` | Rota nova fora das listas cai em `/api/** → ADMIN` |
| Notificação | `V15` `ck_notificacao_ancora_exclusiva` | `num_nonnulls(incidente_id, episodio_latencia_id) = 1`: não existe notificação sem incidente ou episódio |

Ou seja: a manutenção manual está completa e bem guardada; tudo o que ela faz é disparado por **um**
flag numa **uma** linha. O desenho abaixo preserva isso.

---

## 1. Mockup: real, derivável ou ficção

Fonte: `arquivos-Claude-Design/Infra Monitor.dc.html` (dados em `:1430-1434`, tela em `:1904-1917`,
modal em `:1765-1771`, ações em `:1689-1691` e `:1720-1725`).

| Campo / elemento | Hoje | Classificação | O que usar |
|---|---|---|---|
| **ID `MW-0041`** | Gerado no front como `'MW-00' + (44 + length)` (`:1723`) | **Ficção.** Não há sequência; o número depende do tamanho do array e repete após um cancelamento (que remove a linha) | `#41`, o `id` IDENTITY formatado como os demais (`#{{ incidente.id }}`, `#{{ notificacao.id }}`). Sem coluna de código (MA02) |
| Unidade | `unidade` existe | **Real** | FK `unidade_id` obrigatória |
| Escopo | Select com lista fixa (`SW-CORE`, `LINK-WAN`…) que não depende da unidade escolhida; um equipamento só | **Parcialmente ficção** | `UNIDADE` ou `EQUIPAMENTOS` (um ou mais, da mesma unidade) (MA05) |
| Início / Fim | Texto livre `dd/mm/aaaa HH:MM` | **Construir** | `TIMESTAMPTZ`, entrada em `datetime-local` no fuso de `app.reports.timezone` |
| Motivo | — | **Construir** | `VARCHAR(300) NOT NULL`, não vazio |
| Criado por | Nome fixo (`'R. Menezes'`) | **Construir** (o principal já existe: `UsuarioPrincipal`) | FK `criado_por_id → usuarios` |
| Situação AGENDADA/ATIVA/CONCLUÍDA | Constante do mockup | **Construir, e incompleta** | + `CANCELADA` e `EXPIRADA` (§3) |
| Ação "Cancelar" | Apaga a linha (`filter(m => m.id !== f.id)`), aparece até em CONCLUÍDA, e promete "o período passará a contar para o SLA" | **Ficção nas três coisas** | AGENDADA → Cancelar; ATIVA → Encerrar agora; CONCLUÍDA/CANCELADA/EXPIRADA → nenhuma ação. Nada é apagado. O período de uma janela ativa **não pode** voltar a contar para o SLA: nada foi medido nele (MA09) |
| Paginação "1, 2" com 4 linhas | — | **Ficção/incoerente** | `app-paginacao` com total do servidor (§8) |
| Subtítulo "disponibilidade dentro da janela é excluída do SLA" | A manutenção manual já faz isso fechando `janela_monitoramento` | **Real (derivável)** | Mesmo mecanismo |
| Banner na unidade "Janela de manutenção ativa · …" e botão "Agendar manutenção" (`:510-518`) | — | **Derivável** depois da F1 | F2 |
| Status `MANUTENÇÃO` da unidade | `StatusOperacionalUnidade.EM_MANUTENCAO` | **Real**, com regra mais estrita que o mockup (só quando nada monitorado sobra) | Sem mudança |
| Telegram "Manutenção iniciada/concluída" (`:1505`, `:1951`) e nota do modal "Um aviso é enviado no Telegram no início e no fim da janela" (`:1767`) | `ck_notificacao_ancora_exclusiva` não admite | **Ficção.** O mockup *diz*, sim, que avisa — na nota do modal | Fatia própria (F3, §6.3) |
| Relatório "Disponibilidade excl. manutenção" × "Disponibilidade", "Manutenção declarada 240 min" (`:1662`, `:1675-1676`) | Não existe | **Ficção.** "Disponibilidade incluindo manutenção" não é calculável: durante a manutenção nada é medido | "Minutos declarados" fica derivável da tabela nova (F4) |

---

## 2. Modelo de dados (rascunho — NÃO aplicar)

### 2.1 Equipamento: separar o botão do estado efetivo (MA01)

```sql
ALTER TABLE equipamento ADD COLUMN manutencao_manual BOOLEAN NOT NULL DEFAULT FALSE;
-- Hoje toda manutenção é manual.
UPDATE equipamento SET manutencao_manual = em_manutencao;
-- O caso "janela termina com o botão ligado" fica impossível no banco, não só no serviço.
ALTER TABLE equipamento ADD CONSTRAINT ck_equipamento_manutencao_manual_efetiva
    CHECK (NOT manutencao_manual OR em_manutencao);
```

`em_manutencao` passa a significar **manutenção efetiva** e continua sendo lido pelos ~10 pontos de
§0 **sem nenhuma alteração** neles. Só quem escreve muda.

### 2.2 A janela

Nome: `manutencao_agendada`, deliberadamente longe de `janela_monitoramento` (MA03).

```sql
CREATE TABLE manutencao_agendada (
    id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    unidade_id BIGINT NOT NULL REFERENCES unidade(id) ON DELETE RESTRICT,
    escopo VARCHAR(12) NOT NULL,
    inicio_previsto TIMESTAMPTZ NOT NULL,
    fim_previsto TIMESTAMPTZ NOT NULL,
    motivo VARCHAR(300) NOT NULL,
    status VARCHAR(10) NOT NULL DEFAULT 'AGENDADA',
    criado_por_id BIGINT NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
    ativada_em TIMESTAMPTZ,
    encerrada_em TIMESTAMPTZ,
    encerrada_por_id BIGINT REFERENCES usuarios(id) ON DELETE RESTRICT,   -- NULL = fim automático
    cancelada_em TIMESTAMPTZ,
    cancelada_por_id BIGINT REFERENCES usuarios(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT ck_manutencao_agendada_escopo CHECK (escopo IN ('UNIDADE', 'EQUIPAMENTOS')),
    CONSTRAINT ck_manutencao_agendada_status CHECK (
        status IN ('AGENDADA', 'ATIVA', 'CONCLUIDA', 'CANCELADA', 'EXPIRADA')),
    CONSTRAINT ck_manutencao_agendada_periodo CHECK (fim_previsto > inicio_previsto),
    CONSTRAINT ck_manutencao_agendada_motivo CHECK (btrim(motivo) <> ''),
    -- Irmã de ck_incidente_fechamento_coerente: cada status carrega exatamente os seus carimbos.
    CONSTRAINT ck_manutencao_agendada_coerente CHECK (
        (status = 'AGENDADA'  AND ativada_em IS NULL     AND encerrada_em IS NULL     AND cancelada_em IS NULL)
     OR (status = 'ATIVA'     AND ativada_em IS NOT NULL AND encerrada_em IS NULL     AND cancelada_em IS NULL)
     OR (status = 'CONCLUIDA' AND ativada_em IS NOT NULL AND encerrada_em IS NOT NULL AND cancelada_em IS NULL)
     OR (status = 'CANCELADA' AND ativada_em IS NULL     AND encerrada_em IS NULL
                              AND cancelada_em IS NOT NULL AND cancelada_por_id IS NOT NULL)
     OR (status = 'EXPIRADA'  AND ativada_em IS NULL     AND encerrada_em IS NULL     AND cancelada_em IS NULL)),
    CONSTRAINT ck_manutencao_agendada_encerrador CHECK (encerrada_por_id IS NULL OR status = 'CONCLUIDA'),
    -- Nunca ativa antes do previsto; ativar DEPOIS é o caso do sistema parado (§3.3).
    CONSTRAINT ck_manutencao_agendada_ativacao CHECK (ativada_em IS NULL OR ativada_em >= inicio_previsto),
    CONSTRAINT ck_manutencao_agendada_encerramento CHECK (encerrada_em IS NULL OR encerrada_em >= ativada_em)
);
-- O tick só olha o que ainda pode mudar.
CREATE INDEX ix_manutencao_agendada_vigentes ON manutencao_agendada (inicio_previsto)
    WHERE status IN ('AGENDADA', 'ATIVA');
CREATE INDEX ix_manutencao_agendada_unidade ON manutencao_agendada (unidade_id, inicio_previsto DESC);

CREATE TABLE manutencao_agendada_equipamento (
    manutencao_id BIGINT NOT NULL REFERENCES manutencao_agendada(id) ON DELETE RESTRICT,
    equipamento_id BIGINT NOT NULL REFERENCES equipamento(id) ON DELETE RESTRICT,
    PRIMARY KEY (manutencao_id, equipamento_id)
);
CREATE INDEX ix_manutencao_agendada_equipamento_equip ON manutencao_agendada_equipamento (equipamento_id);
```

Regras de serviço (não expressáveis em CHECK, cada uma com teste):

- `EQUIPAMENTOS` exige ≥ 1 linha de ligação; `UNIDADE` exige zero.
- Na criação, todo equipamento ligado pertence a `unidade_id`, está ativo, e a unidade está ativa.
- `inicio_previsto >= agora − 5 min` (tolerância de digitação); começar "agora" é permitido.
- Duração máxima: pendência P-04.

Exclusão: as FKs `RESTRICT` fazem `excluir` de equipamento e de unidade estourar 500 quando houver
janela. Os dois serviços ganham a recusa explícita 409, no mesmo padrão de "existem monitores
associados" (duas camadas, como o resto do inventário).

### 2.3 O predicado de cobertura (fonte única)

```sql
-- desejado(e) = e.manutencao_manual OR coberto(e)
EXISTS (SELECT 1 FROM manutencao_agendada ma
         WHERE ma.status = 'ATIVA'
           AND (   (ma.escopo = 'UNIDADE' AND ma.unidade_id = e.unidade_id)
                OR (ma.escopo = 'EQUIPAMENTOS' AND EXISTS (
                        SELECT 1 FROM manutencao_agendada_equipamento mae
                         WHERE mae.manutencao_id = ma.id AND mae.equipamento_id = e.id))))
```

Usa `status = 'ATIVA'`, **não** o relógio. O relógio só é consultado em um lugar: o reconciliador,
que muda o status (MA06). Se o predicado comparasse `now()` com `inicio/fim`, o painel, o motor e o
reconciliador poderiam discordar por segundos, e o equipamento entraria na janela sem os efeitos.

### 2.4 Relação com `janela_monitoramento`

Nenhuma estrutural. `janela_monitoramento` responde "este monitor estava sendo observado?" — é o
denominador do SLA, por **monitor**, com uma janela aberta por vez (`uq_janela_monitoramento_aberta`)
e `origem PRECISA/INFERIDA`. Manutenção é uma das causas para essa janela fechar, junto com desativar
equipamento ou monitor. Reutilizá-la exigiria afrouxar o índice único, acrescentar motivo/autor/escopo
a uma tabela por monitor, e faria o relatório de SLA confundir "não observado" com "planejado" (MA03).

---

## 3. Ciclo de vida e quem o move

```
             cancelar (operador)
  AGENDADA ───────────────────────────▶ CANCELADA
     │  └── fim_previsto passou sem ter ativado ──▶ EXPIRADA
     │ inicio_previsto <= agora < fim_previsto
     ▼
   ATIVA ── fim_previsto <= agora ──▶ CONCLUIDA (encerrada_por_id NULL)
     └──── encerrar agora (operador) ─▶ CONCLUIDA (encerrada_por_id = usuário)
```

### 3.1 O reconciliador (MA06)

Componente `ReconciliadorManutencao`, `@Scheduled(fixedDelay = 30 s)` e uma passada na subida.
Usa o `monitoringClock`. Cada passada:

1. `UPDATE … SET status='ATIVA', ativada_em=:agora WHERE status='AGENDADA' AND inicio_previsto <= :agora AND fim_previsto > :agora`
2. `UPDATE … SET status='EXPIRADA' WHERE status='AGENDADA' AND fim_previsto <= :agora`
3. `UPDATE … SET status='CONCLUIDA', encerrada_em=:agora WHERE status='ATIVA' AND fim_previsto <= :agora`
4. **Divergência:** `SELECT e.id FROM equipamento e WHERE e.em_manutencao <> (e.manutencao_manual OR coberto(e)) ORDER BY e.id`;
   para cada um, em transação própria, `reavaliar(e)` (§4.2).

Os passos 1–3 são CAS pelo próprio `WHERE status = …`. O passo 4 é **por nível, não por evento**:
não importa o que mudou nem quando; o que diverge é corrigido. É isso que torna a recuperação depois
de queda trivial (§3.3) e que cura qualquer corrida que um caminho síncrono perca (§7).

Frequência: 30 s. A janela é marcada em minutos; meio minuto de atraso é invisível para quem agenda
e barato para ~220 equipamentos (a query de divergência é um anti-join com índice). Configurável por
`manutencao.reconciliador.intervalo-ms`.

### 3.2 Ligar o agendador (MA07)

O agendamento do Spring já está sempre habilitado (`NotificationDispatcherConfiguration`). O
reconciliador é um bean `@ConditionalOnProperty` em `manutencao.agendada.enabled` (variável
`MANUTENCAO_AGENDADA_ENABLED`), desligado por padrão como motor, Telegram e dispatcher, e
`ConfiguracaoPadraoDesligadaTest` passa a cobri-lo.

Consequência que precisa de guarda: com o reconciliador desligado, uma janela criada **nunca
ativaria**, em silêncio. Por isso `POST /manutencoes` responde 409 quando ele está desligado, e
`/api/v1/status` passa a expor `manutencaoAgendadaLigada`. Ver P-06.

### 3.3 Sistema parado no início ou no fim (MA08)

Regra: **nada é aplicado retroativamente.** Efeito de manutenção só acontece no instante real em que
o sistema o executa, e esse instante fica gravado (`ativada_em`, `encerrada_em`), separado do previsto.

| Situação na subida | Ação | Por quê |
|---|---|---|
| AGENDADA, início passou, fim no futuro | **Ativa atrasada** (`ativada_em = agora > inicio_previsto`) | A intervenção provavelmente está em curso; não ativar geraria alarme falso pelo resto da janela |
| AGENDADA, início e fim passaram | **EXPIRADA**, sem efeito nenhum | Aplicar agora seria manutenção fora do combinado; aplicar no passado reescreveria `janela_monitoramento` histórica |
| ATIVA, fim passou | **CONCLUÍDA atrasada** (`encerrada_em = agora > fim_previsto`) | Ver abaixo |

Por que não reabrir a janela de SLA no `fim_previsto` passado: entre o fim previsto e a subida o
sistema não mediu nada. Reabrir no passado contaria esse tempo como disponível — exatamente o defeito
de "SLA sobe para 100 % com o motor parado" (`monitoramento-parado-investigacao.md` §1.2). Concluir no
instante real mantém o buraco fora do denominador, que é a verdade.

Efeito colateral útil: `ativada_em − inicio_previsto` e `encerrada_em − fim_previsto` acima de dois
ticks são **evidência datada** de que o sistema esteve fora. A tela mostra "ativada com 47 min de
atraso" e o reconciliador loga WARN. Não resolve a dívida de monitoramento parado — só ilumina um
pedaço dela. EXPIRADA tem badge de alerta pelo mesmo motivo.

Ordem na subida: o `@Scheduled` do motor é registrado no `ContextRefreshedEvent`, antes de qualquer
`ApplicationRunner`. O motor poderia, portanto, pingar um equipamento que deveria estar numa janela
atrasada antes de o reconciliador ativá-la. Abrir incidente exige N falhas consecutivas depois da
âncora, mas a janela de SLA do monitor sobreviveu ao desligamento e as falhas de antes da parada
contam. Guarda: `MonitoringScheduler` pula ticks até o reconciliador concluir a primeira passada
(quando o reconciliador está ligado). Teste dedicado.

---

## 4. Convivência com o botão manual (crítico)

### 4.1 A regra (MA01)

Sua inclinação está certa e é a regra: **efetiva = manual OR janela ATIVA cobrindo**. O que muda em
relação à inclinação é *onde* ela mora: não num predicado espalhado pelas queries, mas materializada
em `em_manutencao` e protegida por CHECK.

| Caso | Manual | Janela | `em_manutencao` | Efeito |
|---|---|---|---|---|
| Janela ativa, botão desligado | F | T | T | Entrada ao ativar a janela |
| **Janela termina, botão ligado** | T | F | **T** | Nenhum. O CHECK proíbe `em_manutencao = false` com `manutencao_manual = true`; o reconciliador calcula desejado = T e não toca |
| **Botão desligado durante janela ativa** | F | T | **T** | Nenhum. O endpoint responde 200 com `emManutencao: true` e o motivo; a tela diz "Manutenção manual encerrada. {nome} continua em manutenção pela janela #41 até 14/08 12:00." |
| Botão ligado durante janela ativa | T | T | T | Nenhum efeito (já estava). Só grava o manual |
| Os dois terminam | F | F | F | Saída (reabre janela de SLA) |

### 4.2 Uma operação só: `reavaliar(equipamentoId)`

Os efeitos de entrada e de saída que hoje vivem em `entrarEmManutencao` / `sairDeManutencao` saem para
`aplicarEntrada(id, autor, agora)` e `aplicarSaida(id)`, intocados por dentro. Quem decide se aplica é
uma função só:

```
reavaliar(id):
  SELECT … FROM equipamento WHERE id = :id FOR UPDATE      -- mesmo lock de inserirSeElegivel e do M7
  desejado = manutencao_manual OR coberto(id)
  se desejado e não em_manutencao  → UPDATE em_manutencao = true;  aplicarEntrada(...)
  se não desejado e em_manutencao  → UPDATE em_manutencao = false; aplicarSaida(...)
```

Botão iniciar: `UPDATE … SET manutencao_manual = true, em_manutencao = true` (CAS em `manutencao_manual = false`) e,
se `em_manutencao` era falso, `aplicarEntrada`. Botão encerrar: `UPDATE … SET manutencao_manual = false`
(CAS) e `reavaliar`. Janela ativada/concluída/cancelada/encerrada: `reavaliar` em cada equipamento
coberto, em ordem de id.

Autor dos incidentes fechados pela entrada: o usuário do botão, ou o `criado_por_id` da janela
quando é o reconciliador quem ativa (MA10). `fechado_por` nulo continua significando "motor" (V17).

### 4.3 Consequência na interface do PR #17

O item do menu e o botão do drawer decidem hoje por `linha.emManutencao`. Com janela, isso mente:
um equipamento só em janela mostraria "Encerrar manutenção", e o clique não faria nada (CAS em
`manutencao_manual` devolve 0). O read-model ganha `manutencaoManual` e a referência da janela ativa
(`janelaAtivaId`, `janelaAtivaFim`); o item passa a decidir por `manutencaoManual`. Isso entra na F1,
não depois.

---

## 5. Escopo "unidade inteira"

### 5.1 Não depende de `unidade.ativo` (MA05)

A janela de unidade não desliga a unidade: ela põe **cada equipamento** em `em_manutencao`, e o motor
já para de pingá-los. Nada no motor muda.

`unidade.ativo` ignorado por `findActiveExecutionCandidates` é dívida independente
(`manutencao-interface-e-m7.md`): corrigi-la exige mudar juntos motor, os dois INSERTs condicionais, o
M7, `CicloJanelaMonitoramentoService.abrir` e o painel, porque a invariante "janela aberta ⇔
candidato" não pode ficar meio corrigida. Não deve entrar neste ciclo — misturaria duas mudanças de
semântica de elegibilidade num diff só. Ver P-08.

### 5.2 Equipamento criado durante a janela

**Entra** (MA05). Escopo `UNIDADE` é resolvido pelo predicado de cobertura a cada avaliação, não
congelado na ativação: "unidade inteira" quer dizer a unidade, não a lista de equipamentos daquele
minuto. O mesmo vale ao contrário: equipamento **movido para fora** da unidade sai da janela.

Mecanismo: `EquipamentoService.criar` e `atualizar` (quando `unidadeId` muda) chamam `reavaliar` no
fim da transação. Sem isso o tick de 30 s cobre, mas um monitor criado nesse intervalo abriria janela
de SLA e mediria. Com escopo `EQUIPAMENTOS`, a ligação é por id e não muda com a unidade: o
equipamento movido continua na janela (decisão explícita, testada).

Equipamento inativo dentro de janela de unidade: recebe `em_manutencao = true` igual, como já acontece
hoje com o botão (a entrada não valida `ativo`), e o painel mostra `DESABILITADO`, que tem precedência.

---

## 6. Efeitos

### 6.1 Reaproveitado sem mudança

Tudo o que a manutenção manual faz já é o que a janela precisa:

| Efeito | Na entrada | Na saída |
|---|---|---|
| Incidentes abertos | Fechados, `motivo_encerramento = MANUTENCAO` | — (novos só com falhas novas) |
| Episódios de latência | Encerrados, `MANUTENCAO` | — |
| Notificações | Pendente de abertura → `CANCELADA`; abertura já enviada → `INCIDENTE_ENCERRADO_MANUTENCAO` / `LATENCIA_ENCERRADA_MANUTENCAO` | — |
| `janela_monitoramento` | Fechada (SLA não conta) | Reaberta com predicado inteiro |
| Âncora de observação | — | Nova janela = nova âncora; cauda de antes da manutenção não abre nada |
| Motor, INSERTs, M7, painel | Leem `em_manutencao`: param sozinhos | Voltam sozinhos |

### 6.2 Novo

- A divisão `aplicarEntrada`/`aplicarSaida` + `reavaliar` (§4.2).
- Autor vindo da janela (MA10).
- Referência da janela no read-model do painel/lista (§4.3).
- Nada novo em incidente: não proponho `incidente.manutencao_id`. "Fechado por qual janela?" é
  derivável por tempo + escopo; só vale coluna se o relatório pedir (P-07).

### 6.3 Notificação da janela (MA11)

O mockup diz que avisa (nota do modal, `:1767`). Proposta: **sim, avisar o grupo no início e no fim,
uma mensagem por janela** ("Sesc Siqueira Campos em manutenção até 12:00 — Troca do switch core.
Alertas suspensos."). Sem isso, um silêncio planejado de 16 equipamentos no Telegram é indistinguível
de o sistema ter caído — a dívida de monitoramento parado torna isso pior, não melhor.

Mas fica fora da F1, porque custa schema: `notificacao` exige incidente ou episódio. Precisa de coluna
`manutencao_agendada_id`, de recriar `ck_notificacao_ancora_exclusiva` e `ck_notificacao_evento_coerente`
com `MANUTENCAO_INICIADA` / `MANUTENCAO_ENCERRADA`, de unicidade `(manutencao_agendada_id, tipo_evento)`
com `ON CONFLICT DO NOTHING` (padrão do repositório), e de ensinar dispatcher, `NotificacaoMessageBuilder`,
listagem e filtro de evento. É a F3.

Ruído a decidir junto (P-02): janela de unidade com 10 equipamentos fora gera hoje 10 avisos
`INCIDENTE_ENCERRADO_MANUTENCAO` *mais* o aviso da janela. E o botão manual também não avisa ninguém
hoje — a decisão deveria valer para os dois.

---

## 7. Concorrência

Padrão do projeto aplicado: guarda no banco, CAS pelo `WHERE`, lock da linha do equipamento como ponto
único de serialização, ordem de lock **janela → equipamento (por id) → incidente**, nunca o inverso.

| Corrida | Guarda | Desfecho legítimo |
|---|---|---|
| Reconciliador ativa × operador cancela a mesma janela | CAS `WHERE status='AGENDADA'` nos dois | Um ganha. Cancelou primeiro → ativação atualiza 0 linhas. Ativou primeiro → cancelar devolve 409 "janela já ativa, use Encerrar" |
| Encerrar agora × fim automático | CAS `WHERE status='ATIVA'` | Um ganha; `encerrada_por_id` diz qual |
| Botão encerrar × janela ativando no mesmo equipamento | Ambos passam por `reavaliar` sob `FOR UPDATE` | Quem pega o lock por último lê o estado comprometido do outro. Final = manual OR coberto, sempre |
| Duas janelas sobrepostas terminando juntas | Cada término chama `reavaliar`; ordem por id | O último lê as duas CONCLUIDA e sai; nunca sai com outra ainda ATIVA |
| Janela ativando × motor abrindo incidente | Já resolvido: `inserirSeElegivel` com `FOR UPDATE OF e` | Entrada primeiro → INSERT não acontece. INSERT primeiro → incidente fechado `MANUTENCAO` |
| Duas janelas de unidade ativando com conjuntos sobrepostos | `reavaliar` em ordem crescente de id | Sem deadlock |

Por que funciona mesmo quando um caminho perde a corrida: toda mudança de status de janela é seguida
de `reavaliar` dos equipamentos cobertos, e o tick reavalia toda divergência. Um erro de interleaving
pode atrasar a convergência em até 30 s; não pode deixá-la errada.

**Sobreposição é permitida** (MA04). Janela de unidade (quadro elétrico) e janela de equipamento
(firmware) na mesma noite é caso real, e com efetiva = OR a sobreposição é inofensiva. A tela avisa,
não bloqueia.

Testes obrigatórios (Postgres real, `@RequerDocker`, duas threads e `CyclicBarrier`, um por linha da
tabela acima), mais: CHECK `ck_equipamento_manutencao_manual_efetiva` recusando escrita direta; prova
de reversão (sem a guarda, o teste fica vermelho, saída registrada).

---

## 8. Tela

### 8.1 Navegação

Rota `/manutencoes`, item **"Manutenções"** na seção **Gerenciamento**, logo depois de "Monitoramento".
O mockup a põe na Administração, mas no app Administração é só Usuários (ADMIN) e a manutenção é ato
do OPERADOR — o mesmo papel que já usa o botão manual. `h1` "Janelas de manutenção".

Permissões: GET para os três papéis; POST/PATCH para ADMIN e OPERADOR. Exige acrescentar
`/api/v1/manutencoes/**` às listas de `SecurityConfiguration`; sem isso cai em ADMIN-only em silêncio.

### 8.2 Layout (geração A)

`.pagina` (padding 22px, max-width 1500), `h1` 20/700, sem sobretítulo; subtítulo
"Intervenções planejadas. Equipamentos em janela ativa não são verificados e o período não conta no
relatório de disponibilidade." (fiel ao código, sem a promessa de SLA do cancelamento).

Colunas da `.tabela`: `#`, Unidade, Escopo ("Unidade inteira" ou "3 equipamentos", com os nomes no
`title`/expansão), Início, Fim, Motivo, Criado por, Situação (`StatusBadgeComponent`), Ações.
Se ativou/encerrou com atraso, a célula de Início/Fim mostra o real abaixo do previsto.

Badges novos no componente compartilhado (não locais): AGENDADA (neutro), ATIVA (info, mesmo tom de
`EM_MANUTENCAO`), CONCLUIDA (neutro apagado), CANCELADA (neutro), EXPIRADA (alerta).

Ações por estado: AGENDADA → "Cancelar"; ATIVA → "Encerrar agora"; demais → nada. Ambas via
`ConfirmDialog` com `confirmTone="primario"`, como no botão manual: nada é destruído nem apagado.
Texto de "Encerrar agora" diz que os equipamentos voltam a ser verificados na próxima varredura e que
os que estiverem também em manutenção manual continuam fora.

Agendar: `app-modal` com Unidade, Escopo (Unidade inteira / Equipamentos selecionados → lista de
checagem dos equipamentos ativos daquela unidade), Início, Fim (`datetime-local`), Motivo. Aviso não
bloqueante de sobreposição.

### 8.3 Paginação

O "1, 2" com 4 linhas some porque não há paginação inventada: lista paginada no servidor (tamanho 20),
`app-paginacao` com `totalPaginas` do `Page`, que já renderiza "Página X de Y". Com 4 registros: uma
página. Filtro padrão **Vigentes** (AGENDADA + ATIVA, ordem: ATIVA primeiro, depois por início
crescente); alternância **Histórico** (demais, início decrescente). Busca por unidade e motivo.

### 8.4 Conversa com Equipamentos

- **F1 (obrigatório):** item manual decide por `manutencaoManual` (§4.3). Drawer, em "Estado atual",
  diz a origem: "Manual" / "Janela #41 até 14/08 12:00" (link para `/manutencoes`) / ambas.
- **F2:** "Agendar manutenção" no menu da linha e no drawer (modal com unidade e equipamento
  pré-preenchidos); na unidade, botão "Agendar manutenção" e o banner de janela ativa do mockup.

---

## 9. Fatiamento

| Fatia | Conteúdo | Serve à operação? |
|---|---|---|
| **F0** | Botão manual na interface | **Já entregue** (PR #17) |
| **F1 — agendar e confiar** | Migration (§2.1–2.2); `reavaliar` + split de efeitos; reconciliador com subida, atraso e EXPIRADA; guarda de subida no motor; escopos UNIDADE e EQUIPAMENTOS; hooks em `criar`/`atualizar`; API criar/listar/cancelar/encerrar; 409 com reconciliador desligado; segurança; read-model `manutencaoManual` + janela ativa; tela `/manutencoes` (lista, modal, cancelar, encerrar); ajuste do botão manual; testes concorrentes | **Sim.** Agenda-se a troca do switch e ninguém é acordado pelo alarme |
| **F2 — integração** | Agendar a partir de Equipamentos e da Unidade; banner da unidade; editar AGENDADA; prorrogar ATIVA | Conforto. Na F1, prorrogar = criar nova janela começando agora (sobreposição permitida, sem buraco) |
| **F3 — Telegram** | Âncora nova em `notificacao`, eventos de início/fim, decisão de ruído (P-02) | Comunicação ao grupo |
| **F4 — relatório** | "Manutenção declarada (min)" por unidade no relatório e no PDF | Prestação de contas |

O que **não** entra em nenhuma: corrigir `unidade.ativo` (P-08), detectar monitoramento parado
(dívida própria), histórico do botão manual (P-03).

---

## 10. O item separado: botão manual na interface

**Já está entregue.** `startMaintenance`/`endMaintenance` têm chamador desde `d674fed` (menu da linha
e drawer, `ConfirmDialog` com tom primário, `27ad409` para não perder o foco), mergeado em `main` pelo
PR #17 (`2176cd1`). A informação de "sem chamador" vem do design de 2026-10-22, escrito antes da
implementação.

O desenho acima não o absorve nem o substitui: ele continua sendo o "agora". Mas a F1 **precisa**
mudar o critério dele de `emManutencao` para `manutencaoManual` (§4.3) — senão, com janelas, o botão
passa a oferecer uma ação que não faz nada.
