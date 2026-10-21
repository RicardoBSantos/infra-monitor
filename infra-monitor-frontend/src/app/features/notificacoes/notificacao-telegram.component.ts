import { ChangeDetectionStrategy, Component, ElementRef, viewChildren } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { navegarAbas } from '../../shared/a11y/navegar-abas';

interface Aba { caminho: string; rotulo: string; }

const ABAS: Aba[] = [
  { caminho: 'configuracao', rotulo: 'Configuração' },
  { caminho: 'historico', rotulo: 'Histórico' },
];

/**
 * Casca da área de Telegram: cabeçalho e navegação por abas.
 * O conteúdo de cada aba é uma rota filha, carregada sob demanda.
 */
@Component({
  selector: 'app-notificacao-telegram',
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './notificacao-telegram.component.html',
  styleUrl: './notificacao-telegram.component.scss',
})
export class NotificacaoTelegramComponent {
  private readonly gatilhosDeAba = viewChildren<ElementRef<HTMLAnchorElement>>('gatilhoAba');
  protected readonly abas = ABAS;

  protected aoTeclarAba(evento: KeyboardEvent, indice: number): void {
    navegarAbas(evento, indice, this.gatilhosDeAba().map((r) => r.nativeElement));
  }
}
