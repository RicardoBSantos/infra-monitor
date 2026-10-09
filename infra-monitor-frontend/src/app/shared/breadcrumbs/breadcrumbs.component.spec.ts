import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { BreadcrumbsComponent } from './breadcrumbs.component';

/** Host mínimo: a trilha é derivada da árvore de rotas ativa, não de input. */
@Component({ selector: 'app-host', imports: [BreadcrumbsComponent], template: '<app-breadcrumbs />' })
class HostComponent {}

/**
 * Telas cujo detalhe é uma gaveta montada pela própria lista declaram as rotas de
 * detalhe como FILHAS, e por isso precisam de uma filha de path vazio para o estado
 * "lista limpa". Essa filha é a armadilha que estes testes cobrem.
 */
const rotas = [{
  path: 'incidentes',
  component: HostComponent,
  data: { breadcrumb: 'Incidentes', section: 'Operações' },
  children: [
    { path: ':id', children: [], data: { breadcrumb: 'Detalhe do incidente' } },
    { path: '', children: [], data: { breadcrumb: null } },
  ],
}];

describe('BreadcrumbsComponent', () => {
  let harness: RouterTestingHarness;

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [provideRouter(rotas)] });
    harness = await RouterTestingHarness.create();
  });

  afterEach(() => TestBed.resetTestingModule());

  function trilha(): string[] {
    return Array.from(harness.routeNativeElement!.querySelectorAll('.breadcrumbs > span, .breadcrumbs > a'))
      .map((no) => no.textContent!.trim());
  }

  /**
   * Regressão: com a estratégia padrão `emptyOnly`, a filha de path vazio herda o `data`
   * do pai e reentrega `breadcrumb: 'Incidentes'`. Sem o `breadcrumb: null` explícito na
   * rota, a lista limpa sai com "Operações › Incidentes › Incidentes".
   */
  it('não repete o segmento do pai na filha de path vazio', async () => {
    await harness.navigateByUrl('/incidentes');
    harness.detectChanges();
    expect(trilha()).toEqual(['Operações', 'Incidentes']);
  });

  it('acrescenta o segmento da filha quando o detalhe está aberto', async () => {
    await harness.navigateByUrl('/incidentes/12');
    harness.detectChanges();
    expect(trilha()).toEqual(['Operações', 'Incidentes', 'Detalhe do incidente']);
  });
});
