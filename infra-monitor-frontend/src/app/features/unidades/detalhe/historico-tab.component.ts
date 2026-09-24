import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { take } from 'rxjs';

import { DisponibilidadeDiariaUnidadeResponse } from '../../../core/models/relatorio';
import { RelatorioApiService } from '../../../core/services/relatorio-api.service';
import { Estado, UnidadeDetalheStore, formatarPercentual } from './unidade-detalhe.store';

/** Faixas de cor da barra. Ajustáveis aqui, nunca inline no template. */
const LIMIAR_VERDE = 99;
const LIMIAR_AMBAR = 95;

/**
 * Disponibilidade opera perto de 100%: numa escala de 0 a 100 a diferença entre
 * 99,4% e 100% some. O eixo é truncado logo abaixo do pior dia e o piso é
 * declarado na UI. Se algum dia despencar, o piso cai junto e a escala volta a
 * ser inteira — um dia catastrófico deve dominar o desenho.
 */
const FOLGA_PISO = 0.5;
const PISO_MAXIMO = 99.5;

/**
 * tempoMonitoradoSegundos é a SOMA sobre os monitores da unidade: um dia cheio de
 * uma unidade com 16 monitores marca 1.382.400 s, não 86.400. Comparar com um dia
 * absoluto nunca detectaria dia parcial. A cobertura cheia é, portanto, o maior
 * valor da própria série, e o dia é parcial quando fica sensivelmente abaixo dela.
 */
const LIMIAR_COBERTURA = 0.99;

const ROTULOS_EIXO = 4;

type Faixa = 'ok' | 'warn' | 'down';

interface Barra {
  data: string;
  rotulo: string;
  percentual: number;
  percentualTexto: string;
  altura: string;
  faixa: Faixa;
  parcial: boolean;
  dica: string;
  mostrarRotulo: boolean;
}

@Component({
  selector: 'app-unidade-historico',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './historico-tab.component.html',
  styleUrl: './historico-tab.component.scss',
})
export class HistoricoTabComponent {
  private readonly relatorios = inject(RelatorioApiService);
  private readonly store = inject(UnidadeDetalheStore);

  protected readonly estado = signal<Estado>('loading');
  protected readonly dias = signal<DisponibilidadeDiariaUnidadeResponse[]>([]);

  /** Só dias efetivamente calculados viram barra: ausência não é zero. */
  private readonly medidos = computed(() =>
    this.dias().filter((dia) => dia.disponibilidadePercentual !== null));

  protected readonly piso = computed(() => {
    const valores = this.medidos().map((dia) => dia.disponibilidadePercentual as number);
    if (valores.length === 0) return 0;
    return Math.min(PISO_MAXIMO, Math.max(0, Math.floor(Math.min(...valores) - FOLGA_PISO)));
  });

  protected readonly pisoTexto = computed(() => formatarPercentual(this.piso()));

  protected readonly barras = computed<Barra[]>(() => {
    const medidos = this.medidos();
    const piso = this.piso();
    const coberturaCheia = Math.max(...medidos.map((dia) => dia.tempoMonitoradoSegundos ?? 0), 0);
    const amplitude = Math.max(100 - piso, 0.01);
    const indicesComRotulo = this.indicesComRotulo(medidos.length);
    return medidos.map((dia, indice) => {
      const percentual = dia.disponibilidadePercentual as number;
      const segundos = dia.tempoMonitoradoSegundos ?? 0;
      const cobertura = coberturaCheia > 0 ? segundos / coberturaCheia : 1;
      const parcial = cobertura < LIMIAR_COBERTURA;
      const rotulo = this.formatarDia(dia.data);
      const percentualTexto = formatarPercentual(percentual);
      return {
        data: dia.data,
        rotulo,
        percentual,
        percentualTexto,
        altura: `${Math.max(((percentual - piso) / amplitude) * 100, 1.5)}%`,
        faixa: percentual >= LIMIAR_VERDE ? 'ok' : percentual >= LIMIAR_AMBAR ? 'warn' : 'down',
        parcial,
        dica: parcial
          ? `${rotulo} · ${percentualTexto} · dia parcial (${Math.round(cobertura * 100)}% do dia monitorado)`
          : `${rotulo} · ${percentualTexto}`,
        mostrarRotulo: indicesComRotulo.has(indice),
      };
    });
  });

  constructor() { this.carregar(); }

  protected carregar(): void {
    this.estado.set('loading');
    this.relatorios.getDisponibilidadeDiariaUnidade(this.store.id()).pipe(take(1)).subscribe({
      next: (dias) => { this.dias.set(dias); this.estado.set('success'); },
      error: () => { this.dias.set([]); this.estado.set('error'); },
    });
  }

  /** Primeira, última e algumas intermediárias — o eixo não comporta 30 rótulos. */
  private indicesComRotulo(total: number): Set<number> {
    if (total === 0) return new Set();
    if (total <= ROTULOS_EIXO) return new Set(Array.from({ length: total }, (_, i) => i));
    const passo = (total - 1) / (ROTULOS_EIXO - 1);
    return new Set(Array.from({ length: ROTULOS_EIXO }, (_, i) => Math.round(i * passo)));
  }

  /** "2026-08-24" é data civil sem fuso: montar por componente evita voltar um dia em UTC-3. */
  private formatarDia(data: string): string {
    const [, mes, dia] = data.split('-');
    return `${dia}/${mes}`;
  }

}
