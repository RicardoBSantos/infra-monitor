import { PageQuery } from './page-query';

export interface EquipamentoReferencia { id: number; nome: string; }
export interface EquipamentoResponse {
  id: number;
  nome: string;
  ip: string | null;
  hostname: string | null;
  descricao: string | null;
  localizacao: string | null;
  numeroSerie: string | null;
  fabricante: string | null;
  modelo: string | null;
  ativo: boolean;
  emManutencao: boolean;
  manutencaoManual: boolean;
  unidade: EquipamentoReferencia;
  tipoEquipamento: EquipamentoReferencia;
  createdAt: string;
  updatedAt: string;
}
export interface EquipamentoCreateRequest { unidadeId: number; tipoEquipamentoId: number; nome: string; ip: string | null; hostname: string | null; descricao: string | null; localizacao: string | null; numeroSerie: string | null; fabricante: string | null; modelo: string | null; }
export type EquipamentoUpdateRequest = EquipamentoCreateRequest;
export type EquipamentoSortField = 'id' | 'nome' | 'ip' | 'hostname' | 'localizacao' | 'ativo' | 'createdAt' | 'updatedAt';
export interface EquipamentoListQuery extends PageQuery { unidadeId?: number; tipoEquipamentoId?: number; ativo?: boolean; sort?: `${EquipamentoSortField},${'asc' | 'desc'}`; }

/** Uma sessão do botão manual de manutenção. `iniciadaEm` nulo = legado anterior ao registro; `encerradaEm` nulo = em andamento. */
export interface ManutencaoManualResponse { id: number; iniciadaEm: string | null; iniciadaPor: EquipamentoReferencia | null; encerradaEm: string | null; encerradaPor: EquipamentoReferencia | null; duracaoSegundos: number | null; }
