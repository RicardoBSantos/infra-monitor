# Painel — status coerente, incidentes elegíveis e filtro de tipos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Linha de unidade do Painel com barra/ícone/badge da mesma fonte (`unidade.status`), contadores de incidentes abertos só com incidentes elegíveis, e abas de tipo vindas do catálogo de tipos com contagem honesta.

**Architecture:** Backend: uma condição de elegibilidade no CTE `ESTADOS` de `DashboardReadRepository` alimenta status de monitor, contador por unidade e KPI do resumo. Frontend: `tomDoStatus()` exportado do `StatusBadgeComponent` vira a única tabela status→tom; o Painel deixa de calcular `severidade()` para a unidade. Abas de tipo leem `GET /tipos-equipamento` e contam sobre um índice mínimo `EntradaCadastro`, que declara quando está parcial.

**Tech Stack:** Java 21, Spring Boot 4.1, PostgreSQL 16, Testcontainers; Angular (signals, OnPush), Vitest via `ng test`; Playwright (scripts `.cjs` em `infra-monitor-frontend/e2e/`).

**Spec:** `docs/superpowers/specs/2026-10-19-painel-status-incidentes-tipos-design.md`

## Global Constraints

- Sem Lombok; sem abstração especulativa; sem classe/módulo vazio.
- Nunca editar migration executada. Este plano não cria migration.
- Erros da API no formato `ErroResposta`; prefixo `/api/v1`.
- Frontend: usar `StatusBadgeComponent` e tokens existentes (`--im-success`, `--im-warning`, `--im-danger`, `--im-info-soft`, `--im-text-muted`). **Nenhuma cor nova, nenhum badge local.**
- Teste de integração com Postgres real leva `@RequerDocker`; suíte só conta como completa com Docker (sem aviso `!!`).
- Não criar mock/teste artificial para aumentar contagem.
- Comentários e nomes em português, no estilo dos arquivos vizinhos (comentário curto, só onde o porquê não é óbvio).
- Commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Unidade `SEM_DADOS`/`SEM_EQUIPAMENTOS` (tom `muted`) e `EM_MANUTENCAO` (tom `info`) — linha precisa de barra e ícone legíveis, não só os três tons conhecidos. Teste em Task 2.
2. Índice de cadastro parcial (`totalElements > content.length`, caso real do dev hoje) — abas sem contador e aviso de parcial, nunca "0". Teste em Task 4.
3. Aba selecionada que fica com contagem 0 depois de mudar status/busca — continua clicável para poder voltar. Teste em Task 4.
4. Monitor de equipamento em manutenção com incidente órfão — monitor não pode virar `INDISPONIVEL` no resumo de monitores. Teste em Task 1.
5. `GET /tipos-equipamento` falhando — abas caem para os tipos presentes no índice, Painel não quebra. Teste em Task 4.

---

## File Structure

| Arquivo | Responsabilidade | Task |
|---|---|---|
| `infra-monitor-backend/src/main/java/br/com/inframonitor/dashboard/DashboardReadRepository.java` | CTE `ESTADOS` com elegibilidade; KPI do resumo do mesmo CTE | 1 |
| `infra-monitor-backend/src/main/java/br/com/inframonitor/dashboard/DashboardService.java` | `incidentesAbertos` por equipamento = 0 se inativo/manutenção | 1 |
| `infra-monitor-backend/src/test/java/br/com/inframonitor/dashboard/IncidentesAbertosElegiveisPostgresIntegrationTest.java` (novo) | Integração dos 4 casos | 1 |
| `infra-monitor-backend/docs/contagem-incidentes-abertos.md` (novo) | Classificação dos 13 pontos | 1 |
| `infra-monitor-frontend/src/app/shared/status-badge/status-badge.component.ts` (+spec) | Exporta `TomStatus` e `tomDoStatus()` | 2 |
| `infra-monitor-frontend/src/app/shared/app-icon/app-icon.component.ts` | Ícones `check`, `wrench`, `minus` | 2 |
| `infra-monitor-frontend/src/styles/_ui.scss` | `.marca--success/warning/danger/muted/info`, chip | 2 |
| `infra-monitor-frontend/src/app/features/dashboard/dashboard.component.{ts,html,scss,spec.ts}` | Linha (2), banner (3), abas (4) | 2, 3, 4 |
| `infra-monitor-frontend/e2e/painel-status-tipos.cjs` (novo) + `package.json` script | e2e por clique, capturas | 5 |

