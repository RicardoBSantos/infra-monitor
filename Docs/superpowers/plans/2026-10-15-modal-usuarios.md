# Modal de Usuários no padrão do projeto — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Os três diálogos da tela de Usuários (Novo, Editar, Redefinir senha) passam a abrir como modal centralizado com backdrop, borda superior azul e botão ×, via um componente compartilhado `app-modal` com Escape, foco de entrada/retorno e animação.

**Architecture:** Novo `shared/modal/ModalComponent` (standalone, OnPush, template inline) cuida só do "chrome": fundo, painel, cabeçalho, ×, teclado, foco e animação. O formulário entra por `<ng-content>` e seus estilos ficam no componente pai (encapsulamento emulado). Usuários troca os dois blocos `div.dialog-backdrop` por `<app-modal>`. Nenhuma lógica de negócio muda.

**Tech Stack:** Angular 21 (signals, `input()/output()`, control flow `@if`), Reactive Forms, SCSS, testes `ng test` (builder `@angular/build:unit-test`, Vitest + jsdom), e2e Playwright 1.63 em `.cjs`.

**Spec:** `docs/superpowers/specs/2026-10-15-modal-usuarios-design.md`

## Global Constraints

- Mudança VISUAL. Não alterar regra de negócio, payload de API, validação de formulário nem backend.
- Preservar: último ADMIN ativo não é rebaixado/desativado; ADMIN não desativa a si mesmo; criado pela API nasce com `trocaSenhaObrigatoria = true`; senha inicial 12–128; e-mail único case-insensitive. Se algo esbarrar nisso: parar e reportar.
- Modal de usuário: UMA coluna (Nome, E-mail, Papel, Senha inicial só na criação); largura `520px`.
- `aria-modal="true"`; `role="dialog"`; botão × com `aria-label="Fechar"`.
- Animação ~220ms; `prefers-reduced-motion: reduce` → só fade 120ms.
- Sem Lombok/abstração especulativa no front também: nada de `BaseModal`, nada de migrar Equipamentos/Tipos/Monitores/confirm-dialog (fora de escopo).
- Nomes em português no código novo (padrão de `shared/`: `aberto`, `fechar`, `titulo`).
- Diretório de trabalho do frontend: `infra-monitor-frontend/`. Branch: `fix/modal-usuarios`.
- Commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Escape pressionado com o foco ainda fora do painel (no gatilho ou no `body`) tem de fechar — o modal de Equipamento falha nisso. → Task 1, teste "Escape no document".
2. Arrastar seleção de texto de dentro de um campo e soltar sobre o fundo não pode fechar o formulário e perder o que foi digitado. → Task 1, teste "arrasto".
3. Escape/×/fundo durante o salvamento não podem fechar o modal com a requisição em voo. → Task 1 (`bloqueado`) e Task 2 (salvando).
4. Dois `app-modal` na mesma página: o fechado não reage a Escape, e os ids de título não colidem. → Task 1.
5. Recusa da API (e-mail duplicado, último ADMIN) precisa ficar visível dentro do modal, não escondida atrás do backdrop. → Task 2, teste "conflito visível no modal".

---

### Task 1: Componente compartilhado `app-modal`

**Files:**
- Create: `infra-monitor-frontend/src/app/shared/modal/modal.component.ts`
- Create: `infra-monitor-frontend/src/app/shared/modal/modal.component.scss`
- Test: `infra-monitor-frontend/src/app/shared/modal/modal.component.spec.ts`

**Interfaces:**
- Produces: `ModalComponent`, selector `app-modal`, export de `./shared/modal/modal.component`.
  - `aberto = input(false)`, `titulo = input.required<string>()`, `subtitulo = input<string | null>(null)`, `largura = input('520px')`, `bloqueado = input(false)`, `fechar = output<void>()`.
  - DOM: `.modal__fundo` > `section.modal[role=dialog][aria-modal=true][aria-labelledby][tabindex=-1]` > `header.modal__topo` (`h2`, `p` opcional, `button.modal__fechar[aria-label=Fechar]`) + conteúdo projetado.

- [ ] **Step 1: Write the failing test**

`modal.component.spec.ts`:

