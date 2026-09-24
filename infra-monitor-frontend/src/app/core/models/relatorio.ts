import {
  AnalyticState,
  IncidentClosureReason,
  IncidentStatus,
  MeasurementStatus,
  MonitoringWindowQuality,
  NotificationChannel,
  NotificationEventType,
  NotificationStatus,
} from './api-enums';

/** ISO-8601 UTC instants are passed through unchanged to the Reports API. */
export interface ReportPeriodQuery {
  inicio: string;
  fim: string;
}

/**
 * Os três indicadores da Visão Geral, prontos do servidor. Vêm da mesma query que o PDF da
 * tela usa — por isso `incidentesAbertos` conta ABERTO e RECONHECIDO, e não sai do endpoint
 * paginado de incidentes, onde o status é valor único.
 */
export interface IndicadoresVisaoGeralResponse {
  incidentesAbertos: number;
  medicoesComFalha: number;
  notificacoesComFalha: number;
}

export type SortDirection = 'asc' | 'desc';

export interface ReportSort<Field extends string> {
  field: Field;
  direction: SortDirection;
}

export interface ReportPaginationQuery<Field extends string> {
  page?: number;
  size?: number;
  sort?: ReportSort<Field>;
}

export interface DisponibilidadeEquipamentosQuery extends ReportPeriodQuery, ReportPaginationQuery<DisponibilidadeEquipamentoSortField> {
  unidadeId?: number | null;
  equipamentoId?: number | null;
  monitorId?: number | null;
  tipoEquipamentoId?: number | null;
}

export type DisponibilidadeEquipamentoSortField = 'equipamentoNome' | 'unidadeNome' | 'monitorNome' | 'disponibilidadePercentual' | 'tempoIndisponivelSegundos' | 'tempoMonitoradoSegundos' | 'incidentes';

export interface DisponibilidadeUnidadesQuery extends ReportPeriodQuery, ReportPaginationQuery<DisponibilidadeUnidadeSortField> {
  unidadeId?: number | null;
}

export type DisponibilidadeUnidadeSortField = 'unidadeNome' | 'equipamentosTotal' | 'equipamentosMonitorados' | 'equipamentosSemMonitoramento' | 'tempoIndisponivelSegundos' | 'disponibilidadePercentual' | 'incidentes';

export interface HistoricoIncidentesQuery extends ReportPeriodQuery, ReportPaginationQuery<HistoricoIncidenteSortField> {
  unidadeId?: number | null;
  equipamentoId?: number | null;
  monitorId?: number | null;
  status?: IncidentStatus | null;
}

export type HistoricoIncidenteSortField = 'iniciadoEm' | 'encerradoEm' | 'duracaoSegundosNoPeriodo' | 'status' | 'unidadeNome' | 'equipamentoNome' | 'monitorNome';

export interface HistoricoMedicoesQuery extends ReportPeriodQuery, ReportPaginationQuery<HistoricoMedicaoSortField> {
  unidadeId?: number | null;
  equipamentoId?: number | null;
  monitorId?: number | null;
  status?: MeasurementStatus | null;
}

export type HistoricoMedicaoSortField = 'executadoEm' | 'status' | 'latenciaMs' | 'unidadeNome' | 'equipamentoNome' | 'monitorNome';

export interface LatenciaIcmpQuery extends ReportPeriodQuery, ReportPaginationQuery<LatenciaIcmpSortField> {
  unidadeId?: number | null;
  equipamentoId?: number | null;
  monitorId?: number | null;
}

export type LatenciaIcmpSortField = 'unidadeNome' | 'equipamentoNome' | 'monitorNome' | 'minLatenciaMs' | 'avgLatenciaMs' | 'maxLatenciaMs' | 'count';

export interface LatenciaUnidadesQuery extends ReportPeriodQuery, ReportPaginationQuery<LatenciaUnidadeSortField> {
  unidadeId?: number | null;
}

export type LatenciaUnidadeSortField = 'unidadeNome' | 'minLatenciaMs' | 'avgLatenciaMs' | 'maxLatenciaMs' | 'count';

export interface HistoricoNotificacoesQuery extends ReportPeriodQuery, ReportPaginationQuery<HistoricoNotificacaoSortField> {
  incidenteId?: number | null;
  status?: NotificationStatus | null;
  canal?: NotificationChannel | null;
  tipoEvento?: NotificationEventType | null;
}

export type ReportExportQuery<Query extends ReportPeriodQuery> = Omit<Query, 'page' | 'size'>;

