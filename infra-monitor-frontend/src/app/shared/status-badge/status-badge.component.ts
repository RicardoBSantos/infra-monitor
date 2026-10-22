import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { AnalyticState, BotVerificationStatus, EquipmentOperationalStatus, IncidentStatus, MaintenanceWindowStatus, MeasurementStatus, MonitorOperationalStatus, MonitoringWindowQuality, NotificationStatus, UnitOperationalStatus } from '../../core/models/api-enums';

// AnalyticState e MonitoringWindowQuality vêm dos Relatórios. SEM_DADOS e
// SEM_MONITORAMENTO já existiam pelos status operacionais e mantêm o mesmo
// rótulo — a união só acrescenta CALCULADO, PRECISA e INFERIDA.
type DisplayStatus = MonitorOperationalStatus | EquipmentOperationalStatus | UnitOperationalStatus | MeasurementStatus | IncidentStatus | NotificationStatus | BotVerificationStatus | AnalyticState | MonitoringWindowQuality | MaintenanceWindowStatus;
// Exportado porque o marcador de unidade do Mapa precisa do MESMO rótulo dentro de um aria-label:
// o marcador nasce por script, fora do template, e não tem como hospedar um <app-status-badge>.
// Duplicar a tabela deixaria o leitor de tela ouvindo um rótulo que a tela não mostra.
export const LABELS: Record<DisplayStatus, string> = { DISPONIVEL: 'Disponível', DEGRADADO: 'Degradado', INDISPONIVEL: 'Indisponível', SEM_DADOS: 'Sem dados', DESABILITADO: 'Desabilitado', SEM_MONITORAMENTO: 'Sem monitoramento', EM_MANUTENCAO: 'Em manutenção', DEGRADADA: 'Degradada', SEM_EQUIPAMENTOS: 'Sem equipamentos', SUCESSO: 'Sucesso', FALHA: 'Falha', ABERTO: 'Aberto', RECONHECIDO: 'Reconhecido', FECHADO: 'Resolvido', PENDENTE: 'Aguardando', ENVIANDO: 'Em envio', ENVIADA: 'Enviada', CANCELADA: 'Cancelada', VERIFICADO: 'Verificado', NAO_VERIFICADO: 'Não verificado', CALCULADO: 'Calculado', PRECISA: 'Precisa', INFERIDA: 'Inferida',
  // janelas de manutenção; CANCELADA já existia pelas notificações
  AGENDADA: 'Agendada', ATIVA: 'Ativa', CONCLUIDA: 'Concluída', EXPIRADA: 'Expirada' };
/** Tom visual de cada status — fonte única do badge e de quem pinta algo ao lado dele. */
export type TomStatus = 'success' | 'warning' | 'danger' | 'muted' | 'info';
const TONES: Record<DisplayStatus, TomStatus> = { DISPONIVEL: 'success', DEGRADADO: 'warning', INDISPONIVEL: 'danger', SEM_DADOS: 'muted', DESABILITADO: 'muted', SEM_MONITORAMENTO: 'muted', EM_MANUTENCAO: 'info', DEGRADADA: 'warning', SEM_EQUIPAMENTOS: 'muted', SUCESSO: 'success', FALHA: 'danger', ABERTO: 'danger', RECONHECIDO: 'warning', FECHADO: 'success', PENDENTE: 'muted', ENVIANDO: 'info', ENVIADA: 'success', CANCELADA: 'muted', VERIFICADO: 'success', NAO_VERIFICADO: 'muted', CALCULADO: 'info', PRECISA: 'success', INFERIDA: 'warning',
  // janelas de manutenção; CANCELADA já existia pelas notificações
  AGENDADA: 'muted', ATIVA: 'info', CONCLUIDA: 'muted', EXPIRADA: 'warning' };

/** Tom do status: a mesma tabela do badge, para quem precisa pintar algo ao lado dele. */
export function tomDoStatus(status: DisplayStatus): TomStatus { return TONES[status]; }

@Component({ selector: 'app-status-badge', changeDetection: ChangeDetectionStrategy.OnPush, template: `<span class="badge" [class]="'badge badge--' + tone()"><span aria-hidden="true"></span>{{ label() }}</span>`, styleUrl: './status-badge.component.scss' })
export class StatusBadgeComponent { readonly status = input.required<DisplayStatus>(); protected readonly label = computed(() => LABELS[this.status()]); protected readonly tone = computed(() => tomDoStatus(this.status())); }
