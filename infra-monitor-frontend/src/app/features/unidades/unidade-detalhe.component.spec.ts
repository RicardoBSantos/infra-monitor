import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';

import { UnitOperationalStatus } from '../../core/models/api-enums';
import { UnidadeDetalheComponent } from './unidade-detalhe.component';
import { Title } from '@angular/platform-browser';

import { BreadcrumbLabelService } from '../../shared/breadcrumbs/breadcrumb-label.service';
import { UnidadeDetalheStore } from './detalhe/unidade-detalhe.store';

const detalhe = {
  id: 7, nome: 'Centro Operacional', codigoIbge: '2800308', ativo: true, status: UnitOperationalStatus.Degraded,
  equipamentos: { total: 4, ativos: 4, disponiveis: 2, degradados: 1, indisponiveis: 1, semDados: 0, semMonitoramento: 0, emManutencao: 1 },
  monitores: { ativos: 4, indisponiveis: 1 }, incidentesAbertos: 1,
};
const cadastro = {
  id: 7, nome: 'Centro Operacional', sigla: 'CIS-01', descricao: null, codigoIbge: '2800308', ativo: true,
  createdAt: '', updatedAt: '', endereco: 'Av. Ivo do Prado, 1120', cidade: 'Aracaju', uf: 'SE',
  latitude: -10.929, longitude: -37.0715,
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
        provideRouter([]), provideHttpClient(), provideHttpClientTesting(), UnidadeDetalheStore,
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: new Map([['id', id]]) } } },
      ],
    }).compileComponents();
    httpTesting = TestBed.inject(HttpTestingController);
  }

  afterEach(() => { httpTesting.verify({ ignoreCancelled: true }); });

  function criar() { const fixture = TestBed.createComponent(UnidadeDetalheComponent); fixture.detectChanges(); return fixture; }
  function texto(fixture: ComponentFixture<UnidadeDetalheComponent>) { return (fixture.nativeElement as HTMLElement).textContent ?? ''; }

  function responder(fixture: ComponentFixture<UnidadeDetalheComponent>) {
    httpTesting.expectOne((request) => request.url.endsWith('/dashboard/unidades/7')).flush(detalhe);
    httpTesting.expectOne((request) => request.url.endsWith('/api/v1/unidades/7')).flush(cadastro);
    httpTesting.expectOne((request) => request.url.includes('/dashboard/unidades/7/equipamentos')).flush(pagina([equipamento]));
    httpTesting.expectOne((request) => request.url.includes('/relatorios/disponibilidade/unidades')).flush(pagina([{ unidadeId: 7, disponibilidadePercentual: 99.42 }]));
    httpTesting.expectOne((request) => request.url.includes('/relatorios/latencia/unidades')).flush(pagina([{ unidadeId: 7, avgLatenciaMs: 23 }]));
    httpTesting.expectOne((request) => request.url.includes('/relatorios/disponibilidade/equipamentos')).flush(pagina([{ equipamentoId: 31, disponibilidadePercentual: 99.93 }]));
    fixture.detectChanges();
  }

  it('monta o cabeçalho com metadados de localização e os 7 KPIs', async () => {
    await configurar('7');
    const fixture = criar();
    responder(fixture);

    expect(texto(fixture)).toContain('Centro Operacional');
    expect(texto(fixture)).toContain('Degradada');
    expect(texto(fixture)).toContain('CIS-01 · Aracaju/SE · Av. Ivo do Prado, 1120 · -10.929, -37.0715');
    expect(texto(fixture)).toContain('99,42%');
    expect(texto(fixture)).toContain('23');
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('.kpi').length).toBe(7);
  });

  it('omite os segmentos ausentes dos metadados em vez de exibir vazio', async () => {
    await configurar('7');
    const fixture = criar();
    httpTesting.expectOne((request) => request.url.endsWith('/dashboard/unidades/7')).flush(detalhe);
    httpTesting.expectOne((request) => request.url.endsWith('/api/v1/unidades/7'))
      .flush({ ...cadastro, endereco: null, cidade: null, uf: null, latitude: null, longitude: null });
    httpTesting.expectOne((request) => request.url.includes('/dashboard/unidades/7/equipamentos')).flush(pagina([equipamento]));
    for (const trecho of ['/relatorios/disponibilidade/unidades', '/relatorios/latencia/unidades', '/relatorios/disponibilidade/equipamentos']) {
      httpTesting.expectOne((request) => request.url.includes(trecho)).flush(pagina([]));
    }
    fixture.detectChanges();

    const meta = (fixture.nativeElement as HTMLElement).querySelector('.unidade-detalhe__meta');
    expect(meta?.textContent?.trim()).toBe('CIS-01');
  });

  it('deixa "Agendar manutenção" desabilitado com a dica de indisponibilidade', async () => {
    await configurar('7');
    const fixture = criar();
    responder(fixture);

    const botao = [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')]
      .find((elemento) => elemento.textContent?.includes('Agendar manutenção')) as HTMLButtonElement;
    expect(botao.disabled).toBe(true);
    expect(botao.title).toBe('Em breve');
  });

  it('expõe as cinco abas como tablist navegável', async () => {
    await configurar('7');
    const fixture = criar();
    responder(fixture);

    const abas = (fixture.nativeElement as HTMLElement).querySelectorAll('[role="tab"]');
    expect(abas.length).toBe(5);
    expect([...abas].map((aba) => aba.textContent?.trim()))
      .toEqual(['Visão geral', 'Equipamentos', 'Incidentes', 'Histórico', 'Configurações']);
  });

  it('publica o nome da unidade na migalha e no título do documento', async () => {
    await configurar('7');
    const fixture = criar();
    responder(fixture);

    expect(TestBed.inject(BreadcrumbLabelService).rotulo()).toBe('Centro Operacional');
    expect(TestBed.inject(Title).getTitle()).toBe('Centro Operacional · Infra Monitor');
  });

  it('devolve migalha e título ao padrão quando a tela é destruída', async () => {
    await configurar('7');
    const fixture = criar();
    responder(fixture);
    fixture.destroy();

    expect(TestBed.inject(BreadcrumbLabelService).rotulo()).toBeNull();
    expect(TestBed.inject(Title).getTitle()).toBe('Infra Monitor');
  });

  it('mostra unidade não encontrada quando a API responde 404', async () => {
    await configurar('99999');
    const fixture = criar();
    httpTesting.expectOne((request) => request.url.endsWith('/dashboard/unidades/99999')).flush(
      { timestamp: '', status: 404, error: 'Not Found', code: 'RESOURCE_NOT_FOUND', message: 'Unidade nao encontrada', path: '' },
      { status: 404, statusText: 'Not Found' });
    httpTesting.expectOne((request) => request.url.endsWith('/api/v1/unidades/99999')).flush(cadastro);
    httpTesting.expectOne((request) => request.url.includes('/dashboard/unidades/99999/equipamentos')).flush(pagina([]));
    for (const trecho of ['/relatorios/disponibilidade/unidades', '/relatorios/latencia/unidades', '/relatorios/disponibilidade/equipamentos']) {
      httpTesting.expectOne((request) => request.url.includes(trecho)).flush(pagina([]));
    }
    fixture.detectChanges();

    expect(texto(fixture)).toContain('Unidade não encontrada.');
  });

  it('não emite requisição alguma quando o id da rota é inválido', async () => {
    await configurar('abc');
    const fixture = criar();

    expect(texto(fixture)).toContain('Unidade não encontrada.');
    httpTesting.expectNone(() => true);
  });

  it('mantém cabeçalho e KPIs legíveis quando os relatórios falham', async () => {
    await configurar('7');
    const fixture = criar();
    httpTesting.expectOne((request) => request.url.endsWith('/dashboard/unidades/7')).flush(detalhe);
    httpTesting.expectOne((request) => request.url.endsWith('/api/v1/unidades/7')).flush(cadastro);
    httpTesting.expectOne((request) => request.url.includes('/dashboard/unidades/7/equipamentos')).flush(pagina([equipamento]));
    for (const trecho of ['/relatorios/disponibilidade/unidades', '/relatorios/latencia/unidades', '/relatorios/disponibilidade/equipamentos']) {
      httpTesting.expectOne((request) => request.url.includes(trecho)).error(new ProgressEvent('erro'), { status: 500, statusText: 'Internal Server Error' });
    }
    fixture.detectChanges();

    expect(texto(fixture)).toContain('Centro Operacional');
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('.kpi').length).toBe(7);
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('.kpi__vazio').length).toBe(2);
  });
});
