import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MonitorType } from '../models/api-enums';
import { MonitorApiService } from './monitor-api.service';

describe('MonitorApiService', () => {
  let service: MonitorApiService; let http: HttpTestingController;
  const body={equipamentoId:10,tipo:MonitorType.Icmp,nome:'ICMP principal',intervaloSegundos:60,timeoutMs:2000,falhasParaIncidente:3,sucessosParaRecovery:2};
  beforeEach(()=>{TestBed.configureTestingModule({providers:[provideHttpClient(),provideHttpClientTesting()]});service=TestBed.inject(MonitorApiService);http=TestBed.inject(HttpTestingController);}); afterEach(()=>http.verify());
  it('sends default and combined supported list query parameters',()=>{service.list().subscribe();let r=http.expectOne('http://localhost:8080/api/v1/monitores');expect(r.request.method).toBe('GET');r.flush({});service.list({page:2,size:50,sort:'timeoutMs,desc',equipamentoId:10,tipo:MonitorType.Icmp,ativo:false}).subscribe();r=http.expectOne(x=>x.url.endsWith('/monitores'));expect(r.request.params.keys()).toEqual(['page','size','sort','equipamentoId','tipo','ativo']);expect(r.request.params.get('page')).toBe('2');expect(r.request.params.get('size')).toBe('50');expect(r.request.params.get('sort')).toBe('timeoutMs,desc');expect(r.request.params.get('equipamentoId')).toBe('10');expect(r.request.params.get('tipo')).toBe('ICMP');expect(r.request.params.get('ativo')).toBe('false');r.flush({});});
  it('uses all monitor resource methods and payloads',()=>{service.getById(3).subscribe();http.expectOne('http://localhost:8080/api/v1/monitores/3').flush({});service.create(body).subscribe();let r=http.expectOne('http://localhost:8080/api/v1/monitores');expect(r.request.method).toBe('POST');expect(r.request.body).toEqual(body);r.flush({});service.update(3,body).subscribe();r=http.expectOne('http://localhost:8080/api/v1/monitores/3');expect(r.request.method).toBe('PUT');expect(r.request.body).toEqual(body);r.flush({});service.activate(3).subscribe();expect(http.expectOne('http://localhost:8080/api/v1/monitores/3/ativar').request.method).toBe('PATCH');service.deactivate(3).subscribe();expect(http.expectOne('http://localhost:8080/api/v1/monitores/3/desativar').request.method).toBe('PATCH');service.delete(3).subscribe();expect(http.expectOne('http://localhost:8080/api/v1/monitores/3').request.method).toBe('DELETE');});
});
