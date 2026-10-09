export interface TipoEquipamentoResponse { id: number; nome: string; descricao: string | null; ativo: boolean; createdAt: string; updatedAt: string; }
export interface TipoEquipamentoCreateRequest { nome: string; descricao: string | null; }
export interface TipoEquipamentoUpdateRequest { nome: string; descricao: string | null; }