Paralelismo: Task 1 (backend) roda em paralelo com Tasks 2→3→4 (frontend, sequenciais: mesmo componente). Task 5 depois de todas.

---

### Task 1: Incidentes abertos elegíveis no backend

**Files:**
- Modify: `infra-monitor-backend/src/main/java/br/com/inframonitor/dashboard/DashboardReadRepository.java` (CTE `ESTADOS` linhas ~16-43; `resumo()` linha ~63)
- Modify: `infra-monitor-backend/src/main/java/br/com/inframonitor/dashboard/DashboardService.java` (`operacional`, linha ~159)
- Create: `infra-monitor-backend/src/test/java/br/com/inframonitor/dashboard/IncidentesAbertosElegiveisPostgresIntegrationTest.java`
- Create: `infra-monitor-backend/docs/contagem-incidentes-abertos.md`

**Interfaces:**
- Consumes: nada de outras tasks.
- Produces: contrato JSON inalterado; só muda o valor de `incidentesAbertos` (unidade, detalhe, equipamento), `incidentes.abertos` (resumo) e `monitores.indisponiveis`.

- [ ] **Step 1: Escrever o teste de integração (falha)**

Copie a montagem de container/propriedades de `InventarioDashboardPostgresIntegrationTest` (anotações `@RequerDocker`, `@SpringBootTest(properties = …)`, `PostgreSQLContainer` estático, `@DynamicPropertySource`, `truncate` no `@BeforeEach`, criação de tipo/unidade/equipamento pelos services). Cenário único numa unidade "Unidade Teste" com 5 equipamentos, cada um com 1 monitor ICMP ativo e 1 medição recente de sucesso (latência 10 ms):

| Equipamento | Ajuste por JDBC | Incidente `ABERTO` inserido por JDBC? | Conta? |
|---|---|---|---|
| `NORMAL` | — | sim | sim |
| `MONITOR-OFF` | `update monitor set ativo=false` | sim | não |
| `EQUIP-OFF` | `update equipamento set ativo=false` | sim | não |
| `MANUT` | `update equipamento set em_manutencao=true` | sim | não |
| `SAUDAVEL` | — | não | — |

Insira os incidentes **depois** dos ajustes, por JDBC, copiando as colunas obrigatórias do `insert` de incidente usado em `InventarioDashboardPostgresIntegrationTest` (ou `IncidenteRepository.inserirSeElegivel` como referência de colunas — não chame esse método, ele recusa inelegível de propósito).

```java
@Test
void soIncidenteDeMonitorAtivoEmEquipamentoAtivoForaDeManutencaoConta() {
    var linha = dashboard.unidades().stream().filter(u -> u.nome().equals("Unidade Teste")).findFirst().orElseThrow();
    assertThat(linha.incidentesAbertos()).isEqualTo(1);
    assertThat(linha.status()).isEqualTo(StatusOperacionalUnidade.DEGRADADA); // NORMAL offline, SAUDAVEL disponível

    assertThat(dashboard.unidade(linha.id()).incidentesAbertos()).isEqualTo(1);

    var resumo = dashboard.resumo();
    assertThat(resumo.incidentes().abertos()).isEqualTo(1);
    // Monitor de equipamento em manutenção com incidente órfão não vira INDISPONIVEL.
    assertThat(resumo.monitores().indisponiveis()).isEqualTo(1);

    var porNome = dashboard.equipamentosDaUnidade(linha.id(), null, null, PageRequest.of(0, 20, Sort.by("nome")))
            .stream().collect(Collectors.toMap(DashboardEquipamentoResponse::nome, DashboardEquipamentoResponse::incidentesAbertos));
    assertThat(porNome).containsEntry("NORMAL", 1L).containsEntry("MONITOR-OFF", 0L)
            .containsEntry("EQUIP-OFF", 0L).containsEntry("MANUT", 0L).containsEntry("SAUDAVEL", 0L);
}
```

Ajuste os acessores aos nomes reais dos records (`DashboardResumoResponse`, `DashboardUnidadeResponse`, `DashboardEquipamentoResponse` em `dashboard/dto`) e o tipo de `incidentesAbertos` (long/Long). Injete `DashboardService dashboard`.

- [ ] **Step 2: Rodar e ver falhar**

