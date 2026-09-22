# Manutenção de equipamento — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer `equipamento.em_manutencao` ter efeito real: para de pingar, sai do SLA, encerra incidente e episódio com motivo próprio, e notifica o grupo com honestidade — sem nunca dizer "recuperado" sobre algo que ninguém resolveu.

**Architecture:** Uma migration (`V19`) cria `motivo_encerramento` em `incidente` e `monitor_episodio_latencia` e amplia os enums de `notificacao`. A entrada em manutenção vira uma transação única com CAS em cada escrita. A abertura de incidente e de episódio vira `INSERT … SELECT … WHERE` condicional, e a `janela_monitoramento` passa a ser a âncora de "desde quando conta".

**Tech Stack:** Java 21, Spring Boot 4.1.0, Flyway, PostgreSQL 16, Testcontainers, Angular, Playwright.

**Spec:** `Docs/superpowers/specs/2026-09-22-manutencao-e-fechamento-icmp-design.md` (Parte B)
**Proposta de origem:** `Docs/validacao-producao/manutencao-proposta.md` — o spec **prevalece** onde divergir.

## Global Constraints

- Banco de dev (porta **5434**) **intocado**: nenhuma migration, nenhuma escrita. Cópia dele só por restauração num Postgres descartável.
- Motor de monitoramento **nunca** liga contra o banco de dev.
- Telegram real **nunca** é acionado: só mock HTTP local, com `TELEGRAM_API_BASE_URL` apontado para ele.
- Branch **novo** a partir de `fix/icmp-nativo-windows`. **Sem merge.**
- **Sem Lombok.** `ddl-auto: validate` — Hibernate nunca cria schema; **nunca editar migration já executada**.
- Datas: `Instant`, UTC. Erros da API no formato `ErroResposta`.
- Prefixo REST `/api/v1`. Principal autenticado é **`UsuarioPrincipal`**, nunca `Usuario`.
- Senhas e segredos **só** por variável de ambiente, fora do repositório.
- `Docs/validacao-producao/` é atualizado **no mesmo commit** da mudança que ele descreve.
- Commits terminam com `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Valores canônicos, usados em todo o plano:
  - `MotivoEncerramentoIncidente`: `RECUPERACAO_AUTOMATICA`, `FECHAMENTO_MANUAL`, `MANUTENCAO`
  - `MotivoEncerramentoEpisodio`: `NORMALIZACAO`, `INCIDENTE`, `MANUTENCAO`
  - `StatusNotificacao`: `+ CANCELADA`
  - `TipoEventoNotificacao`: `+ INCIDENTE_ENCERRADO_MANUTENCAO` (âncora incidente), `+ LATENCIA_ENCERRADA_MANUTENCAO` (âncora episódio)
  - Texto do aviso: **"Incidente encerrado: equipamento entrou em manutenção"**

---

### Task 0: Branch novo

- [ ] **Step 1: Criar o branch**

```bash
git checkout fix/icmp-nativo-windows
git status --short   # arvore limpa antes de comecar
git checkout -b feat/manutencao-equipamento
```

- [ ] **Step 2: Confirmar**

Run: `git rev-parse --abbrev-ref HEAD`
Expected: `feat/manutencao-equipamento`

---

### Task 1: Diagnóstico do backfill contra uma CÓPIA do banco de dev

**Files:**
- Create: `Docs/validacao-producao/manutencao-backfill-diagnostico.md`

**Interfaces:**
- Consumes: banco de dev (**somente leitura**, via `pg_dump`).
- Produces: contagens por faixa, que a Task 2 cita na V19.

- [ ] **Step 1: Dump do banco de dev — leitura, nunca escrita**

```bash
PGPASSWORD="$DB_PASSWORD_DEV" pg_dump -h localhost -p 5434 -U inframonitor \
  -d inframonitor -Fc -f /tmp/dev-copia.dump
ls -la /tmp/dev-copia.dump
```

`pg_dump` só lê. **Nenhum** comando deste plano escreve na 5434.

- [ ] **Step 2: Subir um Postgres descartável e restaurar a cópia**

```bash
docker run -d --name infra-copia -e POSTGRES_PASSWORD="$PGPASS_DESCARTAVEL" \
  -e POSTGRES_USER=inframonitor -e POSTGRES_DB=inframonitor -p 5436:5432 postgres:16
sleep 5
PGPASSWORD="$PGPASS_DESCARTAVEL" pg_restore -h localhost -p 5436 -U inframonitor \
  -d inframonitor --no-owner /tmp/dev-copia.dump
```

- [ ] **Step 3: Rodar a consulta de diagnóstico na CÓPIA (porta 5436)**

```sql
-- Faixa 1: classificavel como FECHAMENTO_MANUAL (alta certeza)
SELECT count(*) AS fechamento_manual
  FROM incidente WHERE status = 'FECHADO' AND fechado_por IS NOT NULL;

-- Faixa 2: classificavel como RECUPERACAO_AUTOMATICA (alta certeza)
SELECT count(*) AS recuperacao_automatica
  FROM incidente
 WHERE status = 'FECHADO' AND fechado_por IS NULL
   AND observacao LIKE 'Recuperacao detectada automaticamente apos %sucessos consecutivos.';

-- Faixa 3: ambigua, fica NULL
SELECT count(*) AS ambiguo
  FROM incidente
 WHERE status = 'FECHADO' AND fechado_por IS NULL
   AND (observacao IS NULL
        OR observacao NOT LIKE 'Recuperacao detectada automaticamente apos %sucessos consecutivos.');

-- Controle: totais por status, e episodios encerrados (todos ficarao NULL)
SELECT status, count(*) FROM incidente GROUP BY status ORDER BY status;
SELECT count(*) AS episodios_encerrados
  FROM monitor_episodio_latencia WHERE encerrado_em IS NOT NULL;
```

- [ ] **Step 4: Registrar as contagens e o estado de origem do banco de dev**

Guardar também as contagens de controle do banco de **dev** (leitura pura), para provar no fim que ele
não mudou:

```sql
-- rodar na 5434, SOMENTE SELECT
SELECT (SELECT count(*) FROM incidente)  AS incidentes,
       (SELECT count(*) FROM medicao)    AS medicoes,
       (SELECT count(*) FROM notificacao) AS notificacoes,
       (SELECT count(*) FROM equipamento) AS equipamentos,
       (SELECT count(*) FROM janela_monitoramento) AS janelas;
```

Escrever `Docs/validacao-producao/manutencao-backfill-diagnostico.md` com: as três faixas, os totais por
status, a contagem de episódios, a linha de controle do banco de dev, e a frase explícita de que a
consulta rodou numa **cópia restaurada na porta 5436**, nunca no banco de dev.

- [ ] **Step 5: Destruir a cópia**

```bash
docker rm -f infra-copia && rm -f /tmp/dev-copia.dump
docker ps -a --filter name=infra-copia   # vazio
```

- [ ] **Step 6: Commit**

```bash
git add Docs/validacao-producao/manutencao-backfill-diagnostico.md
git commit -m "$(cat <<'EOF'
docs(manutencao): contagens do backfill da V19 medidas numa copia do dev

A proposta deixou as faixas do backfill como NAO VERIFICADO. Agora tem
numero: rodado contra uma restauracao do dump do banco de dev num Postgres
descartavel na 5436, destruido em seguida. O banco de dev so foi lido.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Migration V19

**Files:**
- Create: `infra-monitor-backend/src/main/resources/db/migration/V19__add_motivo_encerramento_e_eventos_manutencao.sql`

**Interfaces:**
- Consumes: as contagens da Task 1.
- Produces: colunas `incidente.motivo_encerramento`, `monitor_episodio_latencia.motivo_encerramento`; `notificacao.tipo_evento` em `VARCHAR(40)`; CHECKs recriadas com `CANCELADA` e os dois tipos novos.

- [ ] **Step 1: Escrever a migration**

```sql
-- V19 - Motivo de encerramento e os eventos de notificacao da manutencao.
--
-- Fechar passa a ter tres caminhos, e nao os dois que a V17 registrou: o motor
-- (recuperacao), o operador (fechamento manual) e a entrada em manutencao. Sem
-- coluna propria, o terceiro seria lido como um dos dois primeiros, e o relatorio
-- diria "o monitor se recuperou" sobre um incidente que ninguem resolveu.
--
-- O status NAO muda: continua FECHADO. Nao ha valor novo em ck_incidente_status.

ALTER TABLE incidente ADD COLUMN motivo_encerramento VARCHAR(24);

ALTER TABLE incidente ADD CONSTRAINT ck_incidente_motivo_encerramento_valor CHECK (
    motivo_encerramento IS NULL OR motivo_encerramento IN (
        'RECUPERACAO_AUTOMATICA', 'FECHAMENTO_MANUAL', 'MANUTENCAO')
);

-- Irma de ck_incidente_fechamento_coerente (V17:21-23): so FECHADO carrega motivo
-- de encerramento. ABERTO e RECONHECIDO nao encerraram nada.
ALTER TABLE incidente ADD CONSTRAINT ck_incidente_motivo_encerramento_coerente CHECK (
    motivo_encerramento IS NULL OR status = 'FECHADO'
);

-- Backfill em duas passadas, da certeza para a duvida. O que sobrar fica NULL:
-- NULL aqui significa "fechado antes da V19, nao classificavel", e nao "faltou dado".
-- As contagens por faixa estao em Docs/validacao-producao/manutencao-backfill-diagnostico.md.
UPDATE incidente SET motivo_encerramento = 'FECHAMENTO_MANUAL'
 WHERE status = 'FECHADO' AND fechado_por IS NOT NULL;

UPDATE incidente SET motivo_encerramento = 'RECUPERACAO_AUTOMATICA'
 WHERE status = 'FECHADO' AND fechado_por IS NULL AND motivo_encerramento IS NULL
   AND observacao LIKE 'Recuperacao detectada automaticamente apos %sucessos consecutivos.';

-- Episodio de latencia: hoje dois encerramentos semanticamente diferentes gravam
-- exatamente as mesmas colunas (LatencyEpisodeProcessor: encerramento silencioso
-- por incidente x normalizacao real). Manutencao seria o terceiro.
ALTER TABLE monitor_episodio_latencia ADD COLUMN motivo_encerramento VARCHAR(24);

ALTER TABLE monitor_episodio_latencia
    ADD CONSTRAINT ck_monitor_episodio_latencia_motivo_valor CHECK (
        motivo_encerramento IS NULL OR motivo_encerramento IN (
            'NORMALIZACAO', 'INCIDENTE', 'MANUTENCAO')
);

ALTER TABLE monitor_episodio_latencia
    ADD CONSTRAINT ck_monitor_episodio_latencia_motivo_coerente CHECK (
        motivo_encerramento IS NULL OR encerrado_em IS NOT NULL
);
-- Sem backfill de proposito: nao sobra nem um sinal fraco para desempatar os dois
-- caminhos antigos, e gravar palpite em coluna que o relatorio le como fato e pior
-- que NULL honesto. A ambiguidade existe desde a V15, nao foi criada aqui.

-- INCIDENTE_ENCERRADO_MANUTENCAO tem exatamente 30 caracteres, o limite atual da
-- coluna (V9:6). Zero margem para o proximo evento: alarga agora.
ALTER TABLE notificacao ALTER COLUMN tipo_evento TYPE VARCHAR(40);

-- CHECK nao se estende: e preciso recriar. Mesmo idioma de V15:48-52 e V16:17-20.
ALTER TABLE notificacao DROP CONSTRAINT ck_notificacao_status;
ALTER TABLE notificacao ADD CONSTRAINT ck_notificacao_status CHECK (
    status IN ('PENDENTE', 'ENVIANDO', 'ENVIADA', 'FALHA', 'CANCELADA')
);

ALTER TABLE notificacao DROP CONSTRAINT ck_notificacao_tipo_evento;
ALTER TABLE notificacao ADD CONSTRAINT ck_notificacao_tipo_evento CHECK (
    tipo_evento IN ('INCIDENTE_ABERTO', 'INCIDENTE_FECHADO',
                    'LATENCIA_ALTA', 'LATENCIA_NORMALIZADA',
                    'INCIDENTE_ENCERRADO_MANUTENCAO', 'LATENCIA_ENCERRADA_MANUTENCAO')
);

-- Dois tipos novos e nao um so: ck_notificacao_evento_coerente amarra tipo a ancora,
-- e um tipo servindo incidente E episodio afrouxaria a constraint nas duas direcoes.
ALTER TABLE notificacao DROP CONSTRAINT ck_notificacao_evento_coerente;
ALTER TABLE notificacao ADD CONSTRAINT ck_notificacao_evento_coerente CHECK (
    (tipo_evento IN ('INCIDENTE_ABERTO', 'INCIDENTE_FECHADO', 'INCIDENTE_ENCERRADO_MANUTENCAO')
     AND incidente_id IS NOT NULL)
    OR (tipo_evento IN ('LATENCIA_ALTA', 'LATENCIA_NORMALIZADA', 'LATENCIA_ENCERRADA_MANUTENCAO')
        AND episodio_latencia_id IS NOT NULL)
);
```

