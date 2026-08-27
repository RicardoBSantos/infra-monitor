import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';

import { UnitOperationalStatus } from '../../core/models/api-enums';
import { UnidadeDetalheComponent } from './unidade-detalhe.component';

const detalhe = {
  id: 7, nome: 'Centro Operacional', codigoIbge: '2800308', ativo: true, status: UnitOperationalStatus.Degraded,
  equipamentos: { total: 4, ativos: 4, disponiveis: 2, degradados: 1, indisponiveis: 1, semDados: 0, semMonitoramento: 0, emManutencao: 1 },
  monitores: { ativos: 4, indisponiveis: 1 }, incidentesAbertos: 1,
};
const equipamento = {
  id: 31, nome: 'SW-CORE', ip: '10.0.0.1', hostname: 'sw-core.rede.local', localizacao: 'Rack 1', ativo: true, status: 'DISPONIVEL',
  tipoEquipamento: { id: 2, nome: 'Switch' }, emManutencao: false, monitoresAtivos: 1, incidentesAbertos: 0,
  ultimaMedicao: { status: 'SUCESSO', latenciaMs: 13, executadoEm: '2026-08-19T11:59:45Z' },
};
const pagina = <T,>(content: T[]) => ({ content, page: 0, size: content.length, totalElements: content.length, totalPages: 1, first: true, last: true });

