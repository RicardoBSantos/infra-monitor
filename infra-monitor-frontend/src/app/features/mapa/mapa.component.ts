import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { take } from 'rxjs';

import { DashboardUnidade } from '../../core/models/dashboard';
import { GeoMunicipioService, Municipio, normalizeCodigoIbge } from '../../core/services/geo-municipio.service';
import { DashboardApiService } from '../../core/services/dashboard-api.service';
import { StatusBadgeComponent } from '../../shared/status-badge/status-badge.component';

type MapState = 'loading' | 'success' | 'empty' | 'error';
interface MapMunicipio extends Municipio { path: string; units: DashboardUnidade[]; }

@Component({ selector: 'app-mapa', imports: [StatusBadgeComponent], changeDetection: ChangeDetectionStrategy.OnPush, templateUrl: './mapa.component.html', styleUrl: './mapa.component.scss' })
export class MapaComponent {
  private readonly geoMunicipio = inject(GeoMunicipioService);
  private readonly dashboardApi = inject(DashboardApiService);
  private readonly router = inject(Router);
  protected readonly state = signal<MapState>('loading');
  protected readonly municipios = signal<MapMunicipio[]>([]);
  protected readonly selected = signal<MapMunicipio | null>(null);
  protected readonly semLocalizacao = signal<DashboardUnidade[]>([]);
  protected readonly semCorrespondencia = signal<DashboardUnidade[]>([]);
  protected readonly error = signal<string | null>(null);
  private sourceMunicipios: Municipio[] | null = null;
  private units: DashboardUnidade[] | null = null;

  constructor() { this.load(); }
  protected load(): void {
    this.state.set('loading'); this.error.set(null); this.selected.set(null); this.municipios.set([]); this.semLocalizacao.set([]); this.semCorrespondencia.set([]); this.sourceMunicipios = null; this.units = null;
    this.geoMunicipio.getMunicipios().pipe(take(1)).subscribe({ next: municipios => { this.sourceMunicipios = municipios; this.resolve(); }, error: () => this.fail('Erro ao carregar mapa: não foi possível carregar a cartografia de Sergipe.') });
    this.dashboardApi.getUnidades().pipe(take(1)).subscribe({ next: units => { this.units = units; this.resolve(); }, error: () => this.fail('Erro ao carregar dados operacionais: não foi possível consultar as unidades.') });
  }
  protected selectMunicipio(municipio: MapMunicipio): void { this.selected.set(municipio); }
  protected onMunicipioKeydown(event: KeyboardEvent, municipio: MapMunicipio): void { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); this.selectMunicipio(municipio); } }
  protected goToUnidades(): void { void this.router.navigate(['/unidades']); }
  protected pathTone(municipio: MapMunicipio): string {
    if (this.selected()?.codigoIbge === municipio.codigoIbge) return 'selected';
    if (municipio.units.length === 0) return 'none';
    if (municipio.units.length > 1) return 'multiple';
    return municipio.units[0].status.toLowerCase().replace(/_/g, '-');
  }
  private resolve(): void {
    if (!this.sourceMunicipios || !this.units || this.state() === 'error') return;
    const unitsByCodigo = new Map<string, DashboardUnidade[]>();
    const semLocalizacao: DashboardUnidade[] = [];
    for (const unit of this.units) {
      const codigo = normalizeCodigoIbge(unit.codigoIbge);
      if (!codigo) { semLocalizacao.push(unit); continue; }
      const group = unitsByCodigo.get(codigo) ?? []; group.push(unit); unitsByCodigo.set(codigo, group);
    }
    const codigosMapa = new Set(this.sourceMunicipios.map(municipio => municipio.codigoIbge));
    this.semLocalizacao.set(semLocalizacao);
    this.semCorrespondencia.set(this.units.filter(unit => !!normalizeCodigoIbge(unit.codigoIbge) && !codigosMapa.has(normalizeCodigoIbge(unit.codigoIbge))));
    const bounds = mapBounds(this.sourceMunicipios);
    this.municipios.set(this.sourceMunicipios.map(municipio => ({ ...municipio, path: toSvgPath(municipio.feature.geometry, bounds), units: unitsByCodigo.get(municipio.codigoIbge) ?? [] })));
    this.state.set(this.units.length === 0 ? 'empty' : 'success');
  }
  private fail(message: string): void { this.error.set(message); this.state.set('error'); }
}

interface Bounds { minLongitude: number; maxLongitude: number; minLatitude: number; maxLatitude: number; }
function mapBounds(municipios: Municipio[]): Bounds {
  const points = municipios.flatMap(municipio => (municipio.feature.geometry.type === 'Polygon' ? municipio.feature.geometry.coordinates : municipio.feature.geometry.coordinates.flat()).flat());
  return { minLongitude: Math.min(...points.map(([longitude]) => longitude)), maxLongitude: Math.max(...points.map(([longitude]) => longitude)), minLatitude: Math.min(...points.map(([, latitude]) => latitude)), maxLatitude: Math.max(...points.map(([, latitude]) => latitude)) };
}
function toSvgPath(geometry: import('../../core/services/geo-municipio.service').GeoJsonGeometry, bounds: Bounds): string {
  const rings = geometry.type === 'Polygon' ? geometry.coordinates : geometry.coordinates.flat();
  const width = 760, height = 680, padding = 26;
  const scale = Math.min((width - padding * 2) / (bounds.maxLongitude - bounds.minLongitude), (height - padding * 2) / (bounds.maxLatitude - bounds.minLatitude));
  const offsetX = (width - (bounds.maxLongitude - bounds.minLongitude) * scale) / 2, offsetY = (height - (bounds.maxLatitude - bounds.minLatitude) * scale) / 2;
  return rings.map(ring => ring.map(([longitude, latitude], index) => `${index ? 'L' : 'M'}${(offsetX + (longitude - bounds.minLongitude) * scale).toFixed(2)} ${(offsetY + (bounds.maxLatitude - latitude) * scale).toFixed(2)}`).join(' ') + ' Z').join(' ');
}