export type DisponibilidadeEquipamentosExportQuery = ReportExportQuery<DisponibilidadeEquipamentosQuery>;
export type DisponibilidadeUnidadesExportQuery = ReportExportQuery<DisponibilidadeUnidadesQuery>;
export type HistoricoIncidentesExportQuery = ReportExportQuery<HistoricoIncidentesQuery>;
export type HistoricoMedicoesExportQuery = ReportExportQuery<HistoricoMedicoesQuery>;
export type LatenciaIcmpExportQuery = ReportExportQuery<LatenciaIcmpQuery>;
export type HistoricoNotificacoesExportQuery = ReportExportQuery<HistoricoNotificacoesQuery>;

export type HistoricoNotificacaoSortField = 'createdAt' | 'enviadoEm' | 'status' | 'canal' | 'tipoEvento' | 'tentativas';

export interface DisponibilidadeEquipamentoResponse {
  equipamentoId: number;
  equipamentoNome: string;
  unidadeId: number;
  unidadeNome: string;
  monitorId: number | null;
  monitorNome: string | null;
  tipoMonitor: string | null;
  inicio: string;
  fim: string;
  estadoAnalitico: AnalyticState;
  qualidadeJanela: MonitoringWindowQuality | null;
  tempoMonitoradoSegundos: number | null;
  tempoIndisponivelSegundos: number | null;
  tempoDisponivelSegundos: number | null;
  disponibilidadePercentual: number | null;
  incidentes: number;
}

export interface DisponibilidadeUnidadeResponse {
  unidadeId: number;
  unidadeNome: string;
  inicio: string;
  fim: string;
  estadoAnalitico: AnalyticState;
  equipamentosTotal: number;
  equipamentosMonitorados: number;
  equipamentosSemMonitoramento: number;
  equipamentosSemDados: number;
  tempoMonitoradoSegundos: number | null;
  tempoIndisponivelSegundos: number | null;
  tempoDisponivelSegundos: number | null;
  disponibilidadePercentual: number | null;
  incidentes: number;
}

export interface HistoricoIncidenteResponse {
  incidenteId: number;
  unidadeId: number;
  unidadeNome: string;
  equipamentoId: number;
  equipamentoNome: string;
  monitorId: number;
  monitorNome: string;
  tipoMonitor: string;
  status: IncidentStatus;
  iniciadoEm: string;
  encerradoEm: string | null;
  duracaoSegundosNoPeriodo: number;
  motivo: string;
  observacao: string | null;
  /** Ausente na maioria dos incidentes fechados: só existe para quem encerrou depois da V19. */
  motivoEncerramento: IncidentClosureReason | null;
}

export interface HistoricoMedicaoResponse {
  medicaoId: number;
  unidadeId: number;
  unidadeNome: string;
  equipamentoId: number;
  equipamentoNome: string;
  monitorId: number;
  monitorNome: string;
  tipoMonitor: string;
  status: MeasurementStatus;
  latenciaMs: number | null;
  executadoEm: string;
}

export interface LatenciaIcmpResponse {
  unidadeId: number;
  unidadeNome: string;
  equipamentoId: number;
  equipamentoNome: string;
  monitorId: number;
  monitorNome: string;
  inicio: string;
  fim: string;
  minLatenciaMs: number | null;
  avgLatenciaMs: number | null;
  maxLatenciaMs: number | null;
  count: number;
  p95LatenciaMs: number | null;
}

/** Latencia ICMP agregada por unidade pelo proprio backend: sem campos de monitor ou equipamento. */
export interface LatenciaUnidadeResponse {
  unidadeId: number;
  unidadeNome: string;
  inicio: string;
  fim: string;
  minLatenciaMs: number | null;
  avgLatenciaMs: number | null;
  maxLatenciaMs: number | null;
  count: number;
}

export interface HistoricoNotificacaoResponse {
  notificacaoId: number;
  incidenteId: number;
  canal: NotificationChannel;
  tipoEvento: NotificationEventType;
  status: NotificationStatus;
  tentativas: number;
  enviadoEm: string | null;
  erro: string | null;
  createdAt: string;
}

/**
 * Disponibilidade diária de uma unidade, últimos 30 dias de calendário local.
 * Diferente dos demais relatórios, o endpoint devolve um array puro, sem envelope
 * de paginação. Dias sem monitoramento não aparecem: ausência não é zero.
 * `data` vem como "AAAA-MM-DD", sem hora e sem fuso.
 */
export interface DisponibilidadeDiariaUnidadeResponse {
  data: string;
  disponibilidadePercentual: number | null;
  tempoMonitoradoSegundos: number | null;
}