Run (em `infra-monitor-backend/`): `./mvnw test -Dtest=IncidentesAbertosElegiveisPostgresIntegrationTest`
Expected: FAIL — unidade com `incidentesAbertos` = 4, resumo = 4, `MANUT` = 1. Se aparecer "pulada: Docker indisponivel", pare e reporte: o teste não rodou.

- [ ] **Step 3: Elegibilidade no CTE**

Em `ESTADOS`, troque o bloco `monitor_estado` por:

```sql
), monitor_estado as (
    select m.id, m.equipamento_id, m.ativo,
        case when not m.ativo then 'DESABILITADO'
             when i.id is not null and e.ativo and not e.em_manutencao then 'INDISPONIVEL'
             when um.id is null then 'SEM_DADOS'
             when um.latencia_ms is not null and um.latencia_ms > ?1 then 'DEGRADADO'
             else 'DISPONIVEL' end as status,
        -- Incidente de monitor desativado ou de equipamento inativo/em manutencao e orfao:
        -- continua na lista de incidentes, mas nao e leitura operacional.
        case when i.id is not null and m.ativo and e.ativo and not e.em_manutencao then 1 else 0 end as incidente_aberto,
        um.latencia_ms, um.executado_em, um.id as medicao_id
    from monitor m
    join equipamento e on e.id = m.equipamento_id
    left join ultima_medicao um on um.monitor_id = m.id
    left join incidente i on i.monitor_id = m.id and i.status in ('ABERTO', 'RECONHECIDO')
```

Em `resumo()`, troque `(select count(*) from incidente where status in ('ABERTO', 'RECONHECIDO'))` por `(select coalesce(sum(incidente_aberto), 0) from monitor_estado)`.

- [ ] **Step 4: Contador por equipamento**

Em `DashboardService.operacional`, troque o argumento
`monitorAtivo.stream().filter(m -> incidentes.containsKey(m.getId())).count()` por

```java
equipamento.isAtivo() && !equipamento.isEmManutencao()
        ? monitorAtivo.stream().filter(m -> incidentes.containsKey(m.getId())).count() : 0L,
```

- [ ] **Step 5: Rodar o teste novo e a suíte do dashboard**

Run: `./mvnw test -Dtest='IncidentesAbertosElegiveisPostgresIntegrationTest,InventarioDashboardPostgresIntegrationTest,OperationalStatusResolverTest,DashboardControllerTest,IncidenteUnificadoPostgresIntegrationTest'`
Expected: PASS, sem classes puladas.

- [ ] **Step 6: Documento de classificação**

Crie `infra-monitor-backend/docs/contagem-incidentes-abertos.md` com: a regra de elegibilidade; a tabela dos 13 pontos (abaixo) com coluna "Decisão"; a divergência intencional do KPI de período (Relatórios/PDF); e as pendências de domínio.

| # | Ponto | Decisão |
|---|---|---|
| 1 | Contador por unidade (`/dashboard/unidades`: Painel, Mapa, lista de Unidades) | Ignora inelegíveis (corrigido) |
| 2 | Detalhe da unidade (`/dashboard/unidades/{id}`) | Ignora (mesma consulta) |
| 3 | KPI "Incidentes abertos" do resumo, banner e badge da sidebar | Ignora (sai do mesmo CTE) |
| 4 | `incidentesAbertos` por equipamento (`/dashboard/unidades/{id}/equipamentos`) | Ignora (0 se inativo/manutenção) |
| 5 | Banner do Painel (lista descritiva e "+N") | Ignora: "+N" deriva do KPI; lista busca ABERTO e RECONHECIDO |
| 6 | Lista `/incidentes` (`DashboardIncidenteReadRepository.listar`) | Mantém: registro e único lugar de fechar órfão |
| 7 | Abas da lista `/incidentes` | Mantém (casa com a lista) |
| 8 | `GET /incidentes` (históricos da unidade e drawer) | Mantém |
| 9 | KPI de Relatórios e PDF (`VisaoGeralPdfRepository.coletarKpis`) | Mantém bruto: é "abertos no período", não leitura atual. Pode diferir do Painel |
| 10 | Disponibilidade (`DisponibilidadeSqlRepository`) | Mantém: janelas de monitoramento já excluem desativação/manutenção |
| 11 | Exportação CSV de incidentes | Mantém (histórico) |
| 12 | Motor, `abertosDoEquipamento`, guarda de duplicidade | Mantém (controle, não exibição) |
| 13 | Notificações/Telegram | Nada a mudar |

