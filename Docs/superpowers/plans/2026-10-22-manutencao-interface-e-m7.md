# Manutenção pela interface, M7 e documentação — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expor iniciar/encerrar manutenção na tela de Equipamentos, recusar incidente manual fora de observação (M7) e corrigir/registrar documentação.

**Architecture:** Backend ganha `emManutencao` no read-model `/dashboard/equipamentos` e uma guarda com lock `FOR UPDATE OF e` em `IncidenteService.criar`. Frontend reusa o fluxo ativar/desativar da lista (menu da linha + output do drawer → `executarAcao` → `ConfirmDialog` → `confirmarAcao`), com o `ConfirmDialog` ganhando tom `primario`.

**Tech Stack:** Java 21, Spring Boot 4.1, PostgreSQL 16, Testcontainers (`@RequerDocker`), Angular (signals, OnPush), Vitest via `ng test`, Playwright (`.cjs` em `e2e/`).

**Spec:** `Docs/superpowers/specs/2026-10-22-manutencao-interface-e-m7-design.md`

**Worktree:** `C:/Users/rbfilho/Documents/infra-monitor-manutencao`, branch `feat/manutencao-interface`. Todo comando roda a partir dele.

## Global Constraints

- Sem Lombok; sem abstração especulativa; não criar classe/módulo vazio.
- Erros de API no formato existente; conflito de regra = `ConflitoException` → 409 `BUSINESS_CONFLICT`.
- Mensagens de backend sem acento, no estilo de `MENSAGEM_INCIDENTE_ABERTO`.
- Classe de teste com `PostgreSQLContainer` precisa de `@RequerDocker`.
- Badge de status: só `StatusBadgeComponent` (`EM_MANUTENCAO` já existe). Nenhum badge local.
- Commits sempre com `git commit -- <arquivos>` (index compartilhado entre agentes paralelos), mensagem terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Nunca editar migration existente; este plano não cria migration.
- Contagem da suíte backend só vale com Docker ativo: procurar `!!` na saída.
- Textos de UI exatamente como na spec (seção "Confirmação").

## Review Focus

1. Equipamento **inativo e em manutenção** (estado alcançável: entrada não valida `ativo`): a linha tem de oferecer "Encerrar manutenção", não "Iniciar" — teste na Task 4.
2. Drawer aberto por deep-link antes do inventário carregar (`linha()` nula): nenhum botão de manutenção, sem erro — teste na Task 4.
3. Usuário sem `canManageInventory`: item do menu desabilitado e botão do drawer ausente — teste na Task 4.
4. Corrida `entrarEmManutencao` × `criar` manual: nunca sobra incidente ABERTO com equipamento em manutenção — teste na Task 2.
5. Diálogos existentes (excluir/desativar/ativar) continuam com botão `--perigo` depois do input novo — teste na Task 3.

---

### Task 1: `emManutencao` no read-model da lista de equipamentos (backend)

**Files:**
- Modify: `infra-monitor-backend/src/main/java/br/com/inframonitor/dashboard/DashboardReadRepository.java` (query `equipamentos`, `equipamento(Object[])`, record `EquipamentoRow`)
- Modify: `infra-monitor-backend/src/main/java/br/com/inframonitor/dashboard/dto/DashboardEquipamentoListaResponse.java`
- Modify: `infra-monitor-backend/src/main/java/br/com/inframonitor/dashboard/DashboardService.java:77-83`
- Test: `infra-monitor-backend/src/test/java/br/com/inframonitor/dashboard/DashboardControllerTest.java:60-80`
- Test: `infra-monitor-backend/src/test/java/br/com/inframonitor/dashboard/InventarioDashboardPostgresIntegrationTest.java` (novo método)

**Interfaces:**
- Produces: JSON de `GET /api/v1/dashboard/equipamentos` ganha `"emManutencao": boolean` em cada item, depois de `numeroSerie`. Record: `DashboardEquipamentoListaResponse(..., String localizacao, String numeroSerie, boolean emManutencao)`.

- [ ] **Step 1: Teste do controller falhando.** Em `expoeInventarioCompletoSemPaginacao`, acrescentar o último argumento nos dois construtores (`false` no primeiro, `true` no segundo) e as asserções:

```java
                .andExpect(jsonPath("$[0].emManutencao").value(false))
                .andExpect(jsonPath("$[1].emManutencao").value(true))
```

- [ ] **Step 2: Teste de integração falhando.** Ler `InventarioDashboardPostgresIntegrationTest` para reaproveitar seu setup (container, truncate, helpers de insert) e acrescentar um teste que cria dois equipamentos — um `ativo=true, em_manutencao=true` e um `ativo=false, em_manutencao=true` — chama `GET /api/v1/dashboard/equipamentos` pelo mesmo mecanismo que a classe já usa e afirma:
  - o primeiro: `status = EM_MANUTENCAO`, `emManutencao = true`;
  - o segundo: `status = DESABILITADO`, `emManutencao = true` (prova que o status sozinho não basta).

- [ ] **Step 3: Rodar e ver falhar.**
Run: `cd infra-monitor-backend && ./mvnw -q test -Dtest=DashboardControllerTest,InventarioDashboardPostgresIntegrationTest`
Expected: erro de compilação (construtor com 13 args) — isso é a falha.

- [ ] **Step 4: Implementar.**
  - Query: `select ... e.ativo, e.localizacao, e.numero_serie, e.em_manutencao` (índice 12).
  - `equipamento(Object[] r)`: último argumento `(Boolean) r[12]`.
  - `EquipamentoRow`: acrescentar `boolean emManutencao` no fim.
  - `DashboardEquipamentoListaResponse`: acrescentar `boolean emManutencao` no fim e uma frase no javadoc: "`emManutencao` vem separado do `status` porque `DESABILITADO` tem precedência sobre `EM_MANUTENCAO` no resolver: a tela precisa do flag para oferecer \"Encerrar manutenção\" a equipamento inativo."
  - `DashboardService.equipamentos`: passar `r.emManutencao()`.

