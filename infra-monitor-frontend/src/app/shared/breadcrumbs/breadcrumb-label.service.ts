import { Injectable, signal } from '@angular/core';

/**
 * Rótulo dinâmico para a última migalha, quando o nome só é conhecido depois da
 * resposta da API. Evita um resolver que refaria a requisição que a tela já faz.
 */
@Injectable({ providedIn: 'root' })
export class BreadcrumbLabelService {
  readonly rotulo = signal<string | null>(null);

  definir(rotulo: string | null): void { this.rotulo.set(rotulo); }
}
