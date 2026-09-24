import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { UnidadeConexaoRequest, UnidadeCreateRequest, UnidadeResponse, UnidadeUpdateRequest } from '../models/unidade';

@Injectable({ providedIn: 'root' })
export class UnidadeApiService {
  private readonly http = inject(HttpClient); private readonly endpoint = `${environment.apiUrl}/unidades`;
  list(ativo?: boolean): Observable<UnidadeResponse[]> { const params = ativo === undefined ? undefined : new HttpParams().set('ativo', ativo); return this.http.get<UnidadeResponse[]>(this.endpoint, { params }); }
  getById(id: number): Observable<UnidadeResponse> { return this.http.get<UnidadeResponse>(`${this.endpoint}/${id}`); }
  create(request: UnidadeCreateRequest): Observable<UnidadeResponse> { return this.http.post<UnidadeResponse>(this.endpoint, request); }
  update(id: number, request: UnidadeUpdateRequest): Observable<UnidadeResponse> { return this.http.put<UnidadeResponse>(`${this.endpoint}/${id}`, request); }
  activate(id: number): Observable<UnidadeResponse> { return this.http.patch<UnidadeResponse>(`${this.endpoint}/${id}/ativar`, {}); }
  deactivate(id: number): Observable<UnidadeResponse> { return this.http.patch<UnidadeResponse>(`${this.endpoint}/${id}/desativar`, {}); }
  delete(id: number): Observable<void> { return this.http.delete<void>(`${this.endpoint}/${id}`); }
  setConexao(id: number, conectaAUnidadeId: number): Observable<UnidadeResponse> { return this.http.put<UnidadeResponse>(`${this.endpoint}/${id}/conexao`, { conectaAUnidadeId } satisfies UnidadeConexaoRequest); }
  clearConexao(id: number): Observable<UnidadeResponse> { return this.http.delete<UnidadeResponse>(`${this.endpoint}/${id}/conexao`); }
}
