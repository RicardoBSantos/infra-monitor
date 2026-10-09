import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, OnDestroy, computed, inject, signal } from '@angular/core';
import { take } from 'rxjs';
import { isApiError } from '../../core/models/api-error';
import { TelegramConfiguracao, TelegramTesteResultado } from '../../core/models/telegram-config';
import { TelegramConfigApiService } from '../../core/services/telegram-config-api.service';
import { StatusBadgeComponent } from '../../shared/status-badge/status-badge.component';

type Estado = 'loading' | 'success' | 'error';
type EstadoTeste = 'idle' | 'enviando' | 'ok' | 'falha';

@Component({
  selector: 'app-configuracao-tab',
  imports: [StatusBadgeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './configuracao-tab.component.html',
  styleUrl: './configuracao-tab.component.scss',
})
export class ConfiguracaoTabComponent implements OnDestroy {
  private readonly api = inject(TelegramConfigApiService);
  private temporizador: ReturnType<typeof setInterval> | null = null;

  protected readonly estado = signal<Estado>('loading');
  protected readonly erro = signal<string | null>(null);
  protected readonly config = signal<TelegramConfiguracao | null>(null);

  protected readonly estadoTeste = signal<EstadoTeste>('idle');
  protected readonly mensagemTeste = signal<string | null>(null);
  protected readonly cooldown = signal(0);

  /** O botão só envia quando há canal ativo, destino configurado e nenhum cooldown correndo. */
  protected readonly podeTestar = computed(() => {
    const config = this.config();
    return !!config && config.telegramEnabled && config.destinoConfigurado
      && this.estadoTeste() !== 'enviando' && this.cooldown() === 0;
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => this.pararContagem());
    this.carregar();
  }

  ngOnDestroy(): void { this.pararContagem(); }

  protected carregar(): void {
    this.estado.set('loading'); this.erro.set(null);
    this.api.configuracao().pipe(take(1)).subscribe({
      next: config => { this.config.set(config); this.estado.set('success'); },
      error: error => { this.erro.set(mensagemDe(error, 'Não foi possível carregar a configuração do Telegram.')); this.estado.set('error'); },
    });
  }

  protected testar(): void {
    if (!this.podeTestar()) return;
    this.estadoTeste.set('enviando'); this.mensagemTeste.set(null);
    this.api.testar().pipe(take(1)).subscribe({
      next: resultado => this.aplicarResultado(resultado),
      error: error => {
        this.estadoTeste.set('falha');
        this.mensagemTeste.set(mensagemDe(error, 'Não foi possível enviar a mensagem de teste.'));
      },
    });
  }

  private aplicarResultado(resultado: TelegramTesteResultado): void {
    if (resultado.enviado) {
      this.estadoTeste.set('ok');
      this.mensagemTeste.set('Mensagem de teste enviada ao destino padrão.');
      this.iniciarContagem(this.config()?.testeCooldownSegundos ?? 0);
      return;
    }
    this.estadoTeste.set('falha');
    this.mensagemTeste.set(resultado.motivo ?? 'O envio de teste foi recusado.');
    // Recusa por throttle traz quanto falta; as demais não iniciam contagem.
    if (resultado.cooldownRestanteSegundos) this.iniciarContagem(resultado.cooldownRestanteSegundos);
  }

  private iniciarContagem(segundos: number): void {
    this.pararContagem();
    if (segundos <= 0) return;
    this.cooldown.set(segundos);
    this.temporizador = setInterval(() => {
      const restante = this.cooldown() - 1;
      this.cooldown.set(Math.max(restante, 0));
      if (restante <= 0) this.pararContagem();
    }, 1000);
  }

  private pararContagem(): void {
    if (this.temporizador !== null) { clearInterval(this.temporizador); this.temporizador = null; }
  }
}

function mensagemDe(error: unknown, alternativa: string): string {
  return error instanceof HttpErrorResponse && isApiError(error.error) ? error.error.message : alternativa;
}
