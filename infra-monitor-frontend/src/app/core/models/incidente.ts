import { IncidentStatus, MonitorType } from './api-enums';
import { PageQuery } from './page-query';

export interface IncidenteMonitorReferencia { id: number; nome: string; tipo: MonitorType; equipamentoId: number; equipamentoNome: string; unidadeId: number; unidadeNome: string; }
export interface IncidenteResponse { id: number; status: IncidentStatus; iniciadoEm: string; encerradoEm: string | null; motivo: string | null; observacao: string | null; monitor: IncidenteMonitorReferencia; createdAt: string; updatedAt: string; }
export interface CloseIncidenteRequest { encerradoEm: string; observacao: string | null; }
export type IncidenteSortField = 'id' | 'status' | 'iniciadoEm' | 'encerradoEm' | 'createdAt' | 'updatedAt';
export interface IncidenteListQuery extends PageQuery { monitorId?: number; equipamentoId?: number; unidadeId?: number; status?: IncidentStatus; inicio?: string; fim?: string; sort?: `${IncidenteSortField},${'asc' | 'desc'}`; }
