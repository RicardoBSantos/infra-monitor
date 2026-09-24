import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { TelegramConfiguracao, TelegramTesteResultado } from '../models/telegram-config';

@Injectable({ providedIn: 'root' })
export class TelegramConfigApiService {
  private readonly http = inject(HttpClient); private readonly endpoint = `${environment.apiUrl}/notificacoes/telegram`;
  configuracao(): Observable<TelegramConfiguracao> { return this.http.get<TelegramConfiguracao>(`${this.endpoint}/configuracao`); }
  testar(): Observable<TelegramTesteResultado> { return this.http.post<TelegramTesteResultado>(`${this.endpoint}/teste`, {}); }
}
