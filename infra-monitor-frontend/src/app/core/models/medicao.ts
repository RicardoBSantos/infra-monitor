import { MeasurementStatus, MonitorType } from './api-enums';
import { PageQuery } from './page-query';

export interface MedicaoMonitorReferencia { id: number; nome: string; tipo: MonitorType; }
export interface MedicaoResponse { id: number; status: MeasurementStatus; latenciaMs: number | null; mensagem: string | null; executadoEm: string; createdAt: string; monitor: MedicaoMonitorReferencia; }
export type MedicaoSortField = 'id' | 'status' | 'latenciaMs' | 'executadoEm' | 'createdAt';
export interface MedicaoListQuery extends PageQuery { monitorId?: number; status?: MeasurementStatus; inicio?: string; fim?: string; sort?: `${MedicaoSortField},${'asc' | 'desc'}`; }
