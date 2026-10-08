import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { RelatoriosComponent } from './relatorios.component';

const page = (content: unknown[] = []) => ({ content, page: 0, size: 20, totalElements: content.length, totalPages: content.length ? 1 : 0, first: true, last: true });
const equipment = (overrides: Record<string, unknown> = {}) => ({ equipamentoId: 1, equipamentoNome: 'Router A', unidadeId: 1, unidadeNome: 'Unidade A', monitorId: 1, monitorNome: 'ICMP A', tipoMonitor: 'ICMP', inicio: '2026-08-25T00:00:00Z', fim: '2026-08-25T01:00:00Z', estadoAnalitico: 'CALCULADO', qualidadeJanela: 'PRECISA', tempoMonitoradoSegundos: 3661, tempoIndisponivelSegundos: 60, tempoDisponivelSegundos: 3601, disponibilidadePercentual: 91, incidentes: 2, ...overrides });
const unit = (overrides: Record<string, unknown> = {}) => ({ unidadeId: 1, unidadeNome: 'Unidade A', inicio: '2026-08-25T00:00:00Z', fim: '2026-08-25T01:00:00Z', estadoAnalitico: 'CALCULADO', equipamentosTotal: 4, equipamentosMonitorados: 2, equipamentosSemMonitoramento: 1, equipamentosSemDados: 1, tempoMonitoradoSegundos: 3600, tempoIndisponivelSegundos: 60, tempoDisponivelSegundos: 3540, disponibilidadePercentual: 98.33, incidentes: 1, ...overrides });
const incident = (overrides: Record<string, unknown> = {}) => ({ incidenteId: 8, unidadeId: 1, unidadeNome: 'Unidade A', equipamentoId: 2, equipamentoNome: 'Router A', monitorId: 3, monitorNome: 'ICMP A', tipoMonitor: 'ICMP', status: 'ABERTO', iniciadoEm: '2026-08-25T10:00:00Z', encerradoEm: null, duracaoSegundosNoPeriodo: 3661, motivo: 'Falha', observacao: null, ...overrides });
const measurement = (overrides: Record<string, unknown> = {}) => ({ medicaoId: 9, unidadeId: 1, unidadeNome: 'Unidade A', equipamentoId: 2, equipamentoNome: 'Router A', monitorId: 3, monitorNome: 'ICMP A', tipoMonitor: 'ICMP', status: 'FALHA', latenciaMs: null, executadoEm: '2026-08-25T10:00:00Z', ...overrides });
const latency = (overrides: Record<string, unknown> = {}) => ({ unidadeId: 1, unidadeNome: 'Unidade A', equipamentoId: 2, equipamentoNome: 'Router A', monitorId: 3, monitorNome: 'ICMP A', inicio: '2026-08-25T00:00:00Z', fim: '2026-08-25T01:00:00Z', minLatenciaMs: 11, avgLatenciaMs: 55, maxLatenciaMs: 96, count: 7, p95LatenciaMs: 91, ...overrides });
const notification = (overrides: Record<string, unknown> = {}) => ({ notificacaoId: 10, incidenteId: 8, canal: 'TELEGRAM', tipoEvento: 'INCIDENTE_ABERTO', status: 'PENDENTE', tentativas: 0, enviadoEm: null, erro: null, createdAt: '2026-08-25T10:00:00Z', ...overrides });

