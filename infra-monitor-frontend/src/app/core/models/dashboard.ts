import { EquipmentOperationalStatus, UnitOperationalStatus } from './api-enums';

export interface DashboardResumo { unidades: DashboardResumoUnidades; equipamentos: DashboardResumoEquipamentos; monitores: DashboardResumoMonitores; incidentes: DashboardResumoIncidentes; limiarLatenciaDegradadaMs: number; geradoEm: string; }
export interface DashboardResumoUnidades { total: number; }
export interface DashboardResumoEquipamentos { total: number; ativos: number; disponiveis: number; degradados: number; indisponiveis: number; semDados: number; semMonitoramento: number; emManutencao: number; }
export interface DashboardResumoMonitores { total: number; ativos: number; disponiveis: number; degradados: number; indisponiveis: number; semDados: number; }
export interface DashboardResumoIncidentes { abertos: number; }
/**
 * `latitude`/`longitude` são anuláveis e independentes de `codigoIbge`: o município posiciona a
 * unidade no mapa coroplético, a coordenada posiciona o marcador. O banco de dev já tem as 11
 * preenchidas (`db/dev-seed/01-unidades-coordenadas.sql`), mas o cadastro continua não exigindo
 * coordenada, então quem consome tem de tratar o nulo como caso normal.
 *
 * Testar sempre com `!= null`, nunca por veracidade — `0` é latitude e longitude válida.
 *
 * `conectaAUnidadeId` é o pai na topologia (auto-referência de `unidade`). Nulo é raiz, não
 * ausência de dado. O mapa desenha a linha hub→unidade a partir daqui, e só quando as DUAS pontas
 * têm coordenada.
 */
export interface DashboardUnidade { id: number; nome: string; codigoIbge: string | null; ativo: boolean; status: UnitOperationalStatus; equipamentosTotal: number; equipamentosAtivos: number; equipamentosDisponiveis: number; equipamentosDegradados: number; equipamentosIndisponiveis: number; equipamentosSemDados: number; equipamentosSemMonitoramento: number; equipamentosEmManutencao: number; incidentesAbertos: number; latitude: number | null; longitude: number | null; conectaAUnidadeId: number | null; }
export interface DashboardUnidadeDetalhe { id: number; nome: string; codigoIbge: string | null; ativo: boolean; status: UnitOperationalStatus; equipamentos: DashboardResumoEquipamentos; monitores: Pick<DashboardResumoMonitores, 'ativos' | 'indisponiveis'>; incidentesAbertos: number; }
export interface DashboardEquipamento { id: number; nome: string; ip: string | null; hostname: string | null; localizacao: string | null; ativo: boolean; status: EquipmentOperationalStatus; tipoEquipamento: { id: number; nome: string }; emManutencao: boolean; monitoresAtivos: number; incidentesAbertos: number; ultimaMedicao: { status: 'SUCESSO' | 'FALHA'; latenciaMs: number | null; executadoEm: string } | null; }
export interface DashboardEquipamentosQuery { page?: number; size?: number; sort?: 'id' | 'nome' | 'ip' | 'localizacao' | 'ativo'; tipoEquipamentoId?: number; ativo?: boolean; }

/**
 * Linha do inventário completo (`GET /dashboard/equipamentos`).
 *
 * `localizacao` e `numeroSerie` vêm aqui porque a busca da tela filtra por eles em
 * memória. `descricao` fica de fora — texto longo que só o formulário de edição usa, e
 * que chega sob demanda por `GET /equipamentos/{id}`.
 */
export interface DashboardEquipamentoLista {
  id: number;
  nome: string;
  tipoNome: string;
  unidadeId: number;
  unidadeNome: string;
  hostname: string | null;
  ip: string | null;
  status: EquipmentOperationalStatus;
  latenciaMs: number | null;
  ativo: boolean;
  localizacao: string | null;
  numeroSerie: string | null;
  emManutencao: boolean;
  manutencaoManual: boolean;
  janelaAtivaId: number | null;
  janelaAtivaFim: string | null;
}
