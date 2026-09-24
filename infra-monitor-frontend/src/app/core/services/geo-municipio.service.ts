import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map, shareReplay } from 'rxjs';

export type GeoJsonGeometry = { type: 'Polygon'; coordinates: number[][][]; } | { type: 'MultiPolygon'; coordinates: number[][][][]; };
export interface GeoMunicipioFeature { type: 'Feature'; properties: { id: string; name: string }; geometry: GeoJsonGeometry; }
interface GeoJsonFeatureCollection { type: 'FeatureCollection'; features: GeoMunicipioFeature[]; }
export interface Municipio { codigoIbge: string; nome: string; uf: string | null; feature: GeoMunicipioFeature; }

/* Os dois primeiros dígitos do código IBGE identificam a UF. Derivar daqui evita
   um segundo campo geográfico editável divergindo do município escolhido. */
const UF_POR_PREFIXO_IBGE: Record<string, string> = {
  '11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA', '16': 'AP', '17': 'TO',
  '21': 'MA', '22': 'PI', '23': 'CE', '24': 'RN', '25': 'PB', '26': 'PE', '27': 'AL', '28': 'SE', '29': 'BA',
  '31': 'MG', '32': 'ES', '33': 'RJ', '35': 'SP',
  '41': 'PR', '42': 'SC', '43': 'RS',
  '50': 'MS', '51': 'MT', '52': 'GO', '53': 'DF',
};

/** UF do município, ou null quando o código não tem o formato esperado. */
export function ufDoCodigoIbge(codigoIbge: string | null | undefined): string | null {
  const codigo = normalizeCodigoIbge(codigoIbge);
  return codigo.length === 7 ? UF_POR_PREFIXO_IBGE[codigo.slice(0, 2)] ?? null : null;
}

@Injectable({ providedIn: 'root' })
export class GeoMunicipioService {
  private readonly http = inject(HttpClient);
  private readonly municipios$ = this.http.get<GeoJsonFeatureCollection>('assets/maps/se-municipalities.geo.json').pipe(
    map(collection => collection.features.map(feature => ({ codigoIbge: normalizeCodigoIbge(feature.properties.id), nome: feature.properties.name, uf: ufDoCodigoIbge(feature.properties.id), feature }))
      .sort((left, right) => left.nome.localeCompare(right.nome, 'pt-BR'))),
    shareReplay({ bufferSize: 1, refCount: false }),
  );

  getMunicipios(): Observable<Municipio[]> { return this.municipios$; }
  loadGeoJson(): Observable<GeoMunicipioFeature[]> { return this.municipios$.pipe(map(municipios => municipios.map(municipio => municipio.feature))); }
  findMunicipioByCodigoIbge(codigoIbge: string | null): Observable<Municipio | undefined> { return this.municipios$.pipe(map(municipios => municipios.find(municipio => municipio.codigoIbge === normalizeCodigoIbge(codigoIbge)))); }
  findFeatureByCodigoIbge(codigoIbge: string | null): Observable<GeoMunicipioFeature | undefined> { return this.findMunicipioByCodigoIbge(codigoIbge).pipe(map(municipio => municipio?.feature)); }
}

export function normalizeCodigoIbge(codigoIbge: string | null | undefined): string { return codigoIbge?.trim() ?? ''; }
