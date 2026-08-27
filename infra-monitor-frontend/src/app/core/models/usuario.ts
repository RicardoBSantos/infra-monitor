import { PapelUsuario } from './auth';

/** Public administrative representation returned by the API. */
export interface UsuarioResponse {
  id: number;
  nome: string;
  email: string;
  papel: PapelUsuario;
  ativo: boolean;
  trocaSenhaObrigatoria: boolean;
}

export interface UsuarioCreateRequest {
  nome: string;
  email: string;
  papel: PapelUsuario;
  senhaInicial: string;
}

export interface UsuarioUpdateRequest {
  nome: string;
  email: string;
  papel: PapelUsuario;
}

export interface UsuarioResetSenhaRequest {
  novaSenha: string;
}

/** The current backend list endpoint accepts no query parameters. */
export interface UsuarioListQuery {}
