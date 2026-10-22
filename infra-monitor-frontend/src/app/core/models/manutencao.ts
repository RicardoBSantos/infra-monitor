import { MaintenanceScope, MaintenanceWindowStatus } from './api-enums';

export interface Referencia { id: number; nome: string; }

/** Janela de manutenção agendada (`/manutencoes`). Datas em ISO-8601 UTC. */
export interface ManutencaoResponse {
  id: number;
  unidade: Referencia;
  escopo: MaintenanceScope;
  equipamentos: Referencia[];
  inicioPrevisto: string;
  fimPrevisto: string;
  motivo: string;
  situacao: MaintenanceWindowStatus;
  criadoPor: Referencia;
  ativadaEm: string | null;
  encerradaEm: string | null;
  encerradaPor: Referencia | null;
  canceladaEm: string | null;
  canceladaPor: Referencia | null;
  sobreposicoes: number[];
}

export interface CriarManutencaoRequest {
  unidadeId: number;
  escopo: MaintenanceScope;
  equipamentoIds: number[];
  inicioPrevisto: string;
  fimPrevisto: string;
  motivo: string;
}

export interface ParametrosManutencao { agendadorLigado: boolean; duracaoMaximaHoras: number; }
export type FiltroManutencao = 'VIGENTES' | 'HISTORICO';
