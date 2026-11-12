export type TelaModoTv = 'MAPA' | 'PAINEL' | 'INCIDENTES' | 'RELATORIOS';

export interface TelaModoTvConfig { tela: TelaModoTv; ordem: number; duracaoSegundos: number; }

export interface ConfiguracaoModoTv {
  ativo: boolean;
  intervaloAtualizacaoSegundos: number;
  telas: TelaModoTvConfig[];
  persistida: boolean;
  atualizadoEm: string | null;
}

/** Campo ausente preserva o valor gravado; `telas`, quando enviado, substitui a lista inteira na ordem dada. */
export interface AtualizarConfiguracaoModoTv {
  ativo?: boolean;
  intervaloAtualizacaoSegundos?: number;
  telas?: { tela: TelaModoTv; duracaoSegundos: number }[];
}
