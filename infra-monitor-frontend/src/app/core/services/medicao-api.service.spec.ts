import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MeasurementStatus } from '../models/api-enums';
import { MedicaoApiService } from './medicao-api.service';

describe('MedicaoApiService', () => {
  let service: MedicaoApiService; let http: HttpTestingController;
  beforeEach(() => { TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] }); service = TestBed.inject(MedicaoApiService); http = TestBed.inject(HttpTestingController); }); afterEach(() => http.verify());
  it('sends the default list request without parameters', () => { service.list().subscribe(); const request = http.expectOne('http://localhost:8080/api/v1/medicoes'); expect(request.request.method).toBe('GET'); request.flush({}); });
  it('sends pagination, sort and every supported filter', () => { service.list({ page: 2, size: 50, sort: 'latenciaMs,desc', monitorId: 10, status: MeasurementStatus.Failure, inicio: '2026-08-20T10:00:00.000Z', fim: '2026-08-20T11:00:00.000Z' }).subscribe(); const request = http.expectOne(value => value.url.endsWith('/medicoes')); expect(request.request.method).toBe('GET'); expect(request.request.params.keys()).toEqual(['page', 'size', 'sort', 'monitorId', 'status', 'inicio', 'fim']); expect(request.request.params.get('page')).toBe('2'); expect(request.request.params.get('size')).toBe('50'); expect(request.request.params.get('sort')).toBe('latenciaMs,desc'); expect(request.request.params.get('monitorId')).toBe('10'); expect(request.request.params.get('status')).toBe('FALHA'); expect(request.request.params.get('inicio')).toBe('2026-08-20T10:00:00.000Z'); expect(request.request.params.get('fim')).toBe('2026-08-20T11:00:00.000Z'); request.flush({}); });
  it('gets a measurement by id', () => { service.getById(3).subscribe(); const request = http.expectOne('http://localhost:8080/api/v1/medicoes/3'); expect(request.request.method).toBe('GET'); request.flush({}); });
});
