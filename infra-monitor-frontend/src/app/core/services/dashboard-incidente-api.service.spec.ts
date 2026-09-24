import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { IncidentStatus } from '../models/api-enums';
import { IncidentSeverity } from '../models/dashboard-incidente';
import { DashboardIncidenteApiService } from './dashboard-incidente-api.service';

describe('DashboardIncidenteApiService', () => {
  let service: DashboardIncidenteApiService; let http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(DashboardIncidenteApiService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('sends the unified list request without parameters', () => {
    service.list().subscribe();
    const request = http.expectOne('http://localhost:8080/api/v1/dashboard/incidentes');
    expect(request.request.method).toBe('GET');
    request.flush({});
  });

  it('sends pagination, sort and every supported filter', () => {
    service.list({
      page: 1, size: 20, sort: 'iniciadoEm,desc', unidadeId: 7, severidade: IncidentSeverity.High,
      status: IncidentStatus.Acknowledged, inicio: '2026-08-20T10:00:00.000Z', fim: '2026-08-20T11:00:00.000Z',
    }).subscribe();
    const request = http.expectOne(value => value.url.endsWith('/dashboard/incidentes'));
    expect(request.request.params.keys().sort()).toEqual(['fim', 'inicio', 'page', 'severidade', 'size', 'sort', 'status', 'unidadeId']);
    expect(request.request.params.get('severidade')).toBe('ALTA');
    expect(request.request.params.get('status')).toBe('RECONHECIDO');
    request.flush({});
  });

  it('omits status from the counters request so the unselected tab is never zeroed', () => {
    service.counters({ unidadeId: 7, severidade: IncidentSeverity.Medium, inicio: 'a', fim: 'b' }).subscribe();
    const request = http.expectOne(value => value.url.endsWith('/dashboard/incidentes/contadores'));
    expect(request.request.method).toBe('GET');
    expect(request.request.params.keys().sort()).toEqual(['fim', 'inicio', 'severidade', 'unidadeId']);
    request.flush({ abertos: 1, reconhecidos: 0, resolvidos: 2, todos: 3 });
  });
});
