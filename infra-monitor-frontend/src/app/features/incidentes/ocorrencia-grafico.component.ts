import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

import { MeasurementStatus } from '../../core/models/api-enums';
import { HistoricoMedicaoResponse } from '../../core/models/relatorio';

const MEDIA_MOVEL = 5;

/** Ponto já projetado no viewBox do SVG; `y` nulo em FALHA, que vira lacuna na linha. */
interface PontoLatencia { x: number; y: number | null; }

/**
 * Gráfico da janela da ocorrência, extraído da antiga página de episódio de latência.
 *
 * Ao contrário do gráfico do drawer de equipamento, que olha os últimos minutos, aqui a
 * janela é a da ocorrência com uma folga fixa nas pontas: a pergunta é "o que aconteceu
 * naquele intervalo", não "como está agora". Quem calcula a janela e busca as medições é
 * o drawer; este componente só desenha o que recebe.
 *
 * `limiarMs` nulo desliga a linha tracejada: incidente de indisponibilidade não tem
 * limiar de latência, e desenhar uma régua em zero afirmaria um limiar que não existe.
 */
@Component({
  selector: 'app-ocorrencia-grafico',
  imports: [DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="grafico__topo">
      <h3 class="grafico__titulo">{{ titulo() }}</h3>
      <p class="grafico__legenda">
        <span class="grafico__chave grafico__chave--linha">latência</span>
        <span class="grafico__chave grafico__chave--media">média móvel</span>
        @if (linhaLimiar() !== null) { <span class="grafico__chave grafico__chave--limiar">limiar</span> }
      </p>
    </div>

    @if (estado() === 'loading') {
      <div class="esqueleto esqueleto--grafico" role="status" aria-label="Carregando medições"><span></span></div>
    } @else if (estado() === 'error') {
      <div class="vazio">
        <strong>Não foi possível carregar as medições.</strong>
        <button class="botao" type="button" (click)="recarregar.emit()">Tentar novamente</button>
      </div>
    } @else if (vazio()) {
      <div class="vazio">
        <strong>Sem medições registradas na janela da ocorrência.</strong>
        <p>A ocorrência foi detectada, mas o histórico de medições não cobre este intervalo.</p>
      </div>
    } @else {
      <svg class="grafico__svg" viewBox="0 0 100 100" preserveAspectRatio="none" role="img"
           [attr.aria-label]="'Latência na janela da ocorrência, com ' + folgaMinutos() + ' minutos de folga em cada extremo'">
        <defs>
          <linearGradient id="ocorrencia-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" class="grafico__area-topo" />
            <stop offset="100%" class="grafico__area-base" />
          </linearGradient>
        </defs>
        @for (area of areas(); track $index) { <polygon class="grafico__area" [attr.points]="area" /> }
        @for (segmento of segmentos(); track $index) { <polyline class="grafico__linha" [attr.points]="segmento" /> }
        @for (segmento of segmentosMedia(); track $index) { <polyline class="grafico__media" [attr.points]="segmento" /> }
        @if (linhaLimiar(); as y) { <line class="grafico__limiar" x1="0" x2="100" [attr.y1]="y" [attr.y2]="y" /> }
      </svg>
      <div class="grafico__eixo mono">
        <span>{{ primeiroHorario() | date:'dd/MM HH:mm' }}</span>
        <span>{{ ultimoHorario() | date:'dd/MM HH:mm' }}</span>
      </div>
    }
  `,
  styleUrl: './ocorrencia-grafico.component.scss',
})
export class OcorrenciaGraficoComponent {
  readonly medicoes = input.required<HistoricoMedicaoResponse[]>();
  readonly estado = input.required<'loading' | 'success' | 'error'>();
  readonly limiarMs = input<number | null>(null);
  readonly titulo = input('Latência na janela');
  readonly folgaMinutos = input(5);

  readonly recarregar = output<void>();

  /**
   * Escala fixada no maior entre o pico e o limiar: sem isso, uma janela de pico baixo
   * desenharia a linha do limiar fora do viewBox.
   */
  private readonly escala = computed(() => {
    const valores = latenciasDe(this.medicoes());
    const maximo = Math.max(this.limiarMs() ?? 0, ...(valores.length ? valores : [0]));
    return maximo > 0 ? maximo : 1;
  });

  private readonly serie = computed<PontoLatencia[]>(() => {
    const janela = this.medicoes();
    if (!janela.length) return [];
    const referencia = this.escala();
    const passo = janela.length > 1 ? 100 / (janela.length - 1) : 0;
    return janela.map((medicao, indice) => ({
      x: indice * passo,
      y: medicao.latenciaMs === null ? null : 100 - (medicao.latenciaMs / referencia) * 90,
    }));
  });

  private readonly trechos = computed(() => segmentar(this.serie()));
  protected readonly segmentos = computed(() => this.trechos().map(pontosDoTrecho));
  protected readonly areas = computed(() => this.trechos().map(areaDoTrecho));

  private readonly trechosMedia = computed(() => {
    const pontos = this.serie();
    const suavizada = pontos.map((ponto, indice) => {
      // A média também quebra na falha: uma linha contínua sobre a lacuna afirmaria
      // uma leitura que não existiu naquele instante.
      if (ponto.y === null) return { x: ponto.x, y: null };
      const anteriores = pontos.slice(Math.max(0, indice - MEDIA_MOVEL + 1), indice + 1)
        .map((anterior) => anterior.y)
        .filter((y): y is number => y !== null);
      return { x: ponto.x, y: anteriores.length ? anteriores.reduce((a, b) => a + b, 0) / anteriores.length : null };
    });
    return segmentar(suavizada);
  });

  protected readonly segmentosMedia = computed(() => this.trechosMedia().map(pontosDoTrecho));

  /** Altura da linha do limiar no mesmo viewBox da série. */
  protected readonly linhaLimiar = computed(() => {
    const limiar = this.limiarMs();
    return limiar === null ? null : 100 - (limiar / this.escala()) * 90;
  });

  protected readonly vazio = computed(() => this.serie().length < 2);
  protected readonly primeiroHorario = computed(() => this.medicoes()[0]?.executadoEm ?? null);
  protected readonly ultimoHorario = computed(() => this.medicoes().at(-1)?.executadoEm ?? null);
}

function latenciasDe(medicoes: HistoricoMedicaoResponse[]): number[] {
  return medicoes
    .filter((medicao) => medicao.status !== MeasurementStatus.Failure && medicao.latenciaMs !== null)
    .map((medicao) => medicao.latenciaMs as number);
}

/** Quebra a série nas lacunas: a linha não atravessa uma FALHA. */
function segmentar(pontos: PontoLatencia[]): PontoLatencia[][] {
  const trechos: PontoLatencia[][] = [];
  let atual: PontoLatencia[] = [];
  for (const ponto of pontos) {
    if (ponto.y === null) { if (atual.length) trechos.push(atual); atual = []; continue; }
    atual.push(ponto);
  }
  if (atual.length) trechos.push(atual);
  return trechos.filter((trecho) => trecho.length > 1);
}

function pontosDoTrecho(trecho: PontoLatencia[]): string {
  return trecho.map((ponto) => `${ponto.x.toFixed(2)},${(ponto.y as number).toFixed(2)}`).join(' ');
}

/** Área sob o trecho, fechada na base: é ela que recebe o gradiente. */
function areaDoTrecho(trecho: PontoLatencia[]): string {
  const corpo = pontosDoTrecho(trecho);
  return `${trecho[0].x.toFixed(2)},100 ${corpo} ${trecho[trecho.length - 1].x.toFixed(2)},100`;
}
