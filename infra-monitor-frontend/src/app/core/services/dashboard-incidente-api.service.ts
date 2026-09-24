import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  DashboardIncidenteContadoresQuery,
  DashboardIncidenteContadoresResponse,
  DashboardIncidenteQuery,
  DashboardIncidenteResponse,
} from '../models/dashboard-incidente';
import { PageResponse } from '../models/page-response';

/**
 * Lista unificada de incidentes e episódios de latência. Serviço separado do
 * `IncidenteApiService` de propósito: aquele fala com `/incidentes`, que continua
 * existindo e continua devolvendo incidentes puros para o painel, a gaveta de
 * equipamento e as telas de unidade. Este fala com a composição de leitura do
 * dashboard, que junta as duas origens e nunca grava.
 */
@Injectable({ providedIn: 'root' })
export class DashboardIncidenteApiService {
  private readonly http = inject(HttpClient);
  private readonly endpoint = `${environment.apiUrl}/dashboard/incidentes`;

  list(query: DashboardIncidenteQuery = {}): Observable<PageResponse<DashboardIncidenteResponse>> {
    return this.http.get<PageResponse<DashboardIncidenteResponse>>(this.endpoint, { params: toParams(query) });
  }

  counters(query: DashboardIncidenteContadoresQuery = {}): Observable<DashboardIncidenteContadoresResponse> {
    return this.http.get<DashboardIncidenteContadoresResponse>(`${this.endpoint}/contadores`, { params: toParams(query) });
  }
}

function toParams(query: object): HttpParams {
  let params = new HttpParams();
  for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== null) params = params.set(key, String(value));
  return params;
}
