import { ChangeDetectionStrategy, Component, OnInit, computed, input, output, signal } from '@angular/core';

/** Atalhos oferecidos antes do período personalizado, em horas contadas a partir de agora. */
const ATALHOS = [
  { chave: '24h', rotulo: '24 h', horas: 24 },
  { chave: '7d', rotulo: '7 dias', horas: 24 * 7 },
  { chave: '30d', rotulo: '30 dias', horas: 24 * 30 },
] as const;

export type DateRangePreset = (typeof ATALHOS)[number]['chave'] | 'custom';

/** Extremos já em ISO-8601 UTC, prontos para virar query string. */
export interface DateRange { inicio: string; fim: string; }

/**
 * Seletor de período compartilhado: um chip único que abre o popover com os mesmos
 * atalhos de sempre mais o intervalo personalizado.
 *
 * O chip existe porque a barra de filtros da tela de incidentes é densa — três selects
 * e o período — e a fileira de botões ocupava o dobro da largura de um controle. O
 * contrato não mudou: continua emitindo `mudar` só com um par válido, e o consumidor
 * nunca precisa revalidar antes de chamar a API. Enquanto o personalizado estiver
 * incompleto ou invertido, o popover mostra o erro e não emite nada, mantendo o último
 * período que funcionou.
 */
@Component({
  selector: 'app-date-range',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="date-range">
      <button class="date-range__chip" type="button" aria-haspopup="dialog" [attr.aria-expanded]="aberto()"
              [attr.aria-label]="rotulo() + ': ' + rotuloAtual()" (click)="alternar()">
        <span class="date-range__chip-texto">{{ rotuloAtual() }}</span>
        <span class="date-range__chip-seta" aria-hidden="true">▾</span>
      </button>

      @if (aberto()) {
        <!-- Fundo transparente em tela cheia: fecha no clique fora sem listener global. -->
        <div class="date-range__fundo" (click)="fechar()" aria-hidden="true"></div>
        <div class="date-range__popover" role="dialog" [attr.aria-label]="rotulo()" (keydown)="aoTeclar($event)">
          <div class="date-range__atalhos">
            @for (atalho of atalhos; track atalho.chave) {
              <button class="botao botao--discreto" type="button" [class.botao--ativo]="preset() === atalho.chave" (click)="aplicarAtalho(atalho.chave)">{{ atalho.rotulo }}</button>
            }
            <button class="botao botao--discreto" type="button" [class.botao--ativo]="preset() === 'custom'" (click)="preset.set('custom')">Personalizado</button>
          </div>
          @if (preset() === 'custom') {
            <div class="date-range__campos">
              <label>DE<input type="datetime-local" [value]="inicioLocal()" (change)="setInicio($any($event.target).value)"></label>
              <label>ATÉ<input type="datetime-local" [value]="fimLocal()" (change)="setFim($any($event.target).value)"></label>
            </div>
          }
          @if (erro()) { <p class="date-range__erro" role="alert">{{ erro() }}</p> }
        </div>
      }
    </div>
  `,
  styleUrl: './date-range.component.scss',
})
export class DateRangeComponent implements OnInit {
  readonly rotulo = input<string>('Período');
  readonly mudar = output<DateRange>();

  protected readonly atalhos = ATALHOS;
  protected readonly preset = signal<DateRangePreset>('7d');
  protected readonly inicioLocal = signal('');
  protected readonly fimLocal = signal('');
  protected readonly erro = signal<string | null>(null);
  protected readonly aberto = signal(false);

  /** Texto do chip: o atalho vigente, ou o intervalo personalizado quando ele é válido. */
  protected readonly rotuloAtual = computed(() => {
    const atalho = ATALHOS.find((candidato) => candidato.chave === this.preset());
    if (atalho) return atalho.rotulo;
    const inicio = formatarLocal(this.inicioLocal()), fim = formatarLocal(this.fimLocal());
    return inicio && fim ? `${inicio} → ${fim}` : 'Personalizado';
  });

  /**
   * Emite o período inicial de 7 dias em `ngOnInit`, e não no construtor: no construtor a
   * ligação `(mudar)` do pai ainda não existe e o evento se perderia. É este emit que
   * dispara a primeira consulta do consumidor — ele não repete o cálculo do período.
   *
   * Não há input para escolher o atalho inicial de propósito: um signal input lido cedo
   * devolve o default, e a primeira consulta sairia com o período errado.
   */
  ngOnInit(): void {
    this.aplicarAtalho('7d');
  }

  protected alternar(): void { this.aberto.update((valor) => !valor); }
  protected fechar(): void { this.aberto.set(false); }

  protected aoTeclar(evento: KeyboardEvent): void {
    if (evento.key === 'Escape') { evento.stopPropagation(); this.fechar(); }
  }

  /** Atalho é escolha completa: aplica e fecha. O personalizado fica aberto para edição. */
  protected aplicarAtalho(chave: DateRangePreset): void {
    const atalho = ATALHOS.find((candidato) => candidato.chave === chave);
    if (!atalho) return;
    this.preset.set(chave);
    this.erro.set(null);
    const fim = new Date();
    const inicio = new Date(fim.getTime() - atalho.horas * 60 * 60 * 1000);
    this.fechar();
    this.mudar.emit({ inicio: inicio.toISOString(), fim: fim.toISOString() });
  }

  protected setInicio(valor: string): void { this.inicioLocal.set(valor); this.avaliarPersonalizado(); }
  protected setFim(valor: string): void { this.fimLocal.set(valor); this.avaliarPersonalizado(); }

  /**
   * Silêncio deliberado enquanto só um dos extremos foi preenchido: o backend exige os
   * dois juntos e recusaria a chamada com 400.
   */
  private avaliarPersonalizado(): void {
    const inicio = paraUtc(this.inicioLocal()), fim = paraUtc(this.fimLocal());
    if (!this.inicioLocal() || !this.fimLocal()) { this.erro.set(null); return; }
    if (!inicio || !fim) { this.erro.set('Informe datas e horários válidos.'); return; }
    if (inicio > fim) { this.erro.set('O início do período deve ser anterior ou igual ao fim.'); return; }
    this.erro.set(null);
    this.mudar.emit({ inicio, fim });
  }
}

function paraUtc(valor: string): string | undefined {
  if (!valor) return undefined;
  const data = new Date(valor);
  return Number.isNaN(data.getTime()) ? undefined : data.toISOString();
}

/** "2026-09-03T14:30" → "03/09 14:30". Entrada já é hora local do campo, sem fuso. */
function formatarLocal(valor: string): string | null {
  const partes = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(valor);
  return partes ? `${partes[3]}/${partes[2]} ${partes[4]}:${partes[5]}` : null;
}
