import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { GeoMunicipioService, Municipio, divergenciaIbge, municipioDaCoordenada, pontoNoPoligono, ufDoCodigoIbge } from './geo-municipio.service';

const geoJson = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { id: '2800308', name: 'Aracaju' }, geometry: { type: 'Polygon', coordinates: [[[-37, -10], [-36.9, -10], [-36.9, -10.1], [-37, -10]]] } }, { type: 'Feature', properties: { id: '2800100', name: 'Amparo de São Francisco' }, geometry: { type: 'Polygon', coordinates: [[[-38, -10], [-37.9, -10], [-37.9, -10.1], [-38, -10]]] } }] };
describe('GeoMunicipioService', () => { let service: GeoMunicipioService; let http: HttpTestingController;
  beforeEach(() => { TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] }); service = TestBed.inject(GeoMunicipioService); http = TestBed.inject(HttpTestingController); }); afterEach(() => http.verify());
  it('loads once, extracts actual id/name properties and orders municipalities', () => { let first: string[] = []; let second: string[] = []; service.getMunicipios().subscribe(items => first = items.map(item => item.nome)); const request = http.expectOne('assets/maps/se-municipalities.geo.json'); request.flush(geoJson); service.getMunicipios().subscribe(items => second = items.map(item => item.codigoIbge)); expect(first).toEqual(['Amparo de São Francisco', 'Aracaju']); expect(second).toEqual(['2800100', '2800308']); });
  it('finds feature and municipality by normalized IBGE code and returns undefined for absent code', () => { let found = ''; let missing: unknown = 'pending'; service.findFeatureByCodigoIbge(' 2800308 ').subscribe(feature => found = feature?.properties.name ?? ''); const request = http.expectOne('assets/maps/se-municipalities.geo.json'); request.flush(geoJson); service.findMunicipioByCodigoIbge('9999999').subscribe(value => missing = value); expect(found).toBe('Aracaju'); expect(missing).toBeUndefined(); });
  it('derives the UF from the two-digit IBGE prefix so the form has a single geographic source', () => { let ufs: (string | null)[] = []; service.getMunicipios().subscribe(items => ufs = items.map(item => item.uf)); http.expectOne('assets/maps/se-municipalities.geo.json').flush(geoJson); expect(ufs).toEqual(['SE', 'SE']); expect(ufDoCodigoIbge('2927408')).toBe('BA'); expect(ufDoCodigoIbge('3550308')).toBe('SP'); expect(ufDoCodigoIbge('9999999')).toBeNull(); expect(ufDoCodigoIbge(null)).toBeNull(); });
});

const quadrado = (x0: number, y0: number, x1: number, y1: number) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
const mun = (codigoIbge: string, nome: string, geometry: { type: string; coordinates: unknown }): Municipio =>
  ({ codigoIbge, nome, uf: 'SE', feature: { type: 'Feature', properties: { id: codigoIbge, name: nome }, geometry } as never });
const itabaiana = mun('2802908', 'Itabaiana', { type: 'Polygon', coordinates: [quadrado(-38, -11, -37, -10)] });
const itabaianinha = mun('2803005', 'Itabaianinha', { type: 'Polygon', coordinates: [quadrado(-38, -12, -37, -11.001)] });
const comBuraco = mun('2800001', 'Anel', { type: 'Polygon', coordinates: [quadrado(-40, -12, -39, -11), quadrado(-39.6, -11.6, -39.4, -11.4)] });
const multi = mun('2800002', 'Ilhas', { type: 'MultiPolygon', coordinates: [[quadrado(-36, -10, -35.5, -9.5)], [quadrado(-35, -10, -34.5, -9.5)]] });
const todos = [itabaiana, itabaianinha, comBuraco, multi];

describe('pontoNoPoligono', () => {
  it('dentro e fora de Polygon', () => {
    expect(pontoNoPoligono([-37.5, -10.5], itabaiana.feature.geometry as never)).toBe(true);
    expect(pontoNoPoligono([-36.5, -10.5], itabaiana.feature.geometry as never)).toBe(false);
  });
  it('buraco não conta como dentro', () => {
    expect(pontoNoPoligono([-39.5, -11.5], comBuraco.feature.geometry as never)).toBe(false);
    expect(pontoNoPoligono([-39.9, -11.9], comBuraco.feature.geometry as never)).toBe(true);
  });
  it('MultiPolygon: qualquer parte', () => {
    expect(pontoNoPoligono([-34.7, -9.7], multi.feature.geometry as never)).toBe(true);
    expect(pontoNoPoligono([-35.2, -9.7], multi.feature.geometry as never)).toBe(false);
  });
});

describe('municipioDaCoordenada', () => {
  it('acha o município que contém o ponto', () => { expect(municipioDaCoordenada([-37.4256, -10.6853], todos)?.codigoIbge).toBe('2802908'); });
  it('fora de tudo devolve null', () => { expect(municipioDaCoordenada([0, 0], todos)).toBeNull(); });
});

describe('divergenciaIbge', () => {
  const ita09 = { codigoIbge: '2803005', latitude: -10.6853, longitude: -37.4256 };
  it('ITA-09: IBGE Itabaianinha, coordenada em Itabaiana', () => {
    expect(divergenciaIbge(ita09, todos)).toEqual({ codigoCadastro: '2803005', nomeCadastro: 'Itabaianinha', codigoCoordenada: '2802908', nomeCoordenada: 'Itabaiana' });
  });
  it('coerente devolve null', () => { expect(divergenciaIbge({ ...ita09, codigoIbge: '2802908' }, todos)).toBeNull(); });
  it('sem IBGE ou sem coordenada devolve null', () => {
    expect(divergenciaIbge({ ...ita09, codigoIbge: null }, todos)).toBeNull();
    expect(divergenciaIbge({ ...ita09, latitude: null }, todos)).toBeNull();
  });
  it('coordenada fora de SE devolve null', () => { expect(divergenciaIbge({ ...ita09, latitude: 0, longitude: 0 }, todos)).toBeNull(); });
  it('IBGE fora da cartografia: nome do cadastro null', () => {
    expect(divergenciaIbge({ ...ita09, codigoIbge: '9999999' }, todos)?.nomeCadastro).toBeNull();
  });
  it('IBGE com espaços é normalizado', () => { expect(divergenciaIbge({ ...ita09, codigoIbge: ' 2802908 ' }, todos)).toBeNull(); });
});

// Teste com o GeoJSON real (public/assets/maps/se-municipalities.geo.json) via `fs` não é possível:
// o builder @angular/build:unit-test empacota o spec para o bundle de browser (esbuild), sem `fs`/`path`/
// `__dirname` do Node, mesmo rodando sobre Vitest. Mantido só o teste sintético (ITA-09) acima.
