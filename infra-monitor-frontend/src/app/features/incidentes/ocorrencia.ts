import { AppIconName } from '../../shared/app-icon/app-icon.component';
import { IncidentClosureReason } from '../../core/models/api-enums';
import { IncidentKind } from '../../core/models/dashboard-incidente';

/**
 * Vocabulário e derivações comuns às duas telas da ocorrência — a lista unificada e a
 * gaveta de detalhe. Está aqui, e não duplicado nas duas, porque uma linha da lista e o
 * cabeçalho da gaveta são a MESMA ocorrência: divergir no rótulo ou no arredondamento da
 * duração faria a tela se contradizer entre o clique e o detalhe.
 */

/** Rótulo do evento: sai da origem da linha, nunca do `motivo`. */
export function rotuloEvento(tipo: IncidentKind): string {
  return tipo === IncidentKind.Latency ? 'Latência acima do limiar' : 'Indisponibilidade consolidada';
}

/** Mesmo par de ícones da navegação: triângulo para indisponibilidade, onda para latência. */
export function iconeEvento(tipo: IncidentKind): AppIconName {
  return tipo === IncidentKind.Latency ? 'monitor' : 'incident';
}

/**
 * Duração derivada no cliente: fim − início, ou agora − início enquanto a ocorrência
 * está em curso. O backend não persiste duração e não deveria — para uma ocorrência
 * aberta ela muda a cada segundo.
 */
export function duracaoDe(iniciadoEm: string, encerradoEm: string | null): string {
  const fim = encerradoEm ? new Date(encerradoEm).getTime() : Date.now();
  return formatarDuracao(Math.max(0, Math.round((fim - new Date(iniciadoEm).getTime()) / 1000)));
}

const ROTULOS_MOTIVO_ENCERRAMENTO: Record<IncidentClosureReason, string> = {
  [IncidentClosureReason.AutomaticRecovery]: 'Recuperação automática',
  [IncidentClosureReason.ManualClosure]: 'Fechamento manual',
  [IncidentClosureReason.Maintenance]: 'Entrada em manutenção',
};

/**
 * Ausente é o caso comum, não exceção: no banco de dev, a maioria dos incidentes fechados
 * tem `motivoEncerramento` nulo, porque foram encerrados antes da V19 que introduziu a coluna.
 * Compartilhada entre a gaveta de detalhe, o histórico do equipamento e a aba de incidentes
 * da unidade — as três leem o mesmo dado e não podem divergir no rótulo.
 */
export function rotuloMotivoEncerramento(motivo: IncidentClosureReason | null | undefined): string {
  if (motivo === null || motivo === undefined) return '—';
  return ROTULOS_MOTIVO_ENCERRAMENTO[motivo];
}

export function formatarDuracao(segundos: number): string {
  if (segundos < 60) return `${segundos} s`;
  const minutos = Math.floor(segundos / 60);
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return minutos % 60 === 0 ? `${horas} h` : `${horas} h ${minutos % 60} min`;
  const dias = Math.floor(horas / 24);
  return horas % 24 === 0 ? `${dias} d` : `${dias} d ${horas % 24} h`;
}