- [ ] **Step 5: Rodar e ver passar** (mesmo comando; com Docker ativo — conferir `docker info`).

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(dashboard): emManutencao na lista de equipamentos" -- infra-monitor-backend/src/main/java/br/com/inframonitor/dashboard infra-monitor-backend/src/test/java/br/com/inframonitor/dashboard
```

---

### Task 2: M7 — recusar incidente manual fora de observação (backend)

**Files:**
- Modify: `infra-monitor-backend/src/main/java/br/com/inframonitor/incidente/repository/IncidenteRepository.java` (query nova + interface de projeção aninhada)
- Modify: `infra-monitor-backend/src/main/java/br/com/inframonitor/incidente/service/IncidenteService.java:32,48-64`
- Test: `infra-monitor-backend/src/test/java/br/com/inframonitor/incidente/service/IncidenteServiceTest.java`
- Create: `infra-monitor-backend/src/test/java/br/com/inframonitor/incidente/AberturaManualElegibilidadePostgresIntegrationTest.java`

**Interfaces:**
- Produces: `IncidenteRepository.Elegibilidade` (interface: `boolean getMonitorAtivo(); boolean getEquipamentoAtivo(); boolean getEmManutencao();`) e `Optional<IncidenteRepository.Elegibilidade> travarElegibilidadeParaAbertura(Long monitorId)`.
- Produces: `POST /api/v1/incidentes` → 409 com mensagens exatas:
  - `Nao e possivel abrir incidente porque o monitor esta inativo`
  - `Nao e possivel abrir incidente porque o equipamento esta inativo`
  - `Nao e possivel abrir incidente porque o equipamento esta em manutencao`

- [ ] **Step 1: Teste de integração falhando.** Criar a classe copiando o cabeçalho de `ManutencaoPostgresIntegrationTest` (anotações `@RequerDocker` + `@SpringBootTest(properties=...)`, container `postgres:16-alpine`, `@DynamicPropertySource`, truncate no `@BeforeEach`, helpers `montarEquipamento`, `montarMonitor`, `insert`, `causaRaiz`). Javadoc da classe: explica que fecha o M7 da `auditoria-concorrencia-ciclo-de-vida.md` e por que há teste concorrente (teste sequencial não prova a corrida). Casos:

```java
    @Test
    void recusaEquipamentoEmManutencaoSemCriarIncidenteNemNotificacao() {
        long equipamentoId = montarEquipamento(true);
        long monitorId = montarMonitor(equipamentoId);

        assertThatThrownBy(() -> incidenteService.criar(new CreateIncidenteRequest(monitorId, T0, "Manual", null)))
                .isInstanceOf(ConflitoException.class)
                .hasMessage("Nao e possivel abrir incidente porque o equipamento esta em manutencao");

        assertThat(contar("incidente")).isZero();
        assertThat(contar("notificacao")).isZero();
    }

    @Test
    void recusaEquipamentoInativo() {
        long equipamentoId = montarEquipamento(false);
        jdbc.update("update equipamento set ativo = false where id = ?", equipamentoId);
        long monitorId = montarMonitor(equipamentoId);

        assertThatThrownBy(() -> incidenteService.criar(new CreateIncidenteRequest(monitorId, T0, "Manual", null)))
                .isInstanceOf(ConflitoException.class)
                .hasMessage("Nao e possivel abrir incidente porque o equipamento esta inativo");
        assertThat(contar("incidente")).isZero();
        assertThat(contar("notificacao")).isZero();
    }

    @Test
    void recusaMonitorInativo() {
        long monitorId = montarMonitor(montarEquipamento(false));
        jdbc.update("update monitor set ativo = false where id = ?", monitorId);

        assertThatThrownBy(() -> incidenteService.criar(new CreateIncidenteRequest(monitorId, T0, "Manual", null)))
                .isInstanceOf(ConflitoException.class)
                .hasMessage("Nao e possivel abrir incidente porque o monitor esta inativo");
        assertThat(contar("incidente")).isZero();
        assertThat(contar("notificacao")).isZero();
    }

    @Test
    void monitorElegivelContinuaAbrindoENotificando() {
        long monitorId = montarMonitor(montarEquipamento(false));

        incidenteService.criar(new CreateIncidenteRequest(monitorId, T0, "Manual", null));

        assertThat(contar("incidente")).isEqualTo(1);
        assertThat(jdbc.queryForObject("select count(*) from notificacao where tipo_evento = 'INCIDENTE_ABERTO'",
                Integer.class)).isEqualTo(1);
    }

    private int contar(String tabela) {
        return jdbc.queryForObject("select count(*) from " + tabela, Integer.class);
    }
```

  Teste concorrente (`@RepeatedTest(20)`), no molde das corridas de `ManutencaoPostgresIntegrationTest` (`CyclicBarrier(2)`, `LIMITE`, `falhas` em `CopyOnWriteArrayList`, `join` com timeout): thread A `equipamentoService.entrarEmManutencao(equipamentoId, operadorId)` (criar o usuário operador como no `@BeforeEach` dessa classe), thread B `incidenteService.criar(...)` capturando `ConflitoException` num `AtomicBoolean recusado`. Depois:

```java
        assertThat(falhas).isEmpty();
        // Desfecho ilegitimo do M7: incidente ABERTO/RECONHECIDO sobrevivendo com o equipamento em manutencao.
        assertThat(jdbc.queryForObject("select count(*) from incidente where status in ('ABERTO','RECONHECIDO')",
                Integer.class)).isZero();
        if (recusado.get()) {
            assertThat(contar("incidente")).isZero();
        } else {
            assertThat(jdbc.queryForObject("select motivo_encerramento from incidente", String.class))
                    .isEqualTo("MANUTENCAO");
        }
        desfechos.add(recusado.get() ? "manutencao-primeiro" : "criar-primeiro");
