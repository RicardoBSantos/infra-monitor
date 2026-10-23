# Manutenção agendada F2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agendar manutenção a partir de Equipamentos (linha e drawer) e da Unidade, editar janela AGENDADA, alterar o fim (prorrogar/antecipar) de janela ATIVA, com registro de alterações e guardas no banco.

**Architecture:** Backend ganha `versao` e a tabela `manutencao_agendada_alteracao` (V22), uma classe JDBC `EdicaoManutencao` com `SELECT … FOR UPDATE` + UPDATE com CAS (`status` e `versao` no WHERE), e três rotas (`GET /{id}`, `PUT /{id}`, `PATCH /{id}/fim`) mais o filtro `unidadeId`. O front reaproveita `app-agendar-manutencao` com `preset` e modo edição, cria `app-alterar-fim`, e liga os pontos de entrada em Equipamentos e Unidade.

**Tech Stack:** Java 21, Spring Boot 4.1, PostgreSQL 16, Flyway, JdbcTemplate, Testcontainers (`@RequerDocker`); Angular (signals, standalone, OnPush), Vitest; Playwright (scripts `.cjs` em `infra-monitor-frontend/e2e`).

**Spec:** `Docs/superpowers/specs/2026-10-23-manutencao-agendada-f2-design.md` (decisões MA19–MA26 em `Docs/manutencao-agendada-architecture/manutencao-agendada-decisoes.md`).

## Global Constraints

- Migration nova `V22__add_versao_e_alteracoes_manutencao_agendada.sql`; **nunca editar V1–V21**.
- `ddl-auto: validate`; Hibernate nunca cria schema.
- Sem Lombok; `record` e classes explícitas; nada de `BaseService`/abstração especulativa.
- Datas `Instant`; persistência UTC.
- Erros no formato `ErroResposta`; conflito = `ConflitoException` (código `BUSINESS_CONFLICT`); validação = `IllegalArgumentException` (400); inexistente = `RecursoNaoEncontradoException` (404).
- Guarda no banco em toda transição: CAS no WHERE / `FOR UPDATE`; nunca ler-depois-escrever sem lock.
- Mensagens de backend sem acento (padrão do módulo: `Nao e possivel …`).
- Teste com `PostgreSQLContainer` leva `@RequerDocker`. Suíte sem Docker "verde com `!!`" **não** conta como validação.
- Testes concorrentes: duas threads, `CyclicBarrier`, `@RepeatedTest(30)`, linha `[corrida-<nome>] desfecho=<ROTULO>` impressa, zero `ILEGITIMO`, prova de reversão registrada no doc de evidência.
- Front: componentes compartilhados (`app-modal`, `app-confirm-dialog`, `app-status-badge`, `app-action-menu`, `.tabela`, `app-paginacao`); layout geração A; Escape fecha, foco entra ao abrir e volta ao gatilho.
- Agentes em paralelo commitam **só os próprios arquivos**: `git commit -m "…" -- <arquivos>` (index compartilhado).
- Commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Nunca usar o equipamento "Servidor AD Core" (controlador de domínio) no banco da carga.

## Review Focus

1. Edição de janela cujo equipamento vinculado foi **desativado ou movido de unidade sozinho**: salvar só o motivo deve dar 200 (Task 3, teste `editarMantemVinculadoInativoOuMovido`).
2. **Trocar a unidade** na edição com um id antigo no corpo: 400, nunca aceitar silenciosamente (Task 3, `editarTrocandoUnidadeRecusaIdAntigo`; Task 5, seleção limpa no form).
3. **Agendador desligado**: PUT de AGENDADA passa (200) e não ativa; PATCH de fim dá 409 com a mensagem do MA16 (Task 3, teste HTTP e de serviço).
4. **Prorrogar uma janela que concluiu** entre abrir o diálogo e enviar: tela troca para "Agendar continuação" e o modal de agendar abre pré-preenchido (Task 6, spec do `AlterarFimComponent`).
5. **Drawer no Mapa** não mostra "Agendar manutenção" (Task 7, spec do drawer com `acoesDeGestao=false`).

---

## File Structure

**Backend** (`infra-monitor-backend/src/main/java/br/com/inframonitor/…`)

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `resources/db/migration/V22__add_versao_e_alteracoes_manutencao_agendada.sql` | criar | `versao` + tabela de alterações |
| `manutencao/entity/ManutencaoAgendada.java` | modificar | mapear `versao` read-only |
| `manutencao/entity/TipoAlteracao.java` | criar | enum `EDICAO, PRORROGACAO, ANTECIPACAO` |
| `manutencao/repository/CoberturaManutencao.java` | modificar | `versao = versao + 1` nos 6 CAS da F1 |
| `manutencao/repository/EdicaoManutencao.java` | criar | lock+CAS de edição e de fim, registro e última alteração |
| `manutencao/repository/ManutencaoAgendadaRepository.java` | modificar | filtro `unidadeId` |
| `manutencao/dto/EditarManutencaoRequest.java`, `AlterarFimRequest.java`, `UltimaAlteracaoResponse.java` | criar | contratos |
| `manutencao/dto/ManutencaoResponse.java` | modificar | `versao`, `ultimaAlteracao` |
| `manutencao/service/ManutencaoAgendadaService.java` | modificar | `obterPorId`, `editar`, `alterarFim`, `listar(…, unidadeId, …)` |
| `manutencao/controller/ManutencaoAgendadaController.java` | modificar | rotas novas |
| `security/SecurityConfiguration.java` | modificar | PUT de `/api/v1/manutencoes/**` |

**Testes backend** (`src/test/java/br/com/inframonitor/manutencao/`): `MigracaoManutencaoAgendadaPostgresIntegrationTest` (V22), `ManutencaoAgendadaEdicaoPostgresIntegrationTest` (novo), `ManutencaoAgendadaHttpSecurityIntegrationTest` (estender), `ManutencaoAgendadaF2ConcorrenciaPostgresIntegrationTest` (novo).

**Frontend** (`infra-monitor-frontend/src/app/…`)

| Arquivo | Ação |
|---|---|
| `core/models/manutencao.ts`, `core/services/manutencao-api.service.ts` | modificar |
| `features/manutencoes/periodo.ts` | modificar (exporta `hora`, `dataHora`) |
| `features/manutencoes/agendar-manutencao.component.{ts,html,scss,spec.ts}` | modificar (preset, edição, dica) |
| `features/manutencoes/alterar-fim.component.{ts,html,scss,spec.ts}` | criar |
| `features/manutencoes/manutencao-list.component.{ts,html,spec.ts}` | modificar |
| `features/equipamentos/equipamento-list.component.{ts,html,spec.ts}`, `equipamento-detalhe-drawer.component.{ts,html}`, `equipamento-detalhe-drawer.spec.ts` | modificar |
| `features/unidades/unidade-detalhe.component.{ts,html,scss}`, `unidade-detalhe.component.spec.ts` | modificar |

**E2E/Docs:** `infra-monitor-frontend/e2e/manutencao-agendada-f2.cjs` (+ `package.json` script), `Docs/validacao-producao/manutencao-agendada-f2.md`, `Docs/manutencao-agendada-architecture/manutencao-agendada-desenho.md` (§ F2), `manutencao-agendada-pendencias.md`.

---

### Task 1: V22, `versao` e incremento nos CAS da F1

**Files:**
- Create: `infra-monitor-backend/src/main/resources/db/migration/V22__add_versao_e_alteracoes_manutencao_agendada.sql`
- Create: `infra-monitor-backend/src/main/java/br/com/inframonitor/manutencao/entity/TipoAlteracao.java`
- Modify: `…/manutencao/entity/ManutencaoAgendada.java`
- Modify: `…/manutencao/repository/CoberturaManutencao.java` (6 UPDATEs)
- Test: `…/test/…/manutencao/MigracaoManutencaoAgendadaPostgresIntegrationTest.java`

**Interfaces:**
- Produces: coluna `manutencao_agendada.versao INTEGER NOT NULL DEFAULT 0`; tabela `manutencao_agendada_alteracao(id, manutencao_id, tipo, alterado_por_id, alterado_em, antes JSONB, depois JSONB)`; `ManutencaoAgendada.getVersao(): int`; `enum TipoAlteracao { EDICAO, PRORROGACAO, ANTECIPACAO }`.

- [ ] **Step 1: Write the failing test** — no fim de `MigracaoManutencaoAgendadaPostgresIntegrationTest`, acrescentar (seguir os helpers de inserção já existentes na classe; se não houver helper de usuário/unidade, inserir por SQL como abaixo):

```java
    @Test
    void v22VersaoComecaEmZeroEAlteracaoRecusaTipoInvalido() {
        long usuario = jdbc.queryForObject("insert into usuarios (nome, email, senha_hash, papel, ativo, "
                + "troca_senha_obrigatoria) values ('V22', 'v22@mig.test', 'h', 'OPERADOR', true, false) returning id",
                Long.class);
        long unidade = jdbc.queryForObject("insert into unidade (nome, sigla, ativo) values ('V22', 'V22', true) "
                + "returning id", Long.class);
        long janela = jdbc.queryForObject("insert into manutencao_agendada (unidade_id, escopo, inicio_previsto, "
                + "fim_previsto, motivo, criado_por_id) values (?, 'UNIDADE', now() + interval '1 hour', "
                + "now() + interval '2 hour', 'x', ?) returning id", Long.class, unidade, usuario);

        assertThat(jdbc.queryForObject("select versao from manutencao_agendada where id = ?", Integer.class, janela))
                .isZero();
        jdbc.update("insert into manutencao_agendada_alteracao (manutencao_id, tipo, alterado_por_id, alterado_em, "
                + "antes, depois) values (?, 'EDICAO', ?, now(), '{}'::jsonb, '{}'::jsonb)", janela, usuario);
        assertThatThrownBy(() -> jdbc.update("insert into manutencao_agendada_alteracao (manutencao_id, tipo, "
                + "alterado_por_id, alterado_em, antes, depois) values (?, 'OUTRO', ?, now(), '{}'::jsonb, '{}'::jsonb)",
                janela, usuario))
                .hasMessageContaining("ck_manutencao_alteracao_tipo");
    }
```

Acrescentar também na classe de teste do reconciliador/serviço que já existir (`ManutencaoAgendadaServicePostgresIntegrationTest`), um teste que prova o incremento:

```java
    @Test
    void transicoesIncrementamVersao() {
        Instant inicio = Instant.now();
        ManutencaoResponse r = service.criar(requisicao(EscopoManutencao.EQUIPAMENTOS, List.of(e1), inicio,
                inicio.plus(Duration.ofHours(1)), "Versao"), operadorId);   // cria e ativa na hora
        assertThat(jdbc.queryForObject("select versao from manutencao_agendada where id = ?", Integer.class, r.id()))
                .isEqualTo(1);
        service.encerrar(r.id(), operadorId);
        assertThat(jdbc.queryForObject("select versao from manutencao_agendada where id = ?", Integer.class, r.id()))
                .isEqualTo(2);
    }
```

E acrescentar `manutencao_agendada_alteracao` no início do `truncate` do `@BeforeEach` das classes de teste do pacote `manutencao` que truncam `manutencao_agendada` (o `cascade` já cobre, mas explícito evita surpresa): `"truncate table manutencao_agendada_alteracao, manutencao_agendada_equipamento, manutencao_agendada, …"`.

- [ ] **Step 2: Run tests to verify they fail**

Run (de `infra-monitor-backend/`): `./mvnw -q test -Dtest='MigracaoManutencaoAgendadaPostgresIntegrationTest,ManutencaoAgendadaServicePostgresIntegrationTest'`
Expected: FAIL (`column "versao" does not exist` / relação inexistente). Se aparecer `!! N classes puladas: Docker indisponivel`, **pare**: Docker é obrigatório.

- [ ] **Step 3: Write the migration**

`V22__add_versao_e_alteracoes_manutencao_agendada.sql`:

```sql
-- V22 - Edicao e prorrogacao de janelas de manutencao (F2).
--
-- versao: guarda de concorrencia das edicoes (MA26). Incrementa em TODA escrita na linha,
-- inclusive nos CAS do reconciliador: quem editou sobre uma versao velha muda zero linhas.
-- manutencao_agendada_alteracao: quem mudou o que e quando (MA24). Criacao, cancelamento e
-- encerramento seguem nas colunas proprias da V21.
-- Desenho: Docs/superpowers/specs/2026-10-23-manutencao-agendada-f2-design.md

ALTER TABLE manutencao_agendada ADD COLUMN versao INTEGER NOT NULL DEFAULT 0;

CREATE TABLE manutencao_agendada_alteracao (
    id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    manutencao_id BIGINT NOT NULL REFERENCES manutencao_agendada(id) ON DELETE RESTRICT,
    tipo VARCHAR(12) NOT NULL,
    alterado_por_id BIGINT NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
    alterado_em TIMESTAMPTZ NOT NULL,
    -- Retrato dos campos editaveis: unidadeId, escopo, equipamentoIds, inicioPrevisto, fimPrevisto, motivo.
    antes JSONB NOT NULL,
    depois JSONB NOT NULL,
    CONSTRAINT ck_manutencao_alteracao_tipo CHECK (tipo IN ('EDICAO', 'PRORROGACAO', 'ANTECIPACAO'))
);

CREATE INDEX ix_manutencao_alteracao_janela
    ON manutencao_agendada_alteracao (manutencao_id, alterado_em DESC, id DESC);
```

- [ ] **Step 4: Entity and enum**

`TipoAlteracao.java`:

```java
package br.com.inframonitor.manutencao.entity;

/** Tipo de uma linha de manutencao_agendada_alteracao (MA24). */
public enum TipoAlteracao {
    EDICAO,
    PRORROGACAO,
    ANTECIPACAO
}
```

Em `ManutencaoAgendada`, depois de `updatedAt`:

```java
    // Escrita so por SQL (CAS em CoberturaManutencao e EdicaoManutencao); o banco preenche o 0.
    @Column(name = "versao", nullable = false, insertable = false, updatable = false)
    private int versao;
```

e o getter `public int getVersao() { return versao; }` junto dos demais.

Em `CoberturaManutencao`, nos seis UPDATEs (`ativarDevidas`, `ativarSeDevida`, `expirarPerdidas`, `concluirVencidas`, `cancelar`, `encerrar`), acrescentar `versao = versao + 1,` logo depois de `SET`. Exemplo:

```java
                UPDATE manutencao_agendada SET versao = versao + 1, status = 'ATIVA', ativada_em = :agora, updated_at = :agora
```

Nenhuma condição de WHERE muda. Acrescentar ao comentário de bloco "Transicoes de situacao": `Todas incrementam versao (MA26): uma edicao preparada sobre a versao anterior muda zero linhas.`

- [ ] **Step 5: Run tests to verify they pass**

Run: `./mvnw -q test -Dtest='MigracaoManutencaoAgendadaPostgresIntegrationTest,ManutencaoAgendadaServicePostgresIntegrationTest,ManutencaoAgendadaConcorrenciaPostgresIntegrationTest'`
Expected: PASS, sem `!!` de Docker.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(manutencao): V22 com versao e registro de alteracoes" -- \
  infra-monitor-backend/src/main/resources/db/migration/V22__add_versao_e_alteracoes_manutencao_agendada.sql \
  infra-monitor-backend/src/main/java/br/com/inframonitor/manutencao/entity/TipoAlteracao.java \
  infra-monitor-backend/src/main/java/br/com/inframonitor/manutencao/entity/ManutencaoAgendada.java \
  infra-monitor-backend/src/main/java/br/com/inframonitor/manutencao/repository/CoberturaManutencao.java \
  infra-monitor-backend/src/test/java/br/com/inframonitor/manutencao/
