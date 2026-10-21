import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MonitorManagementComponent } from './monitor-management.component';

describe('MonitorManagementComponent', () => {
  let fixture: ComponentFixture<MonitorManagementComponent>; let component: MonitorManagementComponent; let http: HttpTestingController;
  const page = { content: [{ id: 7, nome: 'ICMP principal', tipo: 'ICMP', intervaloSegundos: 60, timeoutMs: 2000, falhasParaIncidente: 3, sucessosParaRecovery: 2, ativo: true, equipamento: { id: 10, nome: 'SW-01' }, createdAt: '2026-08-20T00:00:00Z', updatedAt: '2026-08-20T00:00:00Z' }], page: 0, size: 20, totalElements: 1, totalPages: 1, first: true, last: true };
  beforeEach(async () => { await TestBed.configureTestingModule({ imports: [MonitorManagementComponent], providers: [provideHttpClient(), provideHttpClientTesting()] }).compileComponents(); http = TestBed.inject(HttpTestingController); fixture = TestBed.createComponent(MonitorManagementComponent); component = fixture.componentInstance; fixture.detectChanges(); });
  afterEach(() => http.verify());
  function flushInitial(monitors = page): void { http.expectOne(request => request.url.endsWith('/equipamentos')).flush({ content: [], page: 0, size: 100, totalElements: 0, totalPages: 0, first: true, last: true }); http.expectOne(request => request.url.endsWith('/monitores')).flush(monitors); fixture.detectChanges(); }
  it('renders backend monitor configuration without calculating operational status', () => { flushInitial(); expect(fixture.nativeElement.textContent).toContain('3 falhas'); expect(fixture.nativeElement.textContent).toContain('Ativo'); expect(fixture.nativeElement.textContent).not.toContain('Disponível'); expect(fixture.nativeElement.textContent).not.toContain('Indisponível'); });
  it('uses contextual equipment filter for the equipment detail integration', () => { http.expectOne(request => request.url.endsWith('/equipamentos')).flush({ content: [], page: 0, size: 100, totalElements: 0, totalPages: 0, first: true, last: true }); const request = http.expectOne(request => request.url.endsWith('/monitores')); expect(request.request.params.get('equipamentoId')).toBeNull(); request.flush(page); fixture.componentRef.setInput('equipamentoContextId', 10); fixture.detectChanges(); /* Input is stable before initialization in routed usage; explicit refresh validates the API query. */ (component as any).load(); const contextual = http.expectOne(request => request.url.endsWith('/monitores')); expect(contextual.request.params.get('equipamentoId')).toBe('10'); contextual.flush(page); });
  it('maps backend validation fields and invalid enum errors to form feedback', () => { flushInitial(); (component as any).openCreate(); (component as any).form.patchValue({ equipamentoId: 10, nome: 'Teste' }); (component as any).submit(); const request = http.expectOne(request => request.url.endsWith('/monitores') && request.method === 'POST'); request.flush({ timestamp: '2026-08-20T00:00:00Z', status: 400, error: 'Bad Request', code: 'VALIDATION_ERROR', message: 'Requisição inválida', path: '/api/v1/monitores', fields: { nome: 'nome inválido' } }, { status: 400, statusText: 'Bad Request' }); expect((component as any).form.controls.nome.errors?.['backend']).toBe('nome inválido'); (component as any).form.controls.nome.setErrors(null); (component as any).submit(); const invalidEnum = http.expectOne(request => request.url.endsWith('/monitores') && request.method === 'POST'); invalidEnum.flush({ timestamp: '2026-08-20T00:00:00Z', status: 400, error: 'Bad Request', code: 'INVALID_ENUM', message: 'Enum inválido', path: '/api/v1/monitores' }, { status: 400, statusText: 'Bad Request' }); expect((component as any).error()).toContain('tipo de monitor'); });
  it('mostra a contagem no singular e no plural', () => { flushInitial(); expect(fixture.nativeElement.querySelector('p.contagem').textContent.trim()).toBe('1 monitor'); (component as any).totalElements.set(2); fixture.detectChanges(); expect(fixture.nativeElement.querySelector('p.contagem').textContent.trim()).toBe('2 monitores'); });
  it('página usa a casca compartilhada, sem sobretítulo', () => {
    flushInitial(); const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.eyebrow')).toBeNull();
    expect(el.querySelector('section.pagina')).not.toBeNull();
    expect(el.querySelector('header.pagina__cabecalho')).not.toBeNull();
    expect(el.querySelector('p.pagina__descricao')).not.toBeNull();
    expect(el.querySelector('small')).toBeNull();
  });
  it('embutido não vira página e também não tem sobretítulo', () => {
    const embedded = TestBed.createComponent(MonitorManagementComponent); embedded.componentRef.setInput('equipamentoContextId', 10); embedded.detectChanges();
    const vazio = { content: [], page: 0, size: 100, totalElements: 0, totalPages: 0, first: true, last: true };
    http.match(r => r.url.endsWith('/equipamentos')).forEach(r => r.flush(vazio));
    http.match(r => r.url.endsWith('/monitores')).forEach(r => r.flush(page)); embedded.detectChanges();
    const el: HTMLElement = embedded.nativeElement;
    expect(el.querySelector('.eyebrow')).toBeNull();
    expect(el.querySelector('.pagina')).toBeNull();
    expect(el.querySelector('.monitor-page--embedded')).not.toBeNull();
    expect(el.querySelector('p.pagina__descricao')).toBeNull();
    expect(el.querySelector('header p')?.textContent).toContain('Monitores configurados');
    expect(el.querySelector('small')).toBeNull();
  });
  it('usa app-paginacao e não a renderiza com resposta vazia', () => {
    flushInitial(); expect(fixture.nativeElement.querySelector('app-paginacao')).not.toBeNull();
    (component as any).load(); http.expectOne(request => request.url.endsWith('/monitores')).flush({ ...page, content: [], totalElements: 0, totalPages: 0 }); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-paginacao')).toBeNull();
  });
  it('Escape no document logo após abrir o formulário fecha o app-modal', () => {
    flushInitial(); (component as any).openCreate(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-modal [role="dialog"]')).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-modal [role="dialog"]')).toBeNull();
  });
  it('status do monitor usa chip-ativo e o nome não é mono', () => {
    flushInitial(); const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('td .chip-ativo')?.textContent?.trim()).toBe('Ativo');
    expect(el.querySelector('.chip-monitoramento')).toBeNull();
    const nome = Array.from(el.querySelectorAll('td span.forte')).find(n => n.textContent?.includes('ICMP principal'));
    expect(nome).toBeDefined(); expect(nome!.classList.contains('mono')).toBe(false);
  });
});