Pendências: (a) desativar monitor/equipamento não fecha o incidente aberto (manutenção fecha); (b) `POST /incidentes` manual não valida elegibilidade; (c) unidade inativa continua monitorada e abrindo incidente — o KPI do resumo cobre todas as unidades, a soma das linhas só as ativas.

- [ ] **Step 7: Commit**

```bash
git add infra-monitor-backend/src/main/java/br/com/inframonitor/dashboard/DashboardReadRepository.java \
        infra-monitor-backend/src/main/java/br/com/inframonitor/dashboard/DashboardService.java \
        infra-monitor-backend/src/test/java/br/com/inframonitor/dashboard/IncidentesAbertosElegiveisPostgresIntegrationTest.java \
        infra-monitor-backend/docs/contagem-incidentes-abertos.md
git commit -m "fix(dashboard): incidente aberto so conta com monitor e equipamento elegiveis"
```

---

### Task 2: Linha de unidade com fonte única de tom

**Files:**
- Modify: `infra-monitor-frontend/src/app/shared/status-badge/status-badge.component.ts` (+ `status-badge.component.spec.ts`)
- Modify: `infra-monitor-frontend/src/app/shared/app-icon/app-icon.component.ts`
- Modify: `infra-monitor-frontend/src/styles/_ui.scss` (linhas ~55-67)
- Modify: `infra-monitor-frontend/src/app/features/dashboard/dashboard.component.{ts,html,scss,spec.ts}`

**Interfaces:**
- Produces: `export type TomStatus = 'success' | 'warning' | 'danger' | 'muted' | 'info';` e `export function tomDoStatus(status: DisplayStatus): TomStatus` em `status-badge.component.ts`. `AppIconName` ganha `'check' | 'wrench' | 'minus'`.

Use a skill `frontend-design:frontend-design` para os detalhes visuais (tamanho do ícone, posição do chip), dentro das restrições abaixo.

- [ ] **Step 1: Testes que falham**

Em `status-badge.component.spec.ts`:

```ts
import { tomDoStatus } from './status-badge.component';
it('expõe o mesmo tom que o badge usa', () => {
  expect(tomDoStatus('DISPONIVEL')).toBe('success');
  expect(tomDoStatus('DEGRADADA')).toBe('warning');
  expect(tomDoStatus('INDISPONIVEL')).toBe('danger');
  expect(tomDoStatus('SEM_DADOS')).toBe('muted');
  expect(tomDoStatus('SEM_EQUIPAMENTOS')).toBe('muted');
  expect(tomDoStatus('EM_MANUTENCAO')).toBe('info');
});
```

Em `dashboard.component.spec.ts` (helper `responderCarga` já existe), adicione:

```ts
const atalaia = { ...unidade, id: 3, nome: 'Hotel Sesc Atalaia', status: UnitOperationalStatus.Available, equipamentosTotal: 18, equipamentosAtivos: 18,
  equipamentosDisponiveis: 17, equipamentosDegradados: 0, equipamentosIndisponiveis: 0, equipamentosSemDados: 0, equipamentosEmManutencao: 1, incidentesAbertos: 0 };

it('barra, ícone e badge seguem unidade.status: disponível com manutenção parcial fica verde', () => {
  const fixture = create();
  responderCarga(fixture, { ...resumo, incidentes: { abertos: 0 } }, [atalaia]);
  const linha = (fixture.nativeElement as HTMLElement).querySelector('.unidade')!;
  expect(linha.classList).toContain('unidade--success');
  expect(linha.querySelector('.marca')!.classList).toContain('marca--success');
  expect(linha.querySelector('app-icon')!.getAttribute('ng-reflect-name') ?? linha.querySelector('.marca app-icon')!.outerHTML).toContain('check');
  expect(linha.querySelector('app-status-badge')!.textContent).toContain('Disponível');
  expect(linha.querySelector('.chip-manutencao')!.textContent).toContain('1 em manutenção');
});

it.each([
  [UnitOperationalStatus.Degraded, 'warning'], [UnitOperationalStatus.Unavailable, 'danger'],
  [UnitOperationalStatus.NoData, 'muted'], [UnitOperationalStatus.NoEquipment, 'muted'], [UnitOperationalStatus.Maintenance, 'info'],
])('linha com status %s usa tom %s', (status, tom) => {
  const fixture = create();
  responderCarga(fixture, { ...resumo, incidentes: { abertos: 0 } }, [{ ...unidade, status, incidentesAbertos: 0 }]);
  const linha = (fixture.nativeElement as HTMLElement).querySelector('.unidade')!;
  expect(linha.classList).toContain(`unidade--${tom}`);
  expect(linha.querySelector('.marca')!.classList).toContain(`marca--${tom}`);
});
```