- [ ] **Step 2: Rodar a migration do zero num Postgres descartável**

```bash
docker run -d --name infra-v19 -e POSTGRES_PASSWORD="$PGPASS_DESCARTAVEL" \
  -e POSTGRES_USER=inframonitor -e POSTGRES_DB=inframonitor -p 5437:5432 postgres:16
sleep 5
cd infra-monitor-backend
DB_PORT=5437 DB_PASSWORD="$PGPASS_DESCARTAVEL" JWT_SECRET="$JWT_SECRET_DESCARTAVEL" \
  ./mvnw spring-boot:run
```

Expected: sobe. `ddl-auto: validate` ainda não reclama porque as entidades não têm os campos novos —
elas entram na Task 3. Conferir no banco:

```sql
\d incidente
\d monitor_episodio_latencia
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
 WHERE conrelid = 'notificacao'::regclass AND conname LIKE 'ck_notificacao_%';
```

- [ ] **Step 3: Provar que a CHECK recusa valor inválido**

```sql
-- deve falhar
UPDATE incidente SET motivo_encerramento = 'INDETERMINADO' WHERE id = (SELECT min(id) FROM incidente);
-- deve falhar: motivo em incidente que nao esta FECHADO
INSERT INTO notificacao (incidente_id, canal, tipo_evento, status, tentativas, mensagem, created_at, updated_at)
VALUES (1, 'TELEGRAM', 'LATENCIA_ENCERRADA_MANUTENCAO', 'PENDENTE', 0, 'x', now(), now());
```

Expected: as duas recusadas pelo banco. Guardar a saída.

- [ ] **Step 4: Derrubar o descartável e commitar**

```bash
docker rm -f infra-v19
git add infra-monitor-backend/src/main/resources/db/migration/V19__add_motivo_encerramento_e_eventos_manutencao.sql
git commit -m "$(cat <<'EOF'
feat(db): V19 - motivo de encerramento e os eventos da manutencao

Fechar passa a ter tres caminhos e nao dois. Sem coluna propria, o terceiro
seria lido como recuperacao automatica e o relatorio diria que o monitor se
recuperou sozinho.

Dois tipos novos de notificacao, um por ancora, porque
ck_notificacao_evento_coerente amarra tipo a ancora. tipo_evento sobe para
VARCHAR(40): INCIDENTE_ENCERRADO_MANUTENCAO ocupava exatamente os 30 do
limite anterior.

Legado ambiguo fica NULL; episodio sem backfill, de proposito.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Enums e entidades

**Files:**
- Create: `infra-monitor-backend/src/main/java/br/com/inframonitor/incidente/entity/MotivoEncerramentoIncidente.java`
- Create: `infra-monitor-backend/src/main/java/br/com/inframonitor/monitoring/latency/MotivoEncerramentoEpisodio.java`
- Modify: `infra-monitor-backend/src/main/java/br/com/inframonitor/incidente/entity/Incidente.java:97-100,127`
- Modify: `infra-monitor-backend/src/main/java/br/com/inframonitor/monitoring/latency/MonitorEpisodioLatencia.java:61-63`
- Modify: `infra-monitor-backend/src/main/java/br/com/inframonitor/notificacao/entity/StatusNotificacao.java`
- Modify: `infra-monitor-backend/src/main/java/br/com/inframonitor/notificacao/entity/TipoEventoNotificacao.java`
- Test: `infra-monitor-backend/src/test/java/br/com/inframonitor/incidente/entity/IncidenteTest.java`

**Interfaces:**
- Produces:
  - `enum MotivoEncerramentoIncidente { RECUPERACAO_AUTOMATICA, FECHAMENTO_MANUAL, MANUTENCAO }`
  - `enum MotivoEncerramentoEpisodio { NORMALIZACAO, INCIDENTE, MANUTENCAO }`
  - `Incidente.fechar(Instant encerradoEm, String observacao, Usuario fechadoPor, MotivoEncerramentoIncidente motivoEncerramento)` — **a assinatura de 3 argumentos deixa de existir**; todos os chamadores passam o motivo.
  - `Incidente.getMotivoEncerramento()`
  - `MonitorEpisodioLatencia.encerrar(Instant encerradoEm, MotivoEncerramentoEpisodio motivoEncerramento)` — idem.
  - `MonitorEpisodioLatencia.getMotivoEncerramento()`
  - `StatusNotificacao.CANCELADA`, `TipoEventoNotificacao.INCIDENTE_ENCERRADO_MANUTENCAO`, `TipoEventoNotificacao.LATENCIA_ENCERRADA_MANUTENCAO`

- [ ] **Step 1: Escrever o teste que falha**

```java
@Test
void fecharExigeMotivoDeEncerramentoEOGrava() {
    Incidente incidente = new Incidente(monitor, Instant.parse("2026-09-22T10:00:00Z"), "motivo de abertura", null);

    incidente.fechar(Instant.parse("2026-09-22T10:30:00Z"), null, null,
            MotivoEncerramentoIncidente.MANUTENCAO);

    assertThat(incidente.getStatus()).isEqualTo(StatusIncidente.FECHADO);
    assertThat(incidente.getMotivoEncerramento()).isEqualTo(MotivoEncerramentoIncidente.MANUTENCAO);
    // O motivo de ABERTURA nao e sobrescrito: sao perguntas diferentes.
    assertThat(incidente.getMotivo()).isEqualTo("motivo de abertura");
}
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `cd infra-monitor-backend && ./mvnw test -Dtest=IncidenteTest`
Expected: FAIL — não compila: `fechar` tem 3 parâmetros e `MotivoEncerramentoIncidente` não existe.

- [ ] **Step 3: Criar os enums**

```java
package br.com.inframonitor.incidente.entity;

/**
 * Como o incidente foi encerrado. Distinto de {@code motivo}, que e' por que ele
 * abriu: sobrescrever aquele apagaria a razao da abertura.
 *
 * <p>NULL na coluna significa "fechado antes da V19, nao classificavel", e nao
 * "faltou dado". Ver Docs/validacao-producao/manutencao-backfill-diagnostico.md.
 */
public enum MotivoEncerramentoIncidente {
    RECUPERACAO_AUTOMATICA,
    FECHAMENTO_MANUAL,
    MANUTENCAO
}
```

```java
package br.com.inframonitor.monitoring.latency;

/**
 * Como o episodio foi encerrado. INCIDENTE e' o encerramento silencioso que ja'
 * existia desde a V15 — nao normalizou, piorou — e que a linha nao distinguia de
 * NORMALIZACAO. Legado fica NULL.
 */
public enum MotivoEncerramentoEpisodio {
    NORMALIZACAO,
    INCIDENTE,
    MANUTENCAO
}
```

- [ ] **Step 4: Alterar as entidades**

Em `Incidente.java`, acrescentar o campo e mudar `fechar`:

```java
    @Enumerated(EnumType.STRING)
    @Column(name = "motivo_encerramento", length = 24)
    private MotivoEncerramentoIncidente motivoEncerramento;
```

```java
    /**
     * {@code fechadoPor} nulo e o fechamento do motor; preenchido, o do operador ou
     * o da entrada em manutencao. Com tres caminhos de fechamento a ausencia de autor
     * deixou de ser informativa sozinha: dai {@code motivoEncerramento} obrigatorio
     * na assinatura, e nao opcional.
     */
    public void fechar(Instant encerradoEm, String observacao, Usuario fechadoPor,
                       MotivoEncerramentoIncidente motivoEncerramento) {
        // ... corpo atual preservado ...
        this.fechadoPor = fechadoPor;
        this.motivoEncerramento = motivoEncerramento;
    }

    public MotivoEncerramentoIncidente getMotivoEncerramento() { return motivoEncerramento; }
```

Em `MonitorEpisodioLatencia.java`, o mesmo padrão com `MotivoEncerramentoEpisodio` e
`encerrar(Instant, MotivoEncerramentoEpisodio)`.

Em `StatusNotificacao.java`:

```java
public enum StatusNotificacao {
    PENDENTE,
    ENVIANDO,
    ENVIADA,
    FALHA,
    /**
     * A notificacao nunca saiu porque o evento deixou de valer antes do envio —
     * hoje, so' a entrada em manutencao. So' PENDENTE pode virar CANCELADA:
     * marcar ENVIANDO ou ENVIADA seria mentira num campo auditado.
     */
    CANCELADA
}
```

Em `TipoEventoNotificacao.java`:

```java
public enum TipoEventoNotificacao {
    INCIDENTE_ABERTO,
    INCIDENTE_FECHADO,
    LATENCIA_ALTA,
    LATENCIA_NORMALIZADA,
    /** Encerramento por manutencao. NUNCA usar INCIDENTE_FECHADO: ninguem resolveu nada. */
    INCIDENTE_ENCERRADO_MANUTENCAO,
    LATENCIA_ENCERRADA_MANUTENCAO
}
```

- [ ] **Step 5: Corrigir os chamadores quebrados**

Run: `cd infra-monitor-backend && ./mvnw -q compile 2>&1 | grep -E "ERROR|\.java:"`

Cada erro é um chamador de `fechar`/`encerrar` que precisa declarar o motivo. Os esperados:

| chamador | motivo |
|---|---|
| `IncidenteService.fecharAutomaticamente:92-93` | `RECUPERACAO_AUTOMATICA` |
| `IncidenteService.fechar:141` | `FECHAMENTO_MANUAL` |
| `LatencyEpisodeProcessor:74-77` (silencioso, com incidente aberto) | `INCIDENTE` |
| `LatencyEpisodeProcessor:115-117` (normalização real) | `NORMALIZACAO` |

Se aparecer um chamador fora desta lista, **parar e relatar**: é um caminho de fechamento que o
levantamento não conhecia.

- [ ] **Step 6: Rodar os testes**

Run: `cd infra-monitor-backend && ./mvnw test`
Expected: PASS. `ddl-auto: validate` agora exige a `V19` — os testes com Testcontainers rodam a
migration sozinhos.

- [ ] **Step 7: Commit**