```ts
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ModalComponent } from './modal.component';

@Component({
  imports: [ModalComponent],
  template: `
    <button id="gatilho" type="button" (click)="aberto.set(true)">abrir</button>
    <app-modal [aberto]="aberto()" titulo="Novo registro" [subtitulo]="subtitulo()" [bloqueado]="bloqueado()" (fechar)="fechamentos = fechamentos + 1; aberto.set(false)">
      <form><input id="campo" [disabled]="semCampo()"></form>
    </app-modal>
    <app-modal [aberto]="false" titulo="Outro" (fechar)="outros = outros + 1" />
  `,
})
class Hospedeiro {
  readonly aberto = signal(false);
  readonly bloqueado = signal(false);
  readonly semCampo = signal(false);
  readonly subtitulo = signal<string | null>(null);
  fechamentos = 0;
  outros = 0;
}

describe('ModalComponent', () => {
  const montar = () => {
    TestBed.configureTestingModule({ imports: [Hospedeiro] });
    const fixture = TestBed.createComponent(Hospedeiro);
    fixture.detectChanges();
    return fixture;
  };
  const el = (fixture: { nativeElement: HTMLElement }) => fixture.nativeElement;
  const abrir = (fixture: ReturnType<typeof montar>) => {
    const gatilho = el(fixture).querySelector<HTMLButtonElement>('#gatilho')!;
    gatilho.focus();
    gatilho.click();
    fixture.detectChanges();
    return gatilho;
  };
  const escape = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

  it('não renderiza nada fechado', () => {
    const fixture = montar();
    expect(el(fixture).querySelector('[role="dialog"]')).toBeNull();
  });

  it('aberto expõe role, aria-modal, título ligado por aria-labelledby, × e largura padrão', () => {
    const fixture = montar();
    abrir(fixture);
    const painel = el(fixture).querySelector<HTMLElement>('section.modal')!;
    expect(painel.getAttribute('role')).toBe('dialog');
    expect(painel.getAttribute('aria-modal')).toBe('true');
    const titulo = painel.querySelector('h2')!;
    expect(titulo.textContent).toContain('Novo registro');
    expect(painel.getAttribute('aria-labelledby')).toBe(titulo.id);
    expect(painel.querySelector('button.modal__fechar[aria-label="Fechar"]')).not.toBeNull();
    expect(painel.style.width).toContain('520px');
    expect(el(fixture).querySelector('.modal__fundo')).not.toBeNull();
  });

  it('subtítulo só aparece quando informado', () => {
    const fixture = montar();
    abrir(fixture);
    expect(el(fixture).querySelector('.modal__topo p')).toBeNull();
    fixture.componentInstance.subtitulo.set('Explicação curta');
    fixture.detectChanges();
    expect(el(fixture).querySelector('.modal__topo p')!.textContent).toContain('Explicação curta');
  });

  it('ids de título são únicos por instância', () => {
    const a = TestBed.createComponent(ModalComponent);
    a.componentRef.setInput('titulo', 'A');
    a.componentRef.setInput('aberto', true);
    a.detectChanges();
    const b = TestBed.createComponent(ModalComponent);
    b.componentRef.setInput('titulo', 'B');
    b.componentRef.setInput('aberto', true);
    b.detectChanges();
    const idA = (a.nativeElement as HTMLElement).querySelector('h2')!.id;
    const idB = (b.nativeElement as HTMLElement).querySelector('h2')!.id;
    expect(idA).not.toBe('');
    expect(idA).not.toBe(idB);
  });

  it('× emite fechar', () => {
    const fixture = montar();
    abrir(fixture);
    el(fixture).querySelector<HTMLButtonElement>('.modal__fechar')!.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.fechamentos).toBe(1);
    expect(el(fixture).querySelector('[role="dialog"]')).toBeNull();
  });

  it('Escape no document fecha mesmo com o foco fora do painel, e o modal fechado ignora', () => {
    const fixture = montar();
    abrir(fixture);
    (document.activeElement as HTMLElement | null)?.blur();
    escape();
    fixture.detectChanges();
    expect(fixture.componentInstance.fechamentos).toBe(1);
    expect(fixture.componentInstance.outros).toBe(0);
    escape();
    expect(fixture.componentInstance.fechamentos).toBe(1);
  });

  it('clique que começa e termina no fundo fecha; clique no painel não', () => {
    const fixture = montar();
    abrir(fixture);
    const fundo = el(fixture).querySelector<HTMLElement>('.modal__fundo')!;
    const painel = el(fixture).querySelector<HTMLElement>('section.modal')!;
    painel.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    painel.click();
    expect(fixture.componentInstance.fechamentos).toBe(0);
    fundo.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    fundo.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.fechamentos).toBe(1);
  });

  it('arrastar de dentro do campo até o fundo não fecha', () => {
    const fixture = montar();
    abrir(fixture);
    const fundo = el(fixture).querySelector<HTMLElement>('.modal__fundo')!;
    el(fixture).querySelector<HTMLElement>('#campo')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    fundo.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(fixture.componentInstance.fechamentos).toBe(0);
  });

  it('bloqueado: ×, Escape e fundo não fecham, e o × fica desabilitado', () => {
    const fixture = montar();
    abrir(fixture);
    fixture.componentInstance.bloqueado.set(true);
    fixture.detectChanges();
    const fechar = el(fixture).querySelector<HTMLButtonElement>('.modal__fechar')!;
    expect(fechar.disabled).toBe(true);
    fechar.click();
    escape();
    const fundo = el(fixture).querySelector<HTMLElement>('.modal__fundo')!;
    fundo.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    fundo.click();
    expect(fixture.componentInstance.fechamentos).toBe(0);
  });

  it('foco vai ao primeiro campo ao abrir e volta ao gatilho ao fechar', () => {
    const fixture = montar();
    const gatilho = abrir(fixture);
    expect(document.activeElement).toBe(el(fixture).querySelector('#campo'));
    escape();
    fixture.detectChanges();
    expect(document.activeElement).toBe(gatilho);
  });

  it('sem campo focável, o foco vai ao painel', () => {
    const fixture = montar();
    fixture.componentInstance.semCampo.set(true);
    fixture.detectChanges();
    abrir(fixture);
    expect(document.activeElement).toBe(el(fixture).querySelector('section.modal'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (em `infra-monitor-frontend/`): `npx ng test --watch=false --include src/app/shared/modal/modal.component.spec.ts`
Expected: FAIL — `Cannot find module './modal.component'`.

- [ ] **Step 3: Write minimal implementation**

`modal.component.ts`:

```ts
import { ChangeDetectionStrategy, Component, ElementRef, effect, input, output, viewChild } from '@angular/core';