```

  Com um `static` `Set<String> desfechos` impresso num `@AfterAll` (`System.out.println("[M7 corrida] desfechos: " + desfechos)`), para o relatório mostrar que os dois desfechos legítimos ocorreram. Se só um aparecer em 20 rodadas, acrescentar atraso aleatório de 0..N ms em uma das threads depois da barreira (como `ATRASO_MAX_MOTOR_MANUTENCAO_MS`) e documentar o N.

- [ ] **Step 2: Rodar e ver falhar.**
Run: `cd infra-monitor-backend && ./mvnw -q test -Dtest=AberturaManualElegibilidadePostgresIntegrationTest`
Expected: os três `recusa*` FALHAM (nenhuma exceção lançada; incidente criado) e a corrida acusa incidente ABERTO em pelo menos uma repetição. Guardar a saída: é a primeira metade da prova de reversão.

- [ ] **Step 3: Implementar a query** em `IncidenteRepository`, com javadoc explicando o lock (mesma linha e mesma ordem de `entrarEmManutencao`: equipamento antes de incidente, sem ciclo; referência a `inserirSeElegivel`):

```java
    interface Elegibilidade {
        boolean getMonitorAtivo();
        boolean getEquipamentoAtivo();
        boolean getEmManutencao();
    }

    @Query(value = """
            SELECT m.ativo AS monitorAtivo, e.ativo AS equipamentoAtivo, e.em_manutencao AS emManutencao
              FROM monitor m JOIN equipamento e ON e.id = m.equipamento_id
             WHERE m.id = :monitorId
             FOR UPDATE OF e
            """, nativeQuery = true)
    Optional<Elegibilidade> travarElegibilidadeParaAbertura(@Param("monitorId") Long monitorId);
```

- [ ] **Step 4: Implementar a guarda** em `IncidenteService.criar`, logo depois do `findById` e antes do `existsBy`:

```java
        // Mesmo predicado do motor (inserirSeElegivel): incidente para algo que nao esta sendo
        // observado nunca seria fechado automaticamente. O FOR UPDATE OF e serializa com
        // entrarEmManutencao — sem ele o INSERT nao commitado escapa de fecharPorManutencao (M7).
        IncidenteRepository.Elegibilidade elegibilidade = incidenteRepository
                .travarElegibilidadeParaAbertura(monitor.getId())
                .orElseThrow(() -> new RecursoNaoEncontradoException("Monitor nao encontrado"));
        if (!elegibilidade.getMonitorAtivo()) throw new ConflitoException(MENSAGEM_MONITOR_INATIVO);
        if (!elegibilidade.getEquipamentoAtivo()) throw new ConflitoException(MENSAGEM_EQUIPAMENTO_INATIVO);
        if (elegibilidade.getEmManutencao()) throw new ConflitoException(MENSAGEM_EQUIPAMENTO_EM_MANUTENCAO);
```

  Constantes ao lado de `MENSAGEM_INCIDENTE_ABERTO`, com os textos exatos da seção Interfaces.

- [ ] **Step 5: Ajustar `IncidenteServiceTest`.** Os mocks devolvem `Optional.empty()` para a query nova, o que agora vira 404. Acrescentar helper e stub nos testes de `criar` que esperam sucesso ou conflito de índice:

```java
    private static IncidenteRepository.Elegibilidade elegivel(boolean monitorAtivo, boolean equipamentoAtivo,
                                                               boolean emManutencao) {
        return new IncidenteRepository.Elegibilidade() {
            public boolean getMonitorAtivo() { return monitorAtivo; }
            public boolean getEquipamentoAtivo() { return equipamentoAtivo; }
            public boolean getEmManutencao() { return emManutencao; }
        };
    }
```

  `when(incidenteRepository.travarElegibilidadeParaAbertura(1L)).thenReturn(Optional.of(elegivel(true, true, false)));` em `abreIncidenteComSucesso`, na segunda metade de `rejeitaMonitorInexistenteESegundoIncidenteAberto`, em `traduzConflitoDoIndiceParcialParaRegraDeNegocio` e em qualquer outro teste de `criar` que quebrar. Acrescentar um teste unitário:

```java
    @Test
    void recusaForaDeObservacaoSemSalvarNemNotificar() {
        when(monitorRepository.findById(1L)).thenReturn(Optional.of(monitor()));
        when(incidenteRepository.travarElegibilidadeParaAbertura(1L)).thenReturn(Optional.of(elegivel(true, true, true)));

        assertThatThrownBy(() -> incidenteService.criar(criacao()))
                .isInstanceOf(ConflitoException.class)
                .hasMessage("Nao e possivel abrir incidente porque o equipamento esta em manutencao");
        verify(incidenteRepository, never()).saveAndFlush(any());
        verifyNoInteractions(notificacaoService);
    }
