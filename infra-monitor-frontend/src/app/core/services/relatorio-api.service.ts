import { HttpClient, HttpParams, HttpResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../../environments/environment';
import { PageResponse } from '../models/page-response';
import {
  DisponibilidadeEquipamentoResponse,
  DisponibilidadeEquipamentosExportQuery,
  DisponibilidadeEquipamentosQuery,
  DisponibilidadeUnidadeResponse,
  DisponibilidadeUnidadesExportQuery,
  DisponibilidadeUnidadesQuery,
  HistoricoIncidenteResponse,
  HistoricoIncidentesExportQuery,
  HistoricoIncidentesQuery,
  HistoricoMedicaoResponse,
  HistoricoMedicoesExportQuery,
  HistoricoMedicoesQuery,
  HistoricoNotificacaoResponse,
  HistoricoNotificacoesExportQuery,
  HistoricoNotificacoesQuery,
  LatenciaIcmpQuery,
  LatenciaIcmpExportQuery,
  LatenciaIcmpResponse,
  LatenciaUnidadeResponse,
  LatenciaUnidadesQuery,
  ReportSort,
} from '../models/relatorio';

type ParamValue = string | number | null | undefined;
interface ReportParam { key: string; value: ParamValue; }

/** Serializes only meaningful query values, preserving valid numeric zeroes. */
export function buildReportHttpParams(values: readonly ReportParam[]): HttpParams {
  return values.reduce((params, { key, value }) => value === undefined || value === null || value === '' ? params : params.set(key, String(value)), new HttpParams());
}

function sortValue<Field extends string>(sort: ReportSort<Field> | undefined): string | undefined {
  return sort ? `${sort.field},${sort.direction}` : undefined;
}

@Injectable({ providedIn: 'root' })
export class RelatorioApiService {
  private readonly http = inject(HttpClient);
  private readonly endpoint = `${environment.apiUrl}/relatorios`;

  getDisponibilidadeEquipamentos(query: DisponibilidadeEquipamentosQuery): Observable<PageResponse<DisponibilidadeEquipamentoResponse>> {
    return this.http.get<PageResponse<DisponibilidadeEquipamentoResponse>>(`${this.endpoint}/disponibilidade/equipamentos`, { params: buildReportHttpParams([...this.periodAndPage(query), { key: 'unidadeId', value: query.unidadeId }, { key: 'equipamentoId', value: query.equipamentoId }, { key: 'monitorId', value: query.monitorId }, { key: 'tipoEquipamentoId', value: query.tipoEquipamentoId }]) });
  }

  getDisponibilidadeUnidades(query: DisponibilidadeUnidadesQuery): Observable<PageResponse<DisponibilidadeUnidadeResponse>> {
    return this.http.get<PageResponse<DisponibilidadeUnidadeResponse>>(`${this.endpoint}/disponibilidade/unidades`, { params: buildReportHttpParams([...this.periodAndPage(query), { key: 'unidadeId', value: query.unidadeId }]) });
  }

  getIncidentes(query: HistoricoIncidentesQuery): Observable<PageResponse<HistoricoIncidenteResponse>> {
    return this.http.get<PageResponse<HistoricoIncidenteResponse>>(`${this.endpoint}/incidentes`, { params: buildReportHttpParams([...this.periodAndPage(query), { key: 'unidadeId', value: query.unidadeId }, { key: 'equipamentoId', value: query.equipamentoId }, { key: 'monitorId', value: query.monitorId }, { key: 'status', value: query.status }]) });
  }

  getMedicoes(query: HistoricoMedicoesQuery): Observable<PageResponse<HistoricoMedicaoResponse>> {
    return this.http.get<PageResponse<HistoricoMedicaoResponse>>(`${this.endpoint}/medicoes`, { params: buildReportHttpParams([...this.periodAndPage(query), { key: 'unidadeId', value: query.unidadeId }, { key: 'equipamentoId', value: query.equipamentoId }, { key: 'monitorId', value: query.monitorId }, { key: 'status', value: query.status }]) });
  }

  getLatencia(query: LatenciaIcmpQuery): Observable<PageResponse<LatenciaIcmpResponse>> {
    return this.http.get<PageResponse<LatenciaIcmpResponse>>(`${this.endpoint}/latencia`, { params: buildReportHttpParams([...this.periodAndPage(query), { key: 'unidadeId', value: query.unidadeId }, { key: 'equipamentoId', value: query.equipamentoId }, { key: 'monitorId', value: query.monitorId }]) });
  }

  /** Agregacao por unidade feita no backend; o endpoint por monitor continua intacto. */
  getLatenciaUnidades(query: LatenciaUnidadesQuery): Observable<PageResponse<LatenciaUnidadeResponse>> {
    return this.http.get<PageResponse<LatenciaUnidadeResponse>>(`${this.endpoint}/latencia/unidades`, { params: buildReportHttpParams([...this.periodAndPage(query), { key: 'unidadeId', value: query.unidadeId }]) });
  }

  getNotificacoes(query: HistoricoNotificacoesQuery): Observable<PageResponse<HistoricoNotificacaoResponse>> {
    return this.http.get<PageResponse<HistoricoNotificacaoResponse>>(`${this.endpoint}/notificacoes`, { params: buildReportHttpParams([...this.periodAndPage(query), { key: 'incidenteId', value: query.incidenteId }, { key: 'status', value: query.status }, { key: 'canal', value: query.canal }, { key: 'tipoEvento', value: query.tipoEvento }]) });
  }

  exportDisponibilidadeEquipamentos(query: DisponibilidadeEquipamentosExportQuery): Observable<HttpResponse<Blob>> {
    return this.export(`${this.endpoint}/disponibilidade/equipamentos/export`, query, [
      { key: 'unidadeId', value: query.unidadeId }, { key: 'equipamentoId', value: query.equipamentoId },
      { key: 'monitorId', value: query.monitorId }, { key: 'tipoEquipamentoId', value: query.tipoEquipamentoId },
    ]);
  }

  exportDisponibilidadeUnidades(query: DisponibilidadeUnidadesExportQuery): Observable<HttpResponse<Blob>> {
    return this.export(`${this.endpoint}/disponibilidade/unidades/export`, query, [{ key: 'unidadeId', value: query.unidadeId }]);
  }

  exportIncidentes(query: HistoricoIncidentesExportQuery): Observable<HttpResponse<Blob>> {
    return this.export(`${this.endpoint}/incidentes/export`, query, [
      { key: 'unidadeId', value: query.unidadeId }, { key: 'equipamentoId', value: query.equipamentoId },
      { key: 'monitorId', value: query.monitorId }, { key: 'status', value: query.status },
    ]);
  }

  exportMedicoes(query: HistoricoMedicoesExportQuery): Observable<HttpResponse<Blob>> {
    return this.export(`${this.endpoint}/medicoes/export`, query, [
      { key: 'unidadeId', value: query.unidadeId }, { key: 'equipamentoId', value: query.equipamentoId },
      { key: 'monitorId', value: query.monitorId }, { key: 'status', value: query.status },
    ]);
  }

  exportLatencia(query: LatenciaIcmpExportQuery): Observable<HttpResponse<Blob>> {
    return this.export(`${this.endpoint}/latencia/export`, query, [
      { key: 'unidadeId', value: query.unidadeId }, { key: 'equipamentoId', value: query.equipamentoId }, { key: 'monitorId', value: query.monitorId },
    ]);
  }

  exportNotificacoes(query: HistoricoNotificacoesExportQuery): Observable<HttpResponse<Blob>> {
    return this.export(`${this.endpoint}/notificacoes/export`, query, [
      { key: 'incidenteId', value: query.incidenteId }, { key: 'status', value: query.status },
      { key: 'canal', value: query.canal }, { key: 'tipoEvento', value: query.tipoEvento },
    ]);
  }

  exportVisaoGeralPdf(query: { inicio: string; fim: string }): Observable<HttpResponse<Blob>> {
    const params = buildReportHttpParams([
      { key: 'inicio', value: query.inicio }, { key: 'fim', value: query.fim },
    ]);
    return this.http.get(`${this.endpoint}/visao-geral/export/pdf`, {
      params, observe: 'response', responseType: 'blob',
    });
  }

  private export(url: string, query: { inicio: string; fim: string; sort?: ReportSort<string> }, filters: ReportParam[]): Observable<HttpResponse<Blob>> {
    const params = buildReportHttpParams([
      { key: 'inicio', value: query.inicio }, { key: 'fim', value: query.fim },
      ...filters, { key: 'sort', value: sortValue(query.sort) },
    ]);
    return this.http.get(url, { params, observe: 'response', responseType: 'blob' });
  }

  private periodAndPage(query: { inicio: string; fim: string; page?: number; size?: number; sort?: ReportSort<string> }): ReportParam[] {
    return [{ key: 'inicio', value: query.inicio }, { key: 'fim', value: query.fim }, { key: 'page', value: query.page }, { key: 'size', value: query.size }, { key: 'sort', value: sortValue(query.sort) }];
  }
}
