export type PapelUsuario = 'ADMIN' | 'OPERADOR' | 'VISUALIZADOR';

export interface LoginRequest { email: string; senha: string; }
export interface AuthUser { id: number; nome: string; email: string; papel: PapelUsuario; trocaSenhaObrigatoria: boolean; }
export interface LoginResponse { accessToken: string; tokenType: 'Bearer'; expiresIn: number; usuario: AuthUser; }
export type AuthMeResponse = AuthUser;
export interface TrocaSenhaRequest { senhaAtual: string; novaSenha: string; }
