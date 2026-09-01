export enum MonitorType {
  Icmp = 'ICMP',
}

export enum MeasurementStatus {
  Success = 'SUCESSO',
  Failure = 'FALHA',
}

export enum IncidentStatus {
  Open = 'ABERTO',
  Closed = 'FECHADO',
}

export enum NotificationChannel {
  Telegram = 'TELEGRAM',
}

export enum NotificationEventType {
  IncidentOpened = 'INCIDENTE_ABERTO',
  IncidentClosed = 'INCIDENTE_FECHADO',
  HighLatency = 'LATENCIA_ALTA',
  LatencyNormalized = 'LATENCIA_NORMALIZADA',
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