```bash
git add -A infra-monitor-backend/src
git commit -m "$(cat <<'EOF'
feat(incidente,latencia): motivo de encerramento obrigatorio na assinatura

fechar e encerrar passam a exigir o motivo. Obrigatorio e nao opcional de
proposito: com tres caminhos de fechamento, esquecer o motivo em um deles
faria o relatorio ler recuperacao automatica onde ninguem resolveu nada.

CANCELADA e os dois tipos de evento da manutencao entram nos enums.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Auditoria dos enums novos

**Files:**
- Create: `Docs/validacao-producao/manutencao-auditoria-enums.md`

**Interfaces:**
- Consumes: os enums da Task 3.
- Produces: classificação de **todo** ponto de uso — **entra**, **fica de fora**, **tratamento próprio** — que as tasks 5 a 14 seguem.

- [ ] **Step 1: Levantar TODO ponto de uso, por comando**

```bash
cd infra-monitor-backend/src
grep -rn "StatusNotificacao\|'PENDENTE'\|'ENVIANDO'\|'ENVIADA'\|'FALHA'\|status *= *'FALHA'" main | sort
grep -rn "TipoEventoNotificacao\|INCIDENTE_ABERTO\|INCIDENTE_FECHADO\|LATENCIA_ALTA\|LATENCIA_NORMALIZADA" main | sort
cd ../../../infra-monitor-frontend/src
grep -rn "NotificationStatus\|NotificationEventType\|PENDENTE\|ENVIADA\|ENVIANDO" app | sort
```

- [ ] **Step 2: Classificar cada linha**

Escrever `Docs/validacao-producao/manutencao-auditoria-enums.md` com uma tabela
`arquivo:linha | o que faz | classificação | justificativa`. Regras:

- **fica de fora** só quando o comportamento continua **correto** sem conhecer o valor novo. Justificar,
  não afirmar.
- **entra** quando o ponto enumera valores para o usuário (filtro, rótulo, badge, legenda).
- **tratamento próprio** quando o valor novo muda a lógica, não só a lista.

Pontos que a tabela **tem de** conter (a lista final sai do grep, não daqui):

| ponto | classificação esperada | por quê |
|---|---|---|
| `NotificationDispatcher:49` `findIdsReadyForDispatch(..., PENDENTE, ...)` | **fica de fora** | filtra `PENDENTE`; `CANCELADA` nunca é pego — é exatamente o que torna o valor novo seguro |
| `NotificacaoRepository:78-81` `reserveForDispatch` | **fica de fora** | CAS contra `PENDENTE`; cancelamento e reserva disputam a mesma linha e o Postgres serializa |
| `NotificacaoRepository:83-86` `releaseStaleSending` | **fica de fora** | só mexe em `ENVIANDO` |
| `VisaoGeralPdfRepository:26-27` KPI "notificações com falha" | **fica de fora** | conta `FALHA`; é o argumento decisivo contra marcar `FALHA` no cancelamento |
| `NotificacaoService.listar` + `NotificacaoController` | **entra** | filtro por status e tipo exposto na API |
| `NotificacaoMessageBuilder:18-61` | **tratamento próprio** | ramo novo por tipo; nunca reusar o texto de `INCIDENTE_FECHADO` |
| `Notificacao.java:92-139` (transições) | **tratamento próprio** | precisa de `cancelar()`; `CANCELADA` é terminal |
| `frontend core/models/api-enums.ts` | **entra** | `NotificationStatus` e `NotificationEventType` |
| `frontend shared/status-badge/status-badge.component.ts` | **entra** | `LABELS`/`TONES` são `Record<DisplayStatus, string>`: o TypeScript **quebra o build** até o valor novo ganhar rótulo e tom. Proibido badge local. |
| `frontend features/notificacoes/notificacao-list.component.html` | **entra** | filtros do histórico |
| `frontend features/incidentes/incidente-unificado-list` | **entra** | renderiza status de notificação |
| exportações e relatórios de notificação | classificar um a um | |

- [ ] **Step 3: Commit**

```bash
git add Docs/validacao-producao/manutencao-auditoria-enums.md
git commit -m "$(cat <<'EOF'
docs(manutencao): auditoria dos pontos que leem os enums novos

Cada ponto classificado como entra, fica de fora ou exige tratamento
proprio, com justificativa. Fica de fora so quando o comportamento
continua correto sem conhecer o valor novo - e por isso que CANCELADA
tem raio de alcance pequeno.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Cancelamento e aviso de encerramento nas notificações

**Files:**
- Modify: `infra-monitor-backend/src/main/java/br/com/inframonitor/notificacao/repository/NotificacaoRepository.java`
- Modify: `infra-monitor-backend/src/main/java/br/com/inframonitor/notificacao/entity/Notificacao.java`
- Modify: `infra-monitor-backend/src/main/java/br/com/inframonitor/notificacao/service/NotificacaoService.java`
- Modify: `infra-monitor-backend/src/main/java/br/com/inframonitor/notificacao/service/NotificacaoMessageBuilder.java`
- Test: `infra-monitor-backend/src/test/java/br/com/inframonitor/notificacao/service/NotificacaoManutencaoTest.java`

**Interfaces:**
- Produces:
  - `int NotificacaoRepository.cancelarPendentesDoIncidente(Long incidenteId, Instant agora)`
  - `int NotificacaoRepository.cancelarPendentesDoEpisodio(Long episodioId, Instant agora)`
  - `boolean NotificacaoRepository.existeAberturaJaDespachada(Long incidenteId)` / `...DoEpisodio(Long episodioId)`
  - `void NotificacaoService.tratarEncerramentoPorManutencao(Incidente incidente)`
  - `void NotificacaoService.tratarEncerramentoPorManutencao(MonitorEpisodioLatencia episodio)`

- [ ] **Step 1: Escrever os testes dos quatro casos**

```java
@Test
void aberturaPendenteECanceladaESemAvisoDeEncerramento() {
    // abertura PENDENTE
    notificacaoService.tratarEncerramentoPorManutencao(incidente);

    assertThat(statusDa(TipoEventoNotificacao.INCIDENTE_ABERTO)).isEqualTo(StatusNotificacao.CANCELADA);
    assertThat(existe(TipoEventoNotificacao.INCIDENTE_ENCERRADO_MANUTENCAO)).isFalse();
}

@Test
void aberturaEnviadaGeraAvisoDeEncerramentoComTextoProprio() {
    // abertura ENVIADA
    notificacaoService.tratarEncerramentoPorManutencao(incidente);

    assertThat(statusDa(TipoEventoNotificacao.INCIDENTE_ABERTO)).isEqualTo(StatusNotificacao.ENVIADA);
    Notificacao aviso = buscar(TipoEventoNotificacao.INCIDENTE_ENCERRADO_MANUTENCAO);
    assertThat(aviso.getMensagem()).contains("Incidente encerrado: equipamento entrou em manutenção");
    // Nunca o texto nem o tipo de "resolvido".
    assertThat(aviso.getMensagem()).doesNotContainIgnoringCase("recuperacao");
    assertThat(aviso.getMensagem()).doesNotContainIgnoringCase("resolvido");
    assertThat(existe(TipoEventoNotificacao.INCIDENTE_FECHADO)).isFalse();
}

@Test
void aberturaEnviandoNaoECanceladaEGeraAviso() {
    // abertura ENVIANDO: a chamada ao Telegram pode estar em voo. Tratamos como
    // "vai sair", entao o grupo precisa do encerramento. Marcar CANCELADA em cima
    // de algo possivelmente enviado seria mentira num campo auditado.
    notificacaoService.tratarEncerramentoPorManutencao(incidente);

    assertThat(statusDa(TipoEventoNotificacao.INCIDENTE_ABERTO)).isEqualTo(StatusNotificacao.ENVIANDO);
    assertThat(existe(TipoEventoNotificacao.INCIDENTE_ENCERRADO_MANUTENCAO)).isTrue();
}

@Test
void episodioSegueAMesmaMatriz() {
    // LATENCIA_ALTA ENVIADA -> LATENCIA_ENCERRADA_MANUTENCAO criada
    // LATENCIA_ALTA PENDENTE -> CANCELADA, nenhum aviso
}

@Test
void aberturaEmFalhaNaoGeraAviso() {
    // FALHA: a mensagem nao chegou ao grupo; um encerramento sozinho seria ruido.
    notificacaoService.tratarEncerramentoPorManutencao(incidente);
    assertThat(existe(TipoEventoNotificacao.INCIDENTE_ENCERRADO_MANUTENCAO)).isFalse();
}
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `cd infra-monitor-backend && ./mvnw test -Dtest=NotificacaoManutencaoTest`
Expected: FAIL — `tratarEncerramentoPorManutencao` não existe.

- [ ] **Step 3: Implementar o repositório**

```java
    /**
     * CAS contra PENDENTE, mesmo idioma de reserveForDispatch. As duas instrucoes
     * disputam a mesma linha e o Postgres serializa:
     * - cancelamento primeiro: reserveForDispatch encontra CANCELADA, atualiza 0, o
     *   dispatcher desiste;
     * - reserva primeiro: a linha ja e ENVIANDO, o cancelamento atualiza 0 e a
     *   mensagem sai. Aceito e deliberado.
     *
     * <p>Escopo por incidente e nao por tipo de evento: na pratica so existe um
     * INCIDENTE_ABERTO pendente, mas amarrar a regra a uma enumeracao que a V15 ja
     * mostrou que cresce e' criar um bug futuro.
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("update Notificacao n set n.status = br.com.inframonitor.notificacao.entity.StatusNotificacao.CANCELADA, "
            + "n.updatedAt = :agora where n.incidente.id = :incidenteId "
            + "and n.status = br.com.inframonitor.notificacao.entity.StatusNotificacao.PENDENTE")
    int cancelarPendentesDoIncidente(@Param("incidenteId") Long incidenteId, @Param("agora") Instant agora);

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("update Notificacao n set n.status = br.com.inframonitor.notificacao.entity.StatusNotificacao.CANCELADA, "
            + "n.updatedAt = :agora where n.episodioLatencia.id = :episodioId "
            + "and n.status = br.com.inframonitor.notificacao.entity.StatusNotificacao.PENDENTE")
    int cancelarPendentesDoEpisodio(@Param("episodioId") Long episodioId, @Param("agora") Instant agora);

    /** ENVIANDO ou ENVIADA: a mensagem saiu, ou esta saindo. So nesses casos o grupo
     *  precisa do aviso de encerramento. */
    @Query("select count(n) > 0 from Notificacao n where n.incidente.id = :incidenteId "
            + "and n.tipoEvento = br.com.inframonitor.notificacao.entity.TipoEventoNotificacao.INCIDENTE_ABERTO "
            + "and n.status in (br.com.inframonitor.notificacao.entity.StatusNotificacao.ENVIANDO, "
            + "br.com.inframonitor.notificacao.entity.StatusNotificacao.ENVIADA)")
    boolean existeAberturaJaDespachada(@Param("incidenteId") Long incidenteId);

    @Query("select count(n) > 0 from Notificacao n where n.episodioLatencia.id = :episodioId "
            + "and n.tipoEvento = br.com.inframonitor.notificacao.entity.TipoEventoNotificacao.LATENCIA_ALTA "
            + "and n.status in (br.com.inframonitor.notificacao.entity.StatusNotificacao.ENVIANDO, "
            + "br.com.inframonitor.notificacao.entity.StatusNotificacao.ENVIADA)")
    boolean existeAberturaJaDespachadaDoEpisodio(@Param("episodioId") Long episodioId);