Se `ng-reflect-name` não existir no build de teste, identifique o ícone por um atributo explícito: renderize `<app-icon [name]="icone" [attr.data-icone]="icone" />` na marca e asserte `data-icone`. Remova/ajuste testes existentes que afirmam `unidade--critica`/`unidade--atencao`/`severidade`.

- [ ] **Step 2: Rodar e ver falhar**

Run (em `infra-monitor-frontend/`): `npx ng test --watch=false --include='src/app/shared/status-badge/**' --include='src/app/features/dashboard/**'`
Expected: FAIL (`tomDoStatus` não exportado; classes `unidade--success` ausentes).

- [ ] **Step 3: `tomDoStatus`**

Em `status-badge.component.ts`: tipar `TONES` como `Record<DisplayStatus, TomStatus>`, exportar `TomStatus` e:

```ts
/** Tom do status: a mesma tabela do badge, para quem precisa pintar algo ao lado dele. */
export function tomDoStatus(status: DisplayStatus): TomStatus { return TONES[status]; }
```

O componente passa a usar `tomDoStatus(this.status())`.

- [ ] **Step 4: Ícones**

Em `app-icon.component.ts`, acrescente ao tipo e a `ICON_PATHS`:

```ts
check: 'm5 12.5 4.5 4.5L19 7', minus: 'M6 12h12',
wrench: 'M14.7 6.3a4 4 0 0 0-5.4 5.1L4 16.7 7.3 20l5.3-5.3a4 4 0 0 0 5.1-5.4l-2.4 2.4-2.6-.6-.6-2.6 2.4-2.4Z',
```

- [ ] **Step 5: Primitivas em `_ui.scss`**

Renomeie/complete as variantes de `.marca` para os nomes de tom (procure outros usos de `marca--ok|warn|down` com `grep -rn "marca--" src` e atualize-os junto):

```scss
.marca app-icon { width: 16px; height: 16px; }
.marca--success { background: rgba(52, 199, 123, .12); color: var(--im-success); }
.marca--warning { background: rgba(232, 163, 61, .14); color: var(--im-warning); }
.marca--danger { background: rgba(229, 72, 77, .14); color: var(--im-danger); }
.marca--muted { background: rgba(99, 118, 138, .12); color: var(--im-text-muted); }
.marca--info { background: rgba(76, 141, 255, .12); color: var(--im-info-soft); }
```

Chip: `.chip-manutencao app-icon { width: 11px; height: 11px; }` e altura que caiba o rótulo; nenhuma cor nova.

- [ ] **Step 6: Painel**

`dashboard.component.ts`: remova `severidade(unidade)`; adicione

```ts
protected tomDaUnidade(unidade: DashboardUnidade): TomStatus { return tomDoStatus(unidade.status); }
protected iconeDoTom(tom: TomStatus): AppIconName { return ICONE_DO_TOM[tom]; }
```

com `const ICONE_DO_TOM: Record<TomStatus, AppIconName> = { success: 'check', warning: 'incident', danger: 'close', muted: 'minus', info: 'wrench' };`. `rotuloManutencao` permanece (aria/title); rótulo visível: `{{ unidade.equipamentosEmManutencao }} em manutenção`.

`dashboard.component.html`, na linha da unidade:

```html
<div class="unidade" [class]="'unidade unidade--' + tomDaUnidade(unidade)">
  …
  <span class="marca" [class]="'marca marca--' + tomDaUnidade(unidade)" aria-hidden="true">
    <app-icon [name]="iconeDoTom(tomDaUnidade(unidade))" [attr.data-icone]="iconeDoTom(tomDaUnidade(unidade))" />
  </span>
  …
  <span class="linha__estado">
    <app-status-badge [status]="unidade.status" />
    @if (manutencaoParcial(unidade)) {
      <span class="chip-manutencao" [title]="rotuloManutencao(unidade)" [attr.aria-label]="rotuloManutencao(unidade)"><app-icon name="wrench" />{{ unidade.equipamentosEmManutencao }} em manutenção</span>
    }
  </span>
```

