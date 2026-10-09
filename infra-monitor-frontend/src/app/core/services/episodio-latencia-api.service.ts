import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { EpisodioLatenciaResponse } from '../models/episodio-latencia';

/**
 * Só leitura por id. O episódio não tem endpoint de lista próprio: quem lista é a
 * composição unificada em `/dashboard/incidentes`, e é de lá que esta tela é aberta.
 */
@Injectable({ providedIn: 'root' })
export class EpisodioLatenciaApiService {
  private readonly http = inject(HttpClient);
  private readonly endpoint = `${environment.apiUrl}/episodios-latencia`;

  getById(id: number): Observable<EpisodioLatenciaResponse> {
    return this.http.get<EpisodioLatenciaResponse>(`${this.endpoint}/${id}`);
  }
}
