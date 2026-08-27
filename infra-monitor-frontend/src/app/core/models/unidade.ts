export interface UnidadeResponse { id: number; nome: string; sigla: string; descricao: string | null; codigoIbge: string | null; ativo: boolean; createdAt: string; updatedAt: string; }
export interface UnidadeCreateRequest { nome: string; sigla: string; descricao: string | null; codigoIbge: string | null; }
export interface UnidadeUpdateRequest { nome: string; sigla: string; descricao: string | null; codigoIbge: string | null; }
