import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { EquipamentoCreateRequest, EquipamentoListQuery, EquipamentoResponse, EquipamentoUpdateRequest, ManutencaoManualResponse } from '../models/equipamento';
import { PageResponse } from '../models/page-response';

@Injectable({ providedIn: 'root' })
export class EquipamentoApiService {
  private readonly http = inject(HttpClient); private readonly endpoint = `${environment.apiUrl}/equipamentos`;
  list(query: EquipamentoListQuery = {}): Observable<PageResponse<EquipamentoResponse>> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== null) params = params.set(key, String(value));
    return this.http.get<PageResponse<EquipamentoResponse>>(this.endpoint, { params });
  }
  getById(id: number): Observable<EquipamentoResponse> { return this.http.get<EquipamentoResponse>(`${this.endpoint}/${id}`); }
  create(request: EquipamentoCreateRequest): Observable<EquipamentoResponse> { return this.http.post<EquipamentoResponse>(this.endpoint, request); }
  update(id: number, request: EquipamentoUpdateRequest): Observable<EquipamentoResponse> { return this.http.put<EquipamentoResponse>(`${this.endpoint}/${id}`, request); }
  activate(id: number): Observable<EquipamentoResponse> { return this.http.patch<EquipamentoResponse>(`${this.endpoint}/${id}/ativar`, {}); }
  deactivate(id: number): Observable<EquipamentoResponse> { return this.http.patch<EquipamentoResponse>(`${this.endpoint}/${id}/desativar`, {}); }
  startMaintenance(id: number): Observable<EquipamentoResponse> { return this.http.patch<EquipamentoResponse>(`${this.endpoint}/${id}/manutencao/iniciar`, {}); }
  endMaintenance(id: number): Observable<EquipamentoResponse> { return this.http.patch<EquipamentoResponse>(`${this.endpoint}/${id}/manutencao/encerrar`, {}); }
  /** Últimas sessões do botão manual, mais recente primeiro. */
  historicoManutencaoManual(id: number, size = 5): Observable<PageResponse<ManutencaoManualResponse>> { return this.http.get<PageResponse<ManutencaoManualResponse>>(`${this.endpoint}/${id}/manutencoes-manuais`, { params: new HttpParams().set('page', 0).set('size', size) }); }
  delete(id: number): Observable<void> { return this.http.delete<void>(`${this.endpoint}/${id}`); }
}