/** Campo que recebe o foco ao abrir. O × fica de fora: abrir não é pedir para fechar. */
const FOCAVEIS = 'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]):not(.modal__fechar)';

let proximoId = 0;

/**
 * Modal centralizado de formulário: fundo escurecido, borda superior azul e ×.
 * Cuida só do contêiner — o formulário entra por projeção e é estilizado pelo pai.
 *
 * Escape escuta o document, não o painel: preso ao painel ele não dispara enquanto o
 * foco ainda está no botão que abriu (falha do modal local de Equipamentos).
 */
@Component({
  selector: 'app-modal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'pedirFechar()' },
  template: `@if (aberto()) {
    <div class="modal__fundo" (mousedown)="cliqueComecouNoFundo = $event.target === $event.currentTarget" (click)="aoClicarNoFundo($event)">
      <section #painel class="modal" role="dialog" aria-modal="true" [attr.aria-labelledby]="idTitulo" tabindex="-1" [style.width]="'min(100%, ' + largura() + ')'">
        <header class="modal__topo">
          <div>
            <h2 [id]="idTitulo">{{ titulo() }}</h2>
            @if (subtitulo()) { <p>{{ subtitulo() }}</p> }
          </div>
          <button class="modal__fechar" type="button" aria-label="Fechar" [disabled]="bloqueado()" (click)="pedirFechar()">✕</button>
        </header>
        <ng-content />
      </section>
    </div>
  }`,
  styleUrl: './modal.component.scss',
})
export class ModalComponent {
  readonly aberto = input(false);
  readonly titulo = input.required<string>();
  readonly subtitulo = input<string | null>(null);
  readonly largura = input('520px');
  readonly bloqueado = input(false);
  readonly fechar = output<void>();

  protected readonly idTitulo = `modal-titulo-${++proximoId}`;
  protected cliqueComecouNoFundo = false;
  private readonly painel = viewChild<ElementRef<HTMLElement>>('painel');
  private gatilho: HTMLElement | null = null;
  private estavaAberto = false;

  constructor() {
    // Roda antes do template: ao abrir, o foco ainda está no gatilho; ao fechar, o painel ainda existe.
    effect(() => {
      const aberto = this.aberto();
      if (aberto && !this.estavaAberto) {
        this.gatilho = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      } else if (!aberto && this.estavaAberto) {
        const gatilho = this.gatilho;
        this.gatilho = null;
        if (gatilho?.isConnected) gatilho.focus();
      }
      this.estavaAberto = aberto;
    });
    // O painel só existe depois que o @if renderiza.
    effect(() => {
      const painel = this.painel()?.nativeElement;
      if (painel) (painel.querySelector<HTMLElement>(FOCAVEIS) ?? painel).focus();
    });
  }

  protected pedirFechar(): void {
    if (this.aberto() && !this.bloqueado()) this.fechar.emit();
  }

  /** Só fecha se o clique começou no fundo: soltar ali uma seleção de texto feita no campo não conta. */
  protected aoClicarNoFundo(evento: MouseEvent): void {
    const comecouNoFundo = this.cliqueComecouNoFundo;
    this.cliqueComecouNoFundo = false;
    if (comecouNoFundo && evento.target === evento.currentTarget) this.pedirFechar();
  }
}
```

`modal.component.scss`:

```scss
/* Mesmo visual do modal de Equipamentos (.dialog-backdrop + .equipamento-modal).
   Animação ~220ms como a gaveta; sob prefers-reduced-motion resta só o fade. */

.modal__fundo {
  position: fixed;
  inset: 0;
  z-index: var(--im-z-modal);
  display: grid;
  place-items: center;
  padding: 16px;
  background: rgba(0, 0, 0, .65);
  animation: modal-fade 220ms ease-out;
}

.modal {
  box-sizing: border-box;
  max-height: 90vh;
  overflow-y: auto;
  padding: 20px;
  border: 1px solid var(--im-border-strong);
  border-top: 2px solid var(--im-primary);
  border-radius: var(--im-radius-lg);
  background: var(--im-surface-raised);
  box-shadow: var(--im-shadow-raised);
  animation: modal-entrada 220ms cubic-bezier(.32, .72, 0, 1);

  &:focus { outline: none; }
}

.modal__topo {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;

  h2 { margin: 0; color: var(--im-text-strong); font-size: 16px; }
  p { margin: 6px 0 0; color: var(--im-text-secondary); font-size: 12px; }
}

.modal__fechar {
  border: 0;
  background: none;
  color: var(--im-text-secondary);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;

  &:hover { color: var(--im-text); }
  &:focus-visible { outline: 2px solid var(--im-primary); outline-offset: 2px; }
  &:disabled { opacity: .5; cursor: not-allowed; }
}

