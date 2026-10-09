export enum MonitorType {
  Icmp = 'ICMP',
}

export enum MeasurementStatus {
  Success = 'SUCESSO',
  Failure = 'FALHA',
}

export enum IncidentStatus {
  Open = 'ABERTO',
  /** Alguém assumiu o incidente. Continua operacionalmente aberto: não encerra nada. */
  Acknowledged = 'RECONHECIDO',
  Closed = 'FECHADO',
}

/**
 * Espelho de `StatusIncidente.EM_ABERTO` do backend: os estados em que o incidente ainda
 * está acontecendo. Existe como constante, e não como comparação escrita à mão, porque
 * reconhecer e fechar aparecem juntos em mais de uma tela — e foi exatamente uma
 * comparação repetida (`status !== Open`) que deixou o botão Fechar travado para
 * incidentes RECONHECIDO quando o estado novo entrou.
 */
export const INCIDENT_OPEN_STATES: readonly IncidentStatus[] = [IncidentStatus.Open, IncidentStatus.Acknowledged];

export function isIncidentOpen(status: IncidentStatus): boolean {
  return INCIDENT_OPEN_STATES.includes(status);
}

export enum NotificationChannel {
  Telegram = 'TELEGRAM',
}

export enum NotificationEventType {
  IncidentOpened = 'INCIDENTE_ABERTO',
  IncidentClosed = 'INCIDENTE_FECHADO',
  HighLatency = 'LATENCIA_ALTA',
  LatencyNormalized = 'LATENCIA_NORMALIZADA',
  IncidentClosedByMaintenance = 'INCIDENTE_ENCERRADO_MANUTENCAO',
  LatencyClosedByMaintenance = 'LATENCIA_ENCERRADA_MANUTENCAO',
}

/** Verificacao da identidade do bot via getMe, mantida em cache no backend. */
export enum BotVerificationStatus {
  Verified = 'VERIFICADO',
  Unverified = 'NAO_VERIFICADO',
}

export enum NotificationStatus {
  Pending = 'PENDENTE',
  Sending = 'ENVIANDO',
  Sent = 'ENVIADA',
  Failure = 'FALHA',
  /** O evento deixou de valer antes do envio. Só PENDENTE vira CANCELADA. */
  Cancelled = 'CANCELADA',
}

/** Como o incidente foi encerrado. Ausente = fechado antes da V19, não classificável. */
export enum IncidentClosureReason {
  AutomaticRecovery = 'RECUPERACAO_AUTOMATICA',
  ManualClosure = 'FECHAMENTO_MANUAL',
  Maintenance = 'MANUTENCAO',
}

/** Como o episódio de latência foi encerrado. Ausente = aberto, ou encerrado antes da V19. */
export enum LatencyClosureReason {
  Normalization = 'NORMALIZACAO',
  Incident = 'INCIDENTE',
  Maintenance = 'MANUTENCAO',
}

export enum MonitorOperationalStatus {
  Available = 'DISPONIVEL',
  Degraded = 'DEGRADADO',
  Unavailable = 'INDISPONIVEL',
  NoData = 'SEM_DADOS',
  Disabled = 'DESABILITADO',
}

export enum EquipmentOperationalStatus {
  Available = 'DISPONIVEL',
  Degraded = 'DEGRADADO',
  Unavailable = 'INDISPONIVEL',
  NoData = 'SEM_DADOS',
  Disabled = 'DESABILITADO',
  NoMonitoring = 'SEM_MONITORAMENTO',
  Maintenance = 'EM_MANUTENCAO',
}

export enum UnitOperationalStatus {
  Available = 'DISPONIVEL',
  Unavailable = 'INDISPONIVEL',
  Degraded = 'DEGRADADA',
  NoData = 'SEM_DADOS',
  NoEquipment = 'SEM_EQUIPAMENTOS',
  /** Unidade sem nenhum equipamento sob leitura: todos os ativos estao em manutencao planejada. */
  Maintenance = 'EM_MANUTENCAO',
}

/** Analytic state calculated exclusively by the Reports API. */
export enum AnalyticState {
  Calculated = 'CALCULADO',
  NoMonitoring = 'SEM_MONITORAMENTO',
  NoData = 'SEM_DADOS',
}

/** Origin/quality of a monitoring window returned by the Reports API. */
export enum MonitoringWindowQuality {
  Precise = 'PRECISA',
  Inferred = 'INFERIDA',
}