```

**Ordem obrigatória no service: primeiro perguntar `existeAberturaJaDespachada`, depois cancelar.**
O cancelamento só toca `PENDENTE`, mas a leitura antes evita depender da ordem de flush.

- [ ] **Step 4: Implementar o serviço**

```java
    /**
     * Matriz por estado da notificacao de ABERTURA, nao por tipo de evento:
     * PENDENTE  -> cancela, nenhum aviso (a mensagem nunca saiu)
     * ENVIANDO  -> intocada, cria aviso (tratamos como "vai sair")
     * ENVIADA   -> intocada, cria aviso
     * FALHA     -> intocada, nenhum aviso (nao chegou ao grupo)
     * inexistente -> nada
     */
    @Transactional
    public void tratarEncerramentoPorManutencao(Incidente incidente) {
        boolean despachada = notificacaoRepository.existeAberturaJaDespachada(incidente.getId());
        notificacaoRepository.cancelarPendentesDoIncidente(incidente.getId(), Instant.now());
        if (despachada) {
            criarPendente(incidente, TipoEventoNotificacao.INCIDENTE_ENCERRADO_MANUTENCAO);
        }
    }

    @Transactional
    public void tratarEncerramentoPorManutencao(MonitorEpisodioLatencia episodio) {
        boolean despachada = notificacaoRepository.existeAberturaJaDespachadaDoEpisodio(episodio.getId());
        notificacaoRepository.cancelarPendentesDoEpisodio(episodio.getId(), Instant.now());
        if (despachada) {
            criarPendente(episodio, TipoEventoNotificacao.LATENCIA_ENCERRADA_MANUTENCAO);
        }
    }
```

Em `NotificacaoMessageBuilder`, ramo novo — **nunca** reusar o texto de `INCIDENTE_FECHADO`:

```java
        if (tipoEvento == TipoEventoNotificacao.INCIDENTE_ENCERRADO_MANUTENCAO) {
            // NUNCA o texto de "resolvido": ninguem resolveu nada, o equipamento
            // saiu do radar por decisao operacional.
            cabecalho = "🔧 Incidente encerrado: equipamento entrou em manutenção";
        }
```

e o equivalente para `LATENCIA_ENCERRADA_MANUTENCAO`. Conferir o comprimento máximo da mensagem contra
o limite já medido em `medicao.mensagem` / `notificacao.mensagem` — `mensagem` é `TEXT`, sem limite, mas
manter o estilo das mensagens vizinhas.

Em `Notificacao.java`, um mutador explícito, para que `CANCELADA` não seja escrito por setter solto:

```java
    /** CANCELADA e terminal: nenhuma transicao sai dela. So PENDENTE entra aqui. */
    public void cancelar() {
        if (status != StatusNotificacao.PENDENTE) {
            throw new IllegalStateException("So notificacao PENDENTE pode ser cancelada; estava " + status);
        }
        status = StatusNotificacao.CANCELADA;
    }
```

- [ ] **Step 5: Rodar os testes**

Run: `cd infra-monitor-backend && ./mvnw test -Dtest=NotificacaoManutencaoTest`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A infra-monitor-backend/src
git commit -m "$(cat <<'EOF'
feat(notificacao): cancelar a abertura pendente e avisar o encerramento

A regra e por estado da notificacao de abertura, nao por tipo de evento:
PENDENTE cancela e nada mais sai; ENVIANDO e ENVIADA geram o aviso de
encerramento por manutencao; FALHA nao gera nada.

ENVIANDO nao e cancelada: a chamada pode estar em voo e marcar CANCELADA
sobre algo possivelmente enviado seria mentira num campo auditado.

O texto e o tipo sao proprios. Reusar INCIDENTE_FECHADO diria ao plantao
que o monitor se recuperou.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Abertura condicional de incidente e de episódio (B.4)

**Files:**
- Modify: `infra-monitor-backend/src/main/java/br/com/inframonitor/incidente/repository/IncidenteRepository.java`
- Modify: `infra-monitor-backend/src/main/java/br/com/inframonitor/incidente/service/IncidenteService.java:66-81`
- Modify: `infra-monitor-backend/src/main/java/br/com/inframonitor/monitoring/incident/IncidentProcessor.java:57-72`
- Modify: `infra-monitor-backend/src/main/java/br/com/inframonitor/monitoring/latency/MonitorEpisodioLatenciaRepository.java`
- Modify: `infra-monitor-backend/src/main/java/br/com/inframonitor/monitoring/latency/LatencyEpisodeProcessor.java:92-112`
- Test: `infra-monitor-backend/src/test/java/br/com/inframonitor/monitoring/incident/AberturaCondicionalTest.java`

**Interfaces:**
- Produces:
  - `int IncidenteRepository.inserirSeElegivel(Long monitorId, Instant iniciadoEm, String motivo, Instant agora)` — 0 quando o equipamento está em manutenção, inativo, o monitor está inativo, ou já há incidente aberto.
  - `Optional<Incidente> IncidenteService.abrirAutomaticamente(Monitor monitor, Instant iniciadoEm, int falhasConsecutivas)` — **muda de `Incidente` para `Optional<Incidente>`**; vazio = não abriu, e **nenhuma notificação é criada**.
  - `int MonitorEpisodioLatenciaRepository.inserirSeElegivel(Long monitorId, Instant iniciadoEm, int limiarMs, Instant agora)`

- [ ] **Step 1: Escrever o teste da corrida**

```java
@Test
void naoAbreIncidenteParaEquipamentoEmManutencao() {
    equipamento.setEmManutencao(true);
    equipamentoRepository.saveAndFlush(equipamento);

    Optional<Incidente> aberto = incidenteService.abrirAutomaticamente(monitor, agora, 3);

    assertThat(aberto).isEmpty();
    assertThat(incidenteRepository.existsByMonitorId(monitor.getId())).isFalse();
    // O ponto critico: sem insercao, NENHUMA notificacao nasce.
    assertThat(notificacaoRepository.count()).isZero();
}

@Test
void naoAbreEpisodioDeLatenciaParaEquipamentoEmManutencao() {
    equipamento.setEmManutencao(true);
    equipamentoRepository.saveAndFlush(equipamento);

    latencyEpisodeProcessor.process(medicaoDegradada);

    assertThat(episodioRepository.findFirstByMonitorIdAndEncerradoEmIsNull(monitor.getId())).isEmpty();
    assertThat(notificacaoRepository.count()).isZero();
}

@Test
void segundaAberturaConcorrenteNaoDuplicaNemNotifica() {
    incidenteService.abrirAutomaticamente(monitor, agora, 3);
    Optional<Incidente> segunda = incidenteService.abrirAutomaticamente(monitor, agora, 3);

    assertThat(segunda).isEmpty();
    assertThat(notificacaoRepository.count()).isEqualTo(1);
}
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `cd infra-monitor-backend && ./mvnw test -Dtest=AberturaCondicionalTest`
Expected: FAIL — hoje `abrirAutomaticamente` faz `saveAndFlush` incondicional e chama
`criarParaIncidenteAberto` logo depois, sem olhar se algo foi inserido.

- [ ] **Step 3: Implementar o INSERT condicional**

```java
    /**
     * Abertura condicional, no idioma de NotificacaoRepository.inserirPendenteSeAusente.
     * O WHERE carrega o predicado inteiro de "este monitor deveria estar sendo
     * observado agora"; o ON CONFLICT DO NOTHING absorve uq_incidente_monitor_aberto.
     *
     * <p>Retorno 0 significa "a manutencao ganhou a corrida, ou o monitor saiu do ar
     * administrativamente, ou ja havia incidente aberto". Nos tres casos NAO se cria
     * notificacao — e e' esse o ponto, porque o caminho antigo notificava logo depois
     * do save sem olhar se algo tinha sido inserido.
     */
    @Modifying
    @Query(value = """
            INSERT INTO incidente (monitor_id, status, iniciado_em, motivo, created_at, updated_at)
            SELECT m.id, 'ABERTO', :iniciadoEm, :motivo, :agora, :agora
              FROM monitor m JOIN equipamento e ON e.id = m.equipamento_id
             WHERE m.id = :monitorId AND m.ativo AND e.ativo AND e.em_manutencao = false
            ON CONFLICT DO NOTHING
            """, nativeQuery = true)
    int inserirSeElegivel(@Param("monitorId") Long monitorId, @Param("iniciadoEm") Instant iniciadoEm,
                          @Param("motivo") String motivo, @Param("agora") Instant agora);
```

Em `IncidenteService`:

```java
    @Transactional
    public Optional<Incidente> abrirAutomaticamente(Monitor monitor, Instant iniciadoEm, int falhasConsecutivas) {
        String motivo = "Indisponibilidade detectada automaticamente apos " + falhasConsecutivas
                + " falhas consecutivas.";
        if (incidenteRepository.inserirSeElegivel(monitor.getId(), iniciadoEm, motivo, Instant.now()) == 0) {
            // Manutencao ganhou a corrida, monitor/equipamento saiu do ar, ou ja havia
            // incidente aberto. Sem insercao, sem notificacao.
            return Optional.empty();
        }
        Incidente aberto = incidenteRepository
                .findFirstByMonitorIdAndStatusInOrderByIniciadoEmDescIdDesc(monitor.getId(), StatusIncidente.EM_ABERTO)
                .orElseThrow(() -> new IllegalStateException(
                        "insercao reportou 1 linha mas nenhum incidente aberto foi encontrado para o monitor "
                                + monitor.getId()));
        notificacaoService.criarParaIncidenteAberto(aberto);
        return Optional.of(aberto);
    }
```

O `catch (DataIntegrityViolationException)` de `abrirAutomaticamente` **desaparece**: o
`ON CONFLICT DO NOTHING` absorve a violação. `IncidenteService.criar` (caminho manual da API)
**continua como está**, com seu 409 — ali o conflito é resposta ao usuário, não corrida do motor.

Em `IncidentProcessor.processarAbertura`, trocar o `try/catch ConflitoException`:

```java
        incidenteService.abrirAutomaticamente(monitor, medicoes.get(medicoes.size() - 1).getExecutadoEm(), threshold)
                .ifPresentOrElse(
                        incidente -> log.info("Incident {} opened automatically for monitor {}",
                                incidente.getId(), monitor.getId()),
                        () -> log.debug("Incident opening skipped for monitor {}: equipment under maintenance, "
                                + "monitor inactive, or incident already open", monitor.getId()));
```

Em `MonitorEpisodioLatenciaRepository`, o irmão para o episódio:

```java
    @Modifying
    @Query(value = """
            INSERT INTO monitor_episodio_latencia (monitor_id, iniciado_em, limiar_ms, created_at, updated_at)
            SELECT m.id, :iniciadoEm, :limiarMs, :agora, :agora
              FROM monitor m JOIN equipamento e ON e.id = m.equipamento_id
             WHERE m.id = :monitorId AND m.ativo AND e.ativo AND e.em_manutencao = false
            ON CONFLICT DO NOTHING
            """, nativeQuery = true)
    int inserirSeElegivel(@Param("monitorId") Long monitorId, @Param("iniciadoEm") Instant iniciadoEm,
                          @Param("limiarMs") int limiarMs, @Param("agora") Instant agora);
```

**Conferir as colunas reais de `monitor_episodio_latencia` em `V15__create_episodio_latencia.sql`
antes de escrever este INSERT** — se houver coluna `NOT NULL` fora da lista, o INSERT falha.

`LatencyEpisodeProcessor.processarAbertura` passa a usar `inserirSeElegivel`; se devolver 0, retorna
sem criar notificação, e o `catch (DataIntegrityViolationException)` sai.

- [ ] **Step 4: Rodar os testes**