describe('UnidadeDetalheComponent', () => {
  let httpTesting: HttpTestingController;

  async function configurar(id: string) {
    await TestBed.configureTestingModule({
      imports: [UnidadeDetalheComponent],
      providers: [
        provideRouter([]), provideHttpClient(), provideHttpClientTesting(),
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: new Map([['id', id]]) } } },
      ],
    }).compileComponents();
    httpTesting = TestBed.inject(HttpTestingController);
  }

  afterEach(() => { httpTesting.verify({ ignoreCancelled: true }); });

  function criar() { const fixture = TestBed.createComponent(UnidadeDetalheComponent); fixture.detectChanges(); return fixture; }
  function texto(fixture: ComponentFixture<UnidadeDetalheComponent>) { return (fixture.nativeElement as HTMLElement).textContent ?? ''; }

  /** Só endpoints que já existem: detalhe do painel, equipamentos da unidade e relatórios. */
  function responder(fixture: ComponentFixture<UnidadeDetalheComponent>) {
    httpTesting.expectOne((request) => request.url.endsWith('/dashboard/unidades/7')).flush(detalhe);
    httpTesting.expectOne((request) => request.url.includes('/dashboard/unidades/7/equipamentos')).flush(pagina([equipamento]));
    httpTesting.expectOne((request) => request.url.includes('/relatorios/disponibilidade/unidades')).flush(pagina([{ unidadeId: 7, unidadeNome: 'Centro Operacional', inicio: '', fim: '', estadoAnalitico: 'CALCULADO', equipamentosTotal: 4, equipamentosMonitorados: 4, equipamentosSemMonitoramento: 0, equipamentosSemDados: 0, tempoMonitoradoSegundos: 100, tempoIndisponivelSegundos: 1, tempoDisponivelSegundos: 99, disponibilidadePercentual: 99.42, incidentes: 1 }]));
    httpTesting.expectOne((request) => request.url.includes('/relatorios/latencia/unidades')).flush(pagina([{ unidadeId: 7, unidadeNome: 'Centro Operacional', inicio: '', fim: '', minLatenciaMs: 5, avgLatenciaMs: 23, maxLatenciaMs: 40, count: 200 }]));
    httpTesting.expectOne((request) => request.url.includes('/relatorios/disponibilidade/equipamentos')).flush(pagina([{ equipamentoId: 31, equipamentoNome: 'SW-CORE', unidadeId: 7, unidadeNome: 'Centro Operacional', monitorId: 1, monitorNome: 'ICMP', tipoMonitor: 'ICMP', inicio: '', fim: '', estadoAnalitico: 'CALCULADO', qualidadeJanela: 'PRECISA', tempoMonitoradoSegundos: 100, tempoIndisponivelSegundos: 0, tempoDisponivelSegundos: 100, disponibilidadePercentual: 99.93, incidentes: 0 }]));
    httpTesting.expectOne((request) => request.url.endsWith('/api/v1/unidades')).flush([{ id: 7, nome: 'Centro Operacional', sigla: 'CIS-01', descricao: null, codigoIbge: '2800308', ativo: true, createdAt: '', updatedAt: '' }]);
    httpTesting.expectOne((request) => request.url.endsWith('assets/maps/se-municipalities.geo.json')).flush({ type: 'FeatureCollection', features: [] });
    fixture.detectChanges();
  }

  it('renderiza cabeçalho, KPIs e tabela de equipamentos da unidade', async () => {
    await configurar('7');
    const fixture = criar();
    responder(fixture);

    expect(texto(fixture)).toContain('Centro Operacional');
    expect(texto(fixture)).toContain('CIS-01');
    expect(texto(fixture)).toContain('Degradada');
    expect(texto(fixture)).toContain('99,42%');
    expect(texto(fixture)).toContain('23 ms');
    expect(texto(fixture)).toContain('SW-CORE');
    expect(texto(fixture)).toContain('sw-core.rede.local');
    expect(texto(fixture)).toContain('99,93%');
  });

  it('é somente leitura: nenhum formulário nem ação de escrita na página', async () => {
    await configurar('7');
    const fixture = criar();
    responder(fixture);

    const raiz = fixture.nativeElement as HTMLElement;
    expect(raiz.querySelector('form')).toBeNull();
    expect(raiz.querySelectorAll('input, select, textarea').length).toBe(0);
  });

  it('mostra unidade não encontrada quando a API responde 404', async () => {
    await configurar('99999');
    const fixture = criar();
    httpTesting.expectOne((request) => request.url.endsWith('/dashboard/unidades/99999')).flush(
      { timestamp: '', status: 404, error: 'Not Found', code: 'RESOURCE_NOT_FOUND', message: 'Unidade nao encontrada', path: '' },
      { status: 404, statusText: 'Not Found' });
    httpTesting.expectOne((request) => request.url.includes('/dashboard/unidades/99999/equipamentos')).flush(pagina([]));
    httpTesting.expectOne((request) => request.url.includes('/relatorios/disponibilidade/unidades')).flush(pagina([]));
    httpTesting.expectOne((request) => request.url.includes('/relatorios/latencia/unidades')).flush(pagina([]));
    httpTesting.expectOne((request) => request.url.includes('/relatorios/disponibilidade/equipamentos')).flush(pagina([]));
    fixture.detectChanges();

    expect(texto(fixture)).toContain('Unidade não encontrada.');
  });

  it('mantém a página legível quando os relatórios falham', async () => {
    await configurar('7');
    const fixture = criar();
    httpTesting.expectOne((request) => request.url.endsWith('/dashboard/unidades/7')).flush(detalhe);
    httpTesting.expectOne((request) => request.url.includes('/dashboard/unidades/7/equipamentos')).flush(pagina([equipamento]));
    for (const trecho of ['/relatorios/disponibilidade/unidades', '/relatorios/latencia/unidades', '/relatorios/disponibilidade/equipamentos']) {
      httpTesting.expectOne((request) => request.url.includes(trecho)).error(new ProgressEvent('erro'), { status: 500, statusText: 'Internal Server Error' });
    }
    httpTesting.expectOne((request) => request.url.endsWith('/api/v1/unidades')).flush([]);
    httpTesting.expectOne((request) => request.url.endsWith('assets/maps/se-municipalities.geo.json')).flush({ type: 'FeatureCollection', features: [] });
    fixture.detectChanges();

    expect(texto(fixture)).toContain('Centro Operacional');
    expect(texto(fixture)).toContain('SW-CORE');
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('.kpi__vazio').length).toBe(2);
  });
});
