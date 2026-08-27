import { EquipmentOperationalStatus, UnitOperationalStatus } from './api-enums';

export interface DashboardResumo { unidades: DashboardResumoUnidades; equipamentos: DashboardResumoEquipamentos; monitores: DashboardResumoMonitores; incidentes: DashboardResumoIncidentes; limiarLatenciaDegradadaMs: number; geradoEm: string; }
export interface DashboardResumoUnidades { total: number; }
export interface DashboardResumoEquipamentos { total: number; ativos: number; disponiveis: number; degradados: number; indisponiveis: number; semDados: number; semMonitoramento: number; emManutencao: number; }
export interface DashboardResumoMonitores { total: number; ativos: number; disponiveis: number; degradados: number; indisponiveis: number; semDados: number; }
export interface DashboardResumoIncidentes { abertos: number; }
export interface DashboardUnidade { id: number; nome: string; codigoIbge: string | null; ativo: boolean; status: UnitOperationalStatus; equipamentosTotal: number; equipamentosAtivos: number; equipamentosDisponiveis: number; equipamentosDegradados: number; equipamentosIndisponiveis: number; equipamentosSemDados: number; equipamentosSemMonitoramento: number; equipamentosEmManutencao: number; incidentesAbertos: number; }
export interface DashboardUnidadeDetalhe { id: number; nome: string; codigoIbge: string | null; ativo: boolean; status: UnitOperationalStatus; equipamentos: DashboardResumoEquipamentos; monitores: Pick<DashboardResumoMonitores, 'ativos' | 'indisponiveis'>; incidentesAbertos: number; }
export interface DashboardEquipamento { id: number; nome: string; ip: string | null; hostname: string | null; localizacao: string | null; ativo: boolean; status: EquipmentOperationalStatus; tipoEquipamento: { id: number; nome: string }; emManutencao: boolean; monitoresAtivos: number; incidentesAbertos: number; ultimaMedicao: { status: 'SUCESSO' | 'FALHA'; latenciaMs: number | null; executadoEm: string } | null; }
export interface DashboardEquipamentosQuery { page?: number; size?: number; sort?: 'id' | 'nome' | 'ip' | 'localizacao' | 'ativo'; tipoEquipamentoId?: number; ativo?: boolean; }