@keyframes modal-fade { from { opacity: 0; } }
@keyframes modal-entrada { from { opacity: 0; transform: translateY(8px) scale(.98); } }

@media (prefers-reduced-motion: reduce) {
  .modal__fundo { animation-duration: 120ms; }
  .modal { animation: modal-fade 120ms ease-out; }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx ng test --watch=false --include src/app/shared/modal/modal.component.spec.ts`
Expected: PASS (11 testes). Se o teste de foco falhar por ordem de efeitos, NÃO trocar por `setTimeout` sem antes confirmar a causa; o drawer de Equipamentos usa o mesmo `effect` + `viewChild` com sucesso.

- [ ] **Step 5: Commit**

```bash
git add infra-monitor-frontend/src/app/shared/modal
git commit -m "feat(frontend): app-modal compartilhado com Escape, foco e animacao

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Usuários adota `app-modal`

**Files:**
- Modify: `infra-monitor-frontend/src/app/features/usuarios/usuario-list.component.html` (linhas 5–6: os dois blocos `dialog-backdrop`)
- Modify: `infra-monitor-frontend/src/app/features/usuarios/usuario-list.component.ts` (imports; `openCreate`, `openEdit`, `openReset`; novo `closeReset`)
- Modify: `infra-monitor-frontend/src/app/features/unidades/admin-list.component.scss` (regras `.form-dialog…` → `.modal-form…`)
- Test: `infra-monitor-frontend/src/app/features/usuarios/usuario-list.component.spec.ts`

**Interfaces:**
- Consumes: `ModalComponent` (Task 1) — `[aberto] [titulo] [subtitulo] [bloqueado] (fechar)`; DOM `section.modal[role=dialog]`, `button.modal__fechar`.

- [ ] **Step 1: Write the failing tests** — acrescentar ao fim do `describe` existente (antes do `});` final). Os 5 testes existentes ficam intactos.

```ts
  const URL = 'http://localhost:8080/api/v1/usuarios';
  const dialog = (fixture: { nativeElement: HTMLElement }) => fixture.nativeElement.querySelector<HTMLElement>('app-modal section[role="dialog"]');
  const escape = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

  it('opens Novo usuário in the shared modal, one column, focus on nome, Escape closes and returns focus', () => {
    const fixture = create(); http.expectOne(URL).flush([user]); fixture.detectChanges();
    const novo = fixture.nativeElement.querySelector('header .botao--primario') as HTMLButtonElement;
    novo.focus(); novo.click(); fixture.detectChanges();
    const modal = dialog(fixture)!;
    expect(modal.getAttribute('aria-modal')).toBe('true');
    expect(modal.querySelector('h2')!.textContent).toContain('Novo usuário');
    expect(modal.querySelector('button[aria-label="Fechar"]')).not.toBeNull();
    expect(modal.querySelectorAll('form.modal-form > label').length).toBe(4);
    expect(document.activeElement).toBe(modal.querySelector('input[formcontrolname="nome"]'));
    escape(); fixture.detectChanges();
    expect(dialog(fixture)).toBeNull();
    expect(document.activeElement).toBe(novo);
  });

  it('Editar opens the modal without the senha field and × closes it', () => {
    const fixture = create(); http.expectOne(URL).flush([user]); fixture.detectChanges();
    (fixture.nativeElement.querySelector('.actions button') as HTMLButtonElement).click(); fixture.detectChanges();
    const modal = dialog(fixture)!;
    expect(modal.querySelector('h2')!.textContent).toContain('Editar usuário');
    expect(modal.querySelector('input[formcontrolname="senhaInicial"]')).toBeNull();
    (modal.querySelector('button[aria-label="Fechar"]') as HTMLButtonElement).click(); fixture.detectChanges();
    expect(dialog(fixture)).toBeNull();
  });

  it('keeps the form open while saving: Escape and × do nothing until the API answers', () => {
    const fixture = create(); http.expectOne(URL).flush([]); fixture.detectChanges();
    (fixture.nativeElement.querySelector('header .botao--primario') as HTMLButtonElement).click(); fixture.detectChanges();
    (fixture.componentInstance as any).form.setValue({ nome: 'Novo', email: 'novo@example.test', papel: 'OPERADOR', senhaInicial: 'SenhaInicial123!' });
    (fixture.componentInstance as any).submit(); fixture.detectChanges();
    escape(); fixture.detectChanges();
    expect(dialog(fixture)).not.toBeNull();
    expect((dialog(fixture)!.querySelector('button[aria-label="Fechar"]') as HTMLButtonElement).disabled).toBe(true);
    http.expectOne(URL).flush({ ...user, id: 3, nome: 'Novo', email: 'novo@example.test' }, { status: 201, statusText: 'Created' }); fixture.detectChanges();
    expect(dialog(fixture)).toBeNull();
  });

  it('shows the API refusal inside the modal, not hidden behind the backdrop', () => {
    const fixture = create(); http.expectOne(URL).flush([user]); fixture.detectChanges();
    (fixture.nativeElement.querySelector('header .botao--primario') as HTMLButtonElement).click(); fixture.detectChanges();
    (fixture.componentInstance as any).form.setValue({ nome: 'Outro', email: 'OPERADOR@example.test', papel: 'OPERADOR', senhaInicial: 'SenhaInicial123!' });
    (fixture.componentInstance as any).submit();
    http.expectOne(URL).flush(error('BUSINESS_CONFLICT', 'E-mail já cadastrado'), { status: 409, statusText: 'Conflict' }); fixture.detectChanges();
    const alerta = dialog(fixture)!.querySelector('[role="alert"]');
    expect(alerta?.textContent).toContain('E-mail já cadastrado');
  });

  it('clears a previous error when the modal opens again', () => {
    const fixture = create(); http.expectOne(URL).flush([user]); fixture.detectChanges();
    (fixture.componentInstance as any).error.set('Erro antigo'); fixture.detectChanges();
    (fixture.nativeElement.querySelector('header .botao--primario') as HTMLButtonElement).click(); fixture.detectChanges();
    expect(dialog(fixture)!.textContent).not.toContain('Erro antigo');
  });

  it('Redefinir senha opens the modal with the user name and closes by Escape', () => {
    const fixture = create(); http.expectOne(URL).flush([user]); fixture.detectChanges();
    (fixture.nativeElement.querySelectorAll('.actions button')[1] as HTMLButtonElement).click(); fixture.detectChanges();
    const modal = dialog(fixture)!;
    expect(modal.querySelector('h2')!.textContent).toContain('Redefinir senha');
    expect(modal.textContent).toContain('Operador');
    escape(); fixture.detectChanges();
    expect(dialog(fixture)).toBeNull();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx ng test --watch=false --include src/app/features/usuarios/usuario-list.component.spec.ts`
Expected: os 6 testes novos FALHAM (`app-modal` inexistente no template → `dialog(fixture)` nulo); os 5 antigos passam.

- [ ] **Step 3: Implement**

`usuario-list.component.ts`:
- import: `import { ModalComponent } from '../../shared/modal/modal.component';`
- `imports: [ReactiveFormsModule, ConfirmDialogComponent, ModalComponent]`
- Em `openCreate`, `openEdit` e `openReset`, logo após `this.notice.set(null);` acrescentar `this.error.set(null);`.
- Depois de `closeForm()` acrescentar:
  `protected closeReset(): void { if (!this.saving()) this.resetting.set(null); }`
- Nada mais muda (submit, resetPassword, applyFormError, regras).

`usuario-list.component.html` — substituir a linha do bloco `@if (editing() !== undefined) { <div class="dialog-backdrop">…</div> }` e a linha do bloco `@if (resetting(); as user) { <div class="dialog-backdrop">…</div> }` por:

```html
  <app-modal [aberto]="editing() !== undefined" [titulo]="editing() ? 'Editar usuário' : 'Novo usuário'" [subtitulo]="editing() ? 'A senha não muda aqui. Use Redefinir senha.' : 'O usuário deverá trocar a senha inicial no primeiro acesso.'" [bloqueado]="saving()" (fechar)="closeForm()">
    <form class="modal-form" [formGroup]="form" (ngSubmit)="submit()">
      <label>NOME *<input formControlName="nome" maxlength="150" autocomplete="off"></label>
      <label>E-MAIL *<input formControlName="email" type="email" maxlength="254" autocomplete="off"></label>
      <label>PAPEL *<span class="campo-select"><select formControlName="papel">@for (role of roles; track role) { <option [value]="role">{{ roleLabel(role) }}</option> }</select></span></label>
      @if (!editing()) { <label>SENHA INICIAL *<input formControlName="senhaInicial" type="password" minlength="12" maxlength="128" autocomplete="new-password"></label> }
      @if (form.invalid && form.touched) { <small class="field-error">Revise os campos obrigatórios. A senha deve ter de 12 a 128 caracteres.</small> }
      @if (error()) { <p class="field-error" role="alert">{{ error() }}</p> }
      <div class="dialog-actions"><button class="botao" type="button" (click)="closeForm()" [disabled]="saving()">Cancelar</button><button class="botao botao--primario" type="submit" [disabled]="saving()">{{ saving() ? 'Salvando…' : 'Salvar usuário' }}</button></div>
    </form>
  </app-modal>
  <app-modal [aberto]="!!resetting()" titulo="Redefinir senha" [subtitulo]="'Defina uma senha temporária para ' + (resetting()?.nome ?? '') + '. Ela não será exibida depois do envio.'" [bloqueado]="saving()" (fechar)="closeReset()">
    <form class="modal-form" [formGroup]="passwordForm" (ngSubmit)="resetPassword()">
      <label>NOVA SENHA *<input formControlName="novaSenha" type="password" minlength="12" maxlength="128" autocomplete="new-password"></label>
      <label>CONFIRMAÇÃO DA NOVA SENHA *<input formControlName="confirmacaoNovaSenha" type="password" minlength="12" maxlength="128" autocomplete="new-password"></label>
      @if (passwordForm.controls.confirmacaoNovaSenha.errors?.['mismatch']) { <small class="field-error">As senhas devem ser iguais.</small> }
      @if (error()) { <p class="field-error" role="alert">{{ error() }}</p> }
      <div class="dialog-actions"><button class="botao" type="button" (click)="closeReset()" [disabled]="saving()">Cancelar</button><button class="botao botao--primario" type="submit" [disabled]="saving()">{{ saving() ? 'Redefinindo…' : 'Redefinir senha' }}</button></div>
    </form>
  </app-modal>
```

Notas: o `autofocus` sai (o modal foca o primeiro campo). Os rótulos ficam em caixa alta como em Equipamentos. O texto de validação e os limites 12–128 ficam idênticos.

`admin-list.component.scss` — remover, no arquivo minificado, exatamente estas regras:
`.form-dialog{…}`, `.form-dialog h2{…}`, `.form-dialog>p{…}`, `.form-dialog form{…}`, `.form-dialog label{…}`, `.form-dialog input,.form-dialog textarea{…}`, `.form-dialog .campo-select{…}`, `.form-dialog .campo-select select{…}`
e no lugar delas (mesma posição, antes de `.field-error`) inserir:

```scss
.modal-form{display:grid;gap:10px}.modal-form label{display:grid;gap:5px;color:var(--im-text-dim);font-size:9.5px;font-weight:600;letter-spacing:.1em}.modal-form input{box-sizing:border-box;width:100%;padding:8px;border:1px solid var(--im-border-strong);border-radius:var(--im-radius);background:var(--im-surface);color:var(--im-text);font-size:13px}.modal-form input:focus-visible{outline:2px solid var(--im-info-soft);outline-offset:1px;box-shadow:none}.modal-form .campo-select,.modal-form .campo-select select{width:100%}.modal-form .campo-select select{height:auto;padding:8px 26px 8px 8px;font-size:13px}.modal-form .field-error{margin:0;letter-spacing:0;font-weight:400}
```

Confirmar que `.dialog-actions` e `.field-error` continuam no arquivo. Rodar `grep -rn "form-dialog" infra-monitor-frontend/src` — só pode sobrar o comentário em `monitor-management.component.scss`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx ng test --watch=false --include src/app/features/usuarios/usuario-list.component.spec.ts`
Expected: 11/11 PASS (5 antigos + 6 novos). Se um teste ANTIGO falhar, parar: indica mudança de comportamento, não ajustar o teste.

- [ ] **Step 5: Commit**

```bash
git add infra-monitor-frontend/src/app/features/usuarios infra-monitor-frontend/src/app/features/unidades/admin-list.component.scss
git commit -m "fix(frontend): dialogos de usuarios no modal centralizado do projeto

O backdrop nao tinha estilo em admin-list.scss e os tres dialogos caiam no fluxo
da pagina, abaixo da tabela. Agora usam app-modal; a recusa da API aparece dentro
do modal em vez de ficar escondida atras do fundo. Nenhuma regra muda.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: E2E por clique, screenshots e comparação lado a lado

**Files:**
- Create: `infra-monitor-frontend/e2e/modal-usuarios.cjs`
- Modify: `infra-monitor-frontend/package.json` (script `"e2e:modal-usuarios": "node e2e/modal-usuarios.cjs"`)
- Saída: `infra-monitor-frontend/e2e/modal-usuarios-evidence/` (PNGs + `resultado.json` + `rede.json`)

**Interfaces:**
- Consumes: DOM das Tasks 1–2 (`section.modal`, `.modal__fundo`, `button.modal__fechar`, `input[formcontrolname="nome"]`); Equipamentos `section.equipamento-modal`, `.dialog-backdrop`; sidebar `a.navigation__item[href="/usuarios"]`, `[href="/equipamentos"]`; login `#login-email`, `#login-senha`, `.login-submit`.

Ambiente: Postgres dev `inframonitor-postgres` (5434), backend `DB_PORT=5434 JWT_SECRET=<32+ bytes> ./mvnw spring-boot:run` em `infra-monitor-backend/`, frontend `npx ng serve` (4200, apiUrl `http://localhost:8080/api/v1`). Admin `admin@inframonitor.local`; senha em `MODAL_E2E_SENHA`.

Regras herdadas (memória do projeto): depois do login só navegação por clique (nenhum `page.goto`); nenhum `catch` silencioso em seletor; `resultado.json` e `rede.json` gravados em `finally`; roteiro somente leitura — falha se houver qualquer POST/PUT/PATCH/DELETE além do login.

- [ ] **Step 1: Escrever o roteiro**

```js
/*
 * Modal de Usuários no padrão do projeto — verificação por clique, somente leitura.
 *
 *   MODAL_E2E_SENHA=<senha> npm run e2e:modal-usuarios
 *   (opcionais: MODAL_E2E_EMAIL, MODAL_E2E_BASE=http://127.0.0.1:4200, MODAL_E2E_API=http://localhost:8080/api/v1)
 *
 * Nada é gravado: o roteiro abre e fecha os modais e tenta salvar o formulário vazio
 * (validação local, sem requisição). Qualquer escrita na API derruba o resultado.
 * Saída em e2e/modal-usuarios-evidence/.
 */
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');

const BASE = process.env.MODAL_E2E_BASE || 'http://127.0.0.1:4200';
const API = process.env.MODAL_E2E_API || 'http://localhost:8080/api/v1';
const EMAIL = process.env.MODAL_E2E_EMAIL || 'admin@inframonitor.local';
const SENHA = process.env.MODAL_E2E_SENHA;
if (!SENHA) throw new Error('MODAL_E2E_SENHA é obrigatória');

const OUT = path.join(__dirname, 'modal-usuarios-evidence');
fs.mkdirSync(OUT, { recursive: true });
const VIEWPORT = { width: 1440, height: 900 };

const resultados = []; const rede = []; const erros = [];
const checar = (nome, ok, detalhe) => resultados.push({ nome, ok: !!ok, detalhe: detalhe ?? '' });

const geometria = (seletor) => (el) => {
  const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
  return { x: r.x, y: r.y, w: r.width, h: r.height, borderTop: s.borderTopWidth + ' ' + s.borderTopColor, radius: s.borderRadius, fundo: s.backgroundColor };
};

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: VIEWPORT });
  page.on('request', (r) => { if (r.url().startsWith(API)) rede.push(`${r.method()} ${r.url().replace(API, '')}`); });
  page.on('console', (m) => { if (m.type() === 'error') erros.push(m.text()); });
  page.on('pageerror', (e) => erros.push(String(e)));

  try {
    await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
    await page.fill('#login-email', EMAIL);
    await page.fill('#login-senha', SENHA);
    await page.click('.login-submit');
    await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 15000 });

    // ---------------------------------------------------------------- Usuários
    await page.click('a.navigation__item[href="/usuarios"]');
    await page.waitForSelector('#users-title');
    await page.waitForSelector('table');
    const novo = page.locator('header button.botao--primario', { hasText: 'Novo usuário' });
    await novo.click();
    const modal = page.locator('app-modal section.modal[role="dialog"]');
    await modal.waitFor();
    await page.waitForTimeout(300); // fim da animação antes da captura

    const fundoPos = await page.locator('.modal__fundo').evaluate((el) => getComputedStyle(el).position);
    checar('backdrop é position:fixed', fundoPos === 'fixed', fundoPos);
    const g = await modal.evaluate(geometria());
    const centroX = g.x + g.w / 2; const centroY = g.y + g.h / 2;
    checar('modal centralizado na horizontal', Math.abs(centroX - VIEWPORT.width / 2) <= 2, `centroX=${centroX}`);
    checar('modal centralizado na vertical', Math.abs(centroY - VIEWPORT.height / 2) <= 2, `centroY=${centroY}`);
    checar('largura 520px', Math.round(g.w) === 520, `w=${g.w}`);
    checar('aria-modal=true', (await modal.getAttribute('aria-modal')) === 'true');
    checar('título Novo usuário', (await modal.locator('h2').innerText()).includes('Novo usuário'));
    checar('botão × visível', await modal.locator('button.modal__fechar[aria-label="Fechar"]').isVisible());
    checar('uma coluna com 4 campos', (await modal.locator('form.modal-form > label').count()) === 4);
    const focoNome = await page.evaluate(() => document.activeElement?.getAttribute('formcontrolname'));
    checar('foco entra no campo Nome', focoNome === 'nome', String(focoNome));
    await page.screenshot({ path: path.join(OUT, '01-usuario-novo-modal.png') });
    await modal.screenshot({ path: path.join(OUT, '02-usuario-novo-painel.png') });

    // Validação local: salvar vazio não chama a API e mantém o modal aberto.
    const antesSalvar = rede.length;
    await modal.locator('button[type="submit"]').click();
    checar('salvar vazio mostra a validação', await modal.locator('.field-error').first().isVisible());
    checar('salvar vazio não chama a API', rede.length === antesSalvar, rede.slice(antesSalvar).join(', '));

    await page.keyboard.press('Escape');
    await modal.waitFor({ state: 'detached' });
    checar('Escape fecha', true);
    checar('foco volta ao + Novo usuário', await novo.evaluate((el) => el === document.activeElement));

    await novo.click(); await modal.waitFor();
    await modal.locator('button.modal__fechar').click();
    await modal.waitFor({ state: 'detached' });
    checar('× fecha', true);

    await page.locator('td.actions button', { hasText: 'Redefinir senha' }).first().click();
    await modal.waitFor(); await page.waitForTimeout(300);
    checar('Redefinir senha no mesmo modal', (await modal.locator('h2').innerText()).includes('Redefinir senha'));
    await page.screenshot({ path: path.join(OUT, '03-usuario-redefinir-senha-modal.png') });
    await page.mouse.click(8, 8); // fundo
    await modal.waitFor({ state: 'detached' });
    checar('clique no fundo fecha', true);

    await page.locator('td.actions button', { hasText: 'Editar' }).first().click();
    await modal.waitFor(); await page.waitForTimeout(300);
    checar('Editar sem campo de senha', (await modal.locator('input[formcontrolname="senhaInicial"]').count()) === 0);
    await page.screenshot({ path: path.join(OUT, '04-usuario-editar-modal.png') });
    await page.keyboard.press('Escape'); await modal.waitFor({ state: 'detached' });

    // ------------------------------------------------------------ Equipamentos
    await page.click('a.navigation__item[href="/equipamentos"]');
    await page.waitForSelector('#equipamentos-titulo');
    await page.locator('button.botao--primario', { hasText: 'Novo equipamento' }).first().click();
    const modalEq = page.locator('section.equipamento-modal[role="dialog"]');
    await modalEq.waitFor(); await page.waitForTimeout(300);
    const ge = await modalEq.evaluate(geometria());
    checar('mesma borda superior do equipamento', ge.borderTop === g.borderTop, `${ge.borderTop} × ${g.borderTop}`);
    checar('mesmo raio do equipamento', ge.radius === g.radius, `${ge.radius} × ${g.radius}`);
    checar('mesmo fundo do painel do equipamento', ge.fundo === g.fundo, `${ge.fundo} × ${g.fundo}`);
    await page.screenshot({ path: path.join(OUT, '05-equipamento-novo-modal.png') });
    await modalEq.screenshot({ path: path.join(OUT, '06-equipamento-novo-painel.png') });
    await modalEq.locator('button[aria-label="Fechar"]').click();

    // ------------------------------------------------------ Lado a lado
    const b64 = (f) => fs.readFileSync(path.join(OUT, f)).toString('base64');
    const comp = await browser.newPage({ viewport: { width: 2960, height: 980 } });
    await comp.setContent(`<body style="margin:0;padding:20px;background:#111;display:flex;gap:40px;font:600 16px sans-serif;color:#ddd">
      <figure style="margin:0"><figcaption style="margin-bottom:8px">Usuários — Novo usuário (app-modal)</figcaption><img src="data:image/png;base64,${b64('01-usuario-novo-modal.png')}"></figure>
      <figure style="margin:0"><figcaption style="margin-bottom:8px">Equipamentos — Novo equipamento (referência)</figcaption><img src="data:image/png;base64,${b64('05-equipamento-novo-modal.png')}"></figure></body>`);
    await comp.screenshot({ path: path.join(OUT, '07-comparacao-lado-a-lado.png'), fullPage: true });
    await comp.close();

    const escritas = rede.filter((l) => /^(POST|PUT|PATCH|DELETE) /.test(l) && !l.includes('/auth/'));
    checar('nenhuma escrita na API', escritas.length === 0, escritas.join(', '));
  } catch (e) {
    checar('roteiro completo', false, String(e));
    await page.screenshot({ path: path.join(OUT, 'falha.png') }).catch(() => {});
  } finally {
    fs.writeFileSync(path.join(OUT, 'resultado.json'), JSON.stringify({ resultados, erros }, null, 2));
    fs.writeFileSync(path.join(OUT, 'rede.json'), JSON.stringify(rede, null, 2));
    await browser.close();
    const falhas = resultados.filter((r) => !r.ok);
    for (const r of resultados) console.log(`${r.ok ? 'OK  ' : 'FALHA'} ${r.nome}${r.detalhe ? ' — ' + r.detalhe : ''}`);
    console.log(`\n${resultados.length - falhas.length}/${resultados.length} checagens OK`);
    process.exitCode = falhas.length ? 1 : 0;
  }
})();
```

(Nota: o `.catch(() => {})` do screenshot de falha é só da captura de diagnóstico, não de seletor.)

- [ ] **Step 2: Subir ambiente e rodar**

1. `docker ps` — confirmar `inframonitor-postgres` em 5434 (senão `docker desktop start`).
2. Backend em background: `DB_PORT=5434 JWT_SECRET=<32+ bytes> ./mvnw spring-boot:run` em `infra-monitor-backend/`; esperar `GET http://localhost:8080/actuator/health` = UP.
3. Frontend em background: `npx ng serve` em `infra-monitor-frontend/`; esperar 4200.
4. Senha do admin dev: valor documentado em `Docs/Front-End-Docs/F11 - Alinhamento do Painel ao Mockup.md:207`; passar só por env, nunca gravar em arquivo; não redefinir senha no banco.
5. `MODAL_E2E_SENHA=<senha> npm run e2e:modal-usuarios`
Expected: todas as checagens OK, `07-comparacao-lado-a-lado.png` gerado.

- [ ] **Step 3: Inspecionar os PNGs** (01, 03, 04, 05, 07) com a ferramenta de leitura de imagem: modal centralizado, fundo escuro, borda azul, ×, uma coluna.

- [ ] **Step 4: Encerrar processos** por PID (java do backend e node do ng serve) e provar 8080/4200 livres (`netstat -ano | grep -E ":8080|:4200"`).

- [ ] **Step 5: Commit**

```bash
git add infra-monitor-frontend/e2e/modal-usuarios.cjs infra-monitor-frontend/e2e/modal-usuarios-evidence infra-monitor-frontend/package.json
git commit -m "test(e2e): modal de usuarios por clique e comparacao com o de equipamento

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Verificação final

- [ ] `npx ng test --watch=false` em `infra-monitor-frontend/` — suíte inteira verde; registrar contagem.
- [ ] `npx ng build` — sem erro; registrar aviso de budget se houver.
- [ ] `git diff main --stat` — só os arquivos das Tasks 1–3 + spec/plano.
- [ ] Registrar na spec (seção nova "Pendências") a migração futura de Equipamentos/Tipos/Monitores/confirm-dialog para `app-modal`, com a falha de Escape/foco que eles têm hoje. Commit `docs(spec): pendencia de migracao dos modais locais`.