Run: `cd infra-monitor-backend && ./mvnw test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A infra-monitor-backend/src
git commit -m "$(cat <<'EOF'
feat(incidente,latencia): abertura condicional em vez de save incondicional

O WHERE do INSERT ... SELECT carrega o predicado inteiro de "deveria estar
sendo observado agora", e o ON CONFLICT DO NOTHING absorve o indice parcial.
Retorno 0 e' a resposta para tres perguntas de uma vez: manutencao ganhou a
corrida, monitor fora do ar, ou incidente ja aberto.

abrirAutomaticamente devolve Optional: vazio significa que nada foi inserido
e, principalmente, que nenhuma notificacao nasce. O caminho antigo notificava
logo depois do save sem olhar se tinha inserido.

A guarda vale para o episodio de latencia tambem, nao so para o incidente.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Janela como âncora da abertura (B.3)

**Files:**
- Modify: `infra-monitor-backend/src/main/java/br/com/inframonitor/monitoring/incident/IncidentProcessor.java:57-72`
- Modify: `infra-monitor-backend/src/main/java/br/com/inframonitor/relatorio/repository/JanelaMonitoramentoRepository.java` (se faltar o método `aberta`)
- Test: `infra-monitor-backend/src/test/java/br/com/inframonitor/monitoring/incident/CaudaCongeladaTest.java`

**Interfaces:**
- Consumes: `JanelaMonitoramentoRepository.aberta(Long monitorId) -> Optional<JanelaMonitoramento>`; `JanelaMonitoramento.getInicioEm()` — **conferir o nome real do getter em `relatorio/entity/JanelaMonitoramento.java`**.
- Produces: `IncidentProcessor` recusa abertura sustentada por medição anterior ao início da janela aberta.

- [ ] **Step 1: Escrever o teste da cauda congelada**

```java
@Test
void caudaCongeladaPelaManutencaoNaoAbreIncidenteNaPrimeiraFalhaNova() {
    // falhasParaIncidente = 3
    // 3 falhas ANTES da manutencao, janela fechada, janela reaberta, 1 falha NOVA
    medicao(FALHA, "2026-09-22T10:00:00Z");
    medicao(FALHA, "2026-09-22T10:00:30Z");
    medicao(FALHA, "2026-09-22T10:01:00Z");
    fecharJanela("2026-09-22T10:01:10Z");
    abrirJanela("2026-09-22T11:00:00Z");
    Medicao novaFalha = medicao(FALHA, "2026-09-22T11:00:10Z");

    incidentProcessor.process(novaFalha);

    // Sem a ancora, a cauda [FALHA(nova), FALHA(velha), FALHA(velha)] abriria um
    // incidente com iniciadoEm de ANTES da manutencao e dispararia Telegram.
    assertThat(incidenteRepository.existsByMonitorId(monitor.getId())).isFalse();
}

@Test
void tresFalhasNOVASDepoisDaJanelaAbremIncidente() {
    abrirJanela("2026-09-22T11:00:00Z");
    medicao(FALHA, "2026-09-22T11:00:10Z");
    medicao(FALHA, "2026-09-22T11:00:40Z");
    Medicao terceira = medicao(FALHA, "2026-09-22T11:01:10Z");

    incidentProcessor.process(terceira);

    assertThat(incidenteRepository.existsByMonitorId(monitor.getId())).isTrue();
}
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `cd infra-monitor-backend && ./mvnw test -Dtest=CaudaCongeladaTest`
Expected: FAIL no primeiro teste — hoje `processarAbertura` só olha as N últimas linhas e o status delas.

- [ ] **Step 3: Implementar a âncora**

Em `IncidentProcessor`, injetar `JanelaMonitoramentoRepository` e acrescentar, dentro de
`processarAbertura`, logo depois de `sequenciaCompleta`:

```java
        // Espelho da guarda de processarRecovery (:78): medicao anterior ao inicio da
        // observacao atual nao sustenta abertura. Sem isto, a cauda congelada pela
        // manutencao abre um incidente com iniciadoEm de antes dela, e dispara Telegram
        // na PRIMEIRA falha depois da saida - que pode ser o equipamento ainda subindo.
        //
        // A ancora e' a janela_monitoramento porque ela ja e' a resposta canonica do
        // projeto para "desde quando este monitor esta sendo observado", e a saida da
        // manutencao abre uma janela nova de qualquer jeito (B.5).
        Optional<JanelaMonitoramento> janela = janelaRepository.aberta(monitor.getId());
        if (janela.isEmpty()) {
            log.debug("No open monitoring window for monitor {}; opening skipped", monitor.getId());
            return;
        }
        Instant inicioDaObservacao = janela.get().getInicioEm();
        if (medicoes.stream().anyMatch(m -> m.getExecutadoEm().isBefore(inicioDaObservacao))) {
            log.debug("Failure tail predates the open window for monitor {}; opening skipped", monitor.getId());
            return;
        }
```

`janela.isEmpty()` → não abre: sem janela aberta o monitor não é candidato à execução (invariante da
B.5), então uma medição que chegou assim é resíduo.

- [ ] **Step 4: Rodar os testes**

Run: `cd infra-monitor-backend && ./mvnw test -Dtest=CaudaCongeladaTest`
Expected: PASS nos dois.

- [ ] **Step 5: Commit**

```bash
git add -A infra-monitor-backend/src
git commit -m "$(cat <<'EOF'
fix(incidente): ancorar a abertura na janela de monitoramento

processarRecovery ja recusava medicao anterior ao inicio do incidente;
processarAbertura nao tinha a guarda simetrica. Com a cauda congelada pela
manutencao, a primeira falha depois da saida - que pode ser o equipamento
ainda subindo - abria incidente retroativo e disparava Telegram.

A ancora e a janela porque ela ja e a definicao canonica de "desde quando
conta", e a saida da manutencao abre uma janela nova de qualquer jeito.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Invariante da janela (B.5)

**Files:**
- Modify: `infra-monitor-backend/src/main/java/br/com/inframonitor/relatorio/service/CicloJanelaMonitoramentoService.java`
- Modify: `infra-monitor-backend/src/main/java/br/com/inframonitor/monitor/repository/MonitorRepository.java:29-38`
- Modify: `infra-monitor-backend/src/main/java/br/com/inframonitor/equipamento/service/EquipamentoService.java:98-110`
- Test: `infra-monitor-backend/src/test/java/br/com/inframonitor/relatorio/service/InvarianteJanelaTest.java`

**Interfaces:**
- Produces: `void CicloJanelaMonitoramentoService.abrirEquipamento(Long equipamentoId)`; `abrir(Monitor)` ganha a guarda de manutenção; `findActiveExecutionCandidates()` ganha `and e.emManutencao = false`.

- [ ] **Step 1: Escrever o teste da matriz completa**

```java
@ParameterizedTest(name = "equipamento.ativo={0} monitor.ativo={1} emManutencao={2} -> janela aberta={3}")
@CsvSource({
    "true,  true,  false, true",   // 1: unico caso observado
    "true,  true,  true,  false",  // 2: premissa 1 - nao se pinga, nao se mede
    "true,  false, false, false",  // 3
    "true,  false, true,  false",  // 4
    "false, true,  false, false",  // 5
    "false, true,  true,  false",  // 6
    "false, false, false, false",  // 7
    "false, false, true,  false"   // 8
})
void invarianteJanelaAbertaSseCandidatoAExecucao(boolean equipamentoAtivo, boolean monitorAtivo,
                                                  boolean emManutencao, boolean esperaJanelaAberta) {
    // monta o estado, chama cicloJanela.abrirEquipamento(id)
    boolean temJanela = janelaRepository.aberta(monitor.getId()).isPresent();
    boolean eCandidato = monitorRepository.findActiveExecutionCandidates().stream()
            .anyMatch(c -> c.monitorId().equals(monitor.getId()));

    assertThat(temJanela).isEqualTo(esperaJanelaAberta);
    // O coracao do invariante: os dois lados tem de concordar SEMPRE.
    assertThat(temJanela).isEqualTo(eCandidato);
}

@Test
void ativarEquipamentoEmManutencaoNaoAbreJanela() {
    equipamento.setEmManutencao(true);
    equipamentoService.ativar(equipamento.getId());
    assertThat(janelaRepository.aberta(monitor.getId())).isEmpty();
}

@Test
void ativarMonitorDeEquipamentoEmManutencaoNaoAbreJanela() {
    equipamento.setEmManutencao(true);
    monitorService.ativar(monitor.getId());
    assertThat(janelaRepository.aberta(monitor.getId())).isEmpty();
}
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `cd infra-monitor-backend && ./mvnw test -Dtest=InvarianteJanelaTest`
Expected: FAIL nas linhas 2, 4, 6, 8 e nos dois últimos testes.

- [ ] **Step 3: Implementar**

`CicloJanelaMonitoramentoService`:

```java
 /**
  * Invariante: existe janela aberta para um monitor se e somente se ele e' candidato
  * a execucao — equipamento.ativo AND monitor.ativo AND NOT equipamento.em_manutencao,
  * a mesma expressao do WHERE de findActiveExecutionCandidates. Se divergirem, ou se
  * mede tempo em que nao se pinga (SLA punindo silencio administrativo), ou se pinga
  * tempo que nao se mede (queda invisivel).
  *
  * <p>A guarda mora AQUI e nao nos chamadores: abrir tem tres pontos de entrada, e
  * repetir a condicao em tres lugares e garantir que um dia sobre um sem ela.
  */
 @Transactional public void abrir(Monitor m){
   if(!m.isAtivo() || !m.getEquipamento().isAtivo() || m.getEquipamento().isEmManutencao()) return;
   if(repo.aberta(m.getId()).isEmpty()) repo.save(new JanelaMonitoramento(m,Instant.now(clock),OrigemJanelaMonitoramento.PRECISA));
 }

 /**
  * Irmao simetrico de fecharEquipamento. Absorve o bloco inline que vivia em
  * EquipamentoService.ativar. Dois chamadores: ativar e sairDeManutencao.
  *
  * <p>Reavalia o predicado inteiro, e nao so' a manutencao: as linhas 4, 6 e 8 da
  * matriz sao alcancaveis porque entrarEmManutencao nao valida ativo.
  */
 @Transactional public void abrirEquipamento(Long equipamentoId){
   monitorRepository.findByEquipamentoIdIn(List.of(equipamentoId)).forEach(this::abrir);
 }
```

`MonitorRepository.findActiveExecutionCandidates`, na cláusula `where`:

```java
            where m.ativo = true and e.ativo = true and e.emManutencao = false
```

**Conferir o nome real do campo na entidade `Equipamento`** (`emManutencao`) antes de escrever — é JPQL,
o nome é o do campo Java, não o da coluna.

`EquipamentoService.ativar:108` troca o bloco inline pela chamada:

```java
        if (cicloJanela != null) cicloJanela.abrirEquipamento(id);
```

- [ ] **Step 4: Rodar os testes**

