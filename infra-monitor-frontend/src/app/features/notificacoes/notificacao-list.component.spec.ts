import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NotificacaoListComponent } from './notificacao-list.component';

const item = (status = 'ENVIADA', erro: string | null = null, enviadoEm: string | null = '2026-08-20T10:00:00Z') => ({ id: 1, canal: 'TELEGRAM', tipoEvento: 'INCIDENTE_ABERTO', status, tentativas: 2, mensagem: 'Mensagem', erro, enviadoEm, incidente: { id: 9, status: 'ABERTO' }, episodioLatencia: null, monitorNome: 'ICMP', equipamentoNome: 'SW-CORE', unidadeNome: 'Sesc Centro', createdAt: '2026-08-20T09:00:00Z', updatedAt: '2026-08-20T10:00:00Z' });
// Notificacao ancorada em episodio: sem incidente para linkar, como o backend devolve.
const latencyItem = (tipoEvento = 'LATENCIA_ALTA', encerradoEm: string | null = null) => ({ id: 2, canal: 'TELEGRAM', tipoEvento, status: 'ENVIADA', tentativas: 1, mensagem: 'LATENCIA ALTA', erro: null, enviadoEm: '2026-08-20T10:05:00Z', incidente: null, episodioLatencia: { id: 33, iniciadoEm: '2026-08-20T09:55:00Z', encerradoEm, limiarMs: 250 }, monitorNome: 'ICMP', equipamentoNome: 'RT-BORDA', unidadeNome: 'Sesc Norte', createdAt: '2026-08-20T10:00:00Z', updatedAt: '2026-08-20T10:05:00Z' });
const page = (content: unknown[]) => ({ content, page: 0, size: 20, totalElements: content.length, totalPages: content.length ? 1 : 0, first: true, last: true });
describe('NotificacaoListComponent', () => { let fixture: ComponentFixture<NotificacaoListComponent>; let http: HttpTestingController;
  beforeEach(() => { TestBed.configureTestingModule({ imports: [NotificacaoListComponent], providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] }); fixture = TestBed.createComponent(NotificacaoListComponent); http = TestBed.inject(HttpTestingController); }); afterEach(() => http.verify());
  it('renders loading then notification data, including nullable delivery fields and every status', () => { fixture.detectChanges(); const request = http.expectOne(value => value.url.endsWith('/notificacoes')); expect(fixture.nativeElement.querySelector('[aria-label="Carregando notificações"]')).toBeTruthy(); request.flush(page([item('PENDENTE', null, null), item('ENVIANDO'), item('ENVIADA'), item('FALHA', 'Falha\nem duas linhas')])); fixture.detectChanges(); const text = fixture.nativeElement.textContent; expect(text).toContain('Aguardando'); expect(text).toContain('Em envio'); expect(text).toContain('Enviada'); expect(text).toContain('Falha'); expect(text).toContain('Falha\nem duas linhas'); });
  it('renders empty and API error states', () => { fixture.detectChanges(); http.expectOne(value => value.url.endsWith('/notificacoes')).flush(page([])); fixture.detectChanges(); expect(fixture.nativeElement.textContent).toContain('Nenhuma notificação'); (fixture.componentInstance as any).load(); const request = http.expectOne(value => value.url.endsWith('/notificacoes')); request.flush({ timestamp: '2026-08-20T10:00:00Z', status: 400, error: 'Bad Request', code: 'INVALID_REQUEST', message: 'Período inválido', path: '/api/v1/notificacoes' }, { status: 400, statusText: 'Bad Request' }); fixture.detectChanges(); expect(fixture.nativeElement.textContent).toContain('Período inválido'); });
  it('sends incident, enum, period, sort and pagination filters server-side', () => { fixture.detectChanges(); http.expectOne(value => value.url.endsWith('/notificacoes')).flush(page([])); const component = fixture.componentInstance as any; component.incidenteId.set(7); component.status.set('FALHA'); component.canal.set('TELEGRAM'); component.tipoEvento.set('INCIDENTE_FECHADO'); component.inicio.set('2026-08-20T10:00'); component.fim.set('2026-08-20T11:00'); component.sort.set('tentativas,desc'); component.pageNumber.set(1); component.load(); const request = http.expectOne(value => value.url.endsWith('/notificacoes')); expect(request.request.params.get('incidenteId')).toBe('7'); expect(request.request.params.get('status')).toBe('FALHA'); expect(request.request.params.get('canal')).toBe('TELEGRAM'); expect(request.request.params.get('tipoEvento')).toBe('INCIDENTE_FECHADO'); expect(request.request.params.get('sort')).toBe('tentativas,desc'); expect(request.request.params.get('page')).toBe('1'); expect(request.request.params.get('inicio')).toContain('2026-08-20T'); request.flush({ ...page([]), page: 1, totalPages: 2 }); });

  it('renders a latency-episode notification with equipment and unit, and without an incident link', () => {
    fixture.detectChanges();
    http.expectOne(value => value.url.endsWith('/notificacoes')).flush(page([latencyItem()]));
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Latência alta');
    expect(text).toContain('acima de 250 ms');
    expect(text).toContain('RT-BORDA');
    expect(text).toContain('Sesc Norte');
    // Nao existe incidente para linkar nesse tipo de notificacao.
    expect(fixture.nativeElement.querySelector('a[href*="/incidentes"]')).toBeNull();
  });

  it('renders incident and latency notifications side by side, linking only the incident one', () => {
    fixture.detectChanges();
    http.expectOne(value => value.url.endsWith('/notificacoes'))
      .flush(page([item(), latencyItem('LATENCIA_NORMALIZADA', '2026-08-20T10:04:00Z')]));
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Incidente aberto');
    expect(text).toContain('Latência normalizada');
    expect(text).toContain('SW-CORE');
    expect(text).toContain('RT-BORDA');
    expect(fixture.nativeElement.querySelectorAll('a[href*="/incidentes"]').length).toBe(1);
  });

  it('allows filtering by the latency event types', () => {
    fixture.detectChanges();
    http.expectOne(value => value.url.endsWith('/notificacoes')).flush(page([]));
    (fixture.componentInstance as any).setTipoEvento('LATENCIA_ALTA');
    const request = http.expectOne(value => value.url.endsWith('/notificacoes'));
    expect(request.request.params.get('tipoEvento')).toBe('LATENCIA_ALTA');
    request.flush(page([latencyItem()]));
  });

  it('não tem h1 nem cabeçalho próprio: vive dentro da casca do Telegram, que já tem o h1', () => {
    fixture.detectChanges();
    http.expectOne(value => value.url.endsWith('/notificacoes')).flush(page([]));
    fixture.detectChanges();
    const raiz = fixture.nativeElement as HTMLElement;
    expect(raiz.querySelector('h1')).toBeNull();
    expect(raiz.querySelector('section.operational-page > header')).toBeNull();
    expect(raiz.querySelector('section.operational-page')!.getAttribute('aria-label')).toBe('Histórico de notificações');
  });
});
