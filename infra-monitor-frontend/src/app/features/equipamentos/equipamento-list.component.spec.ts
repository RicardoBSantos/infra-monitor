import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { EquipmentOperationalStatus } from '../../core/models/api-enums';
import { DashboardEquipamentoLista } from '../../core/models/dashboard';
import { EquipamentoResponse } from '../../core/models/equipamento';
import { EquipamentoListComponent } from './equipamento-list.component';

function linha(overrides: Partial<DashboardEquipamentoLista> & { id: number }): DashboardEquipamentoLista {
  return {
    nome: `EQ-${overrides.id}`,
    tipoNome: 'Switch',
    unidadeId: 1,
    unidadeNome: 'Matriz',
    hostname: `eq-${overrides.id}.local`,
    ip: `10.0.0.${overrides.id}`,
    status: EquipmentOperationalStatus.Available,
    latenciaMs: 13,
    ativo: true,
    localizacao: `Rack ${overrides.id}`,
    numeroSerie: `SN-000${overrides.id}`,
    ...overrides,
  };
}

const CADASTRO_COMPLETO: EquipamentoResponse = {
  id: 1,
  nome: 'EQ-1',
  ip: '10.0.0.1',
  hostname: 'eq-1.local',
  descricao: 'Switch de núcleo',
  localizacao: 'Rack 03',
  numeroSerie: 'SN-0001',
  fabricante: 'Cisco',
  modelo: 'Catalyst 9200-24T',
  ativo: true,
  emManutencao: false,
  unidade: { id: 1, nome: 'Matriz' },
  tipoEquipamento: { id: 2, nome: 'Switch' },
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

describe('EquipamentoListComponent', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EquipamentoListComponent],
      providers: [provideRouter([
        { path: 'equipamentos', component: EquipamentoListComponent },
        { path: 'equipamentos/:id', component: EquipamentoListComponent },
      ]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  function montar(inventario: DashboardEquipamentoLista[]): ComponentFixture<EquipamentoListComponent> {
    const fixture = TestBed.createComponent(EquipamentoListComponent);
    fixture.detectChanges();
    http.expectOne((requisicao) => requisicao.url.endsWith('/unidades')).flush([
      { id: 1, nome: 'Matriz', sigla: 'MAT', descricao: null, ativo: true, createdAt: '', updatedAt: '' },
    ]);
    http.expectOne((requisicao) => requisicao.url.endsWith('/tipos-equipamento')).flush([
      { id: 2, nome: 'Switch', descricao: null, ativo: true, createdAt: '', updatedAt: '' },
    ]);
    http.expectOne((requisicao) => requisicao.url.endsWith('/dashboard/equipamentos')).flush(inventario);
    fixture.detectChanges();
    return fixture;
  }

  function texto(fixture: ComponentFixture<EquipamentoListComponent>): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  it('carrega o inventário completo de uma vez e o pagina em memória', () => {
    const fixture = montar(Array.from({ length: 25 }, (_, indice) => linha({ id: indice + 1 })));

    expect(texto(fixture)).toContain('25 de 25 dispositivos');
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('tbody tr').length).toBe(20);

    const paginacao = (fixture.nativeElement as HTMLElement).querySelector('.paginacao') as HTMLElement;
    expect(paginacao.textContent).toContain('Página 1 de 2');
    paginacao.querySelector<HTMLButtonElement>('button:last-of-type')!.click();
    fixture.detectChanges();

    // Trocar de página não fala com o servidor: o inventário inteiro já está em memória.
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('tbody tr').length).toBe(5);
  });

  it('busca em memória por todos os campos que o placeholder promete, sem refetch', () => {
    const inventario = [
      linha({ id: 1, nome: 'SW-CORE', localizacao: 'CPD Térreo', numeroSerie: 'ABC-999' }),
      linha({ id: 2, nome: 'AP-RECEPCAO', unidadeId: 2, unidadeNome: 'Filial', tipoNome: 'Access Point' }),
    ];

    for (const [termo, esperado] of [
      ['filial', 'AP-RECEPCAO'],
      ['access point', 'AP-RECEPCAO'],
      ['eq-1.local', 'SW-CORE'],
      ['10.0.0.1', 'SW-CORE'],
      ['cpd térreo', 'SW-CORE'],
      ['abc-999', 'SW-CORE'],
    ] as const) {
      const fixture = montar(inventario);
      const busca = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('#busca-equipamentos')!;
      busca.value = termo;
      busca.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      expect(texto(fixture)).toContain(esperado);
      expect(texto(fixture)).toContain('1 de 2 dispositivos');
      fixture.destroy();
    }
  });

  it('mantém o painel de filtros fechado e sinaliza quantos filtros estão ativos', () => {
    const fixture = montar([
      linha({ id: 1 }),
      linha({ id: 2, unidadeId: 2, unidadeNome: 'Filial' }),
    ]);
    const elemento = fixture.nativeElement as HTMLElement;

    expect(elemento.querySelector('#painel-filtros')).toBeNull();

    elemento.querySelector<HTMLButtonElement>('.equipamentos__filtros-gatilho')!.click();
    fixture.detectChanges();
    expect(elemento.querySelector('#painel-filtros')).not.toBeNull();
    expect(elemento.querySelector('.equipamentos__contador-filtros')).toBeNull();

    const unidade = elemento.querySelectorAll<HTMLSelectElement>('#painel-filtros select')[0];
    unidade.value = '2';
    unidade.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(elemento.querySelector('.equipamentos__contador-filtros')?.textContent?.trim()).toBe('1');
    expect(elemento.querySelectorAll('tbody tr').length).toBe(1);
  });

  it('mostra "timeout" no lugar da latência quando o equipamento está offline', () => {
    const fixture = montar([linha({ id: 1, status: EquipmentOperationalStatus.Unavailable, latenciaMs: null })]);

    expect((fixture.nativeElement as HTMLElement).querySelector('.down')?.textContent).toContain('timeout');
  });

  it('rotula a coluna de monitoramento a partir do campo ativo', () => {
    const fixture = montar([linha({ id: 1, ativo: true }), linha({ id: 2, ativo: false })]);
    const chips = (fixture.nativeElement as HTMLElement).querySelectorAll('.chip-monitoramento');

    expect(chips[0].textContent?.trim()).toBe('Ativado');
    expect(chips[1].textContent?.trim()).toBe('Desativado');
  });

  it('carrega o cadastro completo na edição e reenvia todos os campos ao salvar sem alterações', () => {
    const fixture = montar([linha({ id: 1 })]);

    fixture.componentInstance['executarAcao'](linha({ id: 1 }), 'editar');
    fixture.detectChanges();

    http.expectOne((requisicao) => requisicao.url.endsWith('/equipamentos/1')).flush(CADASTRO_COMPLETO);
    fixture.detectChanges();

    (fixture.nativeElement as HTMLElement).querySelector<HTMLFormElement>('.equipamento-modal form')!
      .dispatchEvent(new Event('submit'));
    fixture.detectChanges();

    const put = http.expectOne((requisicao) => requisicao.method === 'PUT' && requisicao.url.endsWith('/equipamentos/1'));
    // Round-trip: abrir em edição e salvar sem tocar em nada não pode perder campo algum.
    expect(put.request.body).toEqual({
      unidadeId: 1,
      tipoEquipamentoId: 2,
      nome: 'EQ-1',
      ip: '10.0.0.1',
      hostname: 'eq-1.local',
      descricao: 'Switch de núcleo',
      localizacao: 'Rack 03',
      numeroSerie: 'SN-0001',
      fabricante: 'Cisco',
      modelo: 'Catalyst 9200-24T',
    });
    put.flush(CADASTRO_COMPLETO);
    http.expectOne((requisicao) => requisicao.url.endsWith('/dashboard/equipamentos')).flush([linha({ id: 1 })]);
  });

  it('não promete exclusão e mostra no diálogo a recusa vinda da API', () => {
    const fixture = montar([linha({ id: 1, nome: 'SW-CORE' })]);

    fixture.componentInstance['executarAcao'](linha({ id: 1, nome: 'SW-CORE' }), 'excluir');
    fixture.detectChanges();

    expect(texto(fixture)).toContain('só pode ser excluído se não houver monitores associados');
    expect(texto(fixture)).not.toContain('não pode ser desfeita');

    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.botao--perigo')!.click();
    http.expectOne((requisicao) => requisicao.method === 'DELETE').flush(
      { code: 'BUSINESS_CONFLICT', message: 'Nao e possivel excluir o equipamento porque existem monitores associados', status: 409, error: 'Conflict', path: '/api/v1/equipamentos/1', timestamp: '' },
      { status: 409, statusText: 'Conflict' },
    );
    fixture.detectChanges();

    expect(texto(fixture)).toContain('Nao e possivel excluir o equipamento porque existem monitores associados');
  });

  it('avisa que desativar fecha a janela de monitoramento e afeta o relatório', () => {
    const fixture = montar([linha({ id: 1, nome: 'SW-CORE' })]);

    fixture.componentInstance['executarAcao'](linha({ id: 1, nome: 'SW-CORE' }), 'desativar');
    fixture.detectChanges();

    expect(texto(fixture)).toContain('janela de monitoramento em andamento é fechada');
    expect(texto(fixture)).toContain('relatório de disponibilidade');
  });

  it('mostra estado vazio por filtro distinto do inventário vazio', () => {
    const vazio = montar([]);
    expect(texto(vazio)).toContain('Nenhum equipamento cadastrado');

    const comBusca = montar([linha({ id: 1, nome: 'SW-CORE' })]);
    const busca = (comBusca.nativeElement as HTMLElement).querySelector<HTMLInputElement>('#busca-equipamentos')!;
    busca.value = 'inexistente';
    busca.dispatchEvent(new Event('input'));
    comBusca.detectChanges();

    expect(texto(comBusca)).toContain('Nenhum equipamento corresponde aos critérios');
  });

  it('mantém a tela de pé quando o inventário falha, com retry isolado', () => {
    const fixture = TestBed.createComponent(EquipamentoListComponent);
    fixture.detectChanges();
    http.expectOne((requisicao) => requisicao.url.endsWith('/unidades')).flush([]);
    http.expectOne((requisicao) => requisicao.url.endsWith('/tipos-equipamento')).flush([]);
    http.expectOne((requisicao) => requisicao.url.endsWith('/dashboard/equipamentos'))
      .flush('erro', { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();

    expect(texto(fixture)).toContain('Não foi possível carregar o inventário');

    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.vazio .botao')!.click();
    http.expectOne((requisicao) => requisicao.url.endsWith('/dashboard/equipamentos')).flush([linha({ id: 1 })]);
    fixture.detectChanges();

    expect(texto(fixture)).toContain('EQ-1');
  });

  // ---- Rota /equipamentos/:id -------------------------------------------------

  /** Responde às três chamadas que a própria lista faz ao montar. */
  function responderLista(harness: RouterTestingHarness): void {
    harness.detectChanges();
    http.match((requisicao) => requisicao.url.endsWith('/unidades')).forEach((r) => r.flush([]));
    http.match((requisicao) => requisicao.url.endsWith('/tipos-equipamento')).forEach((r) => r.flush([]));
    http.match((requisicao) => requisicao.url.endsWith('/dashboard/equipamentos')).forEach((r) => r.flush([linha({ id: 7 })]));
    harness.detectChanges();
  }

  /** Lista + as chamadas de composição do drawer, sem afirmar conteúdo. */
  function responderTudo(harness: RouterTestingHarness): void {
    responderLista(harness);
    http.match(() => true).forEach((requisicao) => requisicao.flush(
      requisicao.request.url.includes('/api/v1/equipamentos/') ? CADASTRO_COMPLETO
        : { content: [], page: 0, size: 0, totalElements: 0, totalPages: 0, first: true, last: true }));
    harness.detectChanges();
  }

  it('abre o drawer direto no deep-link /equipamentos/:id, sem clique', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/equipamentos/7');
    responderTudo(harness);

    // O componente montado é a lista; o :id só decide se o drawer abre junto.
    expect(harness.routeNativeElement!.querySelector('app-equipamento-detalhe-drawer')).not.toBeNull();
    expect(harness.routeNativeElement!.textContent).toContain('EQ-7');
  });

  it('fechar o drawer navega de volta para /equipamentos limpo', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/equipamentos/7');
    responderTudo(harness);

    harness.routeNativeElement!.querySelector<HTMLButtonElement>('.gaveta__fechar')!.click();
    await harness.fixture.whenStable();
    // A lista é remontada pela rota sem `:id` e refaz a própria carga.
    responderLista(harness);

    expect(TestBed.inject(Router).url).toBe('/equipamentos');
    expect(harness.routeNativeElement!.querySelector('app-equipamento-detalhe-drawer')).toBeNull();
  });

  it('o link cross-page para /equipamentos/:id continua valendo sem edição na origem', async () => {
    const harness = await RouterTestingHarness.create();
    // Mesmo href emitido por Relatórios e pela aba Equipamentos do detalhe de unidade.
    await harness.navigateByUrl('/equipamentos/7');
    responderTudo(harness);

    expect(TestBed.inject(Router).url).toBe('/equipamentos/7');
    expect(harness.routeNativeElement!.querySelector('app-equipamento-detalhe-drawer')).not.toBeNull();
  });
});
