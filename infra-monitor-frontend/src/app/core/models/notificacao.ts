import { IncidentStatus, NotificationChannel, NotificationEventType, NotificationStatus } from './api-enums';
import { PageQuery } from './page-query';

export interface IncidenteNotificacaoResponse { id: number; status: IncidentStatus; }
export interface ManutencaoNotificacaoResponse { id: number; unidadeNome: string; }
export interface ManutencaoManualNotificacaoResponse { id: number; equipamentoId: number; equipamentoNome: string; }
export interface EpisodioLatenciaNotificacaoResponse { id: number; iniciadoEm: string; encerradoEm: string | null; limiarMs: number; }

/**
 * Exatamente uma das âncoras vem preenchida: `incidente` para os eventos de incidente,
 * `episodioLatencia` para os de latência, `manutencao` para os de janela e `manutencaoManual`
 * para os do botão manual — nunca duas, garantido por constraint no banco.
 * Monitor, equipamento e unidade já vêm resolvidos pelo backend a partir da âncora que
 * estiver presente, então a tela não precisa saber qual delas é.
 */
export interface NotificacaoResponse { id: number; canal: NotificationChannel; tipoEvento: NotificationEventType; status: NotificationStatus; tentativas: number; mensagem: string; erro: string | null; enviadoEm: string | null; incidente: IncidenteNotificacaoResponse | null; episodioLatencia: EpisodioLatenciaNotificacaoResponse | null; /** Aviso de janela de manutenção agendada (sem monitor nem equipamento). */ manutencao: ManutencaoNotificacaoResponse | null; /** Aviso da sessão do botão manual de um equipamento. */ manutencaoManual: ManutencaoManualNotificacaoResponse | null; monitorNome: string | null; equipamentoNome: string | null; unidadeNome: string | null; createdAt: string; updatedAt: string; }
export type NotificacaoSortField = 'id' | 'canal' | 'tipoEvento' | 'status' | 'tentativas' | 'enviadoEm' | 'createdAt' | 'updatedAt';
export interface NotificacaoListQuery extends PageQuery { incidenteId?: number; /** Mutuamente exclusivo com incidenteId: as duas ancoras juntas o backend recusa com 400. */ episodioLatenciaId?: number; status?: NotificationStatus; canal?: NotificationChannel; tipoEvento?: NotificationEventType; inicio?: string; fim?: string; sort?: `${NotificacaoSortField},${'asc' | 'desc'}`; }
