import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MaintenanceScope } from '../models/api-enums';
import { CriarManutencaoRequest } from '../models/manutencao';
import { ManutencaoApiService } from './manutencao-api.service';

describe('ManutencaoApiService', () => {
  const base = 'http://localhost:8080/api/v1/manutencoes';
  let service: ManutencaoApiService; let http: HttpTestingController;
  beforeEach(() => { TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] }); service = TestBed.inject(ManutencaoApiService); http = TestBed.inject(HttpTestingController); });
  afterEach(() => http.verify());

  it('lista com situacao, busca, page e size', () => {
    service.list('VIGENTES', 'sede', 2).subscribe();
    const r = http.expectOne(req => req.url === base);
    expect(r.request.method).toBe('GET');
    expect(r.request.params.get('situacao')).toBe('VIGENTES');
    expect(r.request.params.get('busca')).toBe('sede');
    expect(r.request.params.get('page')).toBe('2');
    expect(r.request.params.get('size')).toBe('20');
    r.flush({});
  });

  it('omite busca vazia e respeita size informado', () => {
    service.list('HISTORICO', '  ', 0, 50).subscribe();
    const r = http.expectOne(req => req.url === base);
    expect(r.request.params.has('busca')).toBe(false);
    expect(r.request.params.get('situacao')).toBe('HISTORICO');
    expect(r.request.params.get('size')).toBe('50');
    r.flush({});
  });

  it('lê parametros', () => {
    service.parametros().subscribe();
    const r = http.expectOne(`${base}/parametros`); expect(r.request.method).toBe('GET'); r.flush({});
  });

  it('cria com o corpo recebido', () => {
    const req: CriarManutencaoRequest = { unidadeId: 1, escopo: MaintenanceScope.Equipment, equipamentoIds: [3, 4], inicioPrevisto: '2026-10-23T10:00:00Z', fimPrevisto: '2026-10-23T12:00:00Z', motivo: 'Troca de switch' };
    service.create(req).subscribe();
    const r = http.expectOne(base); expect(r.request.method).toBe('POST'); expect(r.request.body).toEqual(req); r.flush({});
  });

  it('cancela e encerra por PATCH', () => {
    service.cancel(5).subscribe();
    let r = http.expectOne(`${base}/5/cancelar`); expect(r.request.method).toBe('PATCH'); r.flush({});
    service.end(5).subscribe();
    r = http.expectOne(`${base}/5/encerrar`); expect(r.request.method).toBe('PATCH'); r.flush({});
  });
});
