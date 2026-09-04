import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { CloseIncidenteRequest, IncidenteListQuery, IncidenteResponse } from '../models/incidente';
import { PageResponse } from '../models/page-response';

@Injectable({ providedIn: 'root' })
export class IncidenteApiService {
  private readonly http = inject(HttpClient); private readonly endpoint = `${environment.apiUrl}/incidentes`;
  list(query: IncidenteListQuery = {}): Observable<PageResponse<IncidenteResponse>> { let params = new HttpParams(); for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== null) params = params.set(key, String(value)); return this.http.get<PageResponse<IncidenteResponse>>(this.endpoint, { params }); }
  getById(id: number): Observable<IncidenteResponse> { return this.http.get<IncidenteResponse>(`${this.endpoint}/${id}`); }
  close(id: number, request: CloseIncidenteRequest): Observable<IncidenteResponse> { return this.http.patch<IncidenteResponse>(`${this.endpoint}/${id}/fechar`, request); }
  /** Sem corpo por contrato: quem reconheceu e quando saem do servidor, nunca do cliente. */
  acknowledge(id: number): Observable<IncidenteResponse> { return this.http.patch<IncidenteResponse>(`${this.endpoint}/${id}/reconhecer`, null); }
}
