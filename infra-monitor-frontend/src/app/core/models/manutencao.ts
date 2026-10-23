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
  versao: number;
  ultimaAlteracao: UltimaAlteracao | null;
}

export type TipoAlteracao = 'EDICAO' | 'PRORROGACAO' | 'ANTECIPACAO';
export interface UltimaAlteracao { tipo: TipoAlteracao; por: Referencia; em: string; }

export interface CriarManutencaoRequest {
  unidadeId: number;
  escopo: MaintenanceScope;
  equipamentoIds: number[];
  inicioPrevisto: string;
  fimPrevisto: string;
  motivo: string;
}

export interface EditarManutencaoRequest extends CriarManutencaoRequest { versao: number; }
export interface AlterarFimRequest { fimPrevisto: string; versao: number; }

/** Pré-preenchimento do modal de agendar (Equipamentos, Unidade, continuação). Datas ISO. */
export interface PresetAgendamento {
  unidadeId: number;
  travarUnidade: boolean;
  escopo?: MaintenanceScope;
  equipamentoIds?: number[];
  motivo?: string;
  inicio?: string;
  fim?: string;
}

export interface ParametrosManutencao { agendadorLigado: boolean; duracaoMaximaHoras: number; }
export type FiltroManutencao = 'VIGENTES' | 'HISTORICO';
