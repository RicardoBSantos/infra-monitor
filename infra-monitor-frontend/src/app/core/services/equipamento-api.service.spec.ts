import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { EquipamentoApiService } from './equipamento-api.service';

describe('EquipamentoApiService', () => {
  let service: EquipamentoApiService; let http: HttpTestingController;
  const body={unidadeId:1,tipoEquipamentoId:2,nome:'SW-01',ip:'10.0.0.1',hostname:null,descricao:null,localizacao:'CPD',numeroSerie:null};
  beforeEach(()=>{TestBed.configureTestingModule({providers:[provideHttpClient(),provideHttpClientTesting()]});service=TestBed.inject(EquipamentoApiService);http=TestBed.inject(HttpTestingController);}); afterEach(()=>http.verify());
  it('sends supported pagination, sort and filters',()=>{service.list().subscribe();let r=http.expectOne('http://localhost:8080/api/v1/equipamentos');expect(r.request.method).toBe('GET');r.flush({});service.list({page:2,size:50,sort:'nome,desc',unidadeId:1,tipoEquipamentoId:2,ativo:false}).subscribe();r=http.expectOne(x=>x.url.endsWith('/equipamentos'));expect(r.request.params.keys()).toEqual(['page','size','sort','unidadeId','tipoEquipamentoId','ativo']);expect(r.request.params.get('page')).toBe('2');expect(r.request.params.get('sort')).toBe('nome,desc');expect(r.request.params.get('ativo')).toBe('false');r.flush({});});
  it('uses each resource endpoint and method',()=>{service.getById(3).subscribe();http.expectOne('http://localhost:8080/api/v1/equipamentos/3').flush({});service.create(body).subscribe();let r=http.expectOne('http://localhost:8080/api/v1/equipamentos');expect(r.request.method).toBe('POST');expect(r.request.body).toEqual(body);r.flush({});service.update(3,body).subscribe();r=http.expectOne('http://localhost:8080/api/v1/equipamentos/3');expect(r.request.method).toBe('PUT');expect(r.request.body).toEqual(body);r.flush({});service.activate(3).subscribe();expect(http.expectOne('http://localhost:8080/api/v1/equipamentos/3/ativar').request.method).toBe('PATCH');service.deactivate(3).subscribe();expect(http.expectOne('http://localhost:8080/api/v1/equipamentos/3/desativar').request.method).toBe('PATCH');service.delete(3).subscribe();expect(http.expectOne('http://localhost:8080/api/v1/equipamentos/3').request.method).toBe('DELETE');});
});
