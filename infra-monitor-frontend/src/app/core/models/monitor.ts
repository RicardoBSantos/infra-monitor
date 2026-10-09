import { MonitorType } from './api-enums';
import { PageQuery } from './page-query';

export interface MonitorEquipamentoReferencia { id: number; nome: string; }

export interface MonitorResponse {
  id: number;
  nome: string;
  tipo: MonitorType;
  intervaloSegundos: number;
  timeoutMs: number;
  falhasParaIncidente: number;
  sucessosParaRecovery: number;
  ativo: boolean;
  equipamento: MonitorEquipamentoReferencia;
  createdAt: string;
  updatedAt: string;
}

export interface MonitorCreateRequest {
  equipamentoId: number;
  tipo: MonitorType;
  nome: string;
  intervaloSegundos: number;
  timeoutMs: number;
  falhasParaIncidente: number | null;
  sucessosParaRecovery: number | null;
}

export type MonitorUpdateRequest = MonitorCreateRequest;
export type MonitorSortField = 'id' | 'nome' | 'tipo' | 'intervaloSegundos' | 'timeoutMs' | 'ativo' | 'createdAt' | 'updatedAt';
export interface MonitorListQuery extends PageQuery {
  equipamentoId?: number;
  tipo?: MonitorType;
  ativo?: boolean;
  sort?: `${MonitorSortField},${'asc' | 'desc'}`;
}
