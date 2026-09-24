import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { DashboardApiService } from './dashboard-api.service';

describe('DashboardApiService', () => {
  let service: DashboardApiService;
  let httpTesting: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(DashboardApiService);
    httpTesting = TestBed.inject(HttpTestingController);
  });
  afterEach(() => httpTesting.verify());

  it('requests the operational summary', () => {
    service.getResumo().subscribe();
    httpTesting.expectOne('http://localhost:8080/api/v1/dashboard/resumo').flush({});
  });
  it('requests the operational units', () => {
    service.getUnidades().subscribe();
    httpTesting.expectOne('http://localhost:8080/api/v1/dashboard/unidades').flush([]);
  });
  it('requests one operational unit', () => {
    service.getUnidade(42).subscribe();
    httpTesting.expectOne('http://localhost:8080/api/v1/dashboard/unidades/42').flush({});
  });
  it('uses backend pagination, filtering and sorting for unit equipment', () => {
    service.getEquipamentosDaUnidade(42, { page: 2, size: 25, sort: 'nome', tipoEquipamentoId: 7, ativo: true }).subscribe();
    const request = httpTesting.expectOne((candidate) => candidate.url === 'http://localhost:8080/api/v1/dashboard/unidades/42/equipamentos');
    expect(request.request.params.get('page')).toBe('2'); expect(request.request.params.get('size')).toBe('25'); expect(request.request.params.get('sort')).toBe('nome'); expect(request.request.params.get('tipoEquipamentoId')).toBe('7'); expect(request.request.params.get('ativo')).toBe('true');
    request.flush({ content: [], page: 2, size: 25, totalElements: 0, totalPages: 0, first: false, last: true });
  });
});