```

- [ ] **Step 6: Rodar e ver passar.**
Run: `cd infra-monitor-backend && ./mvnw -q test -Dtest='IncidenteServiceTest,AberturaManualElegibilidadePostgresIntegrationTest'`
Expected: PASS, com a linha `[M7 corrida] desfechos: [...]` listando os dois desfechos.

- [ ] **Step 7: Prova de reversão.** Comentar as 3 linhas `if (...) throw` da guarda, rodar só `AberturaManualElegibilidadePostgresIntegrationTest`, guardar a saída vermelha em `Docs/validacao-producao/evidencias/m7-reversao-sem-guarda.txt` (só o bloco de falhas e o resumo `Tests run`), restaurar as linhas, rodar de novo e guardar o verde em `Docs/validacao-producao/evidencias/m7-reversao-com-guarda.txt`. Conferir com `git diff IncidenteService.java` que a guarda voltou intacta.

- [ ] **Step 8: Commit**

```bash
git commit -m "fix(incidente): recusa incidente manual fora de observacao (M7)" -- infra-monitor-backend/src/main/java/br/com/inframonitor/incidente infra-monitor-backend/src/test/java/br/com/inframonitor/incidente Docs/validacao-producao/evidencias/m7-reversao-sem-guarda.txt Docs/validacao-producao/evidencias/m7-reversao-com-guarda.txt
```

---

### Task 3: `ConfirmDialog` com tom `primario` (frontend)

**Files:**
- Modify: `infra-monitor-frontend/src/app/shared/confirm-dialog/confirm-dialog.component.ts:27,35-43`
- Test: `infra-monitor-frontend/src/app/shared/confirm-dialog/confirm-dialog.component.spec.ts`

**Interfaces:**
- Produces: `readonly confirmTone = input<'perigo' | 'primario'>('perigo');` — o botão de confirmar recebe `botao--perigo` ou `botao--primario`.

- [ ] **Step 1: Testes falhando** no spec existente (novo `describe` com hospedeiro próprio, para não mexer no `Hospedeiro` atual):

```ts
@Component({
  imports: [ConfirmDialogComponent],
  template: `<app-confirm-dialog [open]="true" title="Iniciar manutenção de X?" message="m" confirmLabel="Iniciar manutenção" [confirmTone]="tom()" />`,
})
class HospedeiroTom { readonly tom = signal<'perigo' | 'primario'>('primario'); }

@Component({
  imports: [ConfirmDialogComponent],
  template: `<app-confirm-dialog [open]="true" title="Excluir?" message="m" />`,
})
class HospedeiroSemTom {}