`dashboard.component.scss`: `.unidade` mantém `border-left: 3px solid`; troque `.unidade--critica/.unidade--atencao` por

```scss
.unidade--success { border-left-color: var(--im-success); }
.unidade--warning { border-left-color: var(--im-warning); }
.unidade--danger { border-left-color: var(--im-danger); }
.unidade--muted { border-left-color: var(--im-text-muted); }
.unidade--info { border-left-color: var(--im-info-soft); }
.linha__estado { flex-direction: column; align-items: flex-start; gap: 4px; }
```

Garanta que nada da coluna de status ultrapasse a coluna (`min-width: 0`, `max-width: 100%` no chip, `white-space: nowrap`; se não couber em 116px, aumente a 2ª coluna de `--pn-colunas` para o mínimo necessário e confira o breakpoint `@media (max-width: 1240px)`).

- [ ] **Step 7: Rodar testes**

Run: `npx ng test --watch=false`
Expected: PASS (suíte inteira do front).

- [ ] **Step 8: Commit**

```bash
git add infra-monitor-frontend/src
git commit -m "fix(painel): barra, icone e badge da unidade seguem unidade.status"
```

---

### Task 3: Banner do Painel coerente com o KPI

**Files:**
- Modify: `infra-monitor-frontend/src/app/features/dashboard/dashboard.component.{ts,spec.ts}`

**Interfaces:**
- Consumes: `IncidenteApiService.list({ status, size, sort })` existente; `IncidentStatus.Open` e `IncidentStatus.Acknowledged` (confirme o nome do membro `RECONHECIDO` em `core/models/api-enums.ts`).

- [ ] **Step 1: Teste que falha**

```ts
it('banner usa o KPI para o "+N" e descreve abertos e reconhecidos', () => {
  const fixture = create();
  const reconhecido = { ...incidenteAberto, id: 91, status: 'RECONHECIDO', iniciadoEm: '2026-08-19T11:50:00Z' };
  responderCargaSemIncidentes(fixture, { ...resumo, incidentes: { abertos: 7 } });
  httpTesting.expectOne((r) => r.url.endsWith('/api/v1/incidentes') && r.params.get('status') === 'ABERTO').flush(pagina([incidenteAberto]));
  httpTesting.expectOne((r) => r.url.endsWith('/api/v1/incidentes') && r.params.get('status') === 'RECONHECIDO').flush(pagina([reconhecido]));
  fixture.detectChanges();
  expect(texto(fixture)).toContain('+5 incidentes');
});
```

Extraia de `responderCarga` um `responderCargaSemIncidentes` (tudo menos o bloco final de incidentes) e faça `responderCarga` responder as duas chamadas (`ABERTO` com `incidentesBody`, `RECONHECIDO` com `[]`).

- [ ] **Step 2: Rodar e ver falhar** — `npx ng test --watch=false --include='src/app/features/dashboard/**'`; Expected: FAIL.

- [ ] **Step 3: Implementar**

`carregarIncidentes()` faz `forkJoin` das duas listas (`size: INCIDENTES_NO_BANNER`, `sort: 'iniciadoEm,desc'`), junta, ordena por `iniciadoEm` desc, guarda. `descricaoIncidentes` descreve os `INCIDENTES_NO_BANNER` primeiros e calcula `restantes = (this.resumo()?.incidentes.abertos ?? abertos.length) - descritos.length`, com piso 0. Erro de qualquer chamada → lista vazia (comportamento atual).

