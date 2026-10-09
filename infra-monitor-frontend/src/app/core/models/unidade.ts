export interface UnidadeResponse { id: number; nome: string; sigla: string; descricao: string | null; codigoIbge: string | null; ativo: boolean; createdAt: string; updatedAt: string; endereco: string | null; cidade: string | null; uf: string | null; latitude: number | null; longitude: number | null; conectaAUnidadeId: number | null; }
export interface UnidadeCreateRequest { nome: string; sigla: string; descricao: string | null; codigoIbge: string | null; endereco?: string | null; cidade?: string | null; uf?: string | null; latitude?: number | null; longitude?: number | null; }
/** Campos de localização omitidos preservam o valor salvo: o PUT não zera endereço nem coordenadas por omissão. */
export interface UnidadeUpdateRequest { nome: string; sigla: string; descricao: string | null; codigoIbge: string | null; endereco?: string | null; cidade?: string | null; uf?: string | null; latitude?: number | null; longitude?: number | null; }

/**
 * Corpo de PUT /unidades/:id/conexao. A conexão tem endpoint próprio porque no PUT da unidade
 * null significa "preserva": pelo corpo da unidade dá para definir um hub, nunca desconectar.
 * Desconectar é DELETE no mesmo recurso.
 */
export interface UnidadeConexaoRequest { conectaAUnidadeId: number; }
