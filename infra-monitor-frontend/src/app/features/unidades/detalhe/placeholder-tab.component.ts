import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

/** Aba ainda não implementada. Histórico e Configurações entram nas etapas 3 e 4. */
@Component({
  selector: 'app-unidade-aba-pendente',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="vazio"><strong>{{ titulo }}</strong><p>Esta seção ainda não foi implementada.</p></div>`,
  styles: ':host { display: block; border: 1px solid var(--im-border); border-radius: var(--im-radius-lg); background: var(--im-surface-raised); }',
})
export class PlaceholderTabComponent {
  protected readonly titulo = inject(ActivatedRoute).snapshot.data['titulo'] ?? 'Em construção';
}
