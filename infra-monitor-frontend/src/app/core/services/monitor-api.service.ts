import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { MonitorCreateRequest, MonitorListQuery, MonitorResponse, MonitorUpdateRequest } from '../models/monitor';
import { PageResponse } from '../models/page-response';

@Injectable({ providedIn: 'root' })
export class MonitorApiService {
  private readonly http = inject(HttpClient);
  private readonly endpoint = `${environment.apiUrl}/monitores`;

  list(query: MonitorListQuery = {}): Observable<PageResponse<MonitorResponse>> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== null) params = params.set(key, String(value));
    return this.http.get<PageResponse<MonitorResponse>>(this.endpoint, { params });
  }
  getById(id: number): Observable<MonitorResponse> { return this.http.get<MonitorResponse>(`${this.endpoint}/${id}`); }
  create(request: MonitorCreateRequest): Observable<MonitorResponse> { return this.http.post<MonitorResponse>(this.endpoint, request); }
  update(id: number, request: MonitorUpdateRequest): Observable<MonitorResponse> { return this.http.put<MonitorResponse>(`${this.endpoint}/${id}`, request); }
  activate(id: number): Observable<MonitorResponse> { return this.http.patch<MonitorResponse>(`${this.endpoint}/${id}/ativar`, {}); }
  deactivate(id: number): Observable<MonitorResponse> { return this.http.patch<MonitorResponse>(`${this.endpoint}/${id}/desativar`, {}); }
  delete(id: number): Observable<void> { return this.http.delete<void>(`${this.endpoint}/${id}`); }
}