- [ ] **Step 4: Rodar** — `npx ng test --watch=false`; Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -m "fix(painel): banner descreve abertos e reconhecidos e conta pelo KPI"`

---

### Task 4: Abas de tipo pelo catálogo, com contagem honesta

**Files:**
- Modify: `infra-monitor-frontend/src/app/features/dashboard/dashboard.component.{ts,html,scss,spec.ts}`

**Interfaces:**
- Consumes: `TipoEquipamentoApiService.list(): Observable<TipoEquipamentoResponse[]>` (`core/services/tipo-equipamento-api.service.ts`); `TipoEquipamentoResponse { id; nome; ativo; … }`.
- Produces (internos ao Painel, usados pelo item 1 depois): `interface EntradaCadastro { unidadeId: number; tipoId: number; nome: string; hostname: string | null; ip: string | null; }`; signals `cadastro: Map<number, EntradaCadastro[]>`, `cadastroCompleto: boolean | null` (null = não carregado/erro), `cadastroTotal: number | null`; `interface AbaTipo { id: number; nome: string; contagem: number | null; desabilitada: boolean; }`; computed `abasTipo(): AbaTipo[]`, `contagemTodos(): number | null`.

- [ ] **Step 1: Testes que falham**

No helper `responderCarga`, acrescente a resposta de `/api/v1/tipos-equipamento` (parâmetro opcional `tiposBody`, default `[{ id: 2, nome: 'Switch', ativo: true }, { id: 5, nome: 'Câmera', ativo: true }, { id: 9, nome: 'Legado', ativo: false }]` com os demais campos do response) e um parâmetro opcional `cadastroBody` (default `pagina([cadastro])`). Testes:

```ts
it('mostra todos os tipos ativos do catálogo; sem equipamento na visão fica desabilitado com 0', () => {
  const fixture = create(); responderCarga(fixture);
  const abas = [...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('.abas .aba')];
  expect(abas.map((a) => a.textContent!.replace(/\s+/g, ' ').trim())).toEqual(['Todos 1', 'Câmera 0', 'Switch 1']);
  expect(abas[1].disabled).toBe(true);
  expect(abas[2].disabled).toBe(false);
});

it('tipo inativo só aparece se houver equipamento dele', () => {
  const fixture = create();
  responderCarga(fixture, undefined, undefined, undefined, undefined, pagina([cadastro, { ...cadastro, id: 32, tipoEquipamento: { id: 9, nome: 'Legado' } }]));
  expect(texto(fixture)).toContain('Legado');
});

it('índice parcial: abas sem contador, habilitadas, e aviso de parcial', () => {
  const fixture = create();
  responderCarga(fixture, undefined, undefined, undefined, undefined, { ...pagina([cadastro]), totalElements: 221, totalPages: 3, last: false });
  const abas = [...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('.abas .aba')];
  expect(abas.every((a) => !a.disabled)).toBe(true);
  expect(abas.some((a) => /\d/.test(a.textContent!))).toBe(false);
  expect(texto(fixture)).toContain('1 de 221');
});

it('aba selecionada continua clicável quando a visão zera a contagem', () => {
  const fixture = create(); responderCarga(fixture);
  const switchAba = () => [...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('.abas .aba')].find((a) => a.textContent!.includes('Switch'))!;
  switchAba().click(); fixture.detectChanges();
  const busca = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('.filtros__busca input')!;
  busca.value = 'nada-casa'; busca.dispatchEvent(new Event('input')); fixture.detectChanges();
  expect(switchAba().disabled).toBe(false);
});

it('catálogo de tipos falhando cai para os tipos presentes no índice', () => {
  const fixture = create(); responderCarga(fixture, undefined, undefined, undefined, 'erro');
  expect(texto(fixture)).toContain('Switch');
});
```

Ajuste a assinatura de `responderCarga` para aceitar `tiposBody: unknown[] | 'erro'` (com `'erro'` faça `.flush(null, { status: 500, statusText: 'erro' })`) e `cadastroBody`. Como o cadastro carrega em `afterNextRender`, mantenha a ordem de `expectOne` atual; `/tipos-equipamento` pode ser pedido no construtor.

- [ ] **Step 2: Rodar e ver falhar** — `npx ng test --watch=false --include='src/app/features/dashboard/**'`

- [ ] **Step 3: Implementar**

- Injete `TipoEquipamentoApiService`; no construtor `this.tiposApi.list().pipe(take(1)).subscribe({ next: (t) => this.catalogoTipos.set(t), error: () => this.catalogoTipos.set(null) })` com `catalogoTipos = signal<TipoEquipamentoResponse[] | null | undefined>(undefined)`. `atualizar()` recarrega também.
- `carregarCadastro()` mapeia para `EntradaCadastro` e seta `cadastroCompleto.set(pagina.totalElements <= pagina.content.length)`, `cadastroTotal.set(pagina.totalElements)`; erro → `cadastro` vazio, `cadastroCompleto.set(null)`.
- `combinaCadastro` e o filtro de `unidades` passam a usar `EntradaCadastro` (`tipoId` no lugar de `tipoEquipamento.id`).
- Visão atual (sem o filtro de tipo): extraia de `unidades` um computed `unidadesNaVisao` que aplica status e texto; `unidades` = `unidadesNaVisao` + filtro de tipo. Entradas da visão: para cada unidade da visão, todas as entradas se o texto é vazio ou a identidade combina, senão só as que combinam no texto.
- `abasTipo`: catálogo (ou, se `null`, tipos do índice + `detalhes` como hoje, todos tratados como ativos), filtrado por `tipo.ativo || existeNoCadastroInteiro(tipo.id)`, ordenado por nome `pt-BR`. `contagem = cadastroCompleto() === true ? n : null`. `desabilitada = contagem === 0 && filtroTipoId() !== tipo.id`.
- Remova o computed antigo `tipos` e `TipoPresente`.

Template das abas:

```html
<div class="abas" role="group" aria-label="Filtrar por tipo de equipamento">
  <button class="aba" type="button" [class.aba--ativa]="filtroTipoId() === null" (click)="selecionarTipo(null)">Todos @if (contagemTodos() !== null) { <span class="aba__contagem">{{ contagemTodos() }}</span> }</button>
  @for (aba of abasTipo(); track aba.id) {
    <button class="aba" type="button" [class.aba--ativa]="filtroTipoId() === aba.id" [disabled]="aba.desabilitada" (click)="selecionarTipo(aba.id)">{{ aba.nome }} @if (aba.contagem !== null) { <span class="aba__contagem">{{ aba.contagem }}</span> }</button>
  }
