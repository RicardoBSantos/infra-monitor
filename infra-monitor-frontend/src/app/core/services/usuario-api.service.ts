import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { UsuarioCreateRequest, UsuarioListQuery, UsuarioResetSenhaRequest, UsuarioResponse, UsuarioUpdateRequest } from '../models/usuario';

@Injectable({ providedIn: 'root' })
export class UsuarioApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/usuarios`;

  list(_query?: UsuarioListQuery): Observable<UsuarioResponse[]> { return this.http.get<UsuarioResponse[]>(this.baseUrl); }
  getById(id: number): Observable<UsuarioResponse> { return this.http.get<UsuarioResponse>(`${this.baseUrl}/${id}`); }
  create(request: UsuarioCreateRequest): Observable<UsuarioResponse> { return this.http.post<UsuarioResponse>(this.baseUrl, request); }
  update(id: number, request: UsuarioUpdateRequest): Observable<UsuarioResponse> { return this.http.put<UsuarioResponse>(`${this.baseUrl}/${id}`, request); }
  ativar(id: number): Observable<UsuarioResponse> { return this.http.patch<UsuarioResponse>(`${this.baseUrl}/${id}/ativar`, {}); }
  desativar(id: number): Observable<UsuarioResponse> { return this.http.patch<UsuarioResponse>(`${this.baseUrl}/${id}/desativar`, {}); }
  resetSenha(id: number, request: UsuarioResetSenhaRequest): Observable<UsuarioResponse> { return this.http.put<UsuarioResponse>(`${this.baseUrl}/${id}/senha`, request); }
}
