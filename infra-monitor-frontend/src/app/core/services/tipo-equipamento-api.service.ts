import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { TipoEquipamentoCreateRequest, TipoEquipamentoResponse, TipoEquipamentoUpdateRequest } from '../models/tipo-equipamento';

@Injectable({ providedIn: 'root' })
export class TipoEquipamentoApiService {
  private readonly http = inject(HttpClient); private readonly endpoint = `${environment.apiUrl}/tipos-equipamento`;
  list(ativo?: boolean): Observable<TipoEquipamentoResponse[]> { const params = ativo === undefined ? undefined : new HttpParams().set('ativo', ativo); return this.http.get<TipoEquipamentoResponse[]>(this.endpoint, { params }); }
  getById(id: number): Observable<TipoEquipamentoResponse> { return this.http.get<TipoEquipamentoResponse>(`${this.endpoint}/${id}`); }
  create(request: TipoEquipamentoCreateRequest): Observable<TipoEquipamentoResponse> { return this.http.post<TipoEquipamentoResponse>(this.endpoint, request); }
  update(id: number, request: TipoEquipamentoUpdateRequest): Observable<TipoEquipamentoResponse> { return this.http.put<TipoEquipamentoResponse>(`${this.endpoint}/${id}`, request); }
  activate(id: number): Observable<TipoEquipamentoResponse> { return this.http.patch<TipoEquipamentoResponse>(`${this.endpoint}/${id}/ativar`, {}); }
  deactivate(id: number): Observable<TipoEquipamentoResponse> { return this.http.patch<TipoEquipamentoResponse>(`${this.endpoint}/${id}/desativar`, {}); }
  delete(id: number): Observable<void> { return this.http.delete<void>(`${this.endpoint}/${id}`); }
}