```

(`git add` dos arquivos novos antes do commit.)

---

### Task 2: `EdicaoManutencao` — lock, CAS, registro e última alteração

**Files:**
- Create: `…/manutencao/repository/EdicaoManutencao.java`
- Test: `…/test/…/manutencao/EdicaoManutencaoPostgresIntegrationTest.java`

**Interfaces:**
- Consumes: V22 (Task 1), `TipoAlteracao`.
- Produces (todos `public`, chamados dentro de uma transação do serviço):
  - `record Retrato(long unidadeId, String escopo, List<Long> equipamentoIds, Instant inicioPrevisto, Instant fimPrevisto, String motivo)` com `Retrato comFim(Instant fim)`.
  - `record EstadoAtual(String status, int versao)`.
  - `record Ultima(long manutencaoId, TipoAlteracao tipo, long porId, String porNome, Instant em)`.
  - `Optional<Retrato> travar(long id, String status, int versao)` — `SELECT … FOR UPDATE` com `status` e `versao` no WHERE.
  - `Optional<EstadoAtual> estado(long id)`.
  - `boolean gravarEdicao(long id, int versao, Retrato novo, Instant agora)` — CAS `status='AGENDADA' AND versao`; troca a ligação.
  - `boolean gravarFim(long id, int versao, Instant novoFim, Instant agora, Duration maxima)` — CAS `status='ATIVA' AND versao AND :novoFim > :agora AND inicio_previsto >= :novoFim - maxima`.
  - `void registrar(long id, TipoAlteracao tipo, long usuarioId, Instant agora, Retrato antes, Retrato depois)`.
  - `Map<Long, Ultima> ultimas(Collection<Long> ids)`.

- [ ] **Step 1: Write the failing test** — `EdicaoManutencaoPostgresIntegrationTest` com a mesma anotação/propriedades de `ManutencaoAgendadaServicePostgresIntegrationTest` (copiar o bloco `@RequerDocker @SpringBootTest(properties = {...})`, o container e o `@DynamicPropertySource`), e:

```java
    @Autowired private JdbcTemplate jdbc;
    @Autowired private EdicaoManutencao edicao;
    @Autowired private PlatformTransactionManager tm;

    private long operador, u, outra, e1, e2;

    @BeforeEach
    void cenario() {
        jdbc.execute("truncate table manutencao_agendada_alteracao, manutencao_agendada_equipamento, manutencao_agendada, "
                + "equipamento, tipo_equipamento, unidade, usuarios restart identity cascade");
        operador = id("insert into usuarios (nome, email, senha_hash, papel, ativo, troca_senha_obrigatoria) "
                + "values ('Ana', 'ana@edicao.test', 'h', 'OPERADOR', true, false) returning id");
        long tipo = id("insert into tipo_equipamento (nome, ativo) values ('Switch', true) returning id");
        u = id("insert into unidade (nome, sigla, ativo) values ('Centro', 'CTR', true) returning id");
        outra = id("insert into unidade (nome, sigla, ativo) values ('Norte', 'NRT', true) returning id");
        e1 = id("insert into equipamento (unidade_id, tipo_equipamento_id, nome, ativo, em_manutencao) "
                + "values (" + u + ", " + tipo + ", 'SW-01', true, false) returning id");
        e2 = id("insert into equipamento (unidade_id, tipo_equipamento_id, nome, ativo, em_manutencao) "
                + "values (" + outra + ", " + tipo + ", 'SW-02', true, false) returning id");
    }

    @Test
    void travarExigeStatusEVersao() {
        long j = janela("AGENDADA", e1);
        TransactionTemplate tx = new TransactionTemplate(tm);
        assertThat(tx.execute(s -> edicao.travar(j, "AGENDADA", 0))).hasValueSatisfying(r -> {
            assertThat(r.unidadeId()).isEqualTo(u);
            assertThat(r.equipamentoIds()).containsExactly(e1);
            assertThat(r.motivo()).isEqualTo("Original");
        });
        assertThat(tx.execute(s -> edicao.travar(j, "AGENDADA", 1))).isEmpty();
        assertThat(tx.execute(s -> edicao.travar(j, "ATIVA", 0))).isEmpty();
        assertThat(tx.execute(s -> edicao.estado(j))).contains(new EdicaoManutencao.EstadoAtual("AGENDADA", 0));
    }

    @Test
    void gravarEdicaoTrocaLigacaoEIncrementaVersao() {
        long j = janela("AGENDADA", e1);
        Instant agora = Instant.now();
        var novo = new EdicaoManutencao.Retrato(outra, "EQUIPAMENTOS", List.of(e2), agora.plusSeconds(3600),
                agora.plusSeconds(7200), "Novo");
        TransactionTemplate tx = new TransactionTemplate(tm);
        assertThat(tx.execute(s -> edicao.gravarEdicao(j, 0, novo, agora))).isTrue();
        assertThat(tx.execute(s -> edicao.gravarEdicao(j, 0, novo, agora))).as("versao velha").isFalse();
        assertThat(jdbc.queryForList("select equipamento_id from manutencao_agendada_equipamento where manutencao_id = ?",
                Long.class, j)).containsExactly(e2);
        assertThat(jdbc.queryForMap("select unidade_id, motivo, versao from manutencao_agendada where id = ?", j))
                .containsEntry("unidade_id", outra).containsEntry("motivo", "Novo").containsEntry("versao", 1);
    }

    @Test
    void gravarFimRespeitaTetoEAgora() {
        long j = janela("ATIVA", e1);   // inicio = agora - 1 min
        Instant agora = Instant.now();
        TransactionTemplate tx = new TransactionTemplate(tm);
        Duration max = Duration.ofHours(72);
        assertThat(tx.execute(s -> edicao.gravarFim(j, 0, agora.plus(Duration.ofHours(73)), agora, max))).isFalse();
        assertThat(tx.execute(s -> edicao.gravarFim(j, 0, agora.minusSeconds(1), agora, max))).isFalse();
        assertThat(tx.execute(s -> edicao.gravarFim(j, 0, agora.plus(Duration.ofHours(2)), agora, max))).isTrue();
    }

    @Test
    void registrarEUltimaPorJanela() {
        long j = janela("AGENDADA", e1);
        Instant t = Instant.now().truncatedTo(ChronoUnit.MICROS);
        var r = new EdicaoManutencao.Retrato(u, "EQUIPAMENTOS", List.of(e1), t, t.plusSeconds(60), "x");
        TransactionTemplate tx = new TransactionTemplate(tm);
        tx.executeWithoutResult(s -> edicao.registrar(j, TipoAlteracao.EDICAO, operador, t, r, r.comFim(t.plusSeconds(90))));
        tx.executeWithoutResult(s -> edicao.registrar(j, TipoAlteracao.PRORROGACAO, operador, t.plusSeconds(5), r, r));
        assertThat(edicao.ultimas(List.of(j))).containsOnlyKeys(j).extractingByKey(j)
                .satisfies(x -> {
                    assertThat(x.tipo()).isEqualTo(TipoAlteracao.PRORROGACAO);
                    assertThat(x.porNome()).isEqualTo("Ana");
                });
        assertThat(jdbc.queryForObject("select depois->>'fimPrevisto' from manutencao_agendada_alteracao "
                + "where tipo = 'EDICAO'", String.class)).isEqualTo(t.plusSeconds(90).toString());
        assertThat(edicao.ultimas(List.of())).isEmpty();
    }

    private long janela(String status, long equipamento) {
        Instant inicio = "ATIVA".equals(status) ? Instant.now().minusSeconds(60) : Instant.now().plusSeconds(3600);
        long j = jdbc.queryForObject("insert into manutencao_agendada (unidade_id, escopo, inicio_previsto, fim_previsto, "
                + "motivo, status, criado_por_id, ativada_em) values (?, 'EQUIPAMENTOS', ?, ?, 'Original', ?, ?, ?) returning id",
                Long.class, u, Timestamp.from(inicio), Timestamp.from(inicio.plusSeconds(3600)), status, operador,
                "ATIVA".equals(status) ? Timestamp.from(inicio) : null);
        jdbc.update("insert into manutencao_agendada_equipamento values (?, ?)", j, equipamento);
        return j;
    }

    private long id(String sql) { return jdbc.queryForObject(sql, Long.class); }
```

- [ ] **Step 2: Run to verify it fails**

Run: `./mvnw -q test -Dtest=EdicaoManutencaoPostgresIntegrationTest`
Expected: FAIL de compilação (`EdicaoManutencao` não existe).

- [ ] **Step 3: Implement `EdicaoManutencao`**

```java
package br.com.inframonitor.manutencao.repository;

import br.com.inframonitor.manutencao.entity.TipoAlteracao;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.core.namedparam.SqlParameterSource;
import org.springframework.stereotype.Repository;
import tools.jackson.databind.ObjectMapper;