describe('RelatoriosComponent', () => {
  let http: HttpTestingController;
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [RelatoriosComponent], providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());
  it('keeps the report tabs in their own horizontal scroll container on narrow viewports', () => {
    const styles = ((RelatoriosComponent as unknown as { ɵcmp: { styles: string[] } }).ɵcmp.styles ?? []).join('');
    expect(styles).toMatch(/\.tabs[^{]*\{[^}]*overflow-x:\s*auto/);
    expect(styles).toMatch(/\.tabs[^{]*button[^{]*\{[^}]*flex:\s*0\s+0\s+auto/);
    expect(styles).toMatch(/@media\s*\(max-width:\s*1200px\)[\s\S]*?\.filters[^{]*\{[^}]*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
  });
  function create(report = page([equipment()])) {
    const fixture = TestBed.createComponent(RelatoriosComponent); fixture.detectChanges();
    http.expectOne(r => r.url.endsWith('/unidades') && r.params.get('ativo') === 'true').flush([{ id: 1, nome: 'Unidade A' }]);
    http.expectOne(r => r.url.endsWith('/tipos-equipamento') && r.params.get('ativo') === 'true').flush([{ id: 7, nome: 'Roteador' }]);
    return { fixture, request: http.expectOne(r => r.url.includes('/relatorios/disponibilidade/equipamentos')), report };
  }
  function clickTab(fixture: ComponentFixture<RelatoriosComponent>, label: string) {
    (Array.from(fixture.nativeElement.querySelectorAll('[role=tab]')) as HTMLElement[]).find(x => x.textContent?.trim() === label)!.click(); fixture.detectChanges();
  }
  function overviewRequests(fixture: ComponentFixture<RelatoriosComponent>) {
    clickTab(fixture, 'Visão Geral');
    return {
      // Os três KPIs vêm de uma consulta dedicada, a mesma que gera o PDF. Nunca da lista
      // paginada com status fixo: `status=ABERTO` sozinho não enxerga incidente RECONHECIDO.
      indicators: http.expectOne(r => r.url.endsWith('/relatorios/visao-geral/indicadores')),
      units: http.expectOne(r => r.url.endsWith('/relatorios/disponibilidade/unidades')),
      equipment: http.expectOne(r => r.url.endsWith('/relatorios/disponibilidade/equipamentos')),
      latency: http.expectOne(r => r.url.endsWith('/relatorios/latencia')),
    };
  }
  function flushOverview(requests: ReturnType<typeof overviewRequests>) {
    requests.indicators.flush({ incidentesAbertos: 7, medicoesComFalha: 11, notificacoesComFalha: 2 });
    requests.units.flush(page([unit(), unit({ unidadeId: 2, unidadeNome: 'Sem dados', disponibilidadePercentual: null, tempoMonitoradoSegundos: null, tempoIndisponivelSegundos: null })]));
    requests.equipment.flush(page([equipment(), equipment({ equipamentoId: 2, monitorId: 2, equipamentoNome: 'Sem monitor', estadoAnalitico: 'SEM_MONITORAMENTO', qualidadeJanela: null, disponibilidadePercentual: null, tempoIndisponivelSegundos: null })]));
    requests.latency.flush(page([latency()]));
  }

  it('loads the Overview with four exact server-side queries and globally correct KPI counts', () => {
    const { fixture, request, report } = create(); request.flush(report); fixture.detectChanges();
    const requests = overviewRequests(fixture);
    for (const request of Object.values(requests)) { expect(request.request.params.has('inicio')).toBe(true); expect(request.request.params.has('fim')).toBe(true); }
    // Só período: os indicadores não são uma lista, então não carregam page/size/sort.
    expect(requests.indicators.request.params.keys().sort()).toEqual(['fim', 'inicio']);
    for (const request of [requests.units, requests.equipment, requests.latency]) expect(request.request.params.get('page')).toBe('0');
    expect(requests.units.request.params.get('size')).toBe('5'); expect(requests.units.request.params.get('sort')).toBe('disponibilidadePercentual,asc');
    expect(requests.equipment.request.params.get('size')).toBe('5'); expect(requests.equipment.request.params.get('sort')).toBe('disponibilidadePercentual,asc');
    expect(requests.latency.request.params.get('size')).toBe('5'); expect(requests.latency.request.params.get('sort')).toBe('avgLatenciaMs,desc');
    flushOverview(requests); fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Incidentes abertos'); expect(text).toContain('7'); expect(text).toContain('11'); expect(text).toContain('2');
    expect(text).toContain('91 ms'); expect(text).toContain('P95 fornecido pela API');
    expect(text).toContain('SEM_MONITORAMENTO'); expect(text).toContain('Sem dados'); expect(text).not.toMatch(/NaN|undefined|null%|0\.00%/);
  });

  /*
   * O bug: os KPIs saíam de `/relatorios/incidentes?status=ABERTO&size=1`, lendo totalElements.
   * `status` ali é valor único, então incidente RECONHECIDO — que continua em aberto — não
   * entrava na conta, e a tela mostrava 0 enquanto a sidebar e o PDF mostravam 1.
   * O teste antigo fixava esse filtro como se fosse contrato; agora o contrato é o oposto.
   */
  it('never counts KPIs through the paginated list and renders the server count that includes RECONHECIDO', () => {
    const { fixture, request, report } = create(); request.flush(report); fixture.detectChanges();
    const requests = overviewRequests(fixture);
    http.expectNone(r => r.url.endsWith('/relatorios/incidentes'));
    http.expectNone(r => r.params.get('size') === '1');
    requests.indicators.flush({ incidentesAbertos: 1, medicoesComFalha: 0, notificacoesComFalha: 0 });
    requests.units.flush(page()); requests.equipment.flush(page()); requests.latency.flush(page());
    fixture.detectChanges();
    const card = fixture.nativeElement.querySelectorAll('.kpi-card')[0] as HTMLElement;
    expect(card.textContent).toContain('Incidentes abertos'); expect(card.textContent).toContain('1');
    expect(card.textContent).toContain('Aberto ou reconhecido'); expect(card.textContent).not.toContain('Status ABERTO');
  });

  it('shares one loading, error and retry across the three KPI cards without touching the rankings', () => {
    const { fixture, request, report } = create(); request.flush(report); fixture.detectChanges();
    const requests = overviewRequests(fixture);
    requests.units.flush(page()); requests.equipment.flush(page()); requests.latency.flush(page([latency()]));
    fixture.detectChanges();
    const carregando = fixture.nativeElement.querySelectorAll('.kpi-card .skeleton');
    expect(carregando.length).toBe(3); expect(fixture.nativeElement.textContent).toContain('55,00 ms');

    requests.indicators.flush({ status: 500, code: 'INTERNAL_ERROR', message: 'segredo' }, { status: 500, statusText: 'Erro' });
    fixture.detectChanges();
    const cards = Array.from(fixture.nativeElement.querySelectorAll('.kpi-card')) as HTMLElement[];
    expect(cards.every(card => card.querySelector('.widget-error') !== null)).toBe(true);
    expect(fixture.nativeElement.textContent).not.toContain('segredo');
    // Uma ação só para os três, e ela não pode reaparecer em cada cartão.
    const repetir = cards.flatMap(card => Array.from(card.querySelectorAll('.botao')) as HTMLButtonElement[]);
    expect(repetir.length).toBe(1);
    expect(fixture.nativeElement.textContent).toContain('55,00 ms');

    repetir[0].click(); fixture.detectChanges();
    http.expectNone(r => r.url.endsWith('/relatorios/latencia'));
    http.expectOne(r => r.url.endsWith('/relatorios/visao-geral/indicadores'))
      .flush({ incidentesAbertos: 4, medicoesComFalha: 5, notificacoesComFalha: 6 });
    fixture.detectChanges();
    const valores = (Array.from(fixture.nativeElement.querySelectorAll('.kpi-card__value')) as HTMLElement[]).map(v => v.textContent?.trim());
    expect(valores).toEqual(['4', '5', '6']);
  });

  it('keeps Overview widgets independent on partial loading, empty and error and retries only the failed request', () => {
    const { fixture, request, report } = create(); request.flush(report); fixture.detectChanges();
    const requests = overviewRequests(fixture);
    requests.indicators.flush({ incidentesAbertos: 3, medicoesComFalha: 0, notificacoesComFalha: 0 }); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('3'); expect(fixture.nativeElement.textContent).toContain('Carregando ranking');
    requests.units.flush(page()); requests.equipment.flush(page());
    requests.latency.flush({ status: 500, code: 'INTERNAL_ERROR', message: 'segredo' }, { status: 500, statusText: 'Erro' }); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Sem resultados no período'); expect(fixture.nativeElement.textContent).toContain('Serviço temporariamente indisponível'); expect(fixture.nativeElement.textContent).not.toContain('segredo');
    const retry = (Array.from(fixture.nativeElement.querySelectorAll('.analytic-card .botao')) as HTMLButtonElement[]).find(button => button.textContent?.includes('Tentar novamente'))!;
    retry.click(); fixture.detectChanges();
    const retried = http.expectOne(r => r.url.endsWith('/relatorios/latencia')); expect(retried.request.params.get('sort')).toBe('avgLatenciaMs,desc'); retried.flush(page([latency()])); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('55,00 ms');
  });

  it('refreshes and changes the Overview period with four requests and rejects periods over 31 days without calls', () => {
    const { fixture, request, report } = create(); request.flush(report); fixture.detectChanges();
    let requests = overviewRequests(fixture); flushOverview(requests); fixture.detectChanges();
    fixture.nativeElement.querySelector('.reports__header button').click(); fixture.detectChanges();
    const refreshed = http.match(r => r.url.includes('/relatorios/')); expect(refreshed.length).toBe(4); refreshed.forEach(request => request.flush(page())); fixture.detectChanges();
    fixture.componentInstance['overviewForm'].patchValue({ inicio: '2026-01-01T00:00', fim: '2026-02-02T00:01' });
    fixture.nativeElement.querySelector('.filters--overview').dispatchEvent(new Event('submit')); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('31 dias'); http.expectNone(r => r.url.includes('/relatorios/'));
    fixture.componentInstance['overviewForm'].patchValue({ inicio: '2026-08-01T00:00', fim: '2026-08-25T00:00' });
    fixture.nativeElement.querySelector('.filters--overview').dispatchEvent(new Event('submit')); fixture.detectChanges();
    const changed = http.match(r => r.url.includes('/relatorios/')); expect(changed.length).toBe(4);
    expect(new Set(changed.map(request => request.request.urlWithParams)).size).toBe(4); changed.forEach(request => request.flush(page()));
  });
  it('shows loading until the first equipment response and renders a calculated row', () => {
    const { fixture, request, report } = create();
    expect(fixture.nativeElement.textContent).toContain('Carregando relatório');
    request.flush(report); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Calculado'); expect(fixture.nativeElement.textContent).toContain('Precisa'); expect(fixture.nativeElement.textContent).toContain('91,00%'); expect(fixture.nativeElement.textContent).toContain('1h 1m');
  });
  it('renders empty and safe null analytical states without NaN, undefined or false zeroes', () => {
    let x = create(page()); x.request.flush(x.report); x.fixture.detectChanges(); expect(x.fixture.nativeElement.textContent).toContain('Nenhum resultado encontrado');
    x.fixture.destroy();
    x = create(page([equipment({ estadoAnalitico: 'SEM_DADOS', monitorNome: null, monitorId: null, qualidadeJanela: null, disponibilidadePercentual: null, tempoMonitoradoSegundos: null, tempoIndisponivelSegundos: null, tempoDisponivelSegundos: null }), equipment({ estadoAnalitico: 'SEM_MONITORAMENTO', monitorNome: null, monitorId: null, qualidadeJanela: 'INFERIDA', disponibilidadePercentual: null, tempoMonitoradoSegundos: null, tempoIndisponivelSegundos: null, tempoDisponivelSegundos: null })])); x.request.flush(x.report); x.fixture.detectChanges();
    const text = x.fixture.nativeElement.textContent; expect(text).toContain('Sem dados'); expect(text).toContain('Sem monitoramento'); expect(text).toContain('Inferida'); expect(text).not.toMatch(/NaN|undefined|null%|0\.00%/);
  });
  it('sends filters, resets page, clears dependent selects and reloads their lookups', () => {
    const { fixture, request, report } = create(); request.flush(report); fixture.detectChanges();
    const selects = fixture.nativeElement.querySelectorAll('form select');
    selects[0].value = '1'; selects[0].dispatchEvent(new Event('change')); fixture.detectChanges();
    http.match(r => r.url.endsWith('/equipamentos') && r.params.get('unidadeId') === '1').forEach(request => request.flush(page([{ id: 2, nome: 'Equipamento B' }])));
    http.match(r => r.url.includes('/relatorios/disponibilidade/equipamentos') && r.params.get('unidadeId') === '1').forEach(request => request.flush(report));
    selects[3].value = '7'; selects[3].dispatchEvent(new Event('change')); fixture.detectChanges();
    const typed = http.match(r => r.url.includes('/relatorios/disponibilidade/equipamentos') && r.params.get('tipoEquipamentoId') === '7'); expect(typed[0].request.params.get('page')).toBe('0'); typed.forEach(request => request.flush(report));
  });
  it('shows mapped 400, 404 and 500 errors with retry action', () => {
    for (const [status, code, message] of [[400, 'INVALID_REQUEST', 'A consulta não é válida'], [404, 'RESOURCE_NOT_FOUND', 'Um recurso selecionado não foi encontrado'], [500, 'INTERNAL_ERROR', 'O serviço de relatórios apresentou uma falha']] as const) {
      const { fixture, request } = create(); request.flush({ status, code, message: 'x' }, { status, statusText: 'Erro' }); fixture.detectChanges(); expect(fixture.nativeElement.textContent).toContain(message); expect(fixture.nativeElement.textContent).toContain('Tentar novamente'); fixture.destroy();
    }
  });
  it('loads unit states, counts, null percentage and server-side sort/page/size', () => {
    const { fixture, request, report } = create(); request.flush(report); fixture.detectChanges();
    clickTab(fixture, 'Disponibilidade Unidades');
    let units = http.expectOne(r => r.url.includes('/relatorios/disponibilidade/unidades')); units.flush(page([unit({ disponibilidadePercentual: null })])); fixture.detectChanges(); expect(fixture.nativeElement.textContent).toContain('4'); expect(fixture.nativeElement.textContent).toContain('—');
    const sort = fixture.nativeElement.querySelector('.table-tools select'); sort.value = 'disponibilidadePercentual'; sort.dispatchEvent(new Event('change')); fixture.detectChanges(); units = http.expectOne(r => r.url.includes('/relatorios/disponibilidade/unidades')); expect(units.request.params.get('sort')).toBe('disponibilidadePercentual,asc'); units.flush(page([unit()]));
  });
  it('keeps equipment and unit pagination, size and direction independent', () => {
    const { fixture, request, report } = create(); request.flush({ ...report, totalElements: 25, totalPages: 2, last: false }); fixture.detectChanges();
    const size = fixture.nativeElement.querySelector('.pagination select'); size.value = '10'; size.dispatchEvent(new Event('change')); fixture.detectChanges();
    let equipment = http.expectOne(r => r.url.includes('/relatorios/disponibilidade/equipamentos')); expect(equipment.request.params.get('size')).toBe('10'); expect(equipment.request.params.get('page')).toBe('0'); equipment.flush({ ...report, size: 10, totalElements: 25, totalPages: 3, last: false }); fixture.detectChanges();
    fixture.nativeElement.querySelector('.table-tools button').click(); fixture.detectChanges(); equipment = http.expectOne(r => r.url.includes('/relatorios/disponibilidade/equipamentos')); expect(equipment.request.params.get('sort')).toBe('equipamentoNome,desc'); equipment.flush({ ...report, size: 10 }); fixture.detectChanges();
    clickTab(fixture, 'Disponibilidade Unidades');
    const units = http.expectOne(r => r.url.includes('/relatorios/disponibilidade/unidades')); expect(units.request.params.get('page')).toBe('0'); expect(units.request.params.get('size')).toBe('20'); expect(units.request.params.get('sort')).toBe('unidadeNome,asc'); units.flush(page([unit()]));
  });
  it('loads incident history once per native interaction with server filters, sort, pagination, refresh and null-safe open incident', () => {
    const { fixture, request, report } = create(); request.flush(report); fixture.detectChanges();
    (Array.from(fixture.nativeElement.querySelectorAll('[role=tab]')) as HTMLElement[]).find(x => x.textContent?.trim() === 'Incidentes')!.click(); fixture.detectChanges();
    let query = http.expectOne(r => r.url.endsWith('/relatorios/incidentes')); expect(query.request.params.get('page')).toBe('0'); expect(query.request.params.get('size')).toBe('20'); expect(query.request.params.get('sort')).toBe('iniciadoEm,desc'); query.flush(page([incident()])); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Aberto'); expect(fixture.nativeElement.textContent).toContain('1h 1m'); expect(fixture.nativeElement.textContent).toContain('—');
    const sort = fixture.nativeElement.querySelector('.table-tools select'); sort.value = 'status'; sort.dispatchEvent(new Event('change')); fixture.detectChanges(); query = http.expectOne(r => r.url.endsWith('/relatorios/incidentes')); expect(query.request.params.get('sort')).toBe('status,desc'); query.flush(page([incident()]));
    fixture.nativeElement.querySelector('.table-tools button').click(); fixture.detectChanges(); query = http.expectOne(r => r.url.endsWith('/relatorios/incidentes')); expect(query.request.params.get('sort')).toBe('status,asc'); query.flush(page([incident()]));
    fixture.nativeElement.querySelector('.reports__header button').click(); fixture.detectChanges(); query = http.expectOne(r => r.url.endsWith('/relatorios/incidentes')); query.flush(page()); fixture.detectChanges(); expect(fixture.nativeElement.textContent).toContain('Nenhum resultado encontrado');
  });
  it('loads measurement history with default size 50, enum labels, null latency, errors and 31-day validation', () => {
    const { fixture, request, report } = create(); request.flush(report); fixture.detectChanges();
    (Array.from(fixture.nativeElement.querySelectorAll('[role=tab]')) as HTMLElement[]).find(x => x.textContent?.trim() === 'Medições')!.click(); fixture.detectChanges();
    let query = http.expectOne(r => r.url.endsWith('/relatorios/medicoes')); expect(query.request.params.get('size')).toBe('50'); expect(query.request.params.get('sort')).toBe('executadoEm,desc'); query.flush(page([measurement()])); fixture.detectChanges(); expect(fixture.nativeElement.textContent).toContain('Falha'); expect(fixture.nativeElement.textContent).toContain('—');
    const form = fixture.nativeElement.querySelector('form'); fixture.componentInstance['measurementForm'].patchValue({ inicio: '2026-01-01T00:00', fim: '2026-02-02T00:00' }); form.dispatchEvent(new Event('submit')); fixture.detectChanges(); expect(fixture.nativeElement.textContent).toContain('31 dias');
    fixture.componentInstance['measurementForm'].patchValue({ inicio: '2026-08-24T00:00', fim: '2026-08-25T00:00' }); (fixture.componentInstance as any).refresh(); query = http.expectOne(r => r.url.endsWith('/relatorios/medicoes')); query.flush({ status: 500, code: 'INTERNAL_ERROR', message: 'x' }, { status: 500, statusText: 'Erro' }); fixture.detectChanges(); expect(fixture.nativeElement.textContent).toContain('O serviço de relatórios apresentou uma falha');
  });

  it('loads latency with backend min, decimal average, max, p95 and count and applies null safety', () => {
    const { fixture, request, report } = create(); request.flush(report); fixture.detectChanges(); clickTab(fixture, 'Latência');
    const query = http.expectOne(r => r.url.endsWith('/relatorios/latencia'));
    expect(fixture.nativeElement.textContent).toContain('Carregando relatório');
    expect(query.request.params.get('page')).toBe('0'); expect(query.request.params.get('size')).toBe('20'); expect(query.request.params.get('sort')).toBe('monitorNome,asc');
    query.flush(page([latency(), latency({ monitorId: 4, monitorNome: 'ICMP sem dados', minLatenciaMs: null, avgLatenciaMs: null, maxLatenciaMs: null, p95LatenciaMs: null, count: 0 })])); fixture.detectChanges();
    const text = fixture.nativeElement.textContent; expect(text).toContain('11 ms'); expect(text).toContain('55,00 ms'); expect(text).toContain('96 ms'); expect(text).toContain('91 ms'); expect(text).toContain('7'); expect(text).toContain('ICMP sem dados————0'); expect(text).not.toMatch(/NaN|undefined|null/);
  });

  it('covers latency empty plus mapped 400, 404 and 500 states with refresh', () => {
    const { fixture, request, report } = create(); request.flush(report); fixture.detectChanges(); clickTab(fixture, 'Latência');
    let query = http.expectOne(r => r.url.endsWith('/relatorios/latencia')); query.flush(page()); fixture.detectChanges(); expect(fixture.nativeElement.textContent).toContain('Nenhum resultado encontrado');
    for (const [status, expected] of [[400, 'A consulta não é válida'], [404, 'Um recurso selecionado não foi encontrado'], [500, 'O serviço de relatórios apresentou uma falha']] as const) {
      fixture.nativeElement.querySelector('.reports__header button').click(); fixture.detectChanges(); query = http.expectOne(r => r.url.endsWith('/relatorios/latencia')); query.flush({ status, code: status === 404 ? 'RESOURCE_NOT_FOUND' : status === 400 ? 'INVALID_REQUEST' : 'INTERNAL_ERROR', message: 'segura' }, { status, statusText: 'Erro' }); fixture.detectChanges(); expect(fixture.nativeElement.textContent).toContain(expected); expect(fixture.nativeElement.textContent).toContain('Tentar novamente');
    }
  });

  it('blocks invalid latency periods without requests and accepts equal and valid periods up to 90 days', () => {
    const { fixture, request, report } = create(); request.flush(report); fixture.detectChanges(); clickTab(fixture, 'Latência'); let query = http.expectOne(r => r.url.endsWith('/relatorios/latencia')); query.flush(page([latency()]));
    const form = fixture.componentInstance['latencyForm'];
    for (const [inicio, fim, message] of [['', '2026-08-25T00:00', 'inicial'], ['2026-08-25T00:00', '', 'final'], ['2026-08-26T00:00', '2026-08-25T00:00', 'anterior ou igual'], ['2026-01-01T00:00', '2026-04-02T00:01', '90 dias']] as const) {
      form.patchValue({ inicio, fim }); (fixture.componentInstance as any).search(); fixture.detectChanges(); expect(fixture.nativeElement.textContent).toContain(message); http.expectNone(r => r.url.endsWith('/relatorios/latencia'));
    }
    form.patchValue({ inicio: '2026-08-25T00:00', fim: '2026-08-25T00:00' }); (fixture.componentInstance as any).search(); query = http.expectOne(r => r.url.endsWith('/relatorios/latencia')); query.flush(page());
    form.patchValue({ inicio: '2026-06-01T00:00', fim: '2026-08-25T00:00' }); (fixture.componentInstance as any).search(); query = http.expectOne(r => r.url.endsWith('/relatorios/latencia')); query.flush(page());
  });

  it('keeps latency hierarchy dependent and sends one report request per native filter interaction', () => {
    const { fixture, request, report } = create(); request.flush(report); fixture.detectChanges(); clickTab(fixture, 'Latência'); let query = http.expectOne(r => r.url.endsWith('/relatorios/latencia')); query.flush(page([latency()])); fixture.detectChanges();
    let selects = fixture.nativeElement.querySelectorAll('form select'); selects[0].value = '1'; selects[0].dispatchEvent(new Event('change')); fixture.detectChanges();
    http.expectOne(r => r.url.endsWith('/equipamentos') && r.params.get('unidadeId') === '1').flush(page([{ id: 2, nome: 'Router A' }])); query = http.expectOne(r => r.url.endsWith('/relatorios/latencia') && r.params.get('unidadeId') === '1'); expect(query.request.params.has('equipamentoId')).toBe(false); expect(query.request.params.has('monitorId')).toBe(false); query.flush(page([latency()])); fixture.detectChanges();
    selects = fixture.nativeElement.querySelectorAll('form select'); selects[1].value = '2'; selects[1].dispatchEvent(new Event('change')); fixture.detectChanges();
    http.expectOne(r => r.url.endsWith('/monitores') && r.params.get('equipamentoId') === '2').flush(page([{ id: 3, nome: 'ICMP A' }])); query = http.expectOne(r => r.url.endsWith('/relatorios/latencia') && r.params.get('equipamentoId') === '2'); expect(query.request.params.has('monitorId')).toBe(false); query.flush(page([latency()])); fixture.detectChanges();
    selects = fixture.nativeElement.querySelectorAll('form select'); selects[2].value = '3'; selects[2].dispatchEvent(new Event('change')); fixture.detectChanges(); const matches = http.match(r => r.url.endsWith('/relatorios/latencia') && r.params.get('monitorId') === '3'); expect(matches.length).toBe(1); matches[0].flush(page([latency()]));
  });

  it('uses server-side latency sort asc/desc, pagination, size reset and refresh preserving query', () => {
    const { fixture, request, report } = create(); request.flush(report); fixture.detectChanges(); clickTab(fixture, 'Latência'); let query = http.expectOne(r => r.url.endsWith('/relatorios/latencia')); query.flush({ ...page([latency()]), totalElements: 25, totalPages: 2, last: false }); fixture.detectChanges();
    const sort = fixture.nativeElement.querySelector('.table-tools select'); sort.value = 'avgLatenciaMs'; sort.dispatchEvent(new Event('change')); fixture.detectChanges(); query = http.expectOne(r => r.url.endsWith('/relatorios/latencia')); expect(query.request.params.get('sort')).toBe('avgLatenciaMs,asc'); query.flush(page([latency()]));
    fixture.nativeElement.querySelector('.table-tools button').click(); fixture.detectChanges(); query = http.expectOne(r => r.url.endsWith('/relatorios/latencia')); expect(query.request.params.get('sort')).toBe('avgLatenciaMs,desc'); query.flush({ ...page([latency()]), totalElements: 25, totalPages: 2, last: false }); fixture.detectChanges();
    (Array.from(fixture.nativeElement.querySelectorAll('.pagination button')) as HTMLButtonElement[]).find(x => x.textContent?.trim().startsWith('Próxima'))!.click(); fixture.detectChanges(); query = http.expectOne(r => r.url.endsWith('/relatorios/latencia')); expect(query.request.params.get('page')).toBe('1'); query.flush({ ...page([latency()]), page: 1, totalElements: 25, totalPages: 2, first: false, last: true }); fixture.detectChanges();
    const size = fixture.nativeElement.querySelector('.pagination select'); size.value = '50'; size.dispatchEvent(new Event('change')); fixture.detectChanges(); query = http.expectOne(r => r.url.endsWith('/relatorios/latencia')); expect(query.request.params.get('page')).toBe('0'); expect(query.request.params.get('size')).toBe('50'); query.flush(page([latency()]));
    fixture.nativeElement.querySelector('.reports__header button').click(); fixture.detectChanges(); query = http.expectOne(r => r.url.endsWith('/relatorios/latencia')); expect(query.request.params.get('sort')).toBe('avgLatenciaMs,desc'); expect(query.request.params.get('size')).toBe('50'); query.flush(page([latency()]));
  });

  it('loads notifications with real enums, exact attempts, dates and null sent date without local reorder', () => {
    const { fixture, request, report } = create(); request.flush(report); fixture.detectChanges(); clickTab(fixture, 'Notificações'); const query = http.expectOne(r => r.url.endsWith('/relatorios/notificacoes'));
    expect(fixture.nativeElement.textContent).toContain('Carregando relatório'); expect(query.request.params.get('sort')).toBe('createdAt,desc');
    query.flush(page([notification(), notification({ notificacaoId: 11, tipoEvento: 'INCIDENTE_FECHADO', status: 'ENVIADA', tentativas: 1, enviadoEm: '2026-08-25T10:01:00Z' }), notification({ notificacaoId: 12, status: 'FALHA', tentativas: 3 })])); fixture.detectChanges();
    const rows = fixture.nativeElement.querySelectorAll('tbody tr'); expect(rows[0].textContent).toContain('Aguardando'); expect(rows[0].textContent).toContain('0'); expect(rows[0].textContent).toContain('—'); expect(rows[1].textContent).toContain('Enviada'); expect(rows[2].textContent).toContain('Falha'); expect(rows[2].textContent).toContain('3'); expect(fixture.nativeElement.textContent).toContain('TELEGRAM'); expect(fixture.nativeElement.textContent).toContain('INCIDENTE_ABERTO');
  });

  it('covers notifications empty, 400, 404 and 500 states', () => {
    const { fixture, request, report } = create(); request.flush(report); fixture.detectChanges(); clickTab(fixture, 'Notificações'); let query = http.expectOne(r => r.url.endsWith('/relatorios/notificacoes')); query.flush(page()); fixture.detectChanges(); expect(fixture.nativeElement.textContent).toContain('Nenhum resultado encontrado');
    for (const [status, expected] of [[400, 'A consulta não é válida'], [404, 'Um recurso selecionado não foi encontrado'], [500, 'O serviço de relatórios apresentou uma falha']] as const) { fixture.nativeElement.querySelector('.reports__header button').click(); fixture.detectChanges(); query = http.expectOne(r => r.url.endsWith('/relatorios/notificacoes')); query.flush({ status, code: status === 404 ? 'RESOURCE_NOT_FOUND' : status === 400 ? 'INVALID_ENUM' : 'INTERNAL_ERROR', message: 'segura' }, { status, statusText: 'Erro' }); fixture.detectChanges(); expect(fixture.nativeElement.textContent).toContain(expected); }
  });

  it('blocks notification periods over 365 days and sends real filters exactly once per interaction', () => {
    const { fixture, request, report } = create(); request.flush(report); fixture.detectChanges(); clickTab(fixture, 'Notificações'); let query = http.expectOne(r => r.url.endsWith('/relatorios/notificacoes')); query.flush(page([notification()])); fixture.detectChanges();
    const form = fixture.componentInstance['notificationForm']; form.patchValue({ inicio: '2025-01-01T00:00', fim: '2026-01-02T00:01' }); (fixture.componentInstance as any).search(); fixture.detectChanges(); expect(fixture.nativeElement.textContent).toContain('365 dias'); http.expectNone(r => r.url.endsWith('/relatorios/notificacoes'));
    for (const [inicio, fim, message] of [['', '2026-08-25T00:00', 'inicial'], ['2026-08-25T00:00', '', 'final'], ['2026-08-26T00:00', '2026-08-25T00:00', 'anterior ou igual']] as const) { form.patchValue({ inicio, fim }); (fixture.componentInstance as any).search(); fixture.detectChanges(); expect(fixture.nativeElement.textContent).toContain(message); http.expectNone(r => r.url.endsWith('/relatorios/notificacoes')); }
    form.patchValue({ inicio: '2026-08-25T00:00', fim: '2026-08-25T00:00' }); (fixture.componentInstance as any).search(); query = http.expectOne(r => r.url.endsWith('/relatorios/notificacoes')); query.flush(page([notification()]));
    form.patchValue({ inicio: '2026-08-24T00:00', fim: '2026-08-25T00:00' }); fixture.detectChanges();
    const incidentInput = fixture.nativeElement.querySelector('form input[type=number]'); incidentInput.value = '8'; incidentInput.dispatchEvent(new Event('input')); incidentInput.dispatchEvent(new Event('change')); fixture.detectChanges(); let matches = http.match(r => r.url.endsWith('/relatorios/notificacoes')); expect(matches.length).toBe(1); expect(matches[0].request.params.get('incidenteId')).toBe('8'); matches[0].flush(page([notification()]));
    const selects = fixture.nativeElement.querySelectorAll('form select');
    for (const [index, key, value] of [[0, 'status', 'ENVIADA'], [1, 'canal', 'TELEGRAM'], [2, 'tipoEvento', 'INCIDENTE_FECHADO']] as const) { selects[index].value = value; selects[index].dispatchEvent(new Event('change')); fixture.detectChanges(); matches = http.match(r => r.url.endsWith('/relatorios/notificacoes')); expect(matches.length).toBe(1); expect(matches[0].request.params.get(key)).toBe(value); matches[0].flush(page([notification()])); }
  });

  it('uses server-side notification sort both directions, page, size and refresh without reordering rows', () => {
    const { fixture, request, report } = create(); request.flush(report); fixture.detectChanges(); clickTab(fixture, 'Notificações'); let query = http.expectOne(r => r.url.endsWith('/relatorios/notificacoes')); query.flush({ ...page([notification()]), totalElements: 21, totalPages: 2, last: false }); fixture.detectChanges();
    const sort = fixture.nativeElement.querySelector('.table-tools select'); sort.value = 'enviadoEm'; sort.dispatchEvent(new Event('change')); fixture.detectChanges(); query = http.expectOne(r => r.url.endsWith('/relatorios/notificacoes')); expect(query.request.params.get('sort')).toBe('enviadoEm,desc'); query.flush(page([notification(), notification({ notificacaoId: 11, enviadoEm: '2026-08-25T10:01:00Z' })])); fixture.detectChanges(); expect(fixture.nativeElement.querySelector('tbody tr').textContent).toContain('—');
    fixture.nativeElement.querySelector('.table-tools button').click(); fixture.detectChanges(); query = http.expectOne(r => r.url.endsWith('/relatorios/notificacoes')); expect(query.request.params.get('sort')).toBe('enviadoEm,asc'); query.flush({ ...page([notification()]), totalElements: 21, totalPages: 2, last: false }); fixture.detectChanges();
    (Array.from(fixture.nativeElement.querySelectorAll('.pagination button')) as HTMLButtonElement[]).find(x => x.textContent?.trim().startsWith('Próxima'))!.click(); fixture.detectChanges(); query = http.expectOne(r => r.url.endsWith('/relatorios/notificacoes')); expect(query.request.params.get('page')).toBe('1'); query.flush({ ...page([notification()]), page: 1, totalElements: 21, totalPages: 2, first: false }); fixture.detectChanges();
    const size = fixture.nativeElement.querySelector('.pagination select'); size.value = '10'; size.dispatchEvent(new Event('change')); fixture.detectChanges(); query = http.expectOne(r => r.url.endsWith('/relatorios/notificacoes')); expect(query.request.params.get('page')).toBe('0'); expect(query.request.params.get('size')).toBe('10'); query.flush(page([notification()]));
    fixture.nativeElement.querySelector('.reports__header button').click(); fixture.detectChanges(); query = http.expectOne(r => r.url.endsWith('/relatorios/notificacoes')); expect(query.request.params.get('sort')).toBe('enviadoEm,asc'); expect(query.request.params.get('size')).toBe('10'); query.flush(page([notification()]));
  });

  it('exports all six areas once per double click with current filters/sort, Blob headers and no page or size', () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const { fixture, request, report } = create(); request.flush(report); fixture.detectChanges();
    const component = fixture.componentInstance;
    component['form'].patchValue({ unidadeId: '1', equipamentoId: '2', monitorId: '3', tipoEquipamentoId: '7' });
    component['incidentForm'].patchValue({ unidadeId: '1', equipamentoId: '2', monitorId: '3', status: 'ABERTO' });
    component['measurementForm'].patchValue({ unidadeId: '1', equipamentoId: '2', monitorId: '3', status: 'FALHA' });
    component['latencyForm'].patchValue({ unidadeId: '1', equipamentoId: '2', monitorId: '3' });
    component['notificationForm'].patchValue({ incidenteId: '8', status: 'ENVIADA', canal: 'TELEGRAM', tipoEvento: 'INCIDENTE_ABERTO' });

    const cases = [
      ['Disponibilidade Equipamentos', '/disponibilidade/equipamentos/export', 'equipamentoNome,asc', { unidadeId: '1', equipamentoId: '2', monitorId: '3', tipoEquipamentoId: '7' }],
      ['Disponibilidade Unidades', '/disponibilidade/unidades/export', 'unidadeNome,asc', { unidadeId: '1' }],
      ['Incidentes', '/incidentes/export', 'iniciadoEm,desc', { unidadeId: '1', equipamentoId: '2', monitorId: '3', status: 'ABERTO' }],
      ['Medições', '/medicoes/export', 'executadoEm,desc', { unidadeId: '1', equipamentoId: '2', monitorId: '3', status: 'FALHA' }],
      ['Latência', '/latencia/export', 'monitorNome,asc', { unidadeId: '1', equipamentoId: '2', monitorId: '3' }],
      ['Notificações', '/notificacoes/export', 'createdAt,desc', { incidenteId: '8', status: 'ENVIADA', canal: 'TELEGRAM', tipoEvento: 'INCIDENTE_ABERTO' }],
    ] as const;
    for (const [index, [label, endpoint, sort, filters]] of cases.entries()) {
      if (index > 0) { clickTab(fixture, label); http.expectOne(r => r.url.endsWith(endpoint.replace('/export', ''))).flush(page()); fixture.detectChanges(); }
      const button = (Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[]).find(value => value.textContent?.trim() === 'Exportar CSV')!;
      button.click(); button.click(); fixture.detectChanges();
      expect(button.disabled).toBe(true); expect(button.textContent).toContain('Exportando CSV');
      const matches = http.match(r => r.url.endsWith(endpoint)); expect(matches.length).toBe(1);
      const exportRequest = matches[0]; expect(exportRequest.request.method).toBe('GET'); expect(exportRequest.request.responseType).toBe('blob'); expect(exportRequest.request.params.get('sort')).toBe(sort); expect(exportRequest.request.params.has('page')).toBe(false); expect(exportRequest.request.params.has('size')).toBe(false);
      for (const [key, value] of Object.entries(filters)) expect(exportRequest.request.params.get(key)).toBe(value);
      exportRequest.flush(new Blob(['\ufeffheader\r\nlinha'], { type: 'text/csv;charset=UTF-8' }), { headers: { 'Content-Disposition': `attachment; filename="fallback.csv"; filename*=UTF-8''relat%C3%B3rio-${index}.csv` } }); fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain('Download CSV iniciado');
    }
    expect(createObjectURL).toHaveBeenCalledTimes(6); expect(revokeObjectURL).toHaveBeenCalledTimes(6); expect(anchorClick).toHaveBeenCalledTimes(6);
    anchorClick.mockRestore(); createObjectURL.mockRestore(); revokeObjectURL.mockRestore();
  });

  it('preserves active tab, filters, sort, page and table while export loading changes independently', () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test'); const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined); const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const { fixture, request } = create(); request.flush({ ...page([equipment()]), page: 2, first: false }); fixture.detectChanges();
    const component = fixture.componentInstance; component['page'].set(2); component['form'].patchValue({ unidadeId: '1', tipoEquipamentoId: '7' }); component['equipmentSort'].set('incidentes'); component['direction'].set('desc'); fixture.detectChanges();
    const beforeTable = fixture.nativeElement.querySelector('tbody').textContent; const button = fixture.nativeElement.querySelector('.table-tools__actions .botao:last-child'); button.click(); fixture.detectChanges();
    const exportRequest = http.expectOne(r => r.url.endsWith('/disponibilidade/equipamentos/export')); expect(exportRequest.request.params.get('sort')).toBe('incidentes,desc');
    expect(component['activeTab']()).toBe('equipamentos'); expect(component['page']()).toBe(2); expect(component['form'].controls.unidadeId.value).toBe('1'); expect(fixture.nativeElement.querySelector('tbody').textContent).toBe(beforeTable); expect(component['equipmentState']()).toBe('success');
    exportRequest.flush(new Blob(['csv']), { headers: { 'Content-Disposition': 'attachment; filename="equipamentos.csv"' } }); fixture.detectChanges();
    expect(component['page']()).toBe(2); expect(component['equipmentSort']()).toBe('incidentes'); expect(fixture.nativeElement.querySelector('tbody').textContent).toBe(beforeTable);
    anchorClick.mockRestore(); createObjectURL.mockRestore(); revokeObjectURL.mockRestore();
  });

  it('parses Blob JSON for 400/401/403/PASSWORD_CHANGE_REQUIRED/404/422/500 and never downloads errors', async () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test'); const { fixture, request } = create(); request.flush(page([equipment()])); fixture.detectChanges();
    const cases = [
      [400, 'INVALID_REQUEST', 'não é válida'], [401, 'UNAUTHORIZED', 'sessão expirou'], [403, 'FORBIDDEN', 'não tem permissão'],
      [403, 'PASSWORD_CHANGE_REQUIRED', 'Altere sua senha'], [404, 'RESOURCE_NOT_FOUND', 'não foi encontrado'],
      [422, 'EXPORT_LIMIT_EXCEEDED', 'Reduza o período ou aplique mais filtros'], [500, 'INTERNAL_ERROR', 'apresentou uma falha'],
    ] as const;
    for (const [status, code, expected] of cases) {
      const button = fixture.nativeElement.querySelector('.table-tools__actions .botao:last-child') as HTMLButtonElement; button.click(); fixture.detectChanges();
      const exportRequest = http.expectOne(r => r.url.endsWith('/disponibilidade/equipamentos/export'));
      const payload = { timestamp: '2026-08-25T00:00:00Z', status, error: 'Erro', code, message: 'detalhe interno', path: '/export' };
      exportRequest.flush(new Blob([JSON.stringify(payload)], { type: 'application/json' }), { status, statusText: 'Erro' });
      await fixture.whenStable(); fixture.detectChanges(); expect(fixture.nativeElement.textContent).toContain(expected); expect(button.disabled).toBe(false);
    }
    expect(createObjectURL).not.toHaveBeenCalled(); createObjectURL.mockRestore();
  });

  it('exports the Overview PDF once per double click with the exact period and preserves its state', () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:overview');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const { fixture, request, report } = create(); request.flush(report); fixture.detectChanges();
    const requests = overviewRequests(fixture); flushOverview(requests); fixture.detectChanges();
    const component = fixture.componentInstance;
    component['overviewForm'].patchValue({ inicio: '2026-08-01T00:00', fim: '2026-08-25T12:30' });
    const beforeValues = { ...component['overviewForm'].getRawValue() };
    const beforeWidgetValues = Object.values(component['overviewWidgets']).map(widget => widget.value());
    const button = (Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[])
      .find(value => value.textContent?.trim() === 'Exportar PDF')!;

    button.click(); button.click(); fixture.detectChanges();
    expect(button.disabled).toBe(true); expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.textContent).toContain('Exportando PDF');
    const matches = http.match(r => r.url.endsWith('/relatorios/visao-geral/export/pdf'));
    expect(matches.length).toBe(1);
    const exportRequest = matches[0];
    expect(exportRequest.request.method).toBe('GET'); expect(exportRequest.request.responseType).toBe('blob');
    expect(exportRequest.request.params.get('inicio')).toBe('2026-08-01T03:00:00.000Z');
    expect(exportRequest.request.params.get('fim')).toBe('2026-08-25T15:30:00.000Z');
    expect(exportRequest.request.params.has('page')).toBe(false); expect(exportRequest.request.params.has('size')).toBe(false); expect(exportRequest.request.params.has('sort')).toBe(false);
    const originalBlob = new Blob(['%PDF-1.7'], { type: 'application/pdf' });
    exportRequest.flush(originalBlob, { headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': "attachment; filename=unsafe.exe; filename*=UTF-8''vis%C3%A3o-geral.pdf",
    } });
    fixture.detectChanges();

    expect(createObjectURL).toHaveBeenCalledWith(originalBlob);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:overview'); expect(anchorClick).toHaveBeenCalledOnce();
    expect(button.disabled).toBe(false); expect(fixture.nativeElement.textContent).toContain('Download PDF iniciado');
    expect(component['activeTab']()).toBe('overview'); expect(component['overviewForm'].getRawValue()).toEqual(beforeValues);
    expect(Object.values(component['overviewWidgets']).map(widget => widget.value())).toEqual(beforeWidgetValues);
    anchorClick.mockRestore(); createObjectURL.mockRestore(); revokeObjectURL.mockRestore();
  });

  it('blocks an invalid Overview PDF period without a request', () => {
    const { fixture, request, report } = create(); request.flush(report); fixture.detectChanges();
    const requests = overviewRequests(fixture); flushOverview(requests); fixture.detectChanges();
    fixture.componentInstance['overviewForm'].patchValue({ inicio: '2026-01-01T00:00', fim: '2026-02-01T00:01' });
    const button = (Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[])
      .find(value => value.textContent?.trim() === 'Exportar PDF')!;
    button.click(); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('31 dias');
    expect(button.disabled).toBe(false);
    http.expectNone(r => r.url.endsWith('/relatorios/visao-geral/export/pdf'));
  });

  it('rejects a successful response with an unexpected Content-Type without downloading it', () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:unexpected');
    const { fixture, request, report } = create(); request.flush(report); fixture.detectChanges();
    const requests = overviewRequests(fixture); flushOverview(requests); fixture.detectChanges();
    const button = (Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[])
      .find(value => value.textContent?.trim() === 'Exportar PDF')!;
    button.click(); fixture.detectChanges();
    http.expectOne(r => r.url.endsWith('/relatorios/visao-geral/export/pdf')).flush(
      new Blob(['{"code":"INTERNAL_ERROR"}'], { type: 'application/json' }),
      { headers: { 'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename="erro.pdf"' } },
    );
    fixture.detectChanges();
    expect(createObjectURL).not.toHaveBeenCalled(); expect(button.disabled).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('arquivo PDF inesperado');
    createObjectURL.mockRestore();
  });

  it('handles PDF Blob errors for 400, 401, 403, PASSWORD_CHANGE_REQUIRED and 500 without a download', async () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:error');
    const { fixture, request, report } = create(); request.flush(report); fixture.detectChanges();
    const requests = overviewRequests(fixture); flushOverview(requests); fixture.detectChanges();
    const cases = [
      [400, 'INVALID_REQUEST', 'não é válida'], [401, 'UNAUTHORIZED', 'sessão expirou'],
      [403, 'FORBIDDEN', 'não tem permissão'], [403, 'PASSWORD_CHANGE_REQUIRED', 'Altere sua senha'],
      [500, 'INTERNAL_ERROR', 'apresentou uma falha'],
    ] as const;
    for (const [status, code, expected] of cases) {
      const button = (Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[])
        .find(value => value.textContent?.trim() === 'Exportar PDF')!;
      button.click(); fixture.detectChanges();
      const exportRequest = http.expectOne(r => r.url.endsWith('/relatorios/visao-geral/export/pdf'));
      exportRequest.flush(new Blob([JSON.stringify({
        timestamp: '2026-08-26T00:00:00Z', status, error: 'Erro', code, message: 'stack trace secreto', path: '/export/pdf',
      })], { type: 'application/json' }), { status, statusText: 'Erro', headers: { 'Content-Type': 'application/json' } });
      await fixture.whenStable(); fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain(expected); expect(fixture.nativeElement.textContent).not.toContain('stack trace secreto');
      expect(button.disabled).toBe(false);
    }
    expect(createObjectURL).not.toHaveBeenCalled(); createObjectURL.mockRestore();
  });

  it('exposes PDF only in Overview and keeps CSV exclusive to the other six areas', () => {
    const { fixture, request } = create(); request.flush(page([equipment()])); fixture.detectChanges(); const requests = overviewRequests(fixture); flushOverview(requests); fixture.detectChanges();
    expect((Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[]).some(button => button.textContent?.includes('Exportar CSV'))).toBe(false);
    expect((Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[]).filter(button => button.textContent?.includes('Exportar PDF')).length).toBe(1);
    clickTab(fixture, 'Disponibilidade Equipamentos');
    http.expectOne(r => r.url.endsWith('/relatorios/disponibilidade/equipamentos')).flush(page()); fixture.detectChanges();
    expect((Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[]).some(button => button.textContent?.includes('Exportar PDF'))).toBe(false);
    expect((Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[]).filter(button => button.textContent?.includes('Exportar CSV')).length).toBe(1);
  });

  // O botão "Abrir histórico" do drawer de equipamento entra por aqui:
  // /relatorios?aba=medicoes&equipamentoId=2 tem de abrir a aba já filtrada.
  it('abre a aba e o filtro de equipamento vindos da query string', async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [RelatoriosComponent],
      providers: [
        provideRouter([]), provideHttpClient(), provideHttpClientTesting(),
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: new Map([['aba', 'medicoes'], ['equipamentoId', '2']]) } } },
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);

    const fixture = TestBed.createComponent(RelatoriosComponent); fixture.detectChanges();
    http.expectOne(r => r.url.endsWith('/unidades') && r.params.get('ativo') === 'true').flush([{ id: 1, nome: 'Unidade A' }]);
    http.expectOne(r => r.url.endsWith('/tipos-equipamento') && r.params.get('ativo') === 'true').flush([{ id: 7, nome: 'Roteador' }]);

    // A unidade sai do próprio cadastro do equipamento: o filtro de equipamento pende dela.
    http.expectOne(r => r.url.endsWith('/api/v1/equipamentos/2'))
      .flush({ id: 2, nome: 'Router A', unidade: { id: 1, nome: 'Unidade A' }, tipoEquipamento: { id: 7, nome: 'Roteador' } });
    http.expectOne(r => r.url.endsWith('/equipamentos') && r.params.get('unidadeId') === '1').flush(page([{ id: 2, nome: 'Router A' }]));

    const consulta = http.expectOne(r => r.url.endsWith('/relatorios/medicoes'));
    expect(consulta.request.params.get('equipamentoId')).toBe('2');
    expect(consulta.request.params.get('unidadeId')).toBe('1');
    consulta.flush(page([measurement()])); fixture.detectChanges();

    // Sem busca inicial duplicada: a aba padrão não chega a consultar.
    http.expectNone(r => r.url.includes('/relatorios/disponibilidade/equipamentos'));
    expect(fixture.nativeElement.textContent).toContain('Router A');
  });
});
