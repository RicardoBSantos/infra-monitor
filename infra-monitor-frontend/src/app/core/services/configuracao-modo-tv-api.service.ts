import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AtualizarConfiguracaoModoTv, ConfiguracaoModoTv } from '../models/configuracao-modo-tv';

@Injectable({ providedIn: 'root' })
export class ConfiguracaoModoTvApiService {
  private readonly http = inject(HttpClient);
  private readonly endpoint = `${environment.apiUrl}/configuracoes/modo-tv`;
  obter(): Observable<ConfiguracaoModoTv> { return this.http.get<ConfiguracaoModoTv>(this.endpoint); }
  salvar(req: AtualizarConfiguracaoModoTv): Observable<ConfiguracaoModoTv> { return this.http.put<ConfiguracaoModoTv>(this.endpoint, req); }
}
