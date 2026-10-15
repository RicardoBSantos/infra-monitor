# Modal de Usuários no padrão do projeto — design

Data: 2026-10-15 · Branch: `fix/modal-usuarios` · Escopo: frontend, mudança visual

## Problema

Na tela de Usuários, "Novo usuário" (e também "Editar usuário" e "Redefinir senha")
aparece como bloco empilhado abaixo da tabela, sem backdrop e sem botão de fechar.

Causa raiz: o template já usa `div.dialog-backdrop > section.form-dialog[role=dialog]`,
mas a folha `features/unidades/admin-list.component.scss` — hoje usada só por Usuários —
estiliza `.form-dialog` e não tem regra para `.dialog-backdrop`. Sem `position: fixed`
o wrapper fica no fluxo da página.

## Levantamento (2026-10-15)

- Não existe modal de formulário compartilhado. `shared/confirm-dialog` é só confirmação.
- Modais centralizados locais, com CSS copiado: Equipamentos (`.equipamento-modal`, 640px),
  Tipos (`.tipo-modal`, 520px), Monitores (`.monitor-modal`, 640px). `confirm-dialog` tem
  a 4ª cópia de `.dialog-backdrop`.
- Drawers: Unidades (form), detalhe de Equipamento, detalhe de Incidente.
- Fora do padrão: só Usuários (3 diálogos).
- Mecânica: nenhum modal centralizado põe foco no painel ao abrir nem devolve ao gatilho;
  Escape só funciona se o foco já estiver dentro do painel; nenhum anima.

## Decisões

1. Extrair `shared/modal/ModalComponent` (`app-modal`). Usuários adota agora.
   Equipamentos, Tipos e Monitores migram depois, em tarefa separada (fora deste escopo).
2. Os três diálogos de Usuários passam a usar `app-modal`.
3. Largura 520px (precedente de Tipos para formulário de uma coluna).
4. Uma coluna: Nome, E-mail, Papel, Senha inicial (só na criação).
5. `aria-modal="true"` (modal com backdrop bloqueia o fundo; `false` é do drawer).
6. Nenhuma regra de negócio muda. Continuam: último ADMIN ativo não é rebaixado nem
   desativado; ADMIN não desativa a si mesmo; criado pela API nasce com
   `trocaSenhaObrigatoria = true`; senha inicial 12–128; e-mail único case-insensitive.
   Todas vivem no backend e na lógica do `.ts`, que não muda além de foco/fechamento.

## Componente `app-modal`

Arquivos: `src/app/shared/modal/modal.component.{ts,scss,spec.ts}`, template inline
(mesmo estilo do `confirm-dialog`).

API:

| Entrada/saída | Tipo | Uso |
|---|---|---|
| `aberto` | `input<boolean>(false)` | renderiza ou não |
| `titulo` | `input.required<string>()` | `h2`, ligado por `aria-labelledby` |
| `subtitulo` | `input<string \| null>(null)` | parágrafo sob o título |
| `largura` | `input('520px')` | `width: min(100%, largura)` |
| `bloqueado` | `input(false)` | durante salvamento: ×, Escape e fundo não fecham |
| `fechar` | `output<void>()` | pedido de fechamento (×, Escape, clique no fundo) |

Conteúdo por `<ng-content>` (o `<form>` e o rodapé de ações ficam no componente pai).

Estrutura:

```html
<div class="modal__fundo" (click)="pedirFechar()">
  <section class="modal" role="dialog" aria-modal="true" [attr.aria-labelledby]="idTitulo"
           tabindex="-1" (click)="$event.stopPropagation()">
    <header class="modal__topo">
      <div><h2 [id]="idTitulo">…</h2> @if (subtitulo()) { <p>…</p> }</div>
      <button class="modal__fechar" type="button" aria-label="Fechar"
              [disabled]="bloqueado()" (click)="pedirFechar()">✕</button>
    </header>
    <ng-content />
  </section>
</div>
```

Comportamento:

- **Escape:** ouvinte no `document` enquanto aberto (não no painel — no modal de
  equipamento o Escape preso à `section` não dispara quando o foco ainda está no gatilho).
  Ignorado com `bloqueado`.