describe('ConfirmDialogComponent — tom do botão de confirmar', () => {
  it('usa --primario quando pedido, sem --perigo', () => {
    TestBed.configureTestingModule({ imports: [HospedeiroTom] });
    const fixture = TestBed.createComponent(HospedeiroTom);
    fixture.detectChanges();
    const botao = [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')].find((b) => b.textContent?.includes('Iniciar manutenção'))!;
    expect(botao.classList).toContain('botao--primario');
    expect(botao.classList).not.toContain('botao--perigo');
  });

  it('continua --perigo por padrão para os chamadores existentes', () => {
    TestBed.configureTestingModule({ imports: [HospedeiroSemTom] });
    const fixture = TestBed.createComponent(HospedeiroSemTom);
    fixture.detectChanges();
    const botao = [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')].find((b) => b.textContent?.includes('Excluir'))!;
    expect(botao.classList).toContain('botao--perigo');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar.**
Run: `cd infra-monitor-frontend && npx ng test --watch=false --include=src/app/shared/confirm-dialog/confirm-dialog.component.spec.ts`
Expected: FAIL (`confirmTone` não é input conhecido).

- [ ] **Step 3: Implementar.** Input novo ao lado de `confirmLabel`, com comentário curto ("perigo é o padrão: excluir/desativar; primario para mudança de estado reversível sem perda, como manutenção"). Botão:

```html
<button class="botao" [class.botao--perigo]="confirmTone() === 'perigo'" [class.botao--primario]="confirmTone() === 'primario'" type="button" (click)="confirm.emit()" [disabled]="busy()">{{ busy() ? busyLabel() : confirmLabel() }}</button>
```

- [ ] **Step 4: Rodar e ver passar** (mesmo comando; o spec inteiro, inclusive os testes antigos).

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(ui): ConfirmDialog aceita tom primario no botao de confirmar" -- infra-monitor-frontend/src/app/shared/confirm-dialog
```

---

### Task 4: Ações de manutenção na lista e no drawer (frontend)

Depende das Tasks 1 (contrato `emManutencao`) e 3 (`confirmTone`). Usar a skill `frontend-design` só para conferir que nada visual novo foge das primitivas (`.botao`, `.botao--primario`, badge existente); não criar estilo novo.

**Files:**
- Modify: `infra-monitor-frontend/src/app/core/models/dashboard.ts:32-45` (`emManutencao: boolean` no fim de `DashboardEquipamentoLista`)
- Modify: `infra-monitor-frontend/src/app/features/equipamentos/equipamento-list.component.ts`
- Modify: `infra-monitor-frontend/src/app/features/equipamentos/equipamento-list.component.html:273-292`
- Modify: `infra-monitor-frontend/src/app/features/equipamentos/equipamento-detalhe-drawer.component.ts:96-98`
- Modify: `infra-monitor-frontend/src/app/features/equipamentos/equipamento-detalhe-drawer.component.html:255-265`
- Modify: toda fixture de spec que monta `DashboardEquipamentoLista` (achar com `grep -rln "DashboardEquipamentoLista" src/app --include=*.spec.ts`) — acrescentar `emManutencao: false` no default.
- Test: `equipamento-list.component.spec.ts`, `equipamento-detalhe-drawer.spec.ts`

**Interfaces:**
- Consumes: `EquipamentoApiService.startMaintenance(id)` / `endMaintenance(id)` (existentes); `ConfirmDialogComponent.confirmTone`.
- Produces: output `alternarManutencao = output<void>()` no drawer; ids de menu `'iniciarManutencao'` / `'encerrarManutencao'`.

- [ ] **Step 1: Testes falhando na lista** (`equipamento-list.component.spec.ts`; o helper `linha()` ganha `emManutencao: false`):

```ts
  describe('manutenção', () => {
    function itens(fixture: ComponentFixture<EquipamentoListComponent>, l: DashboardEquipamentoLista) {
      return fixture.componentInstance['itensDoMenu'](l) as { id: string; rotulo: string; desabilitado?: boolean }[];
    }
    function comPermissao(pode: boolean) {
      vi.spyOn(TestBed.inject(AuthStateService), 'canManageInventory').mockReturnValue(pode);
    }

    it('oferece Iniciar para ativo fora de manutenção, logo depois de ativar/desativar', () => {
      comPermissao(true);
      const fixture = montar([linha({ id: 1 })]);
      const ids = itens(fixture, linha({ id: 1 })).map((i) => i.id);
      expect(ids).toEqual(['ver', 'editar', 'desativar', 'iniciarManutencao', 'excluir']);
      expect(itens(fixture, linha({ id: 1 }))[3].rotulo).toBe('Iniciar manutenção');
    });

    it('oferece Encerrar mesmo com o equipamento inativo (status DESABILITADO mascara a manutenção)', () => {
      comPermissao(true);
      const l = linha({ id: 1, ativo: false, emManutencao: true, status: EquipmentOperationalStatus.Disabled });
      const fixture = montar([l]);
      const item = itens(fixture, l).find((i) => i.id === 'encerrarManutencao');
      expect(item?.rotulo).toBe('Encerrar manutenção');
      expect(itens(fixture, l).some((i) => i.id === 'iniciarManutencao')).toBe(false);
    });

    it('não oferece manutenção a equipamento inativo fora de manutenção', () => {
      comPermissao(true);
      const l = linha({ id: 1, ativo: false });
      const fixture = montar([l]);
      expect(itens(fixture, l).some((i) => i.id.includes('Manutencao'))).toBe(false);
    });

    it('desabilita o item sem permissão de gestão', () => {
      comPermissao(false);
      const fixture = montar([linha({ id: 1 })]);
      expect(itens(fixture, linha({ id: 1 })).find((i) => i.id === 'iniciarManutencao')?.desabilitado).toBe(true);
    });

    it('confirma o início com texto dos efeitos e botão primário, e chama a API certa', () => {
      comPermissao(true);
      const fixture = montar([linha({ id: 1, nome: 'SW-CORE' })]);
      fixture.componentInstance['executarAcao'](linha({ id: 1, nome: 'SW-CORE' }), 'iniciarManutencao');
      fixture.detectChanges();

      expect(texto(fixture)).toContain('Iniciar manutenção de SW-CORE?');
      expect(texto(fixture)).toContain('deixa de ser verificado por ICMP');
      expect(texto(fixture)).toContain('encerrados com motivo Manutenção');
      expect(texto(fixture)).toContain('aviso de encerramento');
      expect(texto(fixture)).toContain('não conta no relatório de disponibilidade');
      const confirmar = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.botao--primario')!;
      expect(confirmar.textContent).toContain('Iniciar manutenção');
      confirmar.click();

      http.expectOne((r) => r.method === 'PATCH' && r.url.endsWith('/equipamentos/1/manutencao/iniciar')).flush({});
      http.expectOne((r) => r.url.endsWith('/dashboard/equipamentos')).flush([linha({ id: 1, nome: 'SW-CORE', emManutencao: true, status: EquipmentOperationalStatus.Maintenance })]);
      fixture.detectChanges();
      expect(texto(fixture)).toContain('SW-CORE em manutenção.');
    });

    it('confirma o encerramento e chama a API certa', () => {
      comPermissao(true);
      const l = linha({ id: 1, nome: 'SW-CORE', emManutencao: true, status: EquipmentOperationalStatus.Maintenance });
      const fixture = montar([l]);
      fixture.componentInstance['executarAcao'](l, 'encerrarManutencao');
      fixture.detectChanges();

      expect(texto(fixture)).toContain('Encerrar manutenção de SW-CORE?');
      expect(texto(fixture)).toContain('volta a ser verificado por ICMP na próxima varredura');
      (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.botao--primario')!.click();
      http.expectOne((r) => r.method === 'PATCH' && r.url.endsWith('/equipamentos/1/manutencao/encerrar')).flush({});
      http.expectOne((r) => r.url.endsWith('/dashboard/equipamentos')).flush([linha({ id: 1, nome: 'SW-CORE' })]);
      fixture.detectChanges();
      expect(texto(fixture)).toContain('Manutenção de SW-CORE encerrada.');
    });

    it('mostra no diálogo a recusa da API', () => {
      comPermissao(true);
      const fixture = montar([linha({ id: 1 })]);
      fixture.componentInstance['executarAcao'](linha({ id: 1 }), 'iniciarManutencao');
      fixture.detectChanges();
      (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.botao--primario')!.click();
      http.expectOne((r) => r.url.endsWith('/manutencao/iniciar')).flush(
        { code: 'BUSINESS_CONFLICT', message: 'Recusado pela API', status: 409, error: 'Conflict', path: '', timestamp: '' },
        { status: 409, statusText: 'Conflict' });
      fixture.detectChanges();
      expect(texto(fixture)).toContain('Recusado pela API');
    });

    it('excluir continua com botão de perigo', () => {
      const fixture = montar([linha({ id: 1 })]);
      fixture.componentInstance['executarAcao'](linha({ id: 1 }), 'excluir');
      fixture.detectChanges();
      expect((fixture.nativeElement as HTMLElement).querySelector('app-confirm-dialog .botao--perigo')).not.toBeNull();
    });
  });
```

  Se o spec usar outro mecanismo de mock de `AuthStateService` (conferir antes os testes existentes com `authState`), seguir o existente em vez de `vi.spyOn`.

- [ ] **Step 2: Testes falhando no drawer** (`equipamento-detalhe-drawer.spec.ts`, seguindo o teste existente da linha ~188 que assina `alternarEquipamento`): com `linha` em manutenção, o rodapé mostra "Encerrar manutenção" e o clique emite `alternarManutencao`; com `linha` ativa fora de manutenção mostra "Iniciar manutenção"; com `linha` inativa fora de manutenção não mostra nenhum dos dois; com `linha` nula (deep-link carregando) não mostra nenhum dos dois; com `acoesDeGestao` falso (Mapa) não mostra.

- [ ] **Step 3: Rodar e ver falhar.**
Run: `cd infra-monitor-frontend && npx ng test --watch=false --include=src/app/features/equipamentos`
Expected: FAIL.

- [ ] **Step 4: Implementar a lista.**
  - `type Acao = 'excluir' | 'desativar' | 'ativar' | 'iniciarManutencao' | 'encerrarManutencao';`
  - Função de módulo:

```ts
/** Manutenção de equipamento inativo não tem efeito, mas sair dela tem de ser sempre possível. */
function acaoDeManutencao(linha: Pick<DashboardEquipamentoLista, 'ativo' | 'emManutencao'>): 'iniciarManutencao' | 'encerrarManutencao' | null {
  if (linha.emManutencao) return 'encerrarManutencao';
  return linha.ativo ? 'iniciarManutencao' : null;
}
```

  - `itensDoMenu`: depois do item ativar/desativar,

```ts
      ...(manutencao ? [{ id: manutencao, rotulo: manutencao === 'iniciarManutencao' ? 'Iniciar manutenção' : 'Encerrar manutenção', desabilitado: !podeGerenciar }] : []),
```

  com `const manutencao = acaoDeManutencao(linha);` no topo.
  - `executarAcao`: `case 'iniciarManutencao': case 'encerrarManutencao':` caem no mesmo bloco de `ativar/desativar/excluir`.
  - `alternarManutencaoDoDetalhe()`: igual a `alternarDoDetalhe`, usando `acaoDeManutencao(linha)` e saindo se `null`.
  - `tituloConfirmacao`: `Iniciar manutenção de ${nome}?` / `Encerrar manutenção de ${nome}?`.
  - `rotuloConfirmacao`: `'Iniciar manutenção'` / `'Encerrar manutenção'`.
  - `mensagemConfirmacao`: textos exatos da spec, seção "Confirmação".
  - `tomConfirmacao = computed(() => this.acao() === 'iniciarManutencao' || this.acao() === 'encerrarManutencao' ? 'primario' : 'perigo')`, ligado em `[confirmTone]` no template.
  - `confirmarAcao`: requisição por `switch` sobre a ação (`delete`, `deactivate`, `activate`, `startMaintenance`, `endMaintenance`) e aviso por `switch` (`${alvo.nome} em manutenção.`, `Manutenção de ${alvo.nome} encerrada.`). Trocar o ternário aninhado por `switch` porque cinco ramos em ternário não se leem.
  - Template: `(alternarManutencao)="alternarManutencaoDoDetalhe()"` no drawer e `[confirmTone]="tomConfirmacao()"` no diálogo.

- [ ] **Step 5: Implementar o drawer.**
  - `readonly alternarManutencao = output<void>();` ao lado de `alternarEquipamento`.
  - No rodapé, depois do botão de ativar/desativar, dentro do mesmo `@if (acoesDeGestao() && authState.canManageInventory())`:

```html
      @if (linha(); as l) {
        @if (l.emManutencao) {
          <button class="botao" type="button" (click)="alternarManutencao.emit()">Encerrar manutenção</button>
        } @else if (l.ativo) {
          <button class="botao" type="button" (click)="alternarManutencao.emit()">Iniciar manutenção</button>
        }
      }
```

  - Atualizar o comentário do rodapé (linhas ~186-187 do html) para citar manutenção junto de ativar/desativar.

- [ ] **Step 6: Rodar e ver passar** a pasta `features/equipamentos`, depois a suíte inteira: `npx ng test --watch=false`. Depois `npx ng build` (o build tem de passar sem warning novo de budget).

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(equipamentos): iniciar e encerrar manutencao pela lista e pelo drawer" -- infra-monitor-frontend/src/app
```

---

### Task 5: Documentação — correções e registros

Independente das demais (pode rodar em paralelo com 1–3).

**Files:**
- Modify: `Docs/validacao-producao/validacao-producao.md:3-5,15` e tabela de arquivos
- Modify: `Docs/superpowers/specs/2026-09-22-manutencao-e-fechamento-icmp-design.md:301-302`
- Modify: `Docs/validacao-producao/manutencao-proposta.md:648,653`
- Modify: `infra-monitor-backend/src/main/java/br/com/inframonitor/monitoring/config/LimiteDeEsperaPorLock.java:8-11`
- Modify: `infra-monitor-backend/src/main/java/br/com/inframonitor/notificacao/repository/NotificacaoRepository.java:88-98`
- Modify: `Docs/validacao-producao/auditoria-concorrencia-ciclo-de-vida.md` (linha do M7 na tabela e item 7 da lista de priorização)
- Create: `Docs/validacao-producao/manutencao-interface-e-m7.md`

- [ ] **Step 1: `validacao-producao.md`.** Linha 3-5: trocar "mais uma proposta de desenho (ainda não implementada) para o comportamento de manutenção" por "e o comportamento de manutenção — proposto, implementado (verificação ponta a ponta) e exposto na interface (`manutencao-interface-e-m7.md`)". Linha 15: "Proposta de desenho (sem código)..." vira "Desenho da manutenção (implementado; verificação em `manutencao-verificacao-ponta-a-ponta.md`)...". Acrescentar na tabela a linha de `manutencao-interface-e-m7.md` ("Manutenção pela interface de Equipamentos, M7 (incidente manual fora de observação recusado, com prova de reversão), exercício na carga e dívidas registradas") e a do design `2026-10-22-manutencao-interface-e-m7-design.md`.

- [ ] **Step 2: Spec e proposta antigas.** Não reescrever o texto histórico; acrescentar logo depois de cada afirmação uma nota em itálico:
  - `2026-09-22-manutencao-e-fechamento-icmp-design.md:301-302` e `manutencao-proposta.md:648`: "*Resolvido depois deste documento: `fecharAutomaticamente` usa CAS (`fecharAutomaticamenteSeEmAberto`) — ver `riscos-execucao-correcoes.md`, seção 1a.*"
  - `2026-09-22-...:302` e `manutencao-proposta.md:653`: "*Resolvido depois deste documento: excluir monitor/equipamento fecha a janela — ver `riscos-execucao-correcoes.md` (janela na exclusão de monitor) e `ExclusaoEJanelaPostgresIntegrationTest`.*" Antes de escrever, conferir por `grep -n "fecharEquipamento\|fecharMonitor" -r infra-monitor-backend/src/main/java` que `excluir` de monitor e de equipamento realmente fecha a janela; se o de equipamento não fechar, a nota diz só o que é verdade.

- [ ] **Step 3: `LimiteDeEsperaPorLock`.** Trocar "e o saveAndFlush que normaliza o episodio de latencia (ainda sem CAS)" por "e o CAS de normalizacao do episodio de latencia (encerrarPorNormalizacaoSeAberto)". Conferir antes que `LatencyEpisodeProcessor` usa `encerrarPorNormalizacaoSeAberto` e não `saveAndFlush` para normalizar.

- [ ] **Step 4: `NotificacaoRepository` javadoc (linhas ~88-98).** Substituir o item "reserva primeiro: a linha ja e ENVIANDO, o cancelamento atualiza 0 e a mensagem sai. Aceito e deliberado." por:

```
     * - reserva primeiro: a linha ja e ENVIANDO, o cancelamento atualiza 0 e a
     *   mensagem sai. O CAS em si esta correto; o que NAO esta garantido e o aviso
     *   de encerramento que deveria acompanhar a abertura que saiu: a decisao de
     *   cria-lo vem de uma leitura anterior a este UPDATE (divida A4 em
     *   auditoria-concorrencia-ciclo-de-vida.md — o grupo pode receber a abertura e
     *   nunca o encerramento).
```

- [ ] **Step 5: Auditoria.** Na linha M7 da tabela, última coluna: "**Corrigido em 2026-10-22** — guarda com `FOR UPDATE OF e` em `IncidenteService.criar`; ver `manutencao-interface-e-m7.md`". No item 7 da lista final: "M7 corrigido (2026-10-22); M8–M11 seguem abertos".

- [ ] **Step 6: Criar `manutencao-interface-e-m7.md`** com as seções (o conteúdo de resultado — contagens, screenshots, SQL da carga — é preenchido na Task 6; aqui ficam as seções 1-3 completas e as 4-5 com o título e a frase "Preenchido na verificação final."):
  1. **O que mudou** — botão de manutenção (lugar, regra de qual ação aparece, tom `primario` e por quê), campo `emManutencao` no read-model e por quê, M7 (decisão, justificativa, predicado, lock).
  2. **Dívidas registradas, sem correção** — cada uma com o gatilho:
     - 4 violações da invariante da janela no dev (monitores 1, 4, 7, 9): legado de SQL direto e de antes da guarda de setembro; banco da carga limpo. Gatilho: só se o dev for usado para medir SLA.
     - Fila de corrida para rodada própria, nesta ordem: **A4** primeiro (abertura sai e encerramento nunca — mais relevante para a operação), depois A3, A5, M1, M3–M6.
     - Contador por unidade multiplica equipamento com mais de um monitor (join equipamento × monitor antes de contar): latente, ninguém tem mais de um monitor hoje. Gatilho: o primeiro equipamento com mais de um monitor ativo.
     - "Ativar monitoramento" confirma com botão `--perigo` (vermelho) sem ser destrutivo: inconsistência visual, não alterada.
     - Unidade inativa não barra abertura de incidente, nem manual nem pelo motor (o predicado olha monitor e equipamento).
  3. **Prova de reversão do M7** — referência aos dois arquivos de `evidencias/` da Task 2.
  4. **Verificação** — Preenchido na verificação final.
  5. **Exercício na carga** — Preenchido na verificação final.

- [ ] **Step 7: Commit**

```bash
git commit -m "docs(manutencao): corrige afirmacoes vencidas e registra dividas da rodada" -- Docs infra-monitor-backend/src/main/java/br/com/inframonitor/monitoring/config/LimiteDeEsperaPorLock.java infra-monitor-backend/src/main/java/br/com/inframonitor/notificacao/repository/NotificacaoRepository.java
```

---

### Task 6: Verificação final, e2e por clique e exercício na carga

Executada pelo controlador (não por subagente): precisa de Docker, processos de longa duração e julgamento sobre o banco da carga.

**Files:**
- Create: `infra-monitor-frontend/e2e/manutencao-interface.cjs`
- Modify: `infra-monitor-frontend/package.json` (script `"e2e:manutencao-interface": "node e2e/manutencao-interface.cjs"`)
- Create: `infra-monitor-frontend/e2e/manutencao-interface-evidence/` (JSON + PNGs)
- Modify: `Docs/validacao-producao/manutencao-interface-e-m7.md` (seções 4 e 5)

- [ ] **Step 1: Suítes.** `docker info` (ligar com `docker desktop start` se parado). `cd infra-monitor-backend && ./mvnw test` — anotar `Tests run`, falhas, e confirmar ausência do bloco `!!`. `cd infra-monitor-frontend && npx ng test --watch=false` e `npx ng build` — anotar contagens.

- [ ] **Step 2: Roteiro e2e** `e2e/manutencao-interface.cjs`, no molde de `manutencao-verificacao.cjs` e `n04-conexao-unidade.cjs` (cabeçalho com as armadilhas, `checar`, log de rede e JSON em `finally`, `apontarApi(ctx)` de `api-porta.cjs` para `API_PORT`, navegação só por clique, sem `catch` em seletor). Variáveis: `MANUT_UI_EMAIL`, `MANUT_UI_SENHA`, `MANUT_UI_EQUIPAMENTO` (nome exato), `API_PORT`, `BASE` (padrão `http://127.0.0.1:4200`). Fluxo e screenshots (`01-...png` em diante):
  1. login → clicar Equipamentos → buscar o equipamento pelo filtro da lista (seletor escopado à lista, não o do cabeçalho);
  2. abrir o menu "…" da linha → screenshot com "Iniciar manutenção" visível;
  3. clicar → screenshot do diálogo; checar título, trecho "deixa de ser verificado por ICMP" e botão com classe `botao--primario`;
  4. confirmar → esperar o PATCH `/manutencao/iniciar` 200 → screenshot da lista com badge "Em manutenção" na linha e aviso "… em manutenção.";
  5. clicar no nome/“Ver” → drawer → screenshot com badge no cabeçalho e botão "Encerrar manutenção" no rodapé;
  6. clicar "Encerrar manutenção" no drawer → diálogo → screenshot → confirmar → PATCH `/manutencao/encerrar` 200 → screenshot do drawer/lista sem badge de manutenção e aviso "Manutenção de … encerrada.";
  7. JSON com resultados, instantes ISO de início e fim (para as consultas SQL) e log de rede.

- [ ] **Step 3: Ambiente da carga sem derrubar a stack do usuário.** A stack do dia a dia é o backend da carga na 8080 (motor + Telegram + dispatcher ligados) e `ng serve` na 4200, de outro worktree. Não parar nenhum deles. Conferir com `netstat -ano | findstr ":8080 :4200 :5436"`. Montar o jar deste branch fora do `target` do worktree (`git archive HEAD infra-monitor-backend | tar -x -C <scratchpad>/build` e `./mvnw -DskipTests package` lá), subir com `. ~/.inframonitor-carga/env.sh` sobrescrevendo `SERVER_PORT=8081` e com `MONITORING_ENGINE_ENABLED=false`, `TELEGRAM_ENABLED=false`, `NOTIFICATION_DISPATCHER_ENABLED=false` (a 8080 já roda motor e dispatcher sobre o mesmo banco; conferir os nomes exatos das variáveis no `application.yml`). Servir o frontend deste worktree em `ng serve --port 4201` (junção de `node_modules` para o worktree se não houver instalação; remover a junção com `rmdir` antes de qualquer `git worktree remove`). Login: `E2E` com `BOOTSTRAP_ADMIN_EMAIL`/`BOOTSTRAP_ADMIN_PASSWORD` do `env.sh`; se der 401, parar e registrar no relatório em vez de mexer em senha do banco da carga.

- [ ] **Step 4: Escolher o equipamento e fotografar o estado antes.** Por `docker exec inframonitor-carga psql -U inframonitor_carga -d inframonitor_carga`, listar equipamentos ativos com monitor ativo, incidente aberto e janela aberta. Preferir um com incidente aberto (exercita fechamento por manutenção e notificação). Gravar o estado "antes" (incidentes abertos, notificações do incidente, janela aberta, `em_manutencao`) em `<scratchpad>/carga-antes.txt`. Atenção: se o incidente aberto já teve `INCIDENTE_ABERTO` despachado, a entrada em manutenção cria `INCIDENTE_ENCERRADO_MANUTENCAO` e o dispatcher da 8080 envia ao grupo do Telegram — é o comportamento sob teste e foi pedido; registrar no relatório.

- [ ] **Step 5: Rodar o e2e contra a carga.**
`cd infra-monitor-frontend && BASE=http://127.0.0.1:4201 API_PORT=8081 MANUT_UI_EMAIL=... MANUT_UI_SENHA=... MANUT_UI_EQUIPAMENTO="..." npm run e2e:manutencao-interface`
Expected: todos os `checar` OK. Evidência fica no repo só se não expuser dado sensível da rede real além do nome do equipamento; senão copiar as PNG para fora do repo e commitar só o JSON sanitizado (mesma regra da memória "capturas da carga ficam fora do repo"). Decidir pelo conteúdo e registrar a decisão.

- [ ] **Step 6: Conferir no banco (estado depois)**, usando os instantes do JSON:
  - incidente que estava aberto: `status = FECHADO`, `motivo_encerramento = MANUTENCAO`, `encerrado_em` ≈ instante do início;
  - `janela_monitoramento` dos monitores do equipamento: uma fechada no início da manutenção e uma nova aberta no encerramento, sem sobreposição;
  - `notificacao` do incidente: `INCIDENTE_ABERTO` `CANCELADA` (se estava pendente) ou `INCIDENTE_ENCERRADO_MANUTENCAO` criada (se a abertura já tinha saído) — e o status de envio dela;
  - `em_manutencao = false` ao final;
  - SLA: `GET /api/v1/relatorios/...` de disponibilidade do equipamento no período (achar o endpoint em `RelatorioController`) mostrando que o intervalo de manutenção não entrou como indisponibilidade.
  Gravar as consultas e as saídas em `<scratchpad>/carga-depois.txt`.

- [ ] **Step 7: Encerrar processos.** Matar por PID o `java -jar` da 8081 e o `ng serve` da 4201 (`Get-CimInstance Win32_Process` filtrando a linha de comando), provar com `netstat` que 8081/4201 estão livres e que 8080/4200 do usuário continuam de pé.

- [ ] **Step 8: Relatório.** Preencher as seções 4 e 5 de `manutencao-interface-e-m7.md` com as contagens reais (backend com Docker, frontend, build), lista dos `checar` do e2e, consultas SQL e resultados resumidos, e o que foi ou não enviado ao Telegram. Commit:

```bash
git commit -m "test(e2e): fluxo de manutencao pela interface e exercicio na carga" -- infra-monitor-frontend/e2e/manutencao-interface.cjs infra-monitor-frontend/e2e/manutencao-interface-evidence infra-monitor-frontend/package.json Docs/validacao-producao/manutencao-interface-e-m7.md
```

- [ ] **Step 9: Revisão final do branch** (superpowers:requesting-code-review sobre `origin/main..HEAD`), aplicar o que for procedente, push e PR para `main` com corpo terminando em `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
