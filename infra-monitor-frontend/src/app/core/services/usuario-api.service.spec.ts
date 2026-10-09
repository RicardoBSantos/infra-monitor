import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { UsuarioApiService } from './usuario-api.service';

describe('UsuarioApiService', () => {
  let service: UsuarioApiService; let http: HttpTestingController;
  beforeEach(() => { TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] }); service = TestBed.inject(UsuarioApiService); http = TestBed.inject(HttpTestingController); });
  afterEach(() => http.verify());
  it('uses the real administrative endpoints and DTOs', () => {
    service.list().subscribe(); let request = http.expectOne('http://localhost:8080/api/v1/usuarios'); expect(request.request.method).toBe('GET'); request.flush([]);
    service.getById(7).subscribe(); request = http.expectOne('http://localhost:8080/api/v1/usuarios/7'); expect(request.request.method).toBe('GET'); request.flush({});
    const create = { nome: 'Ana', email: 'ana@test.dev', papel: 'OPERADOR' as const, senhaInicial: 'senha-temporaria-12' }; service.create(create).subscribe(); request = http.expectOne('http://localhost:8080/api/v1/usuarios'); expect(request.request.method).toBe('POST'); expect(request.request.body).toEqual(create); request.flush({});
    const update = { nome: 'Ana', email: 'ana@test.dev', papel: 'VISUALIZADOR' as const }; service.update(7, update).subscribe(); request = http.expectOne('http://localhost:8080/api/v1/usuarios/7'); expect(request.request.method).toBe('PUT'); expect(request.request.body).toEqual(update); request.flush({});
    service.ativar(7).subscribe(); request = http.expectOne('http://localhost:8080/api/v1/usuarios/7/ativar'); expect(request.request.method).toBe('PATCH'); request.flush({});
    service.desativar(7).subscribe(); request = http.expectOne('http://localhost:8080/api/v1/usuarios/7/desativar'); expect(request.request.method).toBe('PATCH'); request.flush({});
    service.resetSenha(7, { novaSenha: 'nova-senha-temporaria' }).subscribe(); request = http.expectOne('http://localhost:8080/api/v1/usuarios/7/senha'); expect(request.request.method).toBe('PUT'); expect(request.request.body).toEqual({ novaSenha: 'nova-senha-temporaria' }); request.flush({});
  });
});
