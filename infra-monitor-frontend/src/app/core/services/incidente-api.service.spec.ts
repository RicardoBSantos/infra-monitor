import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { IncidentStatus } from '../models/api-enums';
import { IncidenteApiService } from './incidente-api.service';

describe('IncidenteApiService', () => {
  let service: IncidenteApiService; let http: HttpTestingController;
  beforeEach(() => { TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] }); service = TestBed.inject(IncidenteApiService); http = TestBed.inject(HttpTestingController); }); afterEach(() => http.verify());
  it('sends the default list request without parameters', () => { service.list().subscribe(); const request = http.expectOne('http://localhost:8080/api/v1/incidentes'); expect(request.request.method).toBe('GET'); request.flush({}); });
  it('sends pagination, sort and every supported filter', () => { service.list({ page: 1, size: 20, sort: 'iniciadoEm,desc', monitorId: 10, equipamentoId: 20, unidadeId: 30, status: IncidentStatus.Open, inicio: '2026-08-20T10:00:00.000Z', fim: '2026-08-20T11:00:00.000Z' }).subscribe(); const request = http.expectOne(value => value.url.endsWith('/incidentes')); expect(request.request.method).toBe('GET'); expect(request.request.params.keys()).toEqual(['page', 'size', 'sort', 'monitorId', 'equipamentoId', 'unidadeId', 'status', 'inicio', 'fim']); expect(request.request.params.get('page')).toBe('1'); expect(request.request.params.get('size')).toBe('20'); expect(request.request.params.get('sort')).toBe('iniciadoEm,desc'); expect(request.request.params.get('monitorId')).toBe('10'); expect(request.request.params.get('equipamentoId')).toBe('20'); expect(request.request.params.get('unidadeId')).toBe('30'); expect(request.request.params.get('status')).toBe('ABERTO'); request.flush({}); });
  it('gets and closes an incident with the server payload', () => { service.getById(3).subscribe(); let request = http.expectOne('http://localhost:8080/api/v1/incidentes/3'); expect(request.request.method).toBe('GET'); request.flush({}); const body = { encerradoEm: '2026-08-20T12:00:00.000Z', observacao: null }; service.close(3, body).subscribe(); request = http.expectOne('http://localhost:8080/api/v1/incidentes/3/fechar'); expect(request.request.method).toBe('PATCH'); expect(request.request.body).toEqual(body); request.flush({}); });
  it('acknowledges an incident with an empty body', () => { service.acknowledge(7).subscribe(); const request = http.expectOne('http://localhost:8080/api/v1/incidentes/7/reconhecer'); expect(request.request.method).toBe('PATCH'); expect(request.request.body).toBeNull(); request.flush({}); });
});