import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Edicao de janelas (F2). Cada operacao roda DENTRO da transacao do servico: primeiro
 * {@link #travar} (FOR UPDATE com status e versao no WHERE), depois o UPDATE com as mesmas
 * condicoes como segunda guarda. O reconciliador disputa o mesmo lock de linha; quem chega
 * depois reavalia o proprio WHERE contra a versao commitada (MA26).
 */
@Repository
public class EdicaoManutencao {

    private final NamedParameterJdbcTemplate jdbc;
    private final ObjectMapper json;

    public EdicaoManutencao(NamedParameterJdbcTemplate jdbc, ObjectMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    /** Campos editaveis, como vao para o JSONB antes/depois. Ids ordenados. */
    public record Retrato(long unidadeId, String escopo, List<Long> equipamentoIds, Instant inicioPrevisto,
                          Instant fimPrevisto, String motivo) {
        public Retrato comFim(Instant fim) {
            return new Retrato(unidadeId, escopo, equipamentoIds, inicioPrevisto, fim, motivo);
        }
    }

    public record EstadoAtual(String status, int versao) { }

    public record Ultima(long manutencaoId, TipoAlteracao tipo, long porId, String porNome, Instant em) { }

    /** Trava a linha so se ainda estiver em {@code status} e na {@code versao} lida pela tela. */
    public Optional<Retrato> travar(long id, String status, int versao) {
        List<Retrato> linhas = jdbc.query("""
                SELECT unidade_id, escopo, inicio_previsto, fim_previsto, motivo FROM manutencao_agendada
                 WHERE id = :id AND status = :status AND versao = :versao
                 FOR UPDATE""",
                Map.of("id", id, "status", status, "versao", versao),
                (rs, i) -> new Retrato(rs.getLong("unidade_id"), rs.getString("escopo"), List.of(),
                        rs.getTimestamp("inicio_previsto").toInstant(), rs.getTimestamp("fim_previsto").toInstant(),
                        rs.getString("motivo")));
        if (linhas.isEmpty()) {
            return Optional.empty();
        }
        Retrato r = linhas.get(0);
        List<Long> ids = jdbc.queryForList("SELECT equipamento_id FROM manutencao_agendada_equipamento "
                + "WHERE manutencao_id = :id ORDER BY equipamento_id", Map.of("id", id), Long.class);
        return Optional.of(new Retrato(r.unidadeId(), r.escopo(), ids, r.inicioPrevisto(), r.fimPrevisto(), r.motivo()));
    }

    /** So para escolher a mensagem de recusa depois que {@link #travar} voltou vazio. */
    public Optional<EstadoAtual> estado(long id) {
        return jdbc.query("SELECT status, versao FROM manutencao_agendada WHERE id = :id", Map.of("id", id),
                (rs, i) -> new EstadoAtual(rs.getString("status"), rs.getInt("versao"))).stream().findFirst();
    }

    public boolean gravarEdicao(long id, int versao, Retrato novo, Instant agora) {
        int linhas = jdbc.update("""
                UPDATE manutencao_agendada
                   SET unidade_id = :unidade, escopo = :escopo, inicio_previsto = :inicio, fim_previsto = :fim,
                       motivo = :motivo, versao = versao + 1, updated_at = :agora
                 WHERE id = :id AND status = 'AGENDADA' AND versao = :versao""",
                new MapSqlParameterSource().addValue("id", id).addValue("versao", versao)
                        .addValue("unidade", novo.unidadeId()).addValue("escopo", novo.escopo())
                        .addValue("inicio", ts(novo.inicioPrevisto())).addValue("fim", ts(novo.fimPrevisto()))
                        .addValue("motivo", novo.motivo()).addValue("agora", ts(agora)));
        if (linhas != 1) {
            return false;
        }
        jdbc.update("DELETE FROM manutencao_agendada_equipamento WHERE manutencao_id = :id", Map.of("id", id));
        SqlParameterSource[] ligacoes = novo.equipamentoIds().stream()
                .map(e -> new MapSqlParameterSource().addValue("id", id).addValue("e", e))
                .toArray(SqlParameterSource[]::new);
        if (ligacoes.length > 0) {
            jdbc.batchUpdate("INSERT INTO manutencao_agendada_equipamento (manutencao_id, equipamento_id) "
                    + "VALUES (:id, :e)", ligacoes);
        }
        return true;
    }

    /** Teto no WHERE (MA23): inicio_previsto >= novoFim - maxima equivale a novoFim - inicio <= maxima. */
    public boolean gravarFim(long id, int versao, Instant novoFim, Instant agora, Duration maxima) {
        return jdbc.update("""
                UPDATE manutencao_agendada SET fim_previsto = :fim, versao = versao + 1, updated_at = :agora
                 WHERE id = :id AND status = 'ATIVA' AND versao = :versao
                   AND :fim > :agora AND inicio_previsto >= :inicioMinimo""",
                new MapSqlParameterSource().addValue("id", id).addValue("versao", versao)
                        .addValue("fim", ts(novoFim)).addValue("agora", ts(agora))
                        .addValue("inicioMinimo", ts(novoFim.minus(maxima)))) == 1;
    }

    public void registrar(long id, TipoAlteracao tipo, long usuarioId, Instant agora, Retrato antes, Retrato depois) {
        jdbc.update("""
                INSERT INTO manutencao_agendada_alteracao (manutencao_id, tipo, alterado_por_id, alterado_em, antes, depois)
                VALUES (:id, :tipo, :u, :agora, CAST(:antes AS jsonb), CAST(:depois AS jsonb))""",
                new MapSqlParameterSource().addValue("id", id).addValue("tipo", tipo.name()).addValue("u", usuarioId)
                        .addValue("agora", ts(agora)).addValue("antes", json.writeValueAsString(antes))
                        .addValue("depois", json.writeValueAsString(depois)));
    }

    /** Ultima alteracao de cada janela, uma consulta por pagina. */
    public Map<Long, Ultima> ultimas(Collection<Long> ids) {
        if (ids.isEmpty()) {
            return Map.of();
        }
        Map<Long, Ultima> resultado = new LinkedHashMap<>();
        jdbc.query("""
                SELECT DISTINCT ON (a.manutencao_id) a.manutencao_id, a.tipo, a.alterado_em, u.id AS por_id, u.nome
                  FROM manutencao_agendada_alteracao a JOIN usuarios u ON u.id = a.alterado_por_id
                 WHERE a.manutencao_id IN (:ids)
                 ORDER BY a.manutencao_id, a.alterado_em DESC, a.id DESC""", Map.of("ids", ids),
                (rs, i) -> new Ultima(rs.getLong("manutencao_id"), TipoAlteracao.valueOf(rs.getString("tipo")),
                        rs.getLong("por_id"), rs.getString("nome"), rs.getTimestamp("alterado_em").toInstant()))
                .forEach(x -> resultado.put(x.manutencaoId(), x));
        return resultado;
    }

    private static Timestamp ts(Instant instante) {
        return Timestamp.from(instante);
    }
}
```

Se o bean Jackson 3 não serializar `Instant` em ISO-8601 (`depois->>'fimPrevisto'` diferente de `Instant.toString()`), ajustar o teste para comparar via `Instant.parse` — não trocar o formato do mapper global.

- [ ] **Step 4: Run to verify it passes**

Run: `./mvnw -q test -Dtest=EdicaoManutencaoPostgresIntegrationTest`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add infra-monitor-backend/src/main/java/br/com/inframonitor/manutencao/repository/EdicaoManutencao.java \
  infra-monitor-backend/src/test/java/br/com/inframonitor/manutencao/EdicaoManutencaoPostgresIntegrationTest.java
git commit -m "feat(manutencao): lock e CAS de edicao e de fim com registro" -- \
  infra-monitor-backend/src/main/java/br/com/inframonitor/manutencao/repository/EdicaoManutencao.java \
  infra-monitor-backend/src/test/java/br/com/inframonitor/manutencao/EdicaoManutencaoPostgresIntegrationTest.java
```

---

### Task 3: Serviço, API e segurança (editar, alterar fim, obter, filtro por unidade)

**Files:**
- Create: `…/manutencao/dto/EditarManutencaoRequest.java`, `AlterarFimRequest.java`, `UltimaAlteracaoResponse.java`
- Modify: `…/manutencao/dto/ManutencaoResponse.java`, `…/service/ManutencaoAgendadaService.java`, `…/controller/ManutencaoAgendadaController.java`, `…/repository/ManutencaoAgendadaRepository.java`, `…/security/SecurityConfiguration.java`
- Test: create `…/test/…/manutencao/ManutencaoAgendadaEdicaoPostgresIntegrationTest.java`; modify `ManutencaoAgendadaHttpSecurityIntegrationTest.java`

**Interfaces:**
- Consumes: `EdicaoManutencao` (Task 2).
- Produces (contrato HTTP consumido pelo front, Task 5):
  - `GET /api/v1/manutencoes?situacao&busca&unidadeId&page&size`
  - `GET /api/v1/manutencoes/{id}` → `ManutencaoResponse`
  - `PUT /api/v1/manutencoes/{id}` body `{unidadeId, escopo, equipamentoIds, inicioPrevisto, fimPrevisto, motivo, versao}` → `ManutencaoResponse`
  - `PATCH /api/v1/manutencoes/{id}/fim` body `{fimPrevisto, versao}` → `ManutencaoResponse`
  - `ManutencaoResponse` ganha, no fim: `int versao`, `UltimaAlteracaoResponse ultimaAlteracao` (`{tipo, por:{id,nome}, em}` ou `null`).
  - Service: `ManutencaoResponse obterPorId(Long id)`, `ManutencaoResponse editar(Long id, EditarManutencaoRequest req, Long usuarioId)`, `ManutencaoResponse alterarFim(Long id, AlterarFimRequest req, Long usuarioId)`, `Page<ManutencaoResponse> listar(String situacao, String busca, Long unidadeId, Pageable pageable)`.
  - Mensagens exatas (o e2e e os specs do front usam):
    - editar não-AGENDADA: `Nao e possivel editar: a janela esta <SITUACAO>.` + (se ATIVA) ` Use Alterar fim.`
    - versão divergente: `A janela foi alterada por outra pessoa. Recarregue e tente de novo.`
    - alterar fim não-ATIVA: `Nao e possivel alterar o fim: a janela esta <SITUACAO>.` + (se CONCLUIDA) ` Agende uma continuacao.`
    - fim no passado: `O novo fim ja passou. Para terminar agora use Encerrar agora`
    - fim igual: `O novo fim e igual ao atual`
    - teto: `A janela nao pode passar de <N> horas desde o inicio`

- [ ] **Step 1: DTOs**

```java
package br.com.inframonitor.manutencao.dto;

import br.com.inframonitor.manutencao.entity.EscopoManutencao;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

import java.time.Instant;
import java.util.List;

/** Objeto completo, sem PATCH parcial (MA21): ausente nunca significa "manter". */
public record EditarManutencaoRequest(
        @NotNull Long unidadeId,
        @NotNull EscopoManutencao escopo,
        List<Long> equipamentoIds,
        @NotNull Instant inicioPrevisto,
        @NotNull Instant fimPrevisto,
        @NotBlank @Size(max = 300) String motivo,
        @NotNull @PositiveOrZero Integer versao) {
}
```

```java
package br.com.inframonitor.manutencao.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;

import java.time.Instant;

public record AlterarFimRequest(@NotNull Instant fimPrevisto, @NotNull @PositiveOrZero Integer versao) {
}
```

```java
package br.com.inframonitor.manutencao.dto;

import br.com.inframonitor.equipamento.dto.ReferenciaResponse;
import br.com.inframonitor.manutencao.entity.TipoAlteracao;

import java.time.Instant;

public record UltimaAlteracaoResponse(TipoAlteracao tipo, ReferenciaResponse por, Instant em) {
}
```

`ManutencaoResponse`: acrescentar no fim `int versao, UltimaAlteracaoResponse ultimaAlteracao`.

- [ ] **Step 2: Write the failing service tests** — `ManutencaoAgendadaEdicaoPostgresIntegrationTest`: copiar cabeçalho, container, `@BeforeEach` e helpers (`requisicao`, `equipamento`, `insert`, `emManutencao`) de `ManutencaoAgendadaServicePostgresIntegrationTest` (mesmo cenário: `u`, `norte`, `e1`, `e2`, `eNorte`, `eInativo`, `monitor`), mais `@Autowired ManutencaoAgendadaProperties propriedades;`. Testes:

```java
    private EditarManutencaoRequest edicao(ManutencaoResponse j, long unidadeId, EscopoManutencao escopo,
                                           List<Long> ids, Instant inicio, Instant fim, String motivo) {
        return new EditarManutencaoRequest(unidadeId, escopo, ids, inicio, fim, motivo, j.versao());
    }

    private ManutencaoResponse futura(List<Long> ids) {
        Instant inicio = Instant.now().plus(Duration.ofHours(2)).truncatedTo(ChronoUnit.SECONDS);
        return service.criar(requisicao(EscopoManutencao.EQUIPAMENTOS, ids, inicio, inicio.plus(Duration.ofHours(1)),
                "Original"), operadorId);
    }

    @Test
    void editarAgendadaTrocaTudoERegistra() {
        ManutencaoResponse j = futura(List.of(e1));
        Instant inicio = j.inicioPrevisto().plus(Duration.ofHours(1));
        ManutencaoResponse r = service.editar(j.id(), edicao(j, u, EscopoManutencao.EQUIPAMENTOS, List.of(e2, e1),
                inicio, inicio.plus(Duration.ofHours(3)), " Novo motivo "), operadorId);

        assertThat(r.motivo()).isEqualTo("Novo motivo");
        assertThat(r.equipamentos()).extracting(ReferenciaResponse::id).containsExactly(e1, e2);
        assertThat(r.versao()).isEqualTo(1);
        assertThat(r.ultimaAlteracao().tipo()).isEqualTo(TipoAlteracao.EDICAO);
        assertThat(r.ultimaAlteracao().por()).isEqualTo(new ReferenciaResponse(operadorId, "Operador"));
        assertThat(jdbc.queryForObject("select antes->>'motivo' from manutencao_agendada_alteracao where manutencao_id = ?",
                String.class, j.id())).isEqualTo("Original");
    }

    @Test
    void editarComVersaoVelhaDa409() {
        ManutencaoResponse j = futura(List.of(e1));
        service.editar(j.id(), edicao(j, u, EscopoManutencao.UNIDADE, List.of(), j.inicioPrevisto(), j.fimPrevisto(), "A"),
                operadorId);
        assertThatThrownBy(() -> service.editar(j.id(), edicao(j, u, EscopoManutencao.UNIDADE, List.of(),
                j.inicioPrevisto(), j.fimPrevisto(), "B"), operadorId))
                .isInstanceOf(ConflitoException.class)
                .hasMessage("A janela foi alterada por outra pessoa. Recarregue e tente de novo.");
    }

    @Test
    void editarAtivaDa409ComUseAlterarFim() {
        Instant agora = Instant.now();
        ManutencaoResponse j = service.criar(requisicao(EscopoManutencao.EQUIPAMENTOS, List.of(e1), agora,
                agora.plus(Duration.ofHours(1)), "Ativa"), operadorId);
        ManutencaoResponse atual = service.obterPorId(j.id());
        assertThatThrownBy(() -> service.editar(j.id(), edicao(atual, u, EscopoManutencao.EQUIPAMENTOS, List.of(e1),
                atual.inicioPrevisto(), atual.fimPrevisto(), "X"), operadorId))
                .isInstanceOf(ConflitoException.class)
                .hasMessage("Nao e possivel editar: a janela esta ATIVA. Use Alterar fim.");
    }

    /** MA21, caso 1: a JANELA mudou de alvo. Id da unidade antiga e recusado. */
    @Test
    void editarTrocandoUnidadeRecusaIdAntigo() {
        ManutencaoResponse j = futura(List.of(e1));
        assertThatThrownBy(() -> service.editar(j.id(), edicao(j, norte, EscopoManutencao.EQUIPAMENTOS, List.of(e1),
                j.inicioPrevisto(), j.fimPrevisto(), "Outra unidade"), operadorId))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("O equipamento SW-01 nao pertence a unidade");
        ManutencaoResponse ok = service.editar(j.id(), edicao(j, norte, EscopoManutencao.EQUIPAMENTOS, List.of(eNorte),
                j.inicioPrevisto(), j.fimPrevisto(), "Outra unidade"), operadorId);
        assertThat(ok.unidade().id()).isEqualTo(norte);
    }

    /** MA21, caso 2: o EQUIPAMENTO mudou sozinho; a janela nao mudou de unidade. Continua. */
    @Test
    void editarMantemVinculadoInativoOuMovido() {
        ManutencaoResponse j = futura(List.of(e1, e2));
        jdbc.update("update equipamento set ativo = false where id = ?", e1);
        jdbc.update("update equipamento set unidade_id = ? where id = ?", norte, e2);
        ManutencaoResponse r = service.editar(j.id(), edicao(j, u, EscopoManutencao.EQUIPAMENTOS, List.of(e1, e2),
                j.inicioPrevisto(), j.fimPrevisto(), "So o motivo"), operadorId);
        assertThat(r.equipamentos()).extracting(ReferenciaResponse::id).containsExactlyInAnyOrder(e1, e2);
        // Id NOVO continua passando pelas regras: inativo recusado.
        ManutencaoResponse atual = service.obterPorId(j.id());
        assertThatThrownBy(() -> service.editar(j.id(), edicao(atual, u, EscopoManutencao.EQUIPAMENTOS,
                List.of(e1, e2, eInativo), atual.inicioPrevisto(), atual.fimPrevisto(), "x"), operadorId))
                .isInstanceOf(ConflitoException.class);
    }

    @Test
    void editarComInicioAgoraAtivaNaHora() {
        ManutencaoResponse j = futura(List.of(e1));
        Instant agora = Instant.now();
        ManutencaoResponse r = service.editar(j.id(), edicao(j, u, EscopoManutencao.EQUIPAMENTOS, List.of(e1), agora,
                agora.plus(Duration.ofHours(1)), "Agora"), operadorId);
        assertThat(r.situacao()).isEqualTo(SituacaoManutencao.ATIVA);
        assertThat(emManutencao(e1)).isTrue();
    }

    /** MA25: agendador desligado edita a AGENDADA mas NAO ativa, mesmo com inicio agora. */
    @Test
    void editarComAgendadorDesligadoNaoAtiva() {
        ManutencaoResponse j = futura(List.of(e1));
        propriedades.setEnabled(false);
        try {
            Instant agora = Instant.now();
            ManutencaoResponse r = service.editar(j.id(), edicao(j, u, EscopoManutencao.EQUIPAMENTOS, List.of(e1),
                    agora, agora.plus(Duration.ofHours(1)), "Desligado"), operadorId);
            assertThat(r.situacao()).isEqualTo(SituacaoManutencao.AGENDADA);
            assertThat(emManutencao(e1)).isFalse();
        } finally {
            propriedades.setEnabled(true);
        }
    }

    @Test
    void editarRecusaInicioNoPassadoComoNaCriacao() {
        ManutencaoResponse j = futura(List.of(e1));
        Instant passado = Instant.now().minus(Duration.ofHours(1));
        assertThatThrownBy(() -> service.editar(j.id(), edicao(j, u, EscopoManutencao.EQUIPAMENTOS, List.of(e1), passado,
                passado.plus(Duration.ofHours(2)), "x"), operadorId))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Nao e possivel agendar manutencao com inicio no passado");
    }

    @Test
    void alterarFimProrrogaAntecipaERespeitaTeto() {
        Instant agora = Instant.now();
        ManutencaoResponse j = service.criar(requisicao(EscopoManutencao.EQUIPAMENTOS, List.of(e1), agora,
                agora.plus(Duration.ofHours(1)), "Ativa"), operadorId);
        ManutencaoResponse a = service.obterPorId(j.id());

        ManutencaoResponse p = service.alterarFim(j.id(), new AlterarFimRequest(a.fimPrevisto().plus(Duration.ofHours(1)),
                a.versao()), operadorId);
        assertThat(p.ultimaAlteracao().tipo()).isEqualTo(TipoAlteracao.PRORROGACAO);
        assertThat(p.inicioPrevisto()).isEqualTo(a.inicioPrevisto());

        ManutencaoResponse an = service.alterarFim(j.id(), new AlterarFimRequest(agora.plus(Duration.ofMinutes(30)),
                p.versao()), operadorId);
        assertThat(an.ultimaAlteracao().tipo()).isEqualTo(TipoAlteracao.ANTECIPACAO);

        assertThatThrownBy(() -> service.alterarFim(j.id(), new AlterarFimRequest(
                a.inicioPrevisto().plus(Duration.ofHours(72)).plusSeconds(1), an.versao()), operadorId))
                .hasMessage("A janela nao pode passar de 72 horas desde o inicio");
        assertThatThrownBy(() -> service.alterarFim(j.id(), new AlterarFimRequest(Instant.now().minusSeconds(1),
                an.versao()), operadorId))
                .hasMessage("O novo fim ja passou. Para terminar agora use Encerrar agora");
        assertThat(emManutencao(e1)).isTrue();
    }

    @Test
    void alterarFimDeConcluidaDa409ComContinuacao() {
        Instant agora = Instant.now();
        ManutencaoResponse j = service.criar(requisicao(EscopoManutencao.EQUIPAMENTOS, List.of(e1), agora,
                agora.plus(Duration.ofHours(1)), "Ativa"), operadorId);
        int versao = service.obterPorId(j.id()).versao();
        service.encerrar(j.id(), operadorId);
        assertThatThrownBy(() -> service.alterarFim(j.id(), new AlterarFimRequest(agora.plus(Duration.ofHours(2)),
                versao), operadorId))
                .isInstanceOf(ConflitoException.class)
                .hasMessage("Nao e possivel alterar o fim: a janela esta CONCLUIDA. Agende uma continuacao.");
    }

    @Test
    void alterarFimComAgendadorDesligadoDa409() {
        Instant agora = Instant.now();
        ManutencaoResponse j = service.criar(requisicao(EscopoManutencao.EQUIPAMENTOS, List.of(e1), agora,
                agora.plus(Duration.ofHours(1)), "Ativa"), operadorId);
        propriedades.setEnabled(false);
        try {
            assertThatThrownBy(() -> service.alterarFim(j.id(), new AlterarFimRequest(agora.plus(Duration.ofHours(2)), 1),
                    operadorId))
                    .isInstanceOf(ConflitoException.class).hasMessageContaining("MANUTENCAO_AGENDADA_ENABLED=true");
        } finally {
            propriedades.setEnabled(true);
        }
    }

    @Test
    void listarPorUnidadeEUltimaAlteracaoNaPagina() {
        ManutencaoResponse centro = futura(List.of(e1));
        Instant inicio = Instant.now().plus(Duration.ofHours(3));
        service.criar(requisicao(norte, EscopoManutencao.UNIDADE, null, inicio, inicio.plus(Duration.ofHours(1)), "Norte"),
                operadorId);
        service.editar(centro.id(), edicao(centro, u, EscopoManutencao.EQUIPAMENTOS, List.of(e1),
                centro.inicioPrevisto(), centro.fimPrevisto(), "Editada"), operadorId);

        Page<ManutencaoResponse> soCentro = service.listar("VIGENTES", "", u, PAGINA);
        assertThat(soCentro.getContent()).extracting(ManutencaoResponse::id).containsExactly(centro.id());
        assertThat(soCentro.getContent().get(0).ultimaAlteracao()).isNotNull();
        assertThat(service.listar("VIGENTES", "", null, PAGINA).getTotalElements()).isEqualTo(2);
        assertThat(service.obterPorId(centro.id()).motivo()).isEqualTo("Editada");
        assertThatThrownBy(() -> service.obterPorId(9999L)).isInstanceOf(RecursoNaoEncontradoException.class);
    }
```

`requisicao(norte, …)`: se o helper de `ManutencaoAgendadaServicePostgresIntegrationTest` só aceitar a unidade `u`, criar no novo teste a sobrecarga `requisicao(long unidade, EscopoManutencao escopo, List<Long> ids, Instant inicio, Instant fim, String motivo)` e fazer a de 5 argumentos delegar com `u`. As chamadas existentes de `service.listar(situacao, busca, pageable)` nos testes da F1 passam a `service.listar(situacao, busca, null, pageable)`.

- [ ] **Step 3: Run to verify it fails**

Run: `./mvnw -q test -Dtest=ManutencaoAgendadaEdicaoPostgresIntegrationTest`
Expected: FAIL de compilação (`editar`, `alterarFim`, `obterPorId` inexistentes).

- [ ] **Step 4: Repository filter** — em `ManutencaoAgendadaRepository.FILTRO`, acrescentar o filtro por unidade (0 = todas; evita parâmetro nulo sem tipo no Postgres):

```java
    String FILTRO = " where m.situacao in :situacoes and (:unidadeId = 0 or u.id = :unidadeId)"
            + " and (lower(u.nome) like :busca escape '\\' or lower(m.motivo) like :busca escape '\\')";
```

e `@Param("unidadeId") long unidadeId` em `vigentes` e `historico` (antes de `Pageable`).

- [ ] **Step 5: Service** — em `ManutencaoAgendadaService`:

1. Injetar `EdicaoManutencao edicao` no construtor (novo campo `private final EdicaoManutencao edicao;`).
2. Refatorar validação para servir criação e edição (mesmas mensagens de hoje):

```java
    /** Resultado da validacao comum a criar e editar. */
    private record Validado(Unidade unidade, Set<Equipamento> equipamentos, String motivo) { }

    private Validado validar(Long unidadeId, EscopoManutencao escopo, List<Long> equipamentoIds, Instant inicio,
                             Instant fim, String motivoBruto, Set<Long> jaVinculados, Instant agora) {
        Unidade unidade = unidades.findById(unidadeId)
                .orElseThrow(() -> new RecursoNaoEncontradoException("Unidade nao encontrada"));
        if (!unidade.isAtivo()) {
            throw new ConflitoException("Nao e possivel agendar manutencao em unidade inativa");
        }
        String motivo = motivoBruto == null ? "" : motivoBruto.strip();
        if (motivo.isEmpty()) {
            throw new IllegalArgumentException("Informe o motivo da manutencao");
        }
        if (!fim.isAfter(inicio)) {
            throw new IllegalArgumentException("O fim da janela deve ser depois do inicio");
        }
        if (inicio.isBefore(agora.minus(TOLERANCIA_PASSADO))) {
            throw new IllegalArgumentException("Nao e possivel agendar manutencao com inicio no passado");
        }
        Duration maxima = propriedades.getDuracaoMaxima();
        if (Duration.between(inicio, fim).compareTo(maxima) > 0) {
            throw new IllegalArgumentException("A janela nao pode passar de " + maxima.toHours() + " horas");
        }
        return new Validado(unidade, equipamentosDoEscopo(escopo, equipamentoIds, unidade, jaVinculados), motivo);
    }
```

`validarEMontar(req, usuarioId, agora)` passa a chamar `validar(req.unidadeId(), req.escopo(), req.equipamentoIds(), req.inicioPrevisto(), req.fimPrevisto(), req.motivo(), Set.of(), agora)` e montar a entidade com `v.unidade()`, `v.motivo()`, `v.equipamentos()`.

`equipamentosDoEscopo(EscopoManutencao escopo, List<Long> idsBrutos, Unidade unidade, Set<Long> jaVinculados)`: mesmo corpo de hoje (com `escopo` e `idsBrutos` no lugar de `req.*`), e no laço:

```java
            // MA21: ja vinculado e a unidade da janela nao mudou -> continua mesmo inativo ou movido.
            if (!jaVinculados.contains(id)) {
                if (!equipamento.getUnidade().getId().equals(unidade.getId())) { … mesma mensagem … }
                if (!equipamento.isAtivo()) { … mesma mensagem … }
            }
```

3. Métodos novos:

```java
    public ManutencaoResponse obterPorId(Long id) {
        return detalhar(id);
    }

    /**
     * Edita uma AGENDADA (MA21). Lock e CAS na transacao (MA26); a ativacao imediata vem depois do
     * commit e so com o agendador ligado (MA25): desligado, nada ativaria uma janela que nada encerra.
     */
    public ManutencaoResponse editar(Long id, EditarManutencaoRequest req, Long usuarioId) {
        Instant agora = Instant.now();
        transacao.executeWithoutResult(s -> {
            EdicaoManutencao.Retrato antes = edicao.travar(id, SituacaoManutencao.AGENDADA.name(), req.versao())
                    .orElseThrow(() -> recusaEdicao(id, req.versao(), SituacaoManutencao.AGENDADA));
            boolean mesmaUnidade = antes.unidadeId() == req.unidadeId();
            Validado v = validar(req.unidadeId(), req.escopo(), req.equipamentoIds(), req.inicioPrevisto(),
                    req.fimPrevisto(), req.motivo(),
                    mesmaUnidade ? new LinkedHashSet<>(antes.equipamentoIds()) : Set.of(), agora);
            EdicaoManutencao.Retrato depois = new EdicaoManutencao.Retrato(v.unidade().getId(), req.escopo().name(),
                    v.equipamentos().stream().map(Equipamento::getId).sorted().toList(), req.inicioPrevisto(),
                    req.fimPrevisto(), v.motivo());
            if (!edicao.gravarEdicao(id, req.versao(), depois, agora)) {
                throw new IllegalStateException("Janela " + id + " mudou sob lock");
            }
            edicao.registrar(id, TipoAlteracao.EDICAO, usuarioId, agora, antes, depois);
        });
        if (propriedades.isEnabled()) {
            try {
                if (Boolean.TRUE.equals(transacao.execute(s -> cobertura.ativarSeDevida(id, Instant.now())))) {
                    reavaliarCobertos(id);
                }
            } catch (RuntimeException e) {
                log.warn("Janela {} editada, mas a ativacao imediata falhou; o reconciliador repara na proxima passada",
                        id, e);
            }
        }
        return detalhar(id);
    }

    /** Prorroga ou antecipa uma ATIVA (MA22). Teto sobre o total, tambem no WHERE (MA23). */
    public ManutencaoResponse alterarFim(Long id, AlterarFimRequest req, Long usuarioId) {
        if (!propriedades.isEnabled()) {
            throw new ConflitoException(MSG_DESLIGADO);
        }
        Instant agora = Instant.now();
        Instant novoFim = req.fimPrevisto();
        Duration maxima = propriedades.getDuracaoMaxima();
        transacao.executeWithoutResult(s -> {
            EdicaoManutencao.Retrato antes = edicao.travar(id, SituacaoManutencao.ATIVA.name(), req.versao())
                    .orElseThrow(() -> recusaEdicao(id, req.versao(), SituacaoManutencao.ATIVA));
            if (!novoFim.isAfter(agora)) {
                throw new IllegalArgumentException("O novo fim ja passou. Para terminar agora use Encerrar agora");
            }
            if (novoFim.equals(antes.fimPrevisto())) {
                throw new IllegalArgumentException("O novo fim e igual ao atual");
            }
            if (Duration.between(antes.inicioPrevisto(), novoFim).compareTo(maxima) > 0) {
                throw new IllegalArgumentException("A janela nao pode passar de " + maxima.toHours()
                        + " horas desde o inicio");
            }
            if (!edicao.gravarFim(id, req.versao(), novoFim, agora, maxima)) {
                throw new IllegalStateException("Janela " + id + " mudou sob lock");
            }
            TipoAlteracao tipo = novoFim.isAfter(antes.fimPrevisto()) ? TipoAlteracao.PRORROGACAO
                    : TipoAlteracao.ANTECIPACAO;
            edicao.registrar(id, tipo, usuarioId, agora, antes, antes.comFim(novoFim));
        });
        return detalhar(id);
    }

    /** Por que o lock voltou vazio: inexistente (404), outra situacao (409) ou versao velha (409). */
    private RuntimeException recusaEdicao(long id, int versao, SituacaoManutencao esperada) {
        EdicaoManutencao.EstadoAtual atual = edicao.estado(id).orElse(null);
        if (atual == null) {
            return new RecursoNaoEncontradoException("Janela de manutencao nao encontrada");
        }
        if (!atual.status().equals(esperada.name())) {
            if (esperada == SituacaoManutencao.AGENDADA) {
                return new ConflitoException("Nao e possivel editar: a janela esta " + atual.status() + "."
                        + ("ATIVA".equals(atual.status()) ? " Use Alterar fim." : ""));
            }
            return new ConflitoException("Nao e possivel alterar o fim: a janela esta " + atual.status() + "."
                    + ("CONCLUIDA".equals(atual.status()) ? " Agende uma continuacao." : ""));
        }
        return new ConflitoException("A janela foi alterada por outra pessoa. Recarregue e tente de novo.");
    }
```

4. `listar(String situacao, String busca, Long unidadeId, Pageable pageable)`: passar `unidadeId == null ? 0L : unidadeId` às queries, e montar as respostas com a última alteração da página numa consulta só:

```java
        return leitura.execute(s -> {
            Page<ManutencaoAgendada> janelas = …;   // como hoje, com o novo parametro
            Map<Long, EdicaoManutencao.Ultima> ultimas = edicao.ultimas(
                    janelas.getContent().stream().map(ManutencaoAgendada::getId).toList());
            return janelas.map(m -> paraResposta(m, ultimas.get(m.getId())));
        });
```

5. `detalhar(id)`: `paraResposta(m, edicao.ultimas(List.of(id)).get(id))`. `paraResposta(ManutencaoAgendada m, EdicaoManutencao.Ultima ultima)` acrescenta ao construtor `m.getVersao(), ultima == null ? null : new UltimaAlteracaoResponse(ultima.tipo(), new ReferenciaResponse(ultima.porId(), ultima.porNome()), ultima.em())`.

- [ ] **Step 6: Controller e segurança**

```java
    @GetMapping
    public PaginaResposta<ManutencaoResponse> listar(@RequestParam(defaultValue = "VIGENTES") String situacao,
                                                     @RequestParam(defaultValue = "") String busca,
                                                     @RequestParam(required = false) Long unidadeId,
                                                     @PageableDefault(size = 20) Pageable pageable) {
        return PaginaResposta.de(service.listar(situacao, busca, unidadeId, pageable));
    }

    @GetMapping("/{id}")
    public ManutencaoResponse obter(@PathVariable Long id) {
        return service.obterPorId(id);
    }

    @PutMapping("/{id}")
    public ManutencaoResponse editar(@PathVariable Long id, @Valid @RequestBody EditarManutencaoRequest requisicao,
                                     @AuthenticationPrincipal UsuarioPrincipal principal) {
        return service.editar(id, requisicao, principal.id());
    }

    @PatchMapping("/{id}/fim")
    public ManutencaoResponse alterarFim(@PathVariable Long id, @Valid @RequestBody AlterarFimRequest requisicao,
                                         @AuthenticationPrincipal UsuarioPrincipal principal) {
        return service.alterarFim(id, requisicao, principal.id());
    }
```

(import `org.springframework.web.bind.annotation.PutMapping`.)

`SecurityConfiguration`: na linha `requestMatchers(HttpMethod.PUT, …)`, acrescentar `"/api/v1/manutencoes/**"` ao fim da lista. Nada mais muda: GET já é dos três papéis; o filtro `unidadeId` só estreita uma lista que os três já leem (não há permissão por unidade no modelo).

- [ ] **Step 7: HTTP security tests** — em `ManutencaoAgendadaHttpSecurityIntegrationTest` (agendador **desligado** nessa classe):

```java
    @Test
    void visualizadorNaoEditaNemAlteraFimMasLePorIdEPorUnidade() {
        String token = login("visualizador@manut.test");
        assertThat(chamar("PUT", "/" + janelaId, token, corpoEdicao("Novo", 0)).status()).isEqualTo(403);
        assertThat(chamar("PATCH", "/" + janelaId + "/fim", token, corpoFim(0)).status()).isEqualTo(403);
        Resposta porId = chamar("GET", "/" + janelaId, token, null);
        assertThat(porId.status()).isEqualTo(200);
        assertThat(porId.body()).contains("\"versao\":0", "\"ultimaAlteracao\":null");
        assertThat(chamar("GET", "?unidadeId=" + unidadeId, token, null).body()).contains("\"totalElements\":1");
        assertThat(chamar("GET", "?unidadeId=" + (unidadeId + 1000), token, null).body()).contains("\"totalElements\":0");
    }

    /** MA25 por HTTP: PUT passa (agendador desligado) e registra; PATCH de fim e recusado com o 409 do MA16. */
    @Test
    void operadorEditaComAgendadorDesligadoMasNaoAlteraFim() {
        String token = login("operador@manut.test");
        Resposta put = chamar("PUT", "/" + janelaId, token, corpoEdicao("Troca de nobreak e UPS", 0));
        assertThat(put.status()).isEqualTo(200);
        assertThat(put.body()).contains("\"motivo\":\"Troca de nobreak e UPS\"", "\"versao\":1",
                "\"ultimaAlteracao\":{\"tipo\":\"EDICAO\"", "\"situacao\":\"AGENDADA\"");
        assertThat(chamar("PUT", "/" + janelaId, token, corpoEdicao("De novo", 0)).status()).isEqualTo(409);
        Resposta fim = chamar("PATCH", "/" + janelaId + "/fim", token, corpoFim(1));
        assertThat(fim.status()).isEqualTo(409);
        assertThat(fim.body()).contains("MANUTENCAO_AGENDADA_ENABLED=true");
        assertThat(chamar("GET", "/9999", token, null).status()).isEqualTo(404);
    }

    private String corpoEdicao(String motivo, int versao) {
        Instant inicio = Instant.now().plus(Duration.ofDays(1));
        return "{\"unidadeId\":" + unidadeId + ",\"escopo\":\"UNIDADE\",\"equipamentoIds\":[],"
                + "\"inicioPrevisto\":\"" + inicio + "\",\"fimPrevisto\":\"" + inicio.plus(Duration.ofHours(1))
                + "\",\"motivo\":\"" + motivo + "\",\"versao\":" + versao + "}";
    }

    private String corpoFim(int versao) {
        return "{\"fimPrevisto\":\"" + Instant.now().plus(Duration.ofDays(2)) + "\",\"versao\":" + versao + "}";
    }
```

E no `preparar()` acrescentar `manutencao_agendada_alteracao` ao truncate.

- [ ] **Step 8: Run all manutencao tests**

Run: `./mvnw -q test -Dtest='br.com.inframonitor.manutencao.**'`
Expected: PASS, sem `!!`. Corrigir chamadas de `listar`/`new ManutencaoResponse(` que quebrarem a compilação em outros testes.

- [ ] **Step 9: Commit**

```bash
git add <arquivos novos>
git commit -m "feat(manutencao): editar AGENDADA, alterar fim de ATIVA, GET por id e filtro por unidade" -- \
  infra-monitor-backend/src/main/java/br/com/inframonitor/manutencao \
  infra-monitor-backend/src/main/java/br/com/inframonitor/security/SecurityConfiguration.java \
  infra-monitor-backend/src/test/java/br/com/inframonitor/manutencao
```

---

### Task 4: Corridas C1–C4 com distribuição e provas de reversão

**Files:**
- Create: `…/test/…/manutencao/ManutencaoAgendadaF2ConcorrenciaPostgresIntegrationTest.java`
- Create: `Docs/validacao-producao/manutencao-agendada-f2.md` (seção "Corridas" e "Provas de reversão"; o resto da evidência vem na Task 9/10)

**Interfaces:**
- Consumes: `ManutencaoAgendadaService.editar/alterarFim/obterPorId`, `ReconciliadorManutencao.reconciliar(Instant)`, `EquipamentoService.criar(CreateEquipamentoRequest)`.

- [ ] **Step 1: Esqueleto** — copiar de `ManutencaoAgendadaConcorrenciaPostgresIntegrationTest` **sem alterar**: anotações e propriedades da classe, container, `@DynamicPropertySource`, `montarCenario()` (acrescentando `manutencao_agendada_alteracao` ao truncate), e os helpers `Acao`, `correr`, `largar`, `atrasar`, `resumo`, `janela`, `janelaUnidade`, `janelaAtivaComEfeitosAplicados`, `novoEquipamento`, `novoMonitor`, `situacao`, `emManutencao`, `janelasSlaAbertas`, `insert`. Injetar também `ManutencaoAgendadaService service`, `EquipamentoService equipamentoService`, `ReconciliadorManutencao reconciliador`. Javadoc da classe: "Corridas da F2 (spec §4). C1–C3 sao guardas de CAS/lock; C4 NAO e CAS: e convergencia em ate uma passada do reconciliador de nivel (MA26). Provas de reversao: Docs/validacao-producao/manutencao-agendada-f2.md."

Helper para ler a versão e montar a edição:

```java
    private int versao(long j) {
        return jdbc.queryForObject("select versao from manutencao_agendada where id = ?", Integer.class, j);
    }

    private List<Long> ligados(long j) {
        return jdbc.queryForList("select equipamento_id from manutencao_agendada_equipamento where manutencao_id = ? "
                + "order by equipamento_id", Long.class, j);
    }

    private int alteracoes(long j) {
        return jdbc.queryForObject("select count(*) from manutencao_agendada_alteracao where manutencao_id = ?",
                Integer.class, j);
    }
```

- [ ] **Step 2: C1 — editar AGENDADA × job ativando**

```java
    /**
     * Janela AGENDADA devida (inicio = agora - 1 s) com A. A edicao troca A por B e MANTEM o inicio:
     * mudar o inicio para o futuro seria barrado pelo CHECK ck_manutencao_agendada_ativacao e
     * mascararia a prova. Legitimos: EDICAO (ATIVA com B; B dentro; A fora) ou JOB (409; ATIVA com A;
     * A dentro; B fora). ILEGITIMO: ligacao e efeitos discordando.
     */
    @RepeatedTest(30)
    void editarAgendadaEJobAtivando() throws Exception {
        long b = novoEquipamento("SW-B");
        Instant inicio = agora.minusSeconds(1);
        long j = janela("AGENDADA", inicio, agora.plus(1, HOURS), equipamento);
        int v = versao(j);
        AtomicReference<Throwable> recusa = new AtomicReference<>();
        EditarManutencaoRequest req = new EditarManutencaoRequest(u, EscopoManutencao.EQUIPAMENTOS, List.of(b), inicio,
                agora.plus(1, HOURS), "Trocado", v);

        List<Throwable> falhas = correr(
                () -> { atrasar(ATRASO_C1_MS); reconciliador.reconciliar(Instant.now()); },
                () -> { try { service.editar(j, req, operadorId); } catch (ConflitoException e) { recusa.set(e); } });

        String s = situacao(j);
        List<Long> lig = ligados(j);
        boolean emA = emManutencao(equipamento), emB = emManutencao(b);
        boolean edicao = falhas.isEmpty() && recusa.get() == null && "ATIVA".equals(s) && lig.equals(List.of(b))
                && emB && !emA && alteracoes(j) == 1;
        boolean job = falhas.isEmpty() && recusa.get() != null && "ATIVA".equals(s) && lig.equals(List.of(equipamento))
                && emA && !emB && alteracoes(j) == 0;
        System.out.println("[corrida-editar-ativar] desfecho=" + (edicao ? "EDICAO" : job ? "JOB" : "ILEGITIMO")
                + " situacao=" + s + " ligados=" + lig + " emA=" + emA + " emB=" + emB + " recusado="
                + (recusa.get() != null) + " falhas=" + resumo(falhas));
        assertThat(resumo(falhas)).isEmpty();
        assertThat(edicao || job).as("ligacao e efeitos concordam").isTrue();
    }
```

Nota: se a edição ganha, quem ativa é o `ativarSeDevida` do próprio `editar` ou o reconciliador (que espera o lock e reavalia o WHERE). Os dois levam ao estado EDICAO.

- [ ] **Step 3: C2 — alterar fim × job concluindo**

```java
    /**
     * ATIVA com fim vencido (fim = agora - 1 s). Legitimos: PRORROGOU (ATIVA, fim = +1 h, dentro, 1
     * alteracao) ou CONCLUIU (409, CONCLUIDA, fim antigo, fora, 0 alteracoes). ILEGITIMO: CONCLUIDA
     * com fim alterado (historia reescrita) ou ATIVA com o equipamento fora.
     */
    @RepeatedTest(30)
    void prorrogarEJobConcluindo() throws Exception {
        Instant fimAntigo = agora.minusSeconds(1);
        long j = janelaAtivaComEfeitosAplicados(agora.minus(1, HOURS), fimAntigo, equipamento);
        int v = versao(j);
        Instant novoFim = Instant.now().plus(1, HOURS).truncatedTo(ChronoUnit.MILLIS);
        AtomicReference<Throwable> recusa = new AtomicReference<>();

        List<Throwable> falhas = correr(
                () -> { atrasar(ATRASO_C2_MS); reconciliador.reconciliar(Instant.now()); },
                () -> { try { service.alterarFim(j, new AlterarFimRequest(novoFim, v), operadorId); }
                        catch (ConflitoException e) { recusa.set(e); } });

        Map<String, Object> linha = jdbc.queryForMap("select status, fim_previsto from manutencao_agendada where id = ?", j);
        Instant fim = ((Timestamp) linha.get("fim_previsto")).toInstant();
        boolean em = emManutencao(equipamento);
        boolean prorrogou = falhas.isEmpty() && recusa.get() == null && "ATIVA".equals(linha.get("status"))
                && fim.equals(novoFim) && em && alteracoes(j) == 1;
        boolean concluiu = falhas.isEmpty() && recusa.get() != null && "CONCLUIDA".equals(linha.get("status"))
                && fim.equals(fimAntigo) && !em && alteracoes(j) == 0;
        System.out.println("[corrida-prorrogar-concluir] desfecho=" + (prorrogou ? "PRORROGOU" : concluiu ? "CONCLUIU"
                : "ILEGITIMO") + " situacao=" + linha.get("status") + " fim=" + fim + " em=" + em
                + " recusado=" + (recusa.get() != null) + " falhas=" + resumo(falhas));
        assertThat(resumo(falhas)).isEmpty();
        assertThat(prorrogou || concluiu).as("historia nao reescrita").isTrue();
    }
```

Em `janelaAtivaComEfeitosAplicados`, o tick em `inicio + 1 min` ativa sem concluir (o fim é depois). Usar `fimAntigo` truncado a milissegundos (`agora` já é).

- [ ] **Step 4: C3 — duas edições com a mesma versão (duas variantes)**

```java
    /** Legitimo: exatamente um ganha, estado final inteiro dele, uma alteracao. ILEGITIMO: dois ganham / mistura. */
    @RepeatedTest(30)
    void duasEdicoesComAMesmaVersao() throws Exception {
        long b = novoEquipamento("SW-B");
        long c = novoEquipamento("SW-C");
        Instant inicio = agora.plus(2, HOURS);
        long j = janela("AGENDADA", inicio, inicio.plus(1, HOURS), equipamento);
        int v = versao(j);
        var reqB = new EditarManutencaoRequest(u, EscopoManutencao.EQUIPAMENTOS, List.of(b), inicio,
                inicio.plus(2, HOURS), "Pedido B", v);
        var reqC = new EditarManutencaoRequest(u, EscopoManutencao.EQUIPAMENTOS, List.of(c), inicio.plus(1, HOURS),
                inicio.plus(3, HOURS), "Pedido C", v);
        AtomicReference<Throwable> recusaB = new AtomicReference<>(), recusaC = new AtomicReference<>();

        List<Throwable> falhas = correr(
                () -> { try { service.editar(j, reqB, operadorId); } catch (ConflitoException e) { recusaB.set(e); } },
                () -> { atrasar(ATRASO_C3_MS);
                        try { service.editar(j, reqC, operadorId); } catch (ConflitoException e) { recusaC.set(e); } });

        Map<String, Object> l = jdbc.queryForMap("select motivo, inicio_previsto, versao from manutencao_agendada where id = ?", j);
        List<Long> lig = ligados(j);
        boolean venceuB = recusaB.get() == null && recusaC.get() != null && "Pedido B".equals(l.get("motivo"))
                && lig.equals(List.of(b)) && ((Timestamp) l.get("inicio_previsto")).toInstant().equals(inicio);
        boolean venceuC = recusaC.get() == null && recusaB.get() != null && "Pedido C".equals(l.get("motivo"))
                && lig.equals(List.of(c)) && ((Timestamp) l.get("inicio_previsto")).toInstant().equals(inicio.plus(1, HOURS));
        boolean legitimo = falhas.isEmpty() && (venceuB || venceuC) && alteracoes(j) == 1
                && Integer.valueOf(v + 1).equals(l.get("versao"));
        System.out.println("[corrida-duas-edicoes] desfecho=" + (!legitimo ? "ILEGITIMO" : venceuB ? "B" : "C")
                + " motivo=" + l.get("motivo") + " ligados=" + lig + " alteracoes=" + alteracoes(j)
                + " falhas=" + resumo(falhas));
        assertThat(resumo(falhas)).isEmpty();
        assertThat(legitimo).isTrue();
    }

    @RepeatedTest(30)
    void duasAlteracoesDeFimComAMesmaVersao() throws Exception {
        long j = janelaAtivaComEfeitosAplicados(agora.minus(1, HOURS), agora.plus(1, HOURS), equipamento);
        int v = versao(j);
        Instant fimB = agora.plus(2, HOURS), fimC = agora.plus(3, HOURS);
        AtomicReference<Throwable> recusaB = new AtomicReference<>(), recusaC = new AtomicReference<>();

        List<Throwable> falhas = correr(
                () -> { try { service.alterarFim(j, new AlterarFimRequest(fimB, v), operadorId); }
                        catch (ConflitoException e) { recusaB.set(e); } },
                () -> { atrasar(ATRASO_C3_MS);
                        try { service.alterarFim(j, new AlterarFimRequest(fimC, v), operadorId); }
                        catch (ConflitoException e) { recusaC.set(e); } });

        Instant fim = jdbc.queryForObject("select fim_previsto from manutencao_agendada where id = ?", Timestamp.class, j)
                .toInstant();
        boolean venceuB = recusaB.get() == null && recusaC.get() != null && fim.equals(fimB);
        boolean venceuC = recusaC.get() == null && recusaB.get() != null && fim.equals(fimC);
        boolean legitimo = falhas.isEmpty() && (venceuB || venceuC) && alteracoes(j) == 1;
        System.out.println("[corrida-dois-fins] desfecho=" + (!legitimo ? "ILEGITIMO" : venceuB ? "B" : "C")
                + " fim=" + fim + " alteracoes=" + alteracoes(j) + " falhas=" + resumo(falhas));
        assertThat(resumo(falhas)).isEmpty();
        assertThat(legitimo).isTrue();
    }
```

- [ ] **Step 5: C4 — janela UNIDADE concluindo × equipamento criado (convergência, não CAS)**

```java
    /**
     * NAO E CAS (MA26): a criacao do equipamento e a conclusao da janela nao dividem lock. A
     * garantia e o reconciliador de NIVEL: depois das duas threads, no maximo UMA passada extra deixa
     * zero divergentes. Desfechos: DIRETO (ja convergido ao fim das threads) ou UMA_PASSADA (o novo
     * equipamento ficou em manutencao com a janela concluida e a passada seguinte corrigiu).
     * ILEGITIMO: divergente apos a passada extra, ou falha de thread.
     */
    @RepeatedTest(30)
    void janelaDeUnidadeConcluindoEEquipamentoCriado() throws Exception {
        long j = janelaUnidade(agora.minus(1, HOURS), agora.minusSeconds(1));
        reconciliador.reconciliar(agora.minus(1, HOURS).plus(1, MINUTES));   // ativa; fim ainda no futuro do tick
        assertThat(situacao(j)).isEqualTo("ATIVA");
        AtomicReference<Long> criado = new AtomicReference<>();
        CreateEquipamentoRequest novo = new CreateEquipamentoRequest(u, tipo, "SW-NOVO", null, null, null, null, null,
                null, null);

        List<Throwable> falhas = correr(
                () -> { atrasar(ATRASO_C4_MS); reconciliador.reconciliar(Instant.now()); },
                () -> criado.set(equipamentoService.criar(novo).id()));

        int divergentesAntes = divergentes();
        reconciliador.reconciliar(Instant.now());   // a passada extra
        int divergentesDepois = divergentes();
        boolean legitimo = falhas.isEmpty() && "CONCLUIDA".equals(situacao(j)) && divergentesDepois == 0
                && !emManutencao(criado.get());
        System.out.println("[corrida-unidade-criacao] desfecho=" + (!legitimo ? "ILEGITIMO"
                : divergentesAntes == 0 ? "DIRETO" : "UMA_PASSADA") + " divergentesAntes=" + divergentesAntes
                + " divergentesDepois=" + divergentesDepois + " falhas=" + resumo(falhas));
        assertThat(resumo(falhas)).isEmpty();
        assertThat(legitimo).isTrue();
    }

    private int divergentes() {
        return jdbc.queryForObject("select count(*) from equipamento e where e.em_manutencao <> (e.manutencao_manual or "
                + CoberturaManutencao.COBERTO_E + ")", Integer.class);
    }
```

Mais três testes sem corrida (`@Test`), na mesma classe:

```java
    @Test
    void equipamentoMovidoParaForaDaUnidadeSaiNaHora() {
        long norte = insert("insert into unidade (nome, sigla, ativo) values ('Norte', 'NRT', true) returning id");
        long j = janelaUnidade(agora.minus(1, HOURS), agora.plus(1, HOURS));
        reconciliador.reconciliar(agora);
        assertThat(emManutencao(equipamento)).isTrue();
        equipamentoService.atualizar(equipamento, new UpdateEquipamentoRequest(norte, tipo, "SW-01", null, null, null,
                null, null, null, null));
        assertThat(emManutencao(equipamento)).isFalse();
        assertThat(situacao(j)).isEqualTo("ATIVA");
    }

    @Test
    void equipamentoExcluidoDuranteJanelaDeUnidadeNaoQuebraConclusao() {
        long avulso = novoEquipamento("SW-AVULSO");
        long j = janelaUnidade(agora.minus(1, HOURS), agora.plus(1, HOURS));
        reconciliador.reconciliar(agora);
        assertThat(emManutencao(avulso)).isTrue();
        equipamentoService.excluir(avulso);
        var r = reconciliador.reconciliar(agora.plus(2, HOURS));
        assertThat(r.concluidas()).extracting(Transicao::manutencaoId).containsExactly(j);
        assertThat(situacao(j)).isEqualTo("CONCLUIDA");
    }
```

(Se `equipamentoService.excluir` recusar por monitor/medição, usar `novoEquipamento` sem monitor, como acima; se o nome do método for outro, conferir em `EquipamentoService`.)

- [ ] **Step 6: Calibrar atrasos e rodar**

Constantes no topo, começando em `ATRASO_C1_MS = 8`, `ATRASO_C2_MS = 8`, `ATRASO_C3_MS = 4`, `ATRASO_C4_MS = 8`. Rodar:

`./mvnw -q test -Dtest=ManutencaoAgendadaF2ConcorrenciaPostgresIntegrationTest 2>&1 | grep -o "\[corrida-[a-z-]*\] desfecho=[A-Z_]*" | sort | uniq -c`

Expected: zero `ILEGITIMO`, todos os testes verdes. Para C1–C3 os **dois** desfechos legítimos devem aparecer em 30. Se um lado ganhar 30/30, mover o atraso para a outra thread ou ajustar (registrar cada medição de calibração em comentário, no idioma da F1). Para C4 qualquer distribuição DIRETO/UMA_PASSADA é legítima: registrar a que saiu.

- [ ] **Step 7: Provas de reversão (uma por corrida; reverter o código depois de cada uma)**

| Corrida | Remover temporariamente | Onde |
|---|---|---|
| C1 | `AND status = :status` do `travar` **e** `AND status = 'AGENDADA'` do `gravarEdicao` | `EdicaoManutencao` |
| C2 | `AND status = :status` do `travar` **e** `AND status = 'ATIVA'` do `gravarFim` | `EdicaoManutencao` |
| C3 | `AND versao = :versao` do `travar` **e** dos dois UPDATEs | `EdicaoManutencao` |
| C4 | `alvos.addAll(cobertura.divergentes());` | `ReconciliadorManutencao.reconciliar` |

Para cada uma: aplicar, rodar só o teste da corrida, guardar a contagem de `desfecho=` e a primeira linha `ILEGITIMO`/falha. Depois `git checkout -- <arquivo>`, rodar de novo e confirmar o verde. Se a reversão **não** ficar vermelha, o teste não prova a guarda: reforçar o cenário (não aceitar o teste como está). Atenção em C1/C2: sem `status` no `travar`, o `travar` passa a aceitar outra situação, mas o `recusaEdicao` ainda existe; o vermelho esperado é `ILEGITIMO` (ligação B com A em manutenção; CONCLUIDA com fim novo).

- [ ] **Step 8: Evidência** — criar `Docs/validacao-producao/manutencao-agendada-f2.md` com:
  - `## Corridas`: tabela corrida → distribuição (ex.: `EDICAO 17 / JOB 13`) e zero ILEGITIMO, data e comando.
  - `## Provas de reversão`: por corrida, guarda removida, saída (contagem + linha ILEGITIMO literal) e confirmação do verde ao restaurar.
  - Parágrafo explícito: "C4 não é CAS. …" (texto do MA26).

- [ ] **Step 9: Commit**

```bash
git add infra-monitor-backend/src/test/java/br/com/inframonitor/manutencao/ManutencaoAgendadaF2ConcorrenciaPostgresIntegrationTest.java \
  Docs/validacao-producao/manutencao-agendada-f2.md
git commit -m "test(manutencao): corridas da F2 com distribuicao e provas de reversao" -- \
  infra-monitor-backend/src/test/java/br/com/inframonitor/manutencao/ManutencaoAgendadaF2ConcorrenciaPostgresIntegrationTest.java \
  Docs/validacao-producao/manutencao-agendada-f2.md
```

---

### Task 5: Front — modelo, API e `app-agendar-manutencao` com preset e edição

**Files:**
- Modify: `infra-monitor-frontend/src/app/core/models/manutencao.ts`, `core/services/manutencao-api.service.ts`
- Modify: `features/manutencoes/periodo.ts` (+ `periodo.spec.ts`)
- Modify: `features/manutencoes/agendar-manutencao.component.{ts,html,scss,spec.ts}`
- Modify: specs que montam `ManutencaoResponse` literal (`manutencao-list.component.spec.ts`, `agendar-manutencao.component.spec.ts`): acrescentar `versao: 0, ultimaAlteracao: null` ao helper `resposta()`.

**Interfaces:**
- Produces (usadas por Tasks 6, 7, 8):

```ts
// core/models/manutencao.ts
export type TipoAlteracao = 'EDICAO' | 'PRORROGACAO' | 'ANTECIPACAO';
export interface UltimaAlteracao { tipo: TipoAlteracao; por: Referencia; em: string; }
// ManutencaoResponse += versao: number; ultimaAlteracao: UltimaAlteracao | null;
export interface EditarManutencaoRequest extends CriarManutencaoRequest { versao: number; }
export interface AlterarFimRequest { fimPrevisto: string; versao: number; }
/** Pré-preenchimento do modal de agendar (Equipamentos, Unidade, continuação). Datas ISO. */
export interface PresetAgendamento {
  unidadeId: number;
  travarUnidade: boolean;
  escopo?: MaintenanceScope;
  equipamentoIds?: number[];
  motivo?: string;
  inicio?: string;
  fim?: string;
}

// ManutencaoApiService
list(filtro: FiltroManutencao, busca: string, page: number, size = 20, unidadeId?: number): Observable<PageResponse<ManutencaoResponse>>;
get(id: number): Observable<ManutencaoResponse>;
update(id: number, req: EditarManutencaoRequest): Observable<ManutencaoResponse>;
alterarFim(id: number, req: AlterarFimRequest): Observable<ManutencaoResponse>;

// periodo.ts
export function hora(iso: string): string;      // "HH:MM" local
export function dataHora(iso: string): string;  // "DD/MM/AAAA HH:MM" local

// <app-agendar-manutencao>
//   inputs: aberto, duracaoMaximaHoras, preset: PresetAgendamento | null = null, janela: ManutencaoResponse | null = null
//   outputs: fechar, agendada: ManutencaoResponse (criação), salva: ManutencaoResponse (edição)
```

- [ ] **Step 1: Model + API + periodo** — aplicar as interfaces acima. API:

```ts
  list(filtro: FiltroManutencao, busca: string, page: number, size = 20, unidadeId?: number): Observable<PageResponse<ManutencaoResponse>> {
    let params = new HttpParams().set('situacao', filtro).set('page', page).set('size', size);
    const termo = busca.trim();
    if (termo) { params = params.set('busca', termo); }
    if (unidadeId !== undefined) { params = params.set('unidadeId', unidadeId); }
    return this.http.get<PageResponse<ManutencaoResponse>>(this.baseUrl, { params });
  }
  get(id: number): Observable<ManutencaoResponse> { return this.http.get<ManutencaoResponse>(`${this.baseUrl}/${id}`); }
  update(id: number, req: EditarManutencaoRequest): Observable<ManutencaoResponse> { return this.http.put<ManutencaoResponse>(`${this.baseUrl}/${id}`, req); }
  alterarFim(id: number, req: AlterarFimRequest): Observable<ManutencaoResponse> { return this.http.patch<ManutencaoResponse>(`${this.baseUrl}/${id}/fim`, req); }
```

`periodo.ts`: mover para cá (exportadas) `hora` e `dataHora` que hoje são funções privadas no fim de `manutencao-list.component.ts`; a lista passa a importá-las. Teste em `periodo.spec.ts`:

```ts
  it('formata hora e data-hora no horário local', () => {
    const iso = new Date(2026, 9, 23, 7, 5).toISOString();
    expect(hora(iso)).toBe('07:05');
    expect(dataHora(iso)).toBe('23/10/2026 07:05');
  });
```

- [ ] **Step 2: Failing specs do modal** — em `agendar-manutencao.component.spec.ts`, mudar o `HostComponent` para também passar `[preset]="preset()" [janela]="janela()" (salva)="salva.set($event); aberto.set(false)"` com signals `preset = signal<PresetAgendamento | null>(null)`, `janela = signal<ManutencaoResponse | null>(null)`, `salva = signal<ManutencaoResponse | null>(null)`. Novos casos (usar os helpers já existentes `abrir`, `campo`, `preencher`, `escopo`, `enviar`, `modal`; quando `janela` estiver setada, `abrir` precisa também responder ao `GET /manutencoes/{id}` — criar `abrirEdicao(j)` que faz o mesmo que `abrir` e `http.expectOne(`${URL}/${j.id}`).flush(j)`):

```ts
  it('preset trava a unidade e marca o equipamento', () => {
    const f = TestBed.createComponent(HostComponent);
    f.componentInstance.preset.set({ unidadeId: 1, travarUnidade: true, equipamentoIds: [8] });
    // … mesmo fluxo de abrir() (flush de unidades e equipamentos)
    expect(campo<HTMLSelectElement>(f, 'unidadeId').disabled).toBe(true);
    expect(campo<HTMLSelectElement>(f, 'unidadeId').value).toBe('1');
    const marcados = [...modal(f)!.querySelectorAll<HTMLInputElement>('.checagem input:checked')].map((i) => i.parentElement!.textContent!.trim());
    expect(marcados).toEqual(['AP-01']);
  });

  it('com todos os ativos marcados sugere Unidade inteira', () => {
    // abrir com preset { unidadeId: 1, travarUnidade: true, equipamentoIds: [7, 8] }
    expect(modal(f)!.textContent).toContain('Todos marcados. Para incluir também os equipamentos criados durante a janela, use Unidade inteira.');
  });

  it('edição carrega GET /{id}, mostra vinculado inativo com nota e envia PUT com versao', () => {
    const j = resposta({ id: 50, escopo: MaintenanceScope.Equipment, unidade: { id: 1, nome: 'Sede' }, equipamentos: [{ id: 9, nome: 'AP-VELHO' }],
      inicioPrevisto: new Date(Date.now() + 3_600_000).toISOString(), fimPrevisto: new Date(Date.now() + 7_200_000).toISOString(), motivo: 'Original', versao: 3 });
    // abrirEdicao(j)
    expect(modal(f)!.querySelector('h2')!.textContent).toContain('Editar janela #50');
    expect(modal(f)!.textContent).toContain('AP-VELHO');
    expect(modal(f)!.textContent).toContain('inativo');
    preencher(f, 'motivo', 'Novo motivo');
    enviar(f);
    const put = http.expectOne(`${URL}/50`);
    expect(put.request.method).toBe('PUT');
    expect(put.request.body).toEqual(expect.objectContaining({ versao: 3, motivo: 'Novo motivo', equipamentoIds: [9], unidadeId: 1 }));
    put.flush({ ...j, versao: 4 });
    f.detectChanges();
    expect(f.componentInstance.salva()?.versao).toBe(4);
  });

  it('na edição, trocar a unidade limpa a seleção e esconde os vinculados da unidade antiga', () => {
    // abrirEdicao(j com equipamentos [{id:7,nome:'SW-CORE'}])
    preencher(f, 'unidadeId', '2');
    expect(modal(f)!.querySelectorAll('.checagem input:checked').length).toBe(0);
    expect(modal(f)!.textContent).not.toContain('SW-CORE');
    expect(modal(f)!.textContent).toContain('RT-ITA');
  });
```

O título do `app-modal` está em `h2` (conferir em `shared/modal/modal.component.html`; usar o seletor real).

- [ ] **Step 3: Run to verify failure** — `npx ng test --watch=false --include src/app/features/manutencoes` (de `infra-monitor-frontend/`). Expected: FAIL.

- [ ] **Step 4: Implement the modal**

`agendar-manutencao.component.ts` (alterações):

```ts
  readonly preset = input<PresetAgendamento | null>(null);
  readonly janela = input<ManutencaoResponse | null>(null);
  readonly salva = output<ManutencaoResponse>();

  protected readonly emEdicao = computed(() => this.janela() !== null);
  /** Janela carregada do GET /{id} ao abrir em edição: valores e versão frescos. */
  private readonly carregada = signal<ManutencaoResponse | null>(null);
  protected readonly titulo = computed(() => this.janela() ? `Editar janela #${this.janela()!.id}` : 'Agendar manutenção');

  /** Linha da checklist. `nota` explica vinculado que hoje não seria aceito como novo (MA21). */
  protected readonly equipamentosDaUnidade = computed<{ id: number; nome: string; nota: string | null }[]>(() => {
    const unidade = this.unidadeId();
    if (unidade === null) return [];
    const ativos = this.equipamentos().filter((e) => e.unidadeId === unidade && e.ativo).map((e) => ({ id: e.id, nome: e.nome, nota: null as string | null }));
    const j = this.carregada();
    const vinculados = j && j.unidade.id === unidade
      ? j.equipamentos.filter((v) => !ativos.some((a) => a.id === v.id)).map((v) => {
          const atual = this.equipamentos().find((e) => e.id === v.id);
          const nota = !atual ? null : atual.unidadeId !== unidade ? 'agora em outra unidade' : !atual.ativo ? 'inativo' : null;
          return { id: v.id, nome: v.nome, nota };
        })
      : [];
    return [...ativos, ...vinculados].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  });
  protected readonly todosMarcados = computed(() => {
    const lista = this.equipamentosDaUnidade();
    return this.escopo() === MaintenanceScope.Equipment && lista.length > 1 && lista.every((e) => this.selecionados().has(e.id));
  });
```

`preparar()`:

```ts
  private preparar(): void {
    this.tentou.set(false); this.erroPeriodo.set(null); this.erroApi.set(null); this.erroCarga.set(null);
    this.carregada.set(null);
    const janela = this.janela();
    if (janela) {
      this.preencher({ unidadeId: janela.unidade.id, travarUnidade: false, escopo: janela.escopo, equipamentoIds: janela.equipamentos.map((e) => e.id),
        motivo: janela.motivo, inicio: janela.inicioPrevisto, fim: janela.fimPrevisto });
      this.carregada.set(janela);
      // Valores e versão frescos: a linha da lista pode estar velha (memória: drawer etapa 4).
      this.api.get(janela.id).pipe(take(1)).subscribe({
        next: (atual) => { this.carregada.set(atual); this.preencher({ unidadeId: atual.unidade.id, travarUnidade: false, escopo: atual.escopo,
          equipamentoIds: atual.equipamentos.map((e) => e.id), motivo: atual.motivo, inicio: atual.inicioPrevisto, fim: atual.fimPrevisto }); },
        error: () => this.erroCarga.set('Não foi possível carregar a janela.'),
      });
    } else {
      // Sugestão: próxima hora cheia, duas horas de janela. O operador ajusta.
      const inicio = new Date(); inicio.setMinutes(0, 0, 0); inicio.setHours(inicio.getHours() + 1);
      const p = this.preset();
      this.preencher({ unidadeId: p?.unidadeId ?? null, travarUnidade: p?.travarUnidade ?? false, escopo: p?.escopo ?? MaintenanceScope.Equipment,
        equipamentoIds: p?.equipamentoIds ?? [], motivo: p?.motivo ?? '',
        inicio: p?.inicio ?? inicio.toISOString(), fim: p?.fim ?? new Date(inicio.getTime() + 2 * 3_600_000).toISOString() });
    }
    // … carga de unidades e equipamentos como hoje …
  }

  /** reset() emite valueChanges da unidade, que limpa a seleção: a seleção vem DEPOIS. */
  private preencher(v: { unidadeId: number | null; travarUnidade: boolean; escopo: MaintenanceScope; equipamentoIds: number[]; motivo: string; inicio: string; fim: string }): void {
    this.form.reset({ unidadeId: v.unidadeId === null ? '' : String(v.unidadeId), escopo: v.escopo, inicio: isoParaLocal(v.inicio), fim: isoParaLocal(v.fim), motivo: v.motivo });
    if (v.travarUnidade) this.form.controls.unidadeId.disable({ emitEvent: false }); else this.form.controls.unidadeId.enable({ emitEvent: false });
    this.selecionados.set(new Set(v.equipamentoIds));
  }
```

`enviar()`: depois de montar `request`, se `this.carregada()` existir → `this.api.update(id, { ...request, versao: this.carregada()!.versao })` e no `next` emitir `salva`; senão `create` + `agendada` (como hoje). Mensagem de erro alternativa na edição: `'Não foi possível salvar a janela.'`.

`agendar-manutencao.component.html`:
- `<app-modal … [titulo]="titulo()" …>`;
- na checklist: `{{ equipamento.nome }}@if (equipamento.nota) { <small class="checagem__nota">· {{ equipamento.nota }}</small> }`;
- abaixo da contagem: `@if (todosMarcados()) { <p class="escopo__dica" role="note">Todos marcados. Para incluir também os equipamentos criados durante a janela, use Unidade inteira.</p> }`;
- se `emEdicao()` e houver vinculado com nota: `<p class="escopo__dica">Equipamentos marcados com nota continuam na janela; desmarcados, não podem voltar.</p>`;
- botão: `{{ salvando() ? (emEdicao() ? 'Salvando…' : 'Agendando…') : (emEdicao() ? 'Salvar alterações' : 'Agendar janela') }}`.

`agendar-manutencao.component.scss`: `.checagem__nota { color: var(--texto-apagado); margin-left: 4px; }` (usar o token de texto apagado já usado no arquivo/projeto; conferir nome real).

- [ ] **Step 5: Run** — `npx ng test --watch=false --include src/app/features/manutencoes`. Expected: PASS, inclusive os casos da F1.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(manutencoes): modal de agendar com preset e modo edicao" -- \
  infra-monitor-frontend/src/app/core/models/manutencao.ts \
  infra-monitor-frontend/src/app/core/services/manutencao-api.service.ts \
  infra-monitor-frontend/src/app/features/manutencoes/
```

---

### Task 6: Front — `app-alterar-fim`, continuação e ações da lista

**Files:**
- Create: `features/manutencoes/alterar-fim.component.{ts,html,scss,spec.ts}`
- Modify: `features/manutencoes/manutencao-list.component.{ts,html,spec.ts}`

**Interfaces:**
- Consumes: Task 5 (`PresetAgendamento`, `api.get/alterarFim/update`, `dataHora`, `hora`, modal com `preset`/`janela`/`salva`).
- Produces: `<app-alterar-fim [aberto] [janela] [duracaoMaximaHoras] (fechar) (alterado)="…ManutencaoResponse" (continuar)="…PresetAgendamento" />`.

Usar a skill `frontend-design` para o visual do diálogo (dentro do `app-modal`, sem estilo novo de página).

- [ ] **Step 1: Failing spec** `alterar-fim.component.spec.ts` (host igual ao do agendar):

```ts
  it('prorroga com PATCH /fim e versao', () => {
    const j = ativa({ id: 41, versao: 2, inicioPrevisto: iso(-60), fimPrevisto: iso(60) });
    // abre; campo fim vem preenchido com o fim atual; mostra o limite "até … (72 h desde o início)"
    expect(texto(f)).toContain('72 h desde o início');
    preencherFim(f, isoParaLocal(iso(120)));
    enviar(f);
    const req = http.expectOne(`${URL}/41/fim`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ fimPrevisto: localParaIso(isoParaLocal(iso(120))), versao: 2 });
    req.flush({ ...j, fimPrevisto: iso(120), versao: 3 });
    expect(f.componentInstance.alterado()?.versao).toBe(3);
  });

  it('recusa no cliente fim no passado, igual ao atual ou acima do teto', () => { /* sem request */ });

  it('409 de janela concluída troca para Agendar continuação e emite preset', () => {
    // envia; flush 409 { code: 'BUSINESS_CONFLICT', message: 'Nao e possivel alterar o fim: a janela esta CONCLUIDA. Agende uma continuacao.' , … }
    // GET /41 → flush({ …j, situacao: Completed, encerradaEm: iso(-1) })
    expect(texto(f)).toContain('A janela #41 concluiu às');
    expect(texto(f)).toContain('até a nova janela ativar, eles são pingados por alguns segundos');
    clicar(f, 'Agendar continuação');
    expect(f.componentInstance.continuar()).toEqual(expect.objectContaining({ unidadeId: 1, travarUnidade: true, escopo: j.escopo,
      equipamentoIds: j.equipamentos.map((e) => e.id), motivo: j.motivo }));
  });

  it('409 por outra situação mostra a mensagem do servidor', () => { /* GET devolve ATIVA com versao nova → mensagem + "Recarregue" */ });

  it('Escape fecha e devolve o foco ao gatilho', () => { /* padrão do spec do agendar */ });
```

(`iso(min)` = `new Date(Date.now() + min * 60_000).toISOString()`; o corpo de erro segue `ErroResposta`: `{ timestamp, status: 409, error: 'Conflict', code: 'BUSINESS_CONFLICT', message, path, campos: [] }` — conferir os campos exigidos por `isApiError` em `core/models/api-error.ts`.)

- [ ] **Step 2: Implement** `alterar-fim.component.ts`:

```ts
/**
 * "Alterar fim" de janela ATIVA: prorrogar ou antecipar (MA22). Se ela concluir entre abrir e
 * enviar, o servidor responde 409 e a tela oferece "Agendar continuação" (concluída não reabre).
 */
@Component({ selector: 'app-alterar-fim', imports: [ReactiveFormsModule, ModalComponent], changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './alterar-fim.component.html', styleUrl: './alterar-fim.component.scss' })
export class AlterarFimComponent {
  private readonly api = inject(ManutencaoApiService);
  readonly aberto = input(false);
  readonly janela = input<ManutencaoResponse | null>(null);
  readonly duracaoMaximaHoras = input.required<number>();
  readonly fechar = output<void>();
  readonly alterado = output<ManutencaoResponse>();
  readonly continuar = output<PresetAgendamento>();

  protected readonly fim = new FormControl('', { nonNullable: true });
  protected readonly erro = signal<string | null>(null);
  protected readonly salvando = signal(false);
  protected readonly concluida = signal<ManutencaoResponse | null>(null);
  protected readonly limite = computed(() => {
    const j = this.janela();
    return j ? new Date(Date.parse(j.inicioPrevisto) + this.duracaoMaximaHoras() * 3_600_000).toISOString() : null;
  });
  protected readonly dataHora = dataHora;
  protected readonly hora = hora;

  constructor() {
    effect(() => { if (this.aberto()) untracked(() => this.preparar()); });
  }

  private preparar(): void {
    const j = this.janela();
    this.erro.set(null); this.concluida.set(null); this.salvando.set(false);
    this.fim.setValue(j ? isoParaLocal(j.fimPrevisto) : '');
  }

  protected pedirFechar(): void { if (!this.salvando()) this.fechar.emit(); }

  protected enviar(): void {
    const j = this.janela();
    if (!j || this.salvando()) return;
    const novo = localParaIso(this.fim.value);
    const erro = !novo ? 'Informe o novo fim.'
      : Date.parse(novo) <= Date.now() ? 'O novo fim já passou. Para terminar agora, use Encerrar agora.'
      : Date.parse(novo) === Date.parse(j.fimPrevisto) ? 'O novo fim é igual ao atual.'
      : Date.parse(novo) > Date.parse(this.limite()!) ? `A janela não pode passar de ${this.duracaoMaximaHoras()} horas desde o início.`
      : null;
    this.erro.set(erro);
    if (erro || !novo) return;
    this.salvando.set(true);
    this.api.alterarFim(j.id, { fimPrevisto: novo, versao: j.versao }).pipe(take(1)).subscribe({
      next: (r) => { this.salvando.set(false); this.alterado.emit(r); },
      error: (e: unknown) => {
        const mensagem = e instanceof HttpErrorResponse && isApiError(e.error) ? e.error.message : 'Não foi possível alterar o fim.';
        if (!(e instanceof HttpErrorResponse) || e.status !== 409) { this.salvando.set(false); this.erro.set(mensagem); return; }
        // 409: descobrir se concluiu (oferece continuação) ou se só mudou (recarregar).
        this.api.get(j.id).pipe(take(1)).subscribe({
          next: (atual) => {
            this.salvando.set(false);
            if (atual.situacao === MaintenanceWindowStatus.Completed) this.concluida.set(atual);
            else this.erro.set(`${mensagem} Feche e abra de novo para ver a versão atual.`);
          },
          error: () => { this.salvando.set(false); this.erro.set(mensagem); },
        });
      },
    });
  }

  protected agendarContinuacao(): void {
    const j = this.concluida();
    if (!j) return;
    const pedido = localParaIso(this.fim.value);
    this.continuar.emit({ unidadeId: j.unidade.id, travarUnidade: true, escopo: j.escopo, equipamentoIds: j.equipamentos.map((e) => e.id),
      motivo: j.motivo, inicio: new Date().toISOString(), fim: pedido && Date.parse(pedido) > Date.now() ? pedido : undefined });
  }
}
```

`alterar-fim.component.html`:

```html
<app-modal [aberto]="aberto()" [titulo]="concluida() ? 'Janela #' + concluida()!.id + ' concluída' : 'Alterar fim da janela #' + (janela()?.id ?? '')"
  subtitulo="Prorrogue ou antecipe o fim. Início, escopo e motivo de uma janela ativa não mudam." largura="460px" [bloqueado]="salvando()" (fechar)="pedirFechar()">
  @if (concluida(); as c) {
    <div class="continuacao">
      <p>A janela #{{ c.id }} concluiu às {{ hora(c.encerradaEm!) }}. Os equipamentos voltaram a ser verificados: até a nova janela ativar, eles são pingados por alguns segundos.</p>
      <div class="modal-form__rodape">
        <button class="botao" type="button" (click)="pedirFechar()">Fechar</button>
        <button class="botao botao--primario" type="button" (click)="agendarContinuacao()">Agendar continuação</button>
      </div>
    </div>
  } @else if (janela(); as j) {
    <form class="modal-form" (ngSubmit)="enviar()" novalidate>
      <p class="fim-atual">Fim atual: <strong>{{ dataHora(j.fimPrevisto) }}</strong></p>
      <label>NOVO FIM *<input type="datetime-local" [formControl]="fim"></label>
      <small class="periodo-dica">Até {{ dataHora(limite()!) }} ({{ duracaoMaximaHoras() }} h desde o início). Horário deste navegador.</small>
      <div class="modal-form__rodape">
        @if (erro()) { <p class="rodape-erro" role="alert">{{ erro() }}</p> }
        <button class="botao" type="button" (click)="pedirFechar()" [disabled]="salvando()">Cancelar</button>
        <button class="botao botao--primario" type="submit" [disabled]="salvando()">{{ salvando() ? 'Salvando…' : 'Alterar fim' }}</button>
      </div>
    </form>
  }
</app-modal>
```

(O foco: `app-modal` foca o primeiro focável ao abrir e devolve ao gatilho ao fechar — conferir que, ao trocar para o conteúdo de continuação, o foco não cai no `body`; se cair, focar o botão "Agendar continuação" via `viewChild` + `afterNextRender`.)

- [ ] **Step 3: Lista** — em `manutencao-list.component.ts`:

```ts
  protected readonly editando = signal<ManutencaoResponse | null>(null);
  protected readonly alterandoFim = signal<ManutencaoResponse | null>(null);
  protected readonly preset = signal<PresetAgendamento | null>(null);

  protected acoesDe(janela: ManutencaoResponse): ActionMenuItem[] {
    const desabilitado = !this.podeGerenciar();
    if (janela.situacao === MaintenanceWindowStatus.Scheduled) {
      return [{ id: 'editar', rotulo: 'Editar', desabilitado }, { id: 'cancelar', rotulo: 'Cancelar', desabilitado }];
    }
    if (janela.situacao === MaintenanceWindowStatus.Active) {
      // MA25: sem o agendador, antecipar mentiria (nada encerra a janela).
      return [{ id: 'alterarFim', rotulo: 'Alterar fim', desabilitado: desabilitado || this.agendadorDesligado() },
        { id: 'encerrar', rotulo: 'Encerrar agora', desabilitado }];
    }
    return [];
  }

  protected executar(janela: ManutencaoResponse, acao: string): void {
    this.aviso.set(null);
    if (acao === 'editar') { this.editando.set(janela); return; }
    if (acao === 'alterarFim') { this.alterandoFim.set(janela); return; }
    if (acao !== 'cancelar' && acao !== 'encerrar') return;
    this.erroDialogo.set(null);
    this.confirmando.set({ acao, janela });
  }

  protected abrirAgendamento(): void { this.aviso.set(null); this.preset.set(null); this.agendando.set(true); }
  protected aoSalvar(j: ManutencaoResponse): void { this.editando.set(null); this.aviso.set(`Janela #${j.id} atualizada.`); this.carregar(); }
  protected aoAlterarFim(j: ManutencaoResponse): void { this.alterandoFim.set(null); this.aviso.set(`Fim da janela #${j.id} alterado para ${dataHora(j.fimPrevisto)}.`); this.carregar(); }
  protected aoContinuar(p: PresetAgendamento): void { this.alterandoFim.set(null); this.preset.set(p); this.agendando.set(true); this.carregar(); }

  /** "editada por Ana às 23/10 10:42" — só a última alteração (MA24). */
  protected linhaAlteracao(janela: ManutencaoResponse): string | null {
    const a = janela.ultimaAlteracao;
    if (!a) return null;
    const verbo = a.tipo === 'PRORROGACAO' ? 'prorrogada' : a.tipo === 'ANTECIPACAO' ? 'fim antecipado' : 'editada';
    return `${verbo} por ${a.por.nome} às ${dataHora(a.em)}`;
  }
```

Template:
- célula "Criado por": `{{ janela.criadoPor.nome }}@if (linhaAlteracao(janela); as l) { <small class="desvio desvio--neutro">{{ l }}</small> }`
- no fim, dentro de `@if (podeGerenciar())`:

```html
    <app-agendar-manutencao [aberto]="agendando()" [preset]="preset()" [duracaoMaximaHoras]="parametros()?.duracaoMaximaHoras ?? 72" (fechar)="agendando.set(false)" (agendada)="aoAgendar($event)" />
    <app-agendar-manutencao [aberto]="!!editando()" [janela]="editando()" [duracaoMaximaHoras]="parametros()?.duracaoMaximaHoras ?? 72" (fechar)="editando.set(null)" (salva)="aoSalvar($event)" />
    <app-alterar-fim [aberto]="!!alterandoFim()" [janela]="alterandoFim()" [duracaoMaximaHoras]="parametros()?.duracaoMaximaHoras ?? 72" (fechar)="alterandoFim.set(null)" (alterado)="aoAlterarFim($event)" (continuar)="aoContinuar($event)" />
```

(`AlterarFimComponent` no `imports`. O de criação e o de edição são duas instâncias, cada uma sempre montada: o retorno do foco do `app-modal` depende da transição aberto → fechado.)

Specs novas em `manutencao-list.component.spec.ts`: AGENDADA mostra Editar+Cancelar; ATIVA mostra Alterar fim desabilitado com agendador desligado; "editada por Ana às …" aparece com `ultimaAlteracao`; continuar abre o modal de agendar com o preset.

- [ ] **Step 4: Run** — `npx ng test --watch=false --include src/app/features/manutencoes`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add infra-monitor-frontend/src/app/features/manutencoes/alterar-fim.component.*
git commit -m "feat(manutencoes): alterar fim, continuacao e edicao na lista" -- \
  infra-monitor-frontend/src/app/features/manutencoes/
```

---

### Task 7: Front — Equipamentos (menu da linha e drawer)

**Files:**
- Modify: `features/equipamentos/equipamento-list.component.{ts,html}`, `equipamento-list.component.spec.ts`
- Modify: `features/equipamentos/equipamento-detalhe-drawer.component.{ts,html}`, `equipamento-detalhe-drawer.spec.ts`

**Interfaces:**
- Consumes: Task 5 (`AgendarManutencaoComponent` com `preset`, `ManutencaoApiService.parametros()`, `PresetAgendamento`).
- Produces: drawer `readonly agendarManutencao = output<void>()` e `readonly podeAgendar = input(false)`.

- [ ] **Step 1: Failing specs**
  - `equipamento-list.component.spec.ts`: o menu de uma linha ativa tem "Agendar manutenção" habilitado quando `/manutencoes/parametros` devolve `agendadorLigado: true`; desabilitado para linha inativa e com agendador desligado; clicar abre o modal com a unidade da linha travada e o equipamento marcado (responder `/unidades` e `/dashboard/equipamentos` do modal); `agendada` mostra aviso `Janela #N agendada.` e recarrega o inventário.
  - `equipamento-detalhe-drawer.spec.ts`: com `acoesDeGestao=true`, usuário OPERADOR e linha ativa, existe o botão "Agendar manutenção" e ele emite `agendarManutencao`; com `podeAgendar=false` está `disabled` com `title="Agendamento desligado neste servidor"`; **com `acoesDeGestao=false` (Mapa) o botão não existe** (Review Focus 5).

- [ ] **Step 2: Run to verify fail** — `npx ng test --watch=false --include src/app/features/equipamentos`.

- [ ] **Step 3: Implement**

Drawer `.ts`: `readonly podeAgendar = input(false);` `readonly agendarManutencao = output<void>();`

Drawer `.html`, dentro do segundo `@if (acoesDeGestao() && authState.canManageInventory())`, depois do botão de manutenção manual:

```html
      @if (linha()?.ativo) {
        <button class="botao" type="button" (click)="agendarManutencao.emit()" [disabled]="!podeAgendar()"
                [attr.title]="podeAgendar() ? null : 'Agendamento desligado neste servidor'">Agendar manutenção</button>
      }
```

Lista `.ts`:

```ts
  private readonly manutencaoApi = inject(ManutencaoApiService);
  protected readonly parametrosManutencao = signal<ParametrosManutencao | null>(null);
  protected readonly agendadorLigado = computed(() => this.parametrosManutencao()?.agendadorLigado === true);
  protected readonly agendando = signal(false);
  protected readonly presetAgendamento = signal<PresetAgendamento | null>(null);
  // no constructor:
  //   this.manutencaoApi.parametros().pipe(take(1)).subscribe({ next: (p) => this.parametrosManutencao.set(p), error: () => this.parametrosManutencao.set(null) });
```

`itensDoMenu`: depois do item de manutenção manual, antes de `excluir`:

```ts
      { id: 'agendarManutencao', rotulo: 'Agendar manutenção', desabilitado: !podeGerenciar || !linha.ativo || !this.agendadorLigado() },
```

`executarAcao`: `case 'agendarManutencao': this.abrirAgendamento(linha); break;`

```ts
  protected abrirAgendamento(linha: DashboardEquipamentoLista): void {
    this.aviso.set(null);
    this.presetAgendamento.set({ unidadeId: linha.unidadeId, travarUnidade: true, equipamentoIds: [linha.id] });
    this.agendando.set(true);
  }

  protected agendarDoDetalhe(): void {
    const linha = this.detalheLinha();
    if (!linha) return;
    this.guardarGatilhoDaGaveta();
    this.abrirAgendamento(linha);
  }

  protected fecharAgendamento(): void { this.agendando.set(false); this.devolverFocoAGaveta(); }

  protected aoAgendar(janela: ManutencaoResponse): void {
    this.fecharAgendamento();
    const outras = janela.sobreposicoes.map((id) => `#${id}`);
    this.aviso.set(`Janela #${janela.id} agendada.` + (outras.length ? ` Atenção: sobrepõe ${outras.length === 1 ? 'a janela' : 'as janelas'} ${outras.join(', ')}.` : ''));
    this.carregar();
  }
```

(Conferir o nome real do método que recarrega o inventário em `equipamento-list.component.ts` e do signal de aviso; `devolverFocoAGaveta` só age quando um gatilho foi guardado — confirmar lendo a implementação.)

Lista `.html`: no drawer `[podeAgendar]="agendadorLigado()" (agendarManutencao)="agendarDoDetalhe()"`; e, sob `@if (authState.canManageInventory())`:

```html
  <app-agendar-manutencao [aberto]="agendando()" [preset]="presetAgendamento()" [duracaoMaximaHoras]="parametrosManutencao()?.duracaoMaximaHoras ?? 72"
    (fechar)="fecharAgendamento()" (agendada)="aoAgendar($event)" />
```

O Mapa não muda: já passa `[acoesDeGestao]="false"` e não passa `podeAgendar` (padrão `false`).

- [ ] **Step 4: Run** — `npx ng test --watch=false --include src/app/features/equipamentos` e `--include src/app/features/mapa`. Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(equipamentos): agendar manutencao pelo menu da linha e pelo drawer" -- infra-monitor-frontend/src/app/features/equipamentos/`

---

### Task 8: Front — Unidade (botão e banner)

**Files:**
- Modify: `features/unidades/unidade-detalhe.component.{ts,html,scss}`, `unidade-detalhe.component.spec.ts`

Usar a skill `frontend-design` para o banner (tom informativo, mesmo tratamento visual de `.banner-agendador` em `manutencao-list.component.scss` / marca de `EM_MANUTENCAO`; nada de cor nova fora dos tokens).

**Interfaces:**
- Consumes: Task 5 (`api.list(…, unidadeId)`, `parametros()`, modal com `preset`, `dataHora`).

- [ ] **Step 1: Failing specs** em `unidade-detalhe.component.spec.ts`:
  - com papel OPERADOR, unidade ativa e `agendadorLigado: true`, o botão "Agendar manutenção" está habilitado e abre o modal com a unidade travada (sem equipamento marcado; escopo padrão "Equipamentos selecionados");
  - desabilitado com `title` "Agendamento desligado neste servidor" quando o agendador está desligado, e "Unidade inativa" quando `cadastro().ativo === false`;
  - VISUALIZADOR não vê o botão;
  - `GET /manutencoes?situacao=VIGENTES&unidadeId=<id>&page=0&size=5` com uma ATIVA e uma AGENDADA renderiza `Janela #41 ativa até 23/10/2026 12:00 · Troca do switch` e `Próxima: #42 em …`, com link para `/manutencoes`;
  - erro nessa chamada não mostra banner nem erro e o resto da tela segue.

- [ ] **Step 2: Run to verify fail** — `npx ng test --watch=false --include src/app/features/unidades`.

- [ ] **Step 3: Implement**

```ts
  private readonly manutencaoApi = inject(ManutencaoApiService);
  protected readonly authState = inject(AuthStateService);
  protected readonly parametros = signal<ParametrosManutencao | null>(null);
  protected readonly janelas = signal<ManutencaoResponse[]>([]);
  protected readonly agendando = signal(false);
  protected readonly preset = signal<PresetAgendamento | null>(null);
  protected readonly dataHora = dataHora;

  protected readonly ativa = computed(() => this.janelas().find((j) => j.situacao === MaintenanceWindowStatus.Active) ?? null);
  /** A lista VIGENTES vem com ATIVA primeiro e depois por início: a primeira AGENDADA é a próxima. */
  protected readonly proxima = computed(() => this.janelas().find((j) => j.situacao === MaintenanceWindowStatus.Scheduled) ?? null);
  protected readonly bloqueioAgendar = computed(() =>
    this.parametros()?.agendadorLigado !== true ? 'Agendamento desligado neste servidor'
      : this.store.cadastro()?.ativo === false ? 'Unidade inativa' : null);

  // constructor, depois de this.store.carregar(id):
  //   this.manutencaoApi.parametros().pipe(take(1)).subscribe({ next: (p) => this.parametros.set(p), error: () => this.parametros.set(null) });
  //   this.carregarJanelas(id);

  private carregarJanelas(id: number): void {
    // Falha esconde o banner sem derrubar a tela (memória: lista da unidade).
    this.manutencaoApi.list('VIGENTES', '', 0, 5, id).pipe(take(1)).subscribe({
      next: (r) => this.janelas.set(r.content), error: () => this.janelas.set([]),
    });
  }

  protected abrirAgendamento(): void {
    this.preset.set({ unidadeId: this.store.id(), travarUnidade: true });
    this.agendando.set(true);
  }

  protected aoAgendar(): void { this.agendando.set(false); this.carregarJanelas(this.store.id()); }
```

HTML — substituir o botão desabilitado (linhas 43–44, com o comentário TODO):

```html
        @if (authState.canManageInventory()) {
          <button class="botao" type="button" (click)="abrirAgendamento()" [disabled]="!!bloqueioAgendar() || !store.cadastro()"
                  [attr.title]="bloqueioAgendar()">Agendar manutenção</button>
        }
```

Banner, logo depois do `</header>` e antes de `<div class="kpis">`:

```html
    @if (ativa() || proxima()) {
      <div class="banner-janela" role="status">
        <span class="marca marca--info" aria-hidden="true"><app-icon name="wrench" /></span>
        <div>
          @if (ativa(); as a) { <p><strong>Janela #{{ a.id }} ativa até {{ dataHora(a.fimPrevisto) }}</strong> · {{ a.motivo }}</p> }
          @if (proxima(); as p) { <p>Próxima: #{{ p.id }} em {{ dataHora(p.inicioPrevisto) }} · {{ p.motivo }}</p> }
        </div>
        <a class="link" routerLink="/manutencoes">Ver janelas</a>
      </div>
    }
```

(Conferir o nome do ícone disponível em `AppIconComponent` — usar o mesmo de "Manutenções" na sidebar.) E, sob `@if (authState.canManageInventory())`, no fim do template: `<app-agendar-manutencao [aberto]="agendando()" [preset]="preset()" [duracaoMaximaHoras]="parametros()?.duracaoMaximaHoras ?? 72" (fechar)="agendando.set(false)" (agendada)="aoAgendar()" />`. Imports: `AgendarManutencaoComponent`.

`unidade-detalhe.component.scss`: `.banner-janela` com o mesmo tratamento de `.banner-agendador` da lista de manutenções (flex, gap, borda e fundo do tom info), responsivo (empilha < 600 px).

- [ ] **Step 4: Run** — `npx ng test --watch=false --include src/app/features/unidades`. Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(unidades): agendar manutencao e banner de janelas vigentes" -- infra-monitor-frontend/src/app/features/unidades/`

---

### Task 9: E2E por clique, exercício no banco da carga e evidência

**Files:**
- Create: `infra-monitor-frontend/e2e/manutencao-agendada-f2.cjs`, pasta `e2e/manutencao-agendada-f2-evidence/`
- Modify: `infra-monitor-frontend/package.json` (script `e2e:manutencao-agendada-f2`)
- Modify: `Docs/validacao-producao/manutencao-agendada-f2.md`

Antes de começar, ler as memórias `banco-carga-real-separado.md`, `e2e-api-port-carga-sem-derrubar-dev.md`, `e2e-sessao-navegacao-por-clique.md`, `taskstop-nao-mata-java-filho.md`, `git-bash-msys-pathconv.md`, `inert-quebra-retorno-de-foco-da-gaveta.md` e `manutencao-agendada-f1-estado.md` em `C:\Users\rbfilho\.claude\projects\C--Users-rbfilho-Documents-infra-monitor\memory\`, e o roteiro `e2e/manutencao-agendada.cjs` (F1) — copiar dele cabeçalho, `checar`, `foto`, log de rede em `finally`, `apontarApi` e as armadilhas.

- [ ] **Step 1: Backend com a F2 contra o banco da carga** — empacotar (`./mvnw -DskipTests package`), copiar o jar para fora do `target` e subir na porta usada pela carga (ver memória), com `MANUTENCAO_AGENDADA_ENABLED=true` e intervalo curto (`MANUTENCAO_AGENDADA_INTERVALO_MS=5000`, conferir o nome da variável em `application.yml`). Flyway aplica a V22 no 5436: registrar `select version, success from flyway_schema_history order by installed_rank desc limit 2`. Escolher o equipamento real ativo, fora de manutenção, **diferente de "Servidor AD Core"**: `select e.id, e.nome, u.nome from equipamento e join unidade u on u.id = e.unidade_id where e.ativo and not e.em_manutencao and e.nome <> 'Servidor AD Core' and u.ativo order by e.id`. Credencial: reativar `f1.manutencao@inframonitor.local` com senha nova só para o exercício (como na F1) e desativar no fim; senha descartada, nunca versionada.

- [ ] **Step 2: Roteiro** `manutencao-agendada-f2.cjs` (variáveis `MANUT_F2_EMAIL`, `MANUT_F2_SENHA`, `MANUT_F2_UNIDADE`, `MANUT_F2_EQUIPAMENTO`), toda navegação por clique depois do login, capturas numeradas:
  1. **Equipamentos, menu da linha**: busca (`#busca-equipamentos`) → menu da linha → "Agendar manutenção" → captura `modal-da-linha` (unidade travada, equipamento marcado) → **Escape fecha e o foco volta ao gatilho do menu** (checar `document.activeElement`) → reabre → início = próximo minuto cheio + 3 min, fim = início + 20 min, motivo `E2E F2 linha` → Agendar → aviso `Janela #N agendada.` → captura.
  2. **Drawer**: clicar o nome do equipamento (abre drawer) → "Agendar manutenção" → captura `modal-do-drawer` → Escape → foco volta ao botão do drawer.
  3. **Unidade**: link da unidade → banner `Próxima: #N` → captura → "Agendar manutenção" → modal com unidade travada → marcar todos → dica "Todos marcados…" → captura → Cancelar (não cria).
  4. **Editar AGENDADA**: menu "Manutenções" → linha #N → Editar → captura com valores carregados → motivo `E2E F2 editada`, início = agora + 90 s → Salvar → aviso `Janela #N atualizada.` + `editada por … às …` → captura.
  5. **ATIVA + prorrogar**: alternar Histórico → Vigentes por clique até a linha virar ATIVA (máx. 150 s) → Alterar fim → +15 min → aviso + `prorrogada por …` → captura.
  6. **Continuação**: Alterar fim → antecipar para agora + 70 s → abrir de novo "Alterar fim" e **esperar 90 s com o diálogo aberto** (o job conclui) → novo fim +30 min → enviar → conteúdo "concluiu às … pingados por alguns segundos" → captura → "Agendar continuação" → modal pré-preenchido (unidade travada, equipamento marcado, motivo) → captura → Agendar → aviso → depois, na linha nova, "Encerrar agora" (limpeza).
  7. **Mapa**: menu "Mapa" → abrir o drawer do equipamento (copiar a mecânica de `e2e/m06-drawer-no-mapa.cjs`) → checar que **não existe** botão "Agendar manutenção" → captura.
  8. Limpeza final: nenhuma janela E2E F2 em VIGENTES (cancelar/encerrar pelo menu, por clique).

  Gravar `manutencao-agendada-f2.json` com resultados e rede em `finally`.

- [ ] **Step 3: Rodar** — `MSYS_NO_PATHCONV=1 MANUT_F2_EMAIL=… npm run e2e:manutencao-agendada-f2` (com `BASE` e `API_PORT` conforme memória). Expected: todas as linhas `OK`; nenhuma `FALHA`. Falha = corrigir o código (não o roteiro), salvo seletor errado comprovado.

- [ ] **Step 4: Conferência por SQL no 5436** (registrar saída literal na evidência):

```sql
select id, status, versao, inicio_previsto, fim_previsto, ativada_em, encerrada_em, encerrada_por_id
  from manutencao_agendada where motivo like 'E2E F2%' order by id;
select manutencao_id, tipo, alterado_em, antes->>'motivo' a, depois->>'motivo' d, antes->>'fimPrevisto' fa, depois->>'fimPrevisto' fd
  from manutencao_agendada_alteracao order by id;
select id, nome, em_manutencao, manutencao_manual from equipamento where id = <equipamento>;
select count(*) from incidente where monitor_id in (select id from monitor where equipamento_id = <equipamento>)
  and aberto_em > '<inicio do exercicio>';
select count(*) from equipamento e where e.em_manutencao <> (e.manutencao_manual or exists (
  select 1 from manutencao_agendada ma where ma.status = 'ATIVA' and ((ma.escopo = 'UNIDADE' and ma.unidade_id = e.unidade_id)
  or (ma.escopo = 'EQUIPAMENTOS' and exists (select 1 from manutencao_agendada_equipamento mae where mae.manutencao_id = ma.id and mae.equipamento_id = e.id)))));
```

(Conferir o nome real das colunas de `incidente` antes de rodar.) Esperado: alterações EDICAO, PRORROGACAO e ANTECIPACAO com autor; equipamento fora de manutenção no fim; zero divergentes.

- [ ] **Step 5: Evidência** — em `Docs/validacao-producao/manutencao-agendada-f2.md`: seções `## E2E` (tabela passo → OK, lista de capturas), `## Exercício no banco da carga` (equipamento usado, nunca o AD Core; SQL e saídas), e o intervalo de segundos observado na continuação (instante de conclusão × ativação da nova).

- [ ] **Step 6: Commit**

```bash
git add infra-monitor-frontend/e2e/manutencao-agendada-f2.cjs infra-monitor-frontend/e2e/manutencao-agendada-f2-evidence
git commit -m "test(e2e): fluxos da F2 por clique e exercicio no banco da carga" -- \
  infra-monitor-frontend/e2e/manutencao-agendada-f2.cjs infra-monitor-frontend/e2e/manutencao-agendada-f2-evidence \
  infra-monitor-frontend/package.json Docs/validacao-producao/manutencao-agendada-f2.md
```

---

### Task 10: Suítes completas, documentação e estado

**Files:**
- Modify: `Docs/manutencao-agendada-architecture/manutencao-agendada-desenho.md` (§9 F2 → entregue; nova §11 "F2 entregue" curta apontando para spec e MA19–MA26), `manutencao-agendada-pendencias.md` (F2 decididas; dívidas novas, se houver), `Docs/validacao-producao/manutencao-agendada-f2.md` (`## Suítes`), `infra-monitor-backend/README.md` (rotas novas e MA25 na seção da variável `MANUTENCAO_AGENDADA_ENABLED`).

- [ ] **Step 1: Backend com Docker** — `./mvnw test 2>&1 | tail -40`. Expected: `Tests run: N, Failures: 0, Errors: 0`, **sem** a linha `!! … classes puladas`. Registrar N (era 656 na F1 + novos).
- [ ] **Step 2: Front** — `npx ng test --watch=false` e `npx ng build`. Expected: todas verdes; build sem erro de budget. Registrar as contagens.
- [ ] **Step 3: Docs** — atualizar os arquivos acima; README do backend: `PUT /api/v1/manutencoes/{id}` (AGENDADA, funciona com o agendador desligado), `PATCH /api/v1/manutencoes/{id}/fim` (ATIVA, exige agendador), `GET /api/v1/manutencoes/{id}`, `unidadeId` na listagem.
- [ ] **Step 4: Commit** — `git commit -m "docs(manutencao-agendada): F2 entregue, suites e README" -- Docs/ infra-monitor-backend/README.md`
- [ ] **Step 5: Memória** — atualizar `manutencao-agendada-f1-estado.md` (ou criar `manutencao-agendada-f2-estado.md`) com: F2 pronta no branch, V22 aplicada no banco da carga, o que roda na 8080 e com qual flag.
