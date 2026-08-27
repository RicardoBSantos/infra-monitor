import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { DashboardEquipamento, DashboardEquipamentosQuery, DashboardResumo, DashboardUnidade, DashboardUnidadeDetalhe } from '../models/dashboard';
import { PageResponse } from '../models/page-response';

@Injectable({ providedIn: 'root' })
export class DashboardApiService {
  private readonly http = inject(HttpClient);
  private readonly endpoint = `${environment.apiUrl}/dashboard`;
  getResumo(): Observable<DashboardResumo> { return this.http.get<DashboardResumo>(`${this.endpoint}/resumo`); }
  getUnidades(): Observable<DashboardUnidade[]> { return this.http.get<DashboardUnidade[]>(`${this.endpoint}/unidades`); }
  getUnidade(id: number): Observable<DashboardUnidadeDetalhe> { return this.http.get<DashboardUnidadeDetalhe>(`${this.endpoint}/unidades/${id}`); }
  getEquipamentosDaUnidade(id: number, query: DashboardEquipamentosQuery = {}): Observable<PageResponse<DashboardEquipamento>> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== null) params = params.set(key, String(value));
    return this.http.get<PageResponse<DashboardEquipamento>>(`${this.endpoint}/unidades/${id}/equipamentos`, { params });
  }
}