Run: `cd infra-monitor-backend && ./mvnw test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A infra-monitor-backend/src
git commit -m "$(cat <<'EOF'
feat(janela): janela aberta se e somente se candidato a execucao

O predicado da janela e o WHERE do agendador passam a ser a mesma expressao.
Divergir significa medir tempo em que nao se pinga, ou pingar tempo que nao
se mede.

Ativar equipamento ou monitor em manutencao deixa de abrir janela: ativacao
e decisao administrativa sobre o cadastro, manutencao e decisao operacional
sobre a observacao, e a segunda vence enquanto durar.

A guarda mora dentro de abrir, nao nos tres chamadores.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: A transação da entrada e da saída de manutenção

**Files:**
- Modify: `infra-monitor-backend/src/main/java/br/com/inframonitor/equipamento/service/EquipamentoService.java:112-124`
- Modify: `infra-monitor-backend/src/main/java/br/com/inframonitor/equipamento/repository/EquipamentoRepository.java`
- Modify: `infra-monitor-backend/src/main/java/br/com/inframonitor/equipamento/controller/EquipamentoController.java:74-78`
- Modify: `infra-monitor-backend/src/main/java/br/com/inframonitor/incidente/repository/IncidenteRepository.java`
- Modify: `infra-monitor-backend/src/main/java/br/com/inframonitor/monitoring/latency/MonitorEpisodioLatenciaRepository.java`
- Test: `infra-monitor-backend/src/test/java/br/com/inframonitor/equipamento/service/EntradaEmManutencaoTest.java`

**Interfaces:**
- Produces:
  - `int EquipamentoRepository.marcarEmManutencaoSeNaoEstiver(Long id, Instant agora)` / `desmarcarSeEstiver(...)`
  - `List<Incidente> IncidenteRepository.abertosDoEquipamento(Long equipamentoId)`
  - `int IncidenteRepository.fecharPorManutencao(Long equipamentoId, Usuario usuario, Instant agora)`
  - `List<MonitorEpisodioLatencia> MonitorEpisodioLatenciaRepository.abertosDoEquipamento(Long equipamentoId)`
  - `int MonitorEpisodioLatenciaRepository.encerrarPorManutencao(Long equipamentoId, Instant agora)`
  - `EquipamentoResponse EquipamentoService.entrarEmManutencao(Long id, Long usuarioId)` — **assinatura muda**
  - `EquipamentoResponse EquipamentoService.sairDeManutencao(Long id)`

- [ ] **Step 1: Escrever o teste**

```java
@Test
void entrarEmManutencaoFechaIncidenteComMotivoEAutorEFechaJanela() {
    Incidente aberto = abrirIncidente(monitor);
    enviarNotificacaoDeAbertura(aberto);   // ENVIADA

    equipamentoService.entrarEmManutencao(equipamento.getId(), operador.getId());

    Incidente fechado = incidenteRepository.findById(aberto.getId()).orElseThrow();
    assertThat(fechado.getStatus()).isEqualTo(StatusIncidente.FECHADO);
    assertThat(fechado.getMotivoEncerramento()).isEqualTo(MotivoEncerramentoIncidente.MANUTENCAO);
    assertThat(fechado.getFechadoPor().getId()).isEqualTo(operador.getId());
    assertThat(janelaRepository.aberta(monitor.getId())).isEmpty();
    assertThat(existe(TipoEventoNotificacao.INCIDENTE_ENCERRADO_MANUTENCAO)).isTrue();
    assertThat(existe(TipoEventoNotificacao.INCIDENTE_FECHADO)).isFalse();
}

@Test
void entrarEmManutencaoDuasVezesRodaOsEfeitosUmaVezSo() {
    equipamentoService.entrarEmManutencao(equipamento.getId(), operador.getId());
    long notificacoesDepoisDaPrimeira = notificacaoRepository.count();

    equipamentoService.entrarEmManutencao(equipamento.getId(), operador.getId());

    assertThat(notificacaoRepository.count()).isEqualTo(notificacoesDepoisDaPrimeira);
}

@Test
void episodioDeLatenciaAbertoEEncerradoComMotivoManutencao() {
    MonitorEpisodioLatencia episodio = abrirEpisodio(monitor);

    equipamentoService.entrarEmManutencao(equipamento.getId(), operador.getId());

    MonitorEpisodioLatencia recarregado = episodioRepository.findById(episodio.getId()).orElseThrow();
    assertThat(recarregado.getEncerradoEm()).isNotNull();
    assertThat(recarregado.getMotivoEncerramento()).isEqualTo(MotivoEncerramentoEpisodio.MANUTENCAO);
}

@Test
void sairDeManutencaoReabreJanelaReavaliandoOPredicado() {
    equipamentoService.entrarEmManutencao(equipamento.getId(), operador.getId());
    equipamentoService.sairDeManutencao(equipamento.getId());
    assertThat(janelaRepository.aberta(monitor.getId())).isPresent();
}

@Test
void sairDeManutencaoDeEquipamentoINATIVONaoAbreJanela() {
    equipamento.setAtivo(false);
    equipamentoService.entrarEmManutencao(equipamento.getId(), operador.getId());
    equipamentoService.sairDeManutencao(equipamento.getId());
    assertThat(janelaRepository.aberta(monitor.getId())).isEmpty();
}
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `cd infra-monitor-backend && ./mvnw test -Dtest=EntradaEmManutencaoTest`
Expected: FAIL — hoje `entrarEmManutencao` só faz `setEmManutencao(true)`.

- [ ] **Step 3: Implementar os repositórios**

```java
    // EquipamentoRepository - CAS: dois operadores clicando juntos nao rodam os
    // efeitos colaterais duas vezes. Retorno 0 = ja estava em manutencao.
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("update Equipamento e set e.emManutencao = true, e.updatedAt = :agora "
            + "where e.id = :id and e.emManutencao = false")
    int marcarEmManutencaoSeNaoEstiver(@Param("id") Long id, @Param("agora") Instant agora);

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("update Equipamento e set e.emManutencao = false, e.updatedAt = :agora "
            + "where e.id = :id and e.emManutencao = true")
    int desmarcarManutencaoSeEstiver(@Param("id") Long id, @Param("agora") Instant agora);
```

```java
    // IncidenteRepository - espelha reconhecerSeAberto. Fecha todos os monitores do
    // equipamento numa instrucao e devolve quantos fechou.
    @EntityGraph(attributePaths = "monitor")
    @Query("select i from Incidente i where i.monitor.equipamento.id = :equipamentoId "
            + "and i.status in (br.com.inframonitor.incidente.entity.StatusIncidente.ABERTO, "
            + "br.com.inframonitor.incidente.entity.StatusIncidente.RECONHECIDO)")
    List<Incidente> abertosDoEquipamento(@Param("equipamentoId") Long equipamentoId);

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("update Incidente i set i.status = br.com.inframonitor.incidente.entity.StatusIncidente.FECHADO, "
            + "i.encerradoEm = :agora, "
            + "i.motivoEncerramento = br.com.inframonitor.incidente.entity.MotivoEncerramentoIncidente.MANUTENCAO, "
            + "i.fechadoPor = :usuario, i.updatedAt = :agora "
            + "where i.monitor.equipamento.id = :equipamentoId "
            + "and i.status in (br.com.inframonitor.incidente.entity.StatusIncidente.ABERTO, "
            + "br.com.inframonitor.incidente.entity.StatusIncidente.RECONHECIDO)")
    int fecharPorManutencao(@Param("equipamentoId") Long equipamentoId, @Param("usuario") Usuario usuario,
                            @Param("agora") Instant agora);
```

O irmão para o episódio, com `MotivoEncerramentoEpisodio.MANUTENCAO` e
`where e.monitor.equipamento.id = :equipamentoId and e.encerradoEm is null`.

- [ ] **Step 4: Implementar o serviço — ordem fixa, uma transação**

```java
    /**
     * Entrada em manutencao: flag, fechamento, janela, notificacao — numa transacao so.
     *
     * <p>A ordem importa e e' esta: o flag vem PRIMEIRO. Qualquer processor a caminho
     * encontra em_manutencao = true e nao abre nada (a guarda vive no WHERE do INSERT
     * condicional de incidente e de episodio); qualquer um que tenha aberto ANTES do
     * flag e' fechado pelo passo 2. A ordem inversa deixaria uma janela em que o
     * processor abre depois do fechamento.
     *
     * <p>O CAS do passo 1 torna a operacao idempotente: retorno 0 significa que outro
     * operador ganhou, e nenhum efeito colateral roda duas vezes.
     */
    @Transactional
    public EquipamentoResponse entrarEmManutencao(Long id, Long usuarioId) {
        Equipamento equipamento = obterEquipamento(id);
        Instant agora = Instant.now();
        // 1. flag, com CAS
        if (equipamentoRepository.marcarEmManutencaoSeNaoEstiver(id, agora) == 0) {
            return paraResposta(obterEquipamento(id));
        }
        // 2. incidentes em aberto: lidos ANTES do bulk update, porque depois dele eles
        //    ja nao satisfazem o filtro e a notificacao precisa saber quais eram.
        List<Incidente> afetados = incidenteRepository.abertosDoEquipamento(id);
        incidenteRepository.fecharPorManutencao(id, autor(usuarioId), agora);
        // 3. episodios de latencia em aberto
        List<MonitorEpisodioLatencia> episodios = episodioRepository.abertosDoEquipamento(id);
        episodioRepository.encerrarPorManutencao(id, agora);
        // 4. janelas: sem isto o SLA continua descontando o periodo de manutencao
        cicloJanela.fecharEquipamento(id);
        // 5. notificacoes: cancela a abertura pendente, avisa o encerramento quando a
        //    abertura ja foi despachada. Depois do fechamento, para que a mensagem
        //    descreva o incidente ja fechado.
        afetados.forEach(notificacaoService::tratarEncerramentoPorManutencao);
        episodios.forEach(notificacaoService::tratarEncerramentoPorManutencao);
        return paraResposta(obterEquipamento(id));
    }

    /**
     * Saida: desmarca e REAVALIA o predicado inteiro da janela, e nao so' a manutencao.
     * As linhas 4, 6 e 8 da matriz da B.5 sao alcancaveis porque entrar em manutencao
     * nao valida ativo: sair nao pode presumir que o equipamento esta ativo.
     */
    @Transactional
    public EquipamentoResponse sairDeManutencao(Long id) {
        Equipamento equipamento = obterEquipamento(id);
        if (equipamentoRepository.desmarcarManutencaoSeEstiver(id, Instant.now()) == 0) {
            return paraResposta(equipamento);
        }
        cicloJanela.abrirEquipamento(id);
        return paraResposta(obterEquipamento(id));
    }
```

`autor(Long usuarioId)` já existe em `IncidenteService`; replicar o mesmo padrão em
`EquipamentoService` (ou extrair — **não** criar `BaseService`).

- [ ] **Step 5: Passar o principal pelo controller**

```java
    @PatchMapping("/{id}/manutencao/iniciar")
    public EquipamentoResponse entrarEmManutencao(@PathVariable Long id,
                                                   @AuthenticationPrincipal UsuarioPrincipal principal) {
        // O tipo e UsuarioPrincipal, nao Usuario: o tipo errado injeta null em
        // silencio e so estoura no banco.
        return service.entrarEmManutencao(id, principal.id());
    }
```

- [ ] **Step 6: Rodar os testes**

Run: `cd infra-monitor-backend && ./mvnw test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A infra-monitor-backend/src
git commit -m "$(cat <<'EOF'
feat(equipamento): entrada em manutencao como uma transacao so

Flag primeiro, com CAS, depois fechamento de incidente e de episodio, janela
e notificacao. O flag vem antes de proposito: um processor a caminho encontra
em_manutencao = true e nao abre nada, e quem abriu antes do flag e fechado
pelo passo seguinte.

O incidente fechado por manutencao grava o operador em fechado_por, mantendo
verdadeira a afirmacao da V17 de que fechado_por nulo e fechamento do motor.

Sair reavalia o predicado inteiro da janela: entrar em manutencao nao valida
ativo, entao sair nao pode presumir equipamento ativo.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Relatórios, CSV e a API de histórico

**Files:**
- Modify: `infra-monitor-backend/src/main/java/br/com/inframonitor/relatorio/service/RelatorioService.java:77`
- Modify: `infra-monitor-backend/src/main/java/br/com/inframonitor/relatorio/service/RelatorioExportService.java:31-43,111-113`
- Modify: o record `HistoricoIncidenteResponse` (localizar em `relatorio/dto/`)
- Modify: `infra-monitor-backend/src/main/java/br/com/inframonitor/incidente/dto/IncidenteResponse.java`
- Test: `infra-monitor-backend/src/test/java/br/com/inframonitor/relatorio/service/RelatorioMotivoEncerramentoTest.java`

**Interfaces:**
- Produces: `motivoEncerramento` em `IncidenteResponse` e em `HistoricoIncidenteResponse`; coluna `motivo_encerramento` **no fim** do CSV.

- [ ] **Step 1: Escrever o teste**

```java
@Test
void csvTrazMotivoEncerramentoNaUltimaColuna() {
    String csv = exportService.incidentes(...);
    String cabecalho = csv.lines().findFirst().orElseThrow();

    assertThat(cabecalho).endsWith("motivo_encerramento");
    // Coluna no FIM: nao ha consumidor externo, o sistema nao esta em producao,
    // mas mover coluna existente continua sendo gratuito de evitar.
    String primeiraLinha = csv.lines().skip(1).findFirst().orElseThrow();
    assertThat(primeiraLinha).endsWith(",MANUTENCAO");
}

