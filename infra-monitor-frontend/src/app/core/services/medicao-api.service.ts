import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { MedicaoListQuery, MedicaoResponse } from '../models/medicao';
import { PageResponse } from '../models/page-response';

@Injectable({ providedIn: 'root' })
export class MedicaoApiService {
  private readonly http = inject(HttpClient); private readonly endpoint = `${environment.apiUrl}/medicoes`;
  list(query: MedicaoListQuery = {}): Observable<PageResponse<MedicaoResponse>> { let params = new HttpParams(); for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== null) params = params.set(key, String(value)); return this.http.get<PageResponse<MedicaoResponse>>(this.endpoint, { params }); }
  getById(id: number): Observable<MedicaoResponse> { return this.http.get<MedicaoResponse>(`${this.endpoint}/${id}`); }
}
