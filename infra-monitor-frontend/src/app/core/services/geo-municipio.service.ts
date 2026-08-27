import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map, shareReplay } from 'rxjs';

export type GeoJsonGeometry = { type: 'Polygon'; coordinates: number[][][]; } | { type: 'MultiPolygon'; coordinates: number[][][][]; };
export interface GeoMunicipioFeature { type: 'Feature'; properties: { id: string; name: string }; geometry: GeoJsonGeometry; }
interface GeoJsonFeatureCollection { type: 'FeatureCollection'; features: GeoMunicipioFeature[]; }
export interface Municipio { codigoIbge: string; nome: string; feature: GeoMunicipioFeature; }

@Injectable({ providedIn: 'root' })
export class GeoMunicipioService {
  private readonly http = inject(HttpClient);
  private readonly municipios$ = this.http.get<GeoJsonFeatureCollection>('assets/maps/se-municipalities.geo.json').pipe(
    map(collection => collection.features.map(feature => ({ codigoIbge: normalizeCodigoIbge(feature.properties.id), nome: feature.properties.name, feature }))
      .sort((left, right) => left.nome.localeCompare(right.nome, 'pt-BR'))),
    shareReplay({ bufferSize: 1, refCount: false }),
  );

  getMunicipios(): Observable<Municipio[]> { return this.municipios$; }
  loadGeoJson(): Observable<GeoMunicipioFeature[]> { return this.municipios$.pipe(map(municipios => municipios.map(municipio => municipio.feature))); }
  findMunicipioByCodigoIbge(codigoIbge: string | null): Observable<Municipio | undefined> { return this.municipios$.pipe(map(municipios => municipios.find(municipio => municipio.codigoIbge === normalizeCodigoIbge(codigoIbge)))); }
  findFeatureByCodigoIbge(codigoIbge: string | null): Observable<GeoMunicipioFeature | undefined> { return this.findMunicipioByCodigoIbge(codigoIbge).pipe(map(municipio => municipio?.feature)); }
}

export function normalizeCodigoIbge(codigoIbge: string | null | undefined): string { return codigoIbge?.trim() ?? ''; }
