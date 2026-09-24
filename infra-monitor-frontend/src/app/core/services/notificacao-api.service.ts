import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { NotificacaoListQuery, NotificacaoResponse } from '../models/notificacao';
import { PageResponse } from '../models/page-response';

@Injectable({ providedIn: 'root' })
export class NotificacaoApiService {
  private readonly http = inject(HttpClient); private readonly endpoint = `${environment.apiUrl}/notificacoes`;
  list(query: NotificacaoListQuery = {}): Observable<PageResponse<NotificacaoResponse>> { let params = new HttpParams(); for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== null) params = params.set(key, String(value)); return this.http.get<PageResponse<NotificacaoResponse>>(this.endpoint, { params }); }
  getById(id: number): Observable<NotificacaoResponse> { return this.http.get<NotificacaoResponse>(`${this.endpoint}/${id}`); }
}