- **Foco entra:** ao abrir, guarda `document.activeElement` como gatilho e foca o primeiro
  campo focável do conteúdo (`input, select, textarea, button` não desabilitados, excluindo
  o ×); sem campo, foca o próprio painel (`tabindex=-1`).
- **Foco volta:** quando `aberto` passa de `true` para `false`, devolve o foco ao gatilho
  se ele ainda estiver no documento.
- **Clique no fundo:** pede fechamento (igual Equipamento). Ignorado com `bloqueado`.
- **Animação:** fundo com fade ~220ms; painel com fade + leve translação/escala ~220ms.
  Sob `prefers-reduced-motion: reduce`, só fade de 120ms (mesmo critério do drawer).
- **id do título** único por instância (contador de módulo), pois a tela tem mais de um modal.
- Sem focus trap: nenhum modal ou drawer do projeto tem; manter consistência.

Estilo (do `.equipamento-modal`): `position: fixed; inset: 0; z-index: var(--im-z-modal)`,
fundo `rgba(0,0,0,.65)`, painel com `border-top: 2px solid var(--im-primary)`,
`border-radius: var(--im-radius-lg)`, `background: var(--im-surface-raised)`,
`box-shadow: var(--im-shadow-raised)`, `max-height: 90vh; overflow-y: auto`, padding 20px.
Cabeçalho e × idênticos a `.equipamento-modal__topo` / `__fechar`.

Os estilos de campos (`label`, `input`, `select`) **ficam no pai**: o encapsulamento
emulado do Angular aplica ao conteúdo projetado os atributos do componente pai, então
regras do modal não alcançam o formulário.

## Usuários

- `usuario-list.component.html`: os dois blocos `dialog-backdrop` viram `<app-modal>`.
  - Criar/editar: `[aberto]="editing() !== undefined"`, título "Novo usuário"/"Editar usuário",
    `[bloqueado]="saving()"`, `(fechar)="closeForm()"`.
  - Redefinir senha: `[aberto]="!!resetting()"`, título "Redefinir senha", subtítulo com o nome,
    `(fechar)="closeReset()"`.
  - Remove `autofocus` (o modal cuida do foco).
- `usuario-list.component.ts`: importa `ModalComponent`; novo `closeReset()` com a mesma guarda
  de `saving()` que `closeForm()` já tem. Nada mais muda.
- `admin-list.component.scss`: seletores `.form-dialog …` passam a `.modal-form …` (classe no
  `<form>`), aproximando rótulos/inputs do visual de Equipamento (rótulo 9.5px, `--im-text-dim`,
  foco `--im-info-soft`). `.form-dialog` deixa de existir.

## Testes

- `modal.component.spec.ts`: fechado não renderiza; aberto tem `role=dialog`,
  `aria-modal=true`, `aria-labelledby` apontando para o `h2`; ×, Escape e clique no fundo
  emitem `fechar`; clique no painel não emite; `bloqueado` suprime os três; foco vai ao
  primeiro campo ao abrir; foco volta ao gatilho ao fechar.
- `usuario-list.component.spec.ts`: testes existentes continuam passando sem alteração de
  regra; novos: Novo usuário abre `app-modal` com × e Escape fecha; Redefinir senha idem;
  durante salvamento Escape não fecha.
- E2E Playwright `e2e/modal-usuarios.cjs` (navegação por clique, sem gravar nada no banco):
  login → Usuários → "+ Novo usuário" → checa backdrop `position: fixed`, painel centralizado,
  × visível, foco no campo Nome, screenshot; Escape fecha e foco volta ao botão; abre de novo
  e fecha pelo ×; abre Redefinir senha (screenshot) e fecha pelo fundo; Equipamentos →
  "Novo equipamento" → screenshot; gera comparação lado a lado (PNG) dos dois modais.
- Suíte completa do frontend (`ng test`) e `ng build`.

## Fora de escopo

- Migrar Equipamentos, Tipos, Monitores e `confirm-dialog` para `app-modal`.
- Qualquer mudança no backend ou nas regras de usuário.
