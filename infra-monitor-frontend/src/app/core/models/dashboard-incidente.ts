import { IncidentClosureReason, IncidentStatus } from './api-enums';
import { PageQuery } from './page-query';

/**
 * Origem da linha na tela unificada. As duas tabelas de origem têm sequências
 * independentes e os ids colidem: só o par (tipo, id) identifica uma linha.
 */
export enum IncidentKind {
  Incident = 'INCIDENTE',
  Latency = 'LATENCIA',
}

/** Derivada de `tipo` no backend, sem coluna persistida. */
export enum IncidentSeverity {
  High = 'ALTA',
  Medium = 'MEDIA',
}

/** Aba da tela. `todos` é a soma, não um estado do domínio. */
export type IncidentTab = 'abertos' | 'reconhecidos' | 'resolvidos' | 'todos';

export interface DashboardIncidenteResponse {
  tipo: IncidentKind;
  id: number;
  severidade: IncidentSeverity;
  /** Episódio de latência usa o mesmo vocabulário do incidente: ABERTO ou FECHADO. */
  status: IncidentStatus;
  iniciadoEm: string;
  encerradoEm: string | null;
  motivo: string | null;
  /** Só em linhas de latência: o limiar vigente quando o episódio abriu. */
  limiarMs: number | null;
  reconhecidoEm: string | null;
  reconhecidoPorNome: string | null;
  /**
   * Só em linhas de incidente; episódio de latência tem coluna própria no banco mas
   * este read-model não a projeta. Nulo é o caso comum, não exceção: a maior parte do
   * histórico foi fechada antes da V19 e nunca foi classificada.
   */
  motivoEncerramento: IncidentClosureReason | null;
  monitorId: number; monitorNome: string;
  equipamentoId: number; equipamentoNome: string;
  unidadeId: number; unidadeNome: string;
  notificacaoCanal: string | null;
  notificacaoStatus: string | null;
  notificacaoEnviadoEm: string | null;
}

/**
 * Contadores das abas. Vêm do servidor e não da página: com 20 linhas por página os
 * totais calculados no cliente estariam errados.
 */
export interface DashboardIncidenteContadoresResponse {
  abertos: number;
  reconhecidos: number;
  resolvidos: number;
  todos: number;
}

/** Espelha a whitelist de ORDENACAO do DashboardIncidenteService: fora dela o backend recusa. */
export type DashboardIncidenteSortField = 'iniciadoEm' | 'severidade' | 'status' | 'unidadeNome';

/** Filtros da lista. `status` sai da aba ativa; os demais são os controles do topo. */
export interface DashboardIncidenteQuery extends PageQuery {
  unidadeId?: number;
  severidade?: IncidentSeverity;
  status?: IncidentStatus;
  inicio?: string;
  fim?: string;
  sort?: `${DashboardIncidenteSortField},${'asc' | 'desc'}`;
}

/** Os mesmos filtros da lista menos status — a aba não selecionada mostraria sempre zero. */
export type DashboardIncidenteContadoresQuery = Omit<DashboardIncidenteQuery, 'status' | 'page' | 'size' | 'sort'>;
