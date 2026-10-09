import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import { EventoTimeline } from './timeline';

/**
 * Apresentação pura da linha do tempo. Recebe os eventos já derivados e ordenados por
 * `derivarTimeline` — não busca nada, não calcula nada.
 */
@Component({
  selector: 'app-incidente-timeline',
  imports: [DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (eventos().length === 0) {
      <div class="vazio">
        <strong>Sem eventos registrados na janela.</strong>
        <p>A timeline é derivada das medições, da ocorrência e das notificações — nenhuma delas cobre este intervalo.</p>
      </div>
    } @else {
      <ol class="timeline">
        @for (evento of eventos(); track evento.chave) {
          <li class="timeline__item" [class]="'timeline__item--' + evento.severidade">
            <span class="timeline__marca" aria-hidden="true"></span>
            <time class="timeline__hora mono" [attr.datetime]="evento.instante">{{ evento.instante | date:'dd/MM HH:mm:ss' }}</time>
            <span class="timeline__rotulo">{{ evento.rotulo }}</span>
            @if (evento.detalhe) { <span class="timeline__detalhe">{{ evento.detalhe }}</span> }
          </li>
        }
      </ol>
    }
  `,
  styleUrl: './incidente-timeline.component.scss',
})
export class IncidenteTimelineComponent {
  readonly eventos = input.required<EventoTimeline[]>();
}