@Test
void historicoDeIncidentesExpoeOMotivoDeEncerramento() {
    var pagina = relatorioService.incidentes(...);
    assertThat(pagina.getContent().getFirst().motivoEncerramento()).isEqualTo("MANUTENCAO");
}

@Test
void disponibilidadeNaoFiltraIncidenteEncerradoPorManutencao() {
    // A queda REAL que motivou a manutencao continua contando. O que sai do calculo
    // e o periodo de manutencao, e quem o exclui e a janela.
}
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `cd infra-monitor-backend && ./mvnw test -Dtest=RelatorioMotivoEncerramentoTest`
Expected: FAIL.

- [ ] **Step 3: Implementar**

- `RelatorioService.java:77`: acrescentar `i.motivo_encerramento` à projeção e ao mapeamento do record.
- `RelatorioExportService.java:112`: `motivo_encerramento` **no fim** do cabeçalho; `:113`: o mapper na
  mesma posição; `:31-43`: a coluna no SELECT.
- `IncidenteResponse`: campo novo `MotivoEncerramentoIncidente motivoEncerramento`, e
  `IncidenteService.paraResposta` passa `incidente.getMotivoEncerramento()`.

**Não mexer** em `DisponibilidadeSqlRepository`, `VisaoGeralPdfRepository` nem
`DisponibilidadeTemporalCalculator`: eles já estão corretos por construção — a janela fechada recorta o
período, e filtrar por `motivo_encerramento <> 'MANUTENCAO'` apagaria a indisponibilidade real ocorrida
**antes** da manutenção, que é o dado mais relevante.

- [ ] **Step 4: Rodar os testes**

