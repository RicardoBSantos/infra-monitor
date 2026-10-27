import { NotificationEventType } from './api-enums';

/**
 * Único lugar com o texto de cada evento de notificação. Lista, detalhe e Relatórios liam
 * cópias à mão (e os selects tinham `<option>` escritos um a um): evento novo no enum
 * aparecia no backend e ficava sem rótulo, ou fora do filtro, em silêncio.
 * O `Record` exaustivo faz o compilador recusar um valor do enum sem rótulo.
 */
export const ROTULOS_EVENTO_NOTIFICACAO: Record<NotificationEventType, string> = {
  [NotificationEventType.IncidentOpened]: 'Incidente aberto',
  [NotificationEventType.IncidentClosed]: 'Incidente fechado',
  [NotificationEventType.HighLatency]: 'Latência alta',
  [NotificationEventType.LatencyNormalized]: 'Latência normalizada',
  [NotificationEventType.IncidentClosedByMaintenance]: 'Incidente encerrado por manutenção',
  [NotificationEventType.LatencyClosedByMaintenance]: 'Latência encerrada por manutenção',
  [NotificationEventType.MaintenanceStarted]: 'Manutenção iniciada',
  [NotificationEventType.MaintenanceEnded]: 'Manutenção encerrada',
  [NotificationEventType.MaintenanceEndChanged]: 'Fim da manutenção alterado',
  [NotificationEventType.ManualMaintenanceStarted]: 'Manutenção manual iniciada',
  [NotificationEventType.ManualMaintenanceEnded]: 'Manutenção manual encerrada',
};

/** Opções dos selects de evento, na ordem do enum. */
export const OPCOES_EVENTO_NOTIFICACAO: readonly { valor: NotificationEventType; rotulo: string }[] =
  Object.values(NotificationEventType).map((valor) => ({ valor, rotulo: ROTULOS_EVENTO_NOTIFICACAO[valor] }));

export function rotuloEventoNotificacao(tipo: NotificationEventType): string {
  return ROTULOS_EVENTO_NOTIFICACAO[tipo] ?? tipo;
}
