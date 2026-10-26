import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { NotificacaoDetailComponent } from './notificacao-detail.component';

const incidentNotification = {
  id: 5, canal: 'TELEGRAM', tipoEvento: 'INCIDENTE_ABERTO', status: 'ENVIADA', tentativas: 1,
  mensagem: 'INCIDENTE ABERTO', erro: null, enviadoEm: '2026-08-20T10:00:00Z',
  incidente: { id: 9, status: 'ABERTO' }, episodioLatencia: null, manutencao: null, manutencaoManual: null,
  monitorNome: 'ICMP', equipamentoNome: 'SW-CORE', unidadeNome: 'Sesc Centro',
  createdAt: '2026-08-20T09:00:00Z', updatedAt: '2026-08-20T10:00:00Z',
};

// Ancorada em episodio: incidente nulo, como o backend devolve para eventos de latencia.
const latencyNotification = {
  id: 5, canal: 'TELEGRAM', tipoEvento: 'LATENCIA_ALTA', status: 'ENVIADA', tentativas: 1,
  mensagem: 'LATENCIA ALTA\n\nUnidade: Sesc Norte', erro: null, enviadoEm: '2026-08-20T10:05:00Z',
  incidente: null,
  episodioLatencia: { id: 33, iniciadoEm: '2026-08-20T09:55:00Z', encerradoEm: null, limiarMs: 250 },
  monitorNome: 'ICMP', equipamentoNome: 'RT-BORDA', unidadeNome: 'Sesc Norte',
  createdAt: '2026-08-20T10:00:00Z', updatedAt: '2026-08-20T10:05:00Z',
};

describe('NotificacaoDetailComponent', () => {
  let fixture: ComponentFixture<NotificacaoDetailComponent>;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [NotificacaoDetailComponent],
      providers: [
        provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: '5' }) } } },
      ],
    });
    fixture = TestBed.createComponent(NotificacaoDetailComponent);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('renders an incident-anchored notification with the incident link', () => {
    fixture.detectChanges();
    http.expectOne(value => value.url.endsWith('/notificacoes/5')).flush(incidentNotification);
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Incidente aberto');
    expect(text).toContain('SW-CORE');
    expect(text).toContain('Sesc Centro');
    expect(fixture.nativeElement.querySelectorAll('a[href*="/incidentes"]').length).toBeGreaterThan(0);
  });

  it('renders a latency-episode notification with episode data and no incident section', () => {
    fixture.detectChanges();
    http.expectOne(value => value.url.endsWith('/notificacoes/5')).flush(latencyNotification);
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Latência alta');
    expect(text).toContain('Episódio de latência');
    expect(text).toContain('acima de 250 ms');
    expect(text).toContain('Em andamento');
    expect(text).toContain('RT-BORDA');
    expect(text).toContain('Sesc Norte');
    expect(text).not.toContain('Ver incidente');
    // Sem incidente, nenhum link para /incidentes pode ser renderizado.
    expect(fixture.nativeElement.querySelector('a[href*="/incidentes"]')).toBeNull();
  });

  it('shows the closing timestamp once the episode is finished', () => {
    fixture.detectChanges();
    http.expectOne(value => value.url.endsWith('/notificacoes/5')).flush({
      ...latencyNotification, tipoEvento: 'LATENCIA_NORMALIZADA',
      episodioLatencia: { ...latencyNotification.episodioLatencia, encerradoEm: '2026-08-20T10:04:00Z' },
    });
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Latência normalizada');
    expect(text).not.toContain('Em andamento');
    expect(text).toContain('20/08/2026');
  });

  it('usa a casca .pagina, sem sobretitulo, e mostra o id como descricao', () => {
    fixture.detectChanges();
    http.expectOne(value => value.url.endsWith('/notificacoes/5')).flush(incidentNotification);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('section.pagina')).not.toBeNull();
    expect(el.querySelector('header p:not(.pagina__descricao)')).toBeNull();
    expect(el.querySelector('header .pagina__descricao')?.textContent).toContain('Notificação #5');
  });

  it('carregando mostra o esqueleto compartilhado', () => {
    fixture.detectChanges();
    const esqueleto = fixture.nativeElement.querySelector('.esqueleto[role="status"]');
    expect(esqueleto).not.toBeNull();
    expect(esqueleto.querySelectorAll('span').length).toBe(4);
    http.expectOne(value => value.url.endsWith('/notificacoes/5')).flush(incidentNotification);
  });

  it('erro oferece "Tentar novamente" que recarrega', () => {
    fixture.detectChanges();
    http.expectOne(value => value.url.endsWith('/notificacoes/5')).flush({}, { status: 500, statusText: 'Erro' });
    fixture.detectChanges();
    const botao: HTMLButtonElement = fixture.nativeElement.querySelector('button.botao');
    expect(botao.textContent).toContain('Tentar novamente');
    botao.click();
    http.expectOne(value => value.url.endsWith('/notificacoes/5')).flush(incidentNotification);
  });

  it('mostra a origem da janela com link para /manutencoes', () => {
    fixture.detectChanges();
    http.expectOne(value => value.url.endsWith('/notificacoes/5')).flush({
      ...incidentNotification, incidente: null, tipoEvento: 'MANUTENCAO_ENCERRADA',
      manutencao: { id: 41, unidadeNome: 'Sesc Centro' }, equipamentoNome: null, monitorNome: null,
    });
    fixture.detectChanges();
    const link = fixture.nativeElement.querySelector('a[href="/manutencoes"]') as HTMLAnchorElement;
    expect(link.textContent).toContain('Janela #41');
    expect(fixture.nativeElement.textContent).toContain('Manutenção encerrada');
  });

  it('mostra a origem da manutenção manual com o nome do equipamento', () => {
    fixture.detectChanges();
    http.expectOne(value => value.url.endsWith('/notificacoes/5')).flush({
      ...incidentNotification, incidente: null, tipoEvento: 'MANUTENCAO_MANUAL_INICIADA',
      manutencaoManual: { id: 7, equipamentoId: 2, equipamentoNome: 'SW-01' },
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Manutenção manual · SW-01');
    expect(fixture.nativeElement.textContent).toContain('Manutenção manual iniciada');
  });

});
