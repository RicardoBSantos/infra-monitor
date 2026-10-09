import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { NotificationChannel, NotificationEventType, NotificationStatus } from '../models/api-enums';
import { NotificacaoApiService } from './notificacao-api.service';

describe('NotificacaoApiService', () => {
  let service: NotificacaoApiService; let http: HttpTestingController;
  beforeEach(() => { TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] }); service = TestBed.inject(NotificacaoApiService); http = TestBed.inject(HttpTestingController); }); afterEach(() => http.verify());
  it('lists with no parameters by default', () => { service.list().subscribe(); const request = http.expectOne('http://localhost:8080/api/v1/notificacoes'); expect(request.request.method).toBe('GET'); request.flush({}); });
  it('sends page, size, allowed sort and all filters', () => { service.list({ page: 2, size: 50, sort: 'tentativas,desc', incidenteId: 42, status: NotificationStatus.Failure, canal: NotificationChannel.Telegram, tipoEvento: NotificationEventType.IncidentClosed, inicio: '2026-08-20T10:00:00.000Z', fim: '2026-08-20T11:00:00.000Z' }).subscribe(); const request = http.expectOne(value => value.url.endsWith('/notificacoes')); expect(request.request.method).toBe('GET'); expect(request.request.params.keys()).toEqual(['page', 'size', 'sort', 'incidenteId', 'status', 'canal', 'tipoEvento', 'inicio', 'fim']); expect(request.request.params.get('page')).toBe('2'); expect(request.request.params.get('size')).toBe('50'); expect(request.request.params.get('sort')).toBe('tentativas,desc'); expect(request.request.params.get('incidenteId')).toBe('42'); expect(request.request.params.get('status')).toBe('FALHA'); expect(request.request.params.get('canal')).toBe('TELEGRAM'); expect(request.request.params.get('tipoEvento')).toBe('INCIDENTE_FECHADO'); expect(request.request.params.get('inicio')).toBe('2026-08-20T10:00:00.000Z'); expect(request.request.params.get('fim')).toBe('2026-08-20T11:00:00.000Z'); request.flush({}); });
  it('gets a notification by id', () => { service.getById(7).subscribe(); const request = http.expectOne('http://localhost:8080/api/v1/notificacoes/7'); expect(request.request.method).toBe('GET'); request.flush({}); });
});