Run: `cd infra-monitor-backend && ./mvnw test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A infra-monitor-backend/src
git commit -m "$(cat <<'EOF'
feat(relatorio): expor o motivo de encerramento na API e no CSV

A duracao de um incidente encerrado por manutencao termina no clique, e nao
numa recuperacao: sem a coluna, o leitor nao tem como saber por que aquela
duracao acabou ali.

Coluna no fim do CSV. Nenhum filtro novo no calculo de disponibilidade: a
queda real que motivou a manutencao continua contando, e quem exclui o
periodo de manutencao e a janela.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Frontend — enums, badge e drawer

**Files:**
- Modify: `infra-monitor-frontend/src/app/core/models/api-enums.ts`
- Modify: `infra-monitor-frontend/src/app/core/models/incidente.ts`
- Modify: `infra-monitor-frontend/src/app/shared/status-badge/status-badge.component.ts`
- Modify: `infra-monitor-frontend/src/app/features/incidentes/.../incidente-detalhe-drawer.component.html:154-171`
- Test: `infra-monitor-frontend/src/app/shared/status-badge/status-badge.component.spec.ts`

**Interfaces:**
- Produces: `NotificationStatus.Cancelled = 'CANCELADA'`; `NotificationEventType.IncidentClosedByMaintenance = 'INCIDENTE_ENCERRADO_MANUTENCAO'` e `LatencyClosedByMaintenance = 'LATENCIA_ENCERRADA_MANUTENCAO'`; `IncidentClosureReason` (`RECUPERACAO_AUTOMATICA | FECHAMENTO_MANUAL | MANUTENCAO`); `motivoEncerramento` em `Incidente`.

- [ ] **Step 1: Escrever o teste do badge**

```ts
it('rotula CANCELADA sem dizer que falhou', () => {
  fixture.componentRef.setInput('status', NotificationStatus.Cancelled);
  fixture.detectChanges();
  const badge = fixture.nativeElement.querySelector('.badge');
  expect(badge.textContent.trim()).toBe('Cancelada');
  // 'Falha' seria mentira: nao tentamos e nao deu, o evento deixou de valer.
  expect(badge.className).not.toContain('badge--danger');
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `cd infra-monitor-frontend && npx ng test --watch=false --include='**/status-badge.component.spec.ts'`
Expected: FAIL. Antes disso o próprio `tsc` já quebra: `LABELS` e `TONES` são
`Record<DisplayStatus, string>`, então acrescentar `Cancelled` ao enum **obriga** a entrada nos dois
mapas. Essa quebra é a rede de proteção — registrar isso no documento de auditoria.

- [ ] **Step 3: Implementar**

Em `api-enums.ts`:

```ts
export enum NotificationStatus {
  Pending = 'PENDENTE',
  Sending = 'ENVIANDO',
  Sent = 'ENVIADA',
  Failure = 'FALHA',
  /** O evento deixou de valer antes do envio. Só PENDENTE vira CANCELADA. */
  Cancelled = 'CANCELADA',
}

export enum NotificationEventType {
  IncidentOpened = 'INCIDENTE_ABERTO',
  IncidentClosed = 'INCIDENTE_FECHADO',
  HighLatency = 'LATENCIA_ALTA',
  LatencyNormalized = 'LATENCIA_NORMALIZADA',
  IncidentClosedByMaintenance = 'INCIDENTE_ENCERRADO_MANUTENCAO',
  LatencyClosedByMaintenance = 'LATENCIA_ENCERRADA_MANUTENCAO',
}

/** Como o incidente foi encerrado. Ausente = fechado antes da V19, não classificável. */
export enum IncidentClosureReason {
  AutomaticRecovery = 'RECUPERACAO_AUTOMATICA',
  ManualClosure = 'FECHAMENTO_MANUAL',
  Maintenance = 'MANUTENCAO',
}
```

No `status-badge.component.ts`, acrescentar `CANCELADA` a `LABELS` (`'Cancelada'`) e a `TONES`
(`'muted'` — nem sucesso nem perigo: não saiu, e não por falha).

No drawer, dentro do cartão "Janela da ocorrência", **depois** de "Encerrado em":

```html
<div class="campo">
  <dt>Encerrado por</dt>
  <dd>{{ incidente.fechadoPorNome ?? 'Motor de monitoramento' }}</dd>
</div>
<div class="campo">
  <dt>Motivo do encerramento</dt>
  <dd>{{ rotuloDoMotivoDeEncerramento(incidente.motivoEncerramento) }}</dd>
</div>
```

Rótulos: `RECUPERACAO_AUTOMATICA` → "Recuperação automática"; `FECHAMENTO_MANUAL` → "Fechamento
manual"; `MANUTENCAO` → "Entrada em manutenção"; ausente → `'—'`.

`fechadoPorNome` já existe em `core/models/incidente.ts:5` e **nunca foi renderizado**: com três
caminhos de fechamento, a ausência de autor deixou de ser informativa sozinha.

- [ ] **Step 4: Rodar os testes**

Run: `cd infra-monitor-frontend && npx ng test --watch=false`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A infra-monitor-frontend/src
git commit -m "$(cat <<'EOF'
feat(front): motivo de encerramento no drawer e CANCELADA no badge

LABELS e TONES sao Record<DisplayStatus, string>: o valor novo no enum quebra
o build ate ganhar rotulo e tom, o que e exatamente a rede que impede um badge
local aparecer.

Encerrado por usa fechadoPorNome, que existia desde a V17 e nunca havia sido
renderizado - com tres caminhos de fechamento, a ausencia de autor deixou de
ser informativa sozinha.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Frontend — timeline, lista unificada e filtros

**Files:**
- Modify: `infra-monitor-frontend/src/app/features/incidentes/timeline/timeline.ts:141-153`
- Modify: `infra-monitor-frontend/src/app/features/incidentes/incidente-unificado-list.component.html:61-71`
- Modify: `infra-monitor-frontend/src/app/features/notificacoes/notificacao-list.component.html`
- Modify: `infra-monitor-frontend/src/app/features/equipamentos/.../equipamento-detalhe-drawer.component.html:237`
- Modify: `infra-monitor-frontend/src/app/features/unidades/detalhe/incidentes-tab.component.html:28`
- Test: `infra-monitor-frontend/src/app/features/incidentes/timeline/timeline.spec.ts`

**Interfaces:**
- Consumes: `IncidentClosureReason` e `Incidente.motivoEncerramento` da Task 11.

- [ ] **Step 1: Escrever o teste da timeline**

```ts
it('não afirma recuperação quando o incidente foi encerrado por manutenção', () => {
  const eventos = montarTimeline({
    ...incidenteBase,
    motivoEncerramento: IncidentClosureReason.Maintenance,
  }, limiares);

  const fim = eventos.at(-1)!;
  expect(fim.titulo).toBe('Encerrado por manutenção');
  // Hoje a timeline imprime "N respostas consecutivas restabeleceram o monitor"
  // com rotulo fixo. Para um fechamento por manutencao isso e falso: nao houve
  // sequencia de recuperacao nenhuma.
  expect(fim.detalhe).not.toContain('restabeleceram');
});

it('mantém o texto de recuperação quando o motor fechou', () => {
  const eventos = montarTimeline({
    ...incidenteBase,
    motivoEncerramento: IncidentClosureReason.AutomaticRecovery,
  }, limiares);
  expect(eventos.at(-1)!.detalhe).toContain('restabeleceram o monitor');
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `cd infra-monitor-frontend && npx ng test --watch=false --include='**/timeline.spec.ts'`
Expected: FAIL no primeiro — o rótulo e o detalhe são fixos.

- [ ] **Step 3: Implementar**

Em `timeline.ts:141-153`, ramo por `motivoEncerramento`:

```ts
// O rotulo fixo "Incidente fechado" com o detalhe de N respostas consecutivas
// e falso para um fechamento por manutencao: nao houve sequencia de recuperacao.
// Os eventos de recuperacao ja somem sozinhos (sequenciaDeFechamento procura a
// medicao cujo executadoEm e exatamente encerradoEm, e o fechamento por
// manutencao usa o instante do clique), mas esta frase continuava sendo impressa.
const fechamentoPorManutencao = incidente.motivoEncerramento === IncidentClosureReason.Maintenance;
const titulo = fechamentoPorManutencao ? 'Encerrado por manutenção' : 'Incidente fechado';
const detalhe = fechamentoPorManutencao
  ? 'O equipamento entrou em manutenção e saiu da observação. Nenhuma recuperação foi medida.'
  : `${limiares.sucessosParaRecovery} respostas consecutivas restabeleceram o monitor`;
```

Na **lista unificada**, marca discreta junto do badge de `STATUS` (`:71`) — **sem** décima segunda
coluna, que custaria largura numa tabela que já rola no laptop, para um dado que só interessa depois de
o operador escolher um incidente:

```html
<app-status-badge [status]="linha.status" />
@if (linha.motivoEncerramento === 'MANUTENCAO') {
  <span class="marca-manutencao" title="Encerrado por entrada em manutenção" aria-label="Encerrado por entrada em manutenção">🔧</span>
}
```

No **histórico do equipamento** (`:237`) e no **`incidentes-tab`** (`:28`), que hoje renderizam
`incidente.motivo ?? 'Indisponibilidade consolidada'` (motivo de **abertura**), acrescentar o motivo de
encerramento: é aqui que ele mais importa — quem olha o histórico precisa saber quais incidentes foram
resolvidos e quais foram apenas interrompidos.

Nos **filtros do histórico de notificações**, incluir `CANCELADA` no seletor de status e os dois tipos
novos no seletor de tipo de evento.

- [ ] **Step 4: Rodar os testes**

Run: `cd infra-monitor-frontend && npx ng test --watch=false`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A infra-monitor-frontend/src
git commit -m "$(cat <<'EOF'
fix(front): timeline deixa de afirmar recuperacao que nao houve

O rotulo do fim do incidente era fixo e o detalhe dizia que N respostas
consecutivas restabeleceram o monitor. Num fechamento por manutencao isso e
falso: ninguem mediu recuperacao nenhuma.

A lista unificada ganha marca discreta junto do badge, sem decima segunda
coluna. O historico do equipamento passa a distinguir resolvido de apenas
interrompido.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: Integração real contra Postgres (Testcontainers)

**Files:**
- Create: `infra-monitor-backend/src/test/java/br/com/inframonitor/equipamento/ManutencaoPostgresIntegrationTest.java`

**Interfaces:**
- Consumes: tudo das tasks 2 a 10.

- [ ] **Step 1: Ler o padrão do projeto**

Run: `ls infra-monitor-backend/src/test/java/br/com/inframonitor/**/*PostgresIntegrationTest.java`

Seguir o padrão de `NotificacaoConcorrenciaPostgresIntegrationTest`, inclusive o
`@EnabledIf("dockerDisponivel")` — sem Docker, **pula**, nunca falha.

- [ ] **Step 2: Escrever os testes de integração**

Cobertura obrigatória, cada um contra Postgres real com a `V19` aplicada pelo Flyway:

1. `ck_incidente_motivo_encerramento_coerente` recusa motivo em incidente `ABERTO`;
2. `ck_notificacao_evento_coerente` recusa `LATENCIA_ENCERRADA_MANUTENCAO` pendurado em incidente;
3. o ciclo inteiro: incidente aberto → entra em manutenção → `FECHADO`/`MANUTENCAO`/`fechado_por`
   preenchido, janela fechada, notificação de abertura tratada pela matriz;
4. `inserirSeElegivel` devolve 0 com `em_manutencao = true` e 1 depois de sair;
5. corrida real: duas threads, uma entrando em manutenção e outra chamando
   `abrirAutomaticamente`, terminam **sempre** sem incidente aberto e sem notificação órfã.

- [ ] **Step 3: Rodar**

Run: `cd infra-monitor-backend && ./mvnw test -Dtest=ManutencaoPostgresIntegrationTest`
Expected: PASS (ou "skipped" sem Docker — nesse caso, subir o Docker: **este teste precisa rodar**).

- [ ] **Step 4: Commit**

```bash
git add infra-monitor-backend/src/test
git commit -m "$(cat <<'EOF'
test(manutencao): integracao real contra Postgres com a V19 aplicada

Cobre o que so o banco prova: as CHECKs novas recusando o que deveriam, o
INSERT condicional devolvendo 0 sob manutencao, e a corrida real entre a
entrada em manutencao e a abertura automatica.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: Verificação ponta a ponta

**Files:**
- Create: `infra-monitor-frontend/e2e/manutencao-evidence/` (screenshots + JSON)
- Create: script do mock do Telegram (no scratchpad, **não** no repositório)
- Create: `Docs/validacao-producao/manutencao-verificacao-ponta-a-ponta.md`

**Interfaces:**
- Consumes: tudo.

- [ ] **Step 1: Postgres descartável na 5435, do zero**

```bash
export PGPASS_DESCARTAVEL="$(openssl rand -hex 16)"
export JWT_SECRET_DESCARTAVEL="$(openssl rand -hex 32)"
export ADMIN_PASS_DESCARTAVEL="$(openssl rand -hex 12)"
docker run -d --name infra-e2e -e POSTGRES_PASSWORD="$PGPASS_DESCARTAVEL" \
  -e POSTGRES_USER=inframonitor -e POSTGRES_DB=inframonitor -p 5435:5432 postgres:16
```

Nenhuma dessas variáveis entra em arquivo do repositório.

- [ ] **Step 2: Mock HTTP do Telegram**

Servidor local que responde `{"ok":true,"result":{"message_id":1}}` a
`POST /bot<token>/sendMessage` e **grava cada corpo recebido** num arquivo JSON-lines. Escrever no
scratchpad, não no repositório. Subir em `http://localhost:8099`.

- [ ] **Step 3: Subir o backend com motor e dispatcher ligados — SÓ contra a 5435**

```bash
cd infra-monitor-backend
DB_PORT=5435 DB_PASSWORD="$PGPASS_DESCARTAVEL" JWT_SECRET="$JWT_SECRET_DESCARTAVEL" \
  BOOTSTRAP_ADMIN_ENABLED=true BOOTSTRAP_ADMIN_NAME=Admin \
  BOOTSTRAP_ADMIN_EMAIL=admin@local BOOTSTRAP_ADMIN_PASSWORD="$ADMIN_PASS_DESCARTAVEL" \
  MONITORING_ENGINE_ENABLED=true \
  NOTIFICATION_DISPATCHER_ENABLED=true TELEGRAM_ENABLED=true \
  TELEGRAM_BOT_TOKEN=token-de-teste TELEGRAM_CHAT_ID=-1 \
  TELEGRAM_API_BASE_URL=http://localhost:8099 \
  ./mvnw spring-boot:run
```

**Conferir antes de seguir:** `DB_PORT=5435`. Se aparecer 5434 em qualquer comando desta task, **parar**.

- [ ] **Step 4: Cadastro via API**

1 unidade; 2 equipamentos em `192.0.2.10` e `192.0.2.11` (TEST-NET-1, nunca roteado, o ping sempre
falha); 1 monitor ICMP por equipamento, `intervaloSegundos=10`, `falhasParaIncidente=3`.

- [ ] **Step 5: Passo (1) — incidentes abrem e o mock recebe**

Esperar ~40 s. Evidência:

```sql
SELECT id, monitor_id, status, iniciado_em, motivo_encerramento FROM incidente ORDER BY id;
SELECT id, incidente_id, tipo_evento, status, enviado_em FROM notificacao ORDER BY id;
```
mais os corpos recebidos pelo mock.

- [ ] **Step 6: Passo (2) — `.10` entra em manutenção**

`PATCH /api/v1/equipamentos/{id-do-.10}/manutencao/iniciar` autenticado. Conferir, **com SQL colado**:

```sql
-- FECHADO com motivo MANUTENCAO e autor preenchido
SELECT id, status, encerrado_em, motivo_encerramento, fechado_por FROM incidente WHERE monitor_id = :m10;
-- janela fechada
SELECT id, inicio_em, fim_em FROM janela_monitoramento WHERE monitor_id = :m10 ORDER BY id;
-- notificacao do tipo novo, nunca INCIDENTE_FECHADO
SELECT tipo_evento, status FROM notificacao WHERE incidente_id = :i10;
-- nenhuma medicao nova depois do instante da manutencao
SELECT count(*) FROM medicao WHERE monitor_id = :m10 AND executado_em > :instante_da_manutencao;
```
Expected: a última contagem **0**, depois de esperar dois intervalos. Mais o corpo recebido pelo mock,
com o texto "Incidente encerrado: equipamento entrou em manutenção".

- [ ] **Step 7: Passo (3) — `.11` com o dispatcher desligado**

Reiniciar o backend com `NOTIFICATION_DISPATCHER_ENABLED=false`, deixar `.11` abrir incidente (a
notificação fica `PENDENTE`), então colocar `.11` em manutenção.

```sql
SELECT tipo_evento, status FROM notificacao WHERE incidente_id = :i11;
```
Expected: `INCIDENTE_ABERTO | CANCELADA`, e **nenhuma** linha `INCIDENTE_ENCERRADO_MANUTENCAO`.
Contagem de corpos no mock **inalterada**.

- [ ] **Step 8: Passo (4) — `.10` sai da manutenção**

`PATCH …/manutencao/encerrar`. Conferir: janela nova aberta; e que o incidente novo aparece **só depois
de 3 falhas NOVAS**, não na primeira:

```sql
SELECT count(*) FROM incidente WHERE monitor_id = :m10;   -- logo apos a 1a falha nova: ainda 1
SELECT executado_em, status FROM medicao WHERE monitor_id = :m10 ORDER BY executado_em DESC LIMIT 5;
SELECT id, iniciado_em FROM incidente WHERE monitor_id = :m10 ORDER BY id DESC LIMIT 1;
```
Expected: o `iniciado_em` do incidente novo é **posterior** ao início da janela nova. Este é o passo que
prova a B.3 em campo.

- [ ] **Step 9: Telas por Playwright, navegando por clique**

Credencial por variável de ambiente (`$ADMIN_PASS_DESCARTAVEL`), **nunca** no script. Depois do login,
navegar **por clique** — `page.goto` pós-login cai em `/login`. Sem `catch` mudo em seletor; log de rede
no `finally`.

Screenshots obrigatórios em `infra-monitor-frontend/e2e/manutencao-evidence/`:

1. drawer do incidente: "Encerrado por" e "Motivo do encerramento";
2. timeline: sem "recuperação" falsa;
3. lista unificada: marca de manutenção;
4. painel: KPI de manutenção;
5. mapa: o equipamento em manutenção ainda visível;
6. histórico de notificações: `CANCELADA` e os tipos novos nos badges.

- [ ] **Step 10: Destruir e provar que o dev não mudou**

```bash
docker rm -f infra-e2e
# mock encerrado
PGPASSWORD="$DB_PASSWORD_DEV" psql -h localhost -p 5434 -U inframonitor -d inframonitor -c \
"SELECT (SELECT count(*) FROM incidente) AS incidentes, (SELECT count(*) FROM medicao) AS medicoes,
        (SELECT count(*) FROM notificacao) AS notificacoes, (SELECT count(*) FROM equipamento) AS equipamentos,
        (SELECT count(*) FROM janela_monitoramento) AS janelas;"
psql ... -c "SELECT version, description, success FROM flyway_schema_history ORDER BY installed_rank DESC LIMIT 3;"
```

Expected: contagens **idênticas** às da Task 1 Step 4, e a última migration do banco de dev ainda a
`V18`. Colar as duas saídas lado a lado.

- [ ] **Step 11: Escrever o documento e commitar tudo junto**

`Docs/validacao-producao/manutencao-verificacao-ponta-a-ponta.md` com os quatro passos do roteiro, cada
um com **consulta SQL e corpo recebido pelo mock**, os screenshots referenciados, e a prova final de que
o banco de dev está intocado.

```bash
git add Docs/validacao-producao infra-monitor-frontend/e2e/manutencao-evidence
git commit -m "$(cat <<'EOF'
docs(manutencao): verificacao ponta a ponta com banco e mock descartaveis

Postgres 16 na 5435 criado do zero, mock HTTP no lugar da API do Telegram,
motor ligado somente contra esse banco. Os quatro passos do roteiro com SQL
e corpo recebido em cada um, e as telas por Playwright navegando por clique.

Banco descartavel e mock destruidos no fim. O banco de dev continua na V18 e
com as mesmas contagens do relatorio de investigacao.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-review do plano

**Cobertura do spec:** B.0 → Task 2 e 3; B.a → Task 5; B.b → Task 4; B.c → Tasks 6 e 9; B.d → Task 10;
B.e → Task 1; B.3 → Task 7; B.5 → Task 8; B.7 → Tasks 11 e 12; testes → Tasks 5–9 e 13; ponta a ponta →
Task 14.

**Consistência de tipos:** `MotivoEncerramentoIncidente` e `MotivoEncerramentoEpisodio` são enums
distintos e não se misturam; `abrirAutomaticamente` devolve `Optional<Incidente>` da Task 6 em diante e
a Task 7 já conta com isso; `entrarEmManutencao(Long, Long)` da Task 9 é o que a Task 14 chama pelo
controller.

**O que este plano NÃO faz:** `fecharAutomaticamente` continua sem CAS; `excluir` continua sem fechar
janela; a CHECK não exige `motivo_encerramento NOT NULL` em `FECHADO`; manutenção continua sendo do
equipamento, nunca de um monitor isolado. Tudo registrado no spec como dívida.