</div>
@if (cadastroCompleto() === false) { <p class="abas__parcial" role="status">Contagem por tipo indisponível: índice com {{ cadastroCarregados() }} de {{ cadastroTotal() }} equipamentos.</p> }
```

(`cadastroCarregados` = total de entradas no índice.) SCSS local: `.aba__contagem { color: var(--im-text-dim); font: 10.5px var(--im-mono); }`, `.aba:disabled { opacity: .45; cursor: default; }` (sem hover), `.abas__parcial { margin: 0; color: var(--im-text-dim); font: 11px var(--im-mono); }`.

- [ ] **Step 4: Rodar** — `npx ng test --watch=false`; Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(painel): abas de tipo pelo catalogo com contagem da visao atual"`

---

### Task 5: e2e por clique nos dois bancos, capturas conferidas

**Files:**
- Create: `infra-monitor-frontend/e2e/painel-status-tipos.cjs`; script `"e2e:painel": "node e2e/painel-status-tipos.cjs"` em `package.json`
- Evidência: `infra-monitor-frontend/e2e/painel-status-tipos-evidence/` (dev); capturas da carga fora do repo (scratchpad).

- [ ] **Step 1: Script** — siga o padrão de `e2e/mapa-legenda-painel.cjs` (login por formulário, navegação por clique, `api-porta.cjs` para API 8081, log de rede em `finally`, sem `catch` em seletor). Credenciais: `PAINEL_EMAIL`/`PAINEL_SENHA`. Verificações:
  1. Para cada `.unidade`: o tom de `unidade--*` == tom de `marca--*` == tom do `.badge--*` dentro de `app-status-badge` (mapear `success→success` etc.). Falha se divergir.
  2. Ícone (`[data-icone]`) com bounding box ≥ 14px.
  3. Chip `.chip-manutencao` (se houver) não intersecta a `.faixa` da mesma linha (bounding boxes).
  4. Abas: lista de rótulos sem filtro; clique na pill "Degradado" e captura das abas; busca por texto e captura.
  5. Dev: linha "Hotel Sesc Atalaia" com `unidade--success`, badge "Disponível", chip "1 em manutenção". Carga: abas incluem "Servidor" e "Roteador".
  Capturas: tela inteira, recorte das linhas por status, recorte das abas (sem filtro / com pill / com busca).
- [ ] **Step 2: Rodar no dev** (frontend 4200, API 8080 com o backend desta branch). Conferir cada captura visualmente.
- [ ] **Step 3: Rodar na carga** (container `inframonitor-carga` 5436, jar na 8081 com motor/Telegram/dispatcher desligados). Conferir capturas.
- [ ] **Step 4: Suítes completas** — backend `./mvnw test` (com Docker, sem `!!`), frontend `npx ng test --watch=false`.
- [ ] **Step 5: Commit** do script e da evidência do dev.
