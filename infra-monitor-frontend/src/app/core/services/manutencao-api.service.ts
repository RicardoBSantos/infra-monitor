import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { CriarManutencaoRequest, FiltroManutencao, ManutencaoResponse, ParametrosManutencao } from '../models/manutencao';
import { PageResponse } from '../models/page-response';

@Injectable({ providedIn: 'root' })
export class ManutencaoApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/manutencoes`;

  list(filtro: FiltroManutencao, busca: string, page: number, size = 20): Observable<PageResponse<ManutencaoResponse>> {
    let params = new HttpParams().set('situacao', filtro).set('page', page).set('size', size);
    const termo = busca.trim();
    if (termo) { params = params.set('busca', termo); }
    return this.http.get<PageResponse<ManutencaoResponse>>(this.baseUrl, { params });
  }
  parametros(): Observable<ParametrosManutencao> { return this.http.get<ParametrosManutencao>(`${this.baseUrl}/parametros`); }
  create(req: CriarManutencaoRequest): Observable<ManutencaoResponse> { return this.http.post<ManutencaoResponse>(this.baseUrl, req); }
  cancel(id: number): Observable<ManutencaoResponse> { return this.http.patch<ManutencaoResponse>(`${this.baseUrl}/${id}/cancelar`, {}); }
  end(id: number): Observable<ManutencaoResponse> { return this.http.patch<ManutencaoResponse>(`${this.baseUrl}/${id}/encerrar`, {}); }
}
