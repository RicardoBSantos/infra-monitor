import { IncidentStatus, NotificationChannel, NotificationEventType, NotificationStatus } from './api-enums';
import { PageQuery } from './page-query';

export interface IncidenteNotificacaoResponse { id: number; status: IncidentStatus; }
export interface NotificacaoResponse { id: number; canal: NotificationChannel; tipoEvento: NotificationEventType; status: NotificationStatus; tentativas: number; mensagem: string; erro: string | null; enviadoEm: string | null; incidente: IncidenteNotificacaoResponse; createdAt: string; updatedAt: string; }
export type NotificacaoSortField = 'id' | 'canal' | 'tipoEvento' | 'status' | 'tentativas' | 'enviadoEm' | 'createdAt' | 'updatedAt';
export interface NotificacaoListQuery extends PageQuery { incidenteId?: number; status?: NotificationStatus; canal?: NotificationChannel; tipoEvento?: NotificationEventType; inicio?: string; fim?: string; sort?: `${NotificacaoSortField},${'asc' | 'desc'}`; }
