import { origemDaManutencao } from './origem-manutencao';

describe('origemDaManutencao', () => {
  it('é nula fora de manutenção', () => {
    expect(origemDaManutencao({ emManutencao: false, manutencaoManual: false, janelaAtivaId: null })).toBeNull();
  });
  it('distingue manual, janela e os dois', () => {
    expect(origemDaManutencao({ emManutencao: true, manutencaoManual: true, janelaAtivaId: null })).toBe('Manual');
    expect(origemDaManutencao({ emManutencao: true, manutencaoManual: false, janelaAtivaId: 41 })).toBe('Janela #41');
    expect(origemDaManutencao({ emManutencao: true, manutencaoManual: true, janelaAtivaId: 41 })).toBe('Manual + janela #41');
  });
  it('em manutenção sem manual nem janela ativa é "Origem desconhecida"', () => {
    expect(origemDaManutencao({ emManutencao: true, manutencaoManual: false, janelaAtivaId: null })).toBe('Origem desconhecida');
  });
});
