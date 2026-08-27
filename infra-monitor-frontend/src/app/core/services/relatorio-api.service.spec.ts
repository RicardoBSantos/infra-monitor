import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { IncidentStatus, MeasurementStatus, NotificationChannel, NotificationEventType, NotificationStatus } from '../models/api-enums';
import { buildReportHttpParams, RelatorioApiService } from './relatorio-api.service';

describe('RelatorioApiService', () => {
  let service: RelatorioApiService; let http: HttpTestingController;
  const period = { inicio: '2026-08-01T00:00:00Z', fim: '2026-08-02T00:00:00Z' };
  beforeEach(() => { TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] }); service = TestBed.inject(RelatorioApiService); http = TestBed.inject(HttpTestingController); });
  afterEach(() => http.verify());

  it('serializes the required period and omits null, undefined and empty values while preserving zero', () => {
    const params = buildReportHttpParams([{ key: 'inicio', value: period.inicio }, { key: 'fim', value: period.fim }, { key: 'unidadeId', value: 1 }, { key: 'equipamentoId', value: null }, { key: 'monitorId', value: undefined }, { key: 'status', value: '' }, { key: 'page', value: 0 }, { key: 'size', value: 20 }, { key: 'sort', value: 'disponibilidadePercentual,desc' }]);
    expect(params.keys()).toEqual(['inicio', 'fim', 'unidadeId', 'page', 'size', 'sort']);
    expect(params.get('page')).toBe('0');
  });

  it('gets availability by equipment with typed filters and omits null values', () => {
    service.getDisponibilidadeEquipamentos({ ...period, unidadeId: 1, equipamentoId: null, page: 0, size: 20, sort: { field: 'disponibilidadePercentual', direction: 'desc' } }).subscribe();
    const request = http.expectOne(value => value.url.endsWith('/relatorios/disponibilidade/equipamentos'));
    expect(request.request.method).toBe('GET'); expect(request.request.params.get('unidadeId')).toBe('1'); expect(request.request.params.get('page')).toBe('0'); expect(request.request.params.get('size')).toBe('20'); expect(request.request.params.get('sort')).toBe('disponibilidadePercentual,desc'); expect(request.request.params.has('equipamentoId')).toBe(false); request.flush({ content: [] });
  });

  it('gets availability by unit', () => {
    service.getDisponibilidadeUnidades({ ...period, unidadeId: 2, page: 0, size: 20, sort: { field: 'unidadeNome', direction: 'asc' } }).subscribe();
    const request = http.expectOne(value => value.url.endsWith('/relatorios/disponibilidade/unidades'));
    expect(request.request.method).toBe('GET'); expect(request.request.params.get('unidadeId')).toBe('2'); expect(request.request.params.get('sort')).toBe('unidadeNome,asc'); request.flush({ content: [] });
  });

  it('gets incidents', () => {
    service.getIncidentes({ ...period, monitorId: 3, status: IncidentStatus.Open, page: 0, size: 20, sort: { field: 'iniciadoEm', direction: 'desc' } }).subscribe();
    const request = http.expectOne(value => value.url.endsWith('/relatorios/incidentes'));
    expect(request.request.method).toBe('GET'); expect(request.request.params.get('monitorId')).toBe('3'); expect(request.request.params.get('status')).toBe('ABERTO'); request.flush({ content: [] });
  });

  it('gets measurements', () => {
    service.getMedicoes({ ...period, equipamentoId: 4, status: MeasurementStatus.Failure, page: 0, size: 50, sort: { field: 'executadoEm', direction: 'desc' } }).subscribe();
    const request = http.expectOne(value => value.url.endsWith('/relatorios/medicoes'));
    expect(request.request.method).toBe('GET'); expect(request.request.params.get('equipamentoId')).toBe('4'); expect(request.request.params.get('size')).toBe('50'); expect(request.request.params.get('status')).toBe('FALHA'); request.flush({ content: [] });
  });

  it('gets latency', () => {
    service.getLatencia({ ...period, monitorId: 5, page: 0, size: 20, sort: { field: 'avgLatenciaMs', direction: 'desc' } }).subscribe();
    const request = http.expectOne(value => value.url.endsWith('/relatorios/latencia'));
    expect(request.request.method).toBe('GET'); expect(request.request.params.get('monitorId')).toBe('5'); expect(request.request.params.get('sort')).toBe('avgLatenciaMs,desc'); request.flush({ content: [] });
  });

  it('gets notifications', () => {
    service.getNotificacoes({ ...period, incidenteId: 6, status: NotificationStatus.Sent, canal: NotificationChannel.Telegram, tipoEvento: NotificationEventType.IncidentOpened, page: 0, size: 20, sort: { field: 'createdAt', direction: 'desc' } }).subscribe();
    const request = http.expectOne(value => value.url.endsWith('/relatorios/notificacoes'));
    expect(request.request.method).toBe('GET'); expect(request.request.params.get('incidenteId')).toBe('6'); expect(request.request.params.get('status')).toBe('ENVIADA'); expect(request.request.params.get('canal')).toBe('TELEGRAM'); expect(request.request.params.get('tipoEvento')).toBe('INCIDENTE_ABERTO'); request.flush({ content: [] });
  });

  it('exports availability by equipment as one full Blob response without pagination', () => {
    service.exportDisponibilidadeEquipamentos({ ...period, unidadeId: 1, equipamentoId: 2, monitorId: 3, tipoEquipamentoId: 4, sort: { field: 'incidentes', direction: 'desc' } }).subscribe(response => {
      expect(response.status).toBe(200); expect(response.body).toBeInstanceOf(Blob); expect(response.headers.get('Content-Disposition')).toContain('equipamentos.csv');
    });
    const request = expectExport('/disponibilidade/equipamentos/export', { unidadeId: '1', equipamentoId: '2', monitorId: '3', tipoEquipamentoId: '4', sort: 'incidentes,desc' });
    request.flush(new Blob(['csv'], { type: 'text/csv' }), { status: 200, statusText: 'OK', headers: { 'Content-Disposition': 'attachment; filename="equipamentos.csv"' } });
  });

  it('exports availability by unit and omits empty filters', () => {
    service.exportDisponibilidadeUnidades({ ...period, unidadeId: null, sort: { field: 'unidadeNome', direction: 'asc' } }).subscribe();
    const request = expectExport('/disponibilidade/unidades/export', { sort: 'unidadeNome,asc' }); request.flush(new Blob());
  });

  it('exports incidents with its current filters and sort', () => {
    service.exportIncidentes({ ...period, unidadeId: 1, equipamentoId: 2, monitorId: 3, status: IncidentStatus.Closed, sort: { field: 'status', direction: 'asc' } }).subscribe();
    const request = expectExport('/incidentes/export', { unidadeId: '1', equipamentoId: '2', monitorId: '3', status: 'FECHADO', sort: 'status,asc' }); request.flush(new Blob());
  });

  it('exports measurements with its current filters and sort', () => {
    service.exportMedicoes({ ...period, unidadeId: 1, equipamentoId: 2, monitorId: 3, status: MeasurementStatus.Failure, sort: { field: 'latenciaMs', direction: 'desc' } }).subscribe();
    const request = expectExport('/medicoes/export', { unidadeId: '1', equipamentoId: '2', monitorId: '3', status: 'FALHA', sort: 'latenciaMs,desc' }); request.flush(new Blob());
  });

  it('exports latency with its current filters and sort', () => {
    service.exportLatencia({ ...period, unidadeId: 1, equipamentoId: 2, monitorId: 3, sort: { field: 'avgLatenciaMs', direction: 'desc' } }).subscribe();
    const request = expectExport('/latencia/export', { unidadeId: '1', equipamentoId: '2', monitorId: '3', sort: 'avgLatenciaMs,desc' }); request.flush(new Blob());
  });

  it('exports notifications with its current filters and sort', () => {
    service.exportNotificacoes({ ...period, incidenteId: 6, status: NotificationStatus.Sent, canal: NotificationChannel.Telegram, tipoEvento: NotificationEventType.IncidentOpened, sort: { field: 'createdAt', direction: 'desc' } }).subscribe();
    const request = expectExport('/notificacoes/export', { incidenteId: '6', status: 'ENVIADA', canal: 'TELEGRAM', tipoEvento: 'INCIDENTE_ABERTO', sort: 'createdAt,desc' }); request.flush(new Blob());
  });

  it('exports the Overview PDF as the full Blob response with only inicio and fim', () => {
    service.exportVisaoGeralPdf(period).subscribe(response => {
      expect(response.status).toBe(200);
      expect(response.body).toBeInstanceOf(Blob);
      expect(response.headers.get('Content-Type')).toBe('application/pdf');
      expect(response.headers.get('Content-Disposition')).toContain('visao-geral.pdf');
    });
    const request = http.expectOne(value => value.url.endsWith('/relatorios/visao-geral/export/pdf'));
    expect(request.request.method).toBe('GET');
    expect(request.request.responseType).toBe('blob');
    expect(request.request.params.keys()).toEqual(['inicio', 'fim']);
    expect(request.request.params.get('inicio')).toBe(period.inicio);
    expect(request.request.params.get('fim')).toBe(period.fim);
    expect(request.request.params.has('page')).toBe(false);
    expect(request.request.params.has('size')).toBe(false);
    expect(request.request.params.has('sort')).toBe(false);
    request.flush(new Blob(['%PDF'], { type: 'application/pdf' }), {
      status: 200, statusText: 'OK',
      headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="visao-geral.pdf"' },
    });
  });

  function expectExport(path: string, expected: Record<string, string>) {
    const request = http.expectOne(value => value.url.endsWith(`/relatorios${path}`));
    expect(request.request.method).toBe('GET'); expect(request.request.responseType).toBe('blob');
    expect(request.request.params.get('inicio')).toBe(period.inicio); expect(request.request.params.get('fim')).toBe(period.fim);
    expect(request.request.params.has('page')).toBe(false); expect(request.request.params.has('size')).toBe(false);
    for (const [key, value] of Object.entries(expected)) expect(request.request.params.get(key)).toBe(value);
    return request;
  }
});
