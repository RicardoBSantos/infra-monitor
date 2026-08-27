import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { GeoMunicipioService } from './geo-municipio.service';

const geoJson = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { id: '2800308', name: 'Aracaju' }, geometry: { type: 'Polygon', coordinates: [[[-37, -10], [-36.9, -10], [-36.9, -10.1], [-37, -10]]] } }, { type: 'Feature', properties: { id: '2800100', name: 'Amparo de São Francisco' }, geometry: { type: 'Polygon', coordinates: [[[-38, -10], [-37.9, -10], [-37.9, -10.1], [-38, -10]]] } }] };
describe('GeoMunicipioService', () => { let service: GeoMunicipioService; let http: HttpTestingController;
  beforeEach(() => { TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] }); service = TestBed.inject(GeoMunicipioService); http = TestBed.inject(HttpTestingController); }); afterEach(() => http.verify());
  it('loads once, extracts actual id/name properties and orders municipalities', () => { let first: string[] = []; let second: string[] = []; service.getMunicipios().subscribe(items => first = items.map(item => item.nome)); const request = http.expectOne('assets/maps/se-municipalities.geo.json'); request.flush(geoJson); service.getMunicipios().subscribe(items => second = items.map(item => item.codigoIbge)); expect(first).toEqual(['Amparo de São Francisco', 'Aracaju']); expect(second).toEqual(['2800100', '2800308']); });
  it('finds feature and municipality by normalized IBGE code and returns undefined for absent code', () => { let found = ''; let missing: unknown = 'pending'; service.findFeatureByCodigoIbge(' 2800308 ').subscribe(feature => found = feature?.properties.name ?? ''); const request = http.expectOne('assets/maps/se-municipalities.geo.json'); request.flush(geoJson); service.findMunicipioByCodigoIbge('9999999').subscribe(value => missing = value); expect(found).toBe('Aracaju'); expect(missing).toBeUndefined(); });
});
