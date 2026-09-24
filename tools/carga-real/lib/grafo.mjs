// Deteccao de ciclo no grafo de conexao de hub das unidades.
// Espelha a regra do backend (UnidadeService.validarAusenciaDeCiclo): uma
// aresta origem->destino so pode ser criada se destino NAO conseguir, andando
// pela cadeia de hubs, chegar de volta em origem. Auto-referencia (origem ==
// destino) tambem e ciclo (o caso mais curto).
//
// O grafo e representado como Map<chave, chave|null>, chave->hub atual
// (null/undefined = sem hub, e raiz). A chave e livre (aqui, sigla da unidade
// em minusculas) para que o chamador combine estado da API com o arquivo.

const TETO_PROFUNDIDADE = 1000; // cadeia real e rasa; teto so contra grafo corrompido.

/**
 * true se adicionar a aresta origem->destino ao grafo fechraria um ciclo
 * (incluindo auto-referencia origem === destino).
 */
export function criariCiclo(grafo, origem, destino) {
  if (origem === destino) return true;
  let atual = destino;
  let passos = 0;
  const visitados = new Set();
  while (atual != null && passos < TETO_PROFUNDIDADE) {
    if (atual === origem) return true;
    if (visitados.has(atual)) return false; // ciclo preexistente que nao envolve origem
    visitados.add(atual);
    atual = grafo.has(atual) ? grafo.get(atual) : null;
    passos += 1;
  }
  return false;
}

/**
 * Aplica uma lista ordenada de arestas desejadas [{origem, destino}] sobre um
 * grafo base (por exemplo, o estado atual da API), validando cada uma contra
 * o grafo acumulado ate aqui (arquivo + API). Devolve, para cada aresta na
 * mesma ordem de entrada, { origem, destino, ok, motivo? }. Arestas invalidas
 * NAO sao aplicadas ao grafo acumulado (nao contaminam as proximas).
 */
export function validarArestas(grafoBase, arestasDesejadas) {
  const grafo = new Map(grafoBase);
  const resultados = [];
  for (const { origem, destino } of arestasDesejadas) {
    if (criariCiclo(grafo, origem, destino)) {
      resultados.push({
        origem,
        destino,
        ok: false,
        motivo:
          origem === destino
            ? 'auto-referencia: uma unidade nao pode ser seu proprio hub'
            : `conectar ${origem} a ${destino} fecharia um ciclo entre unidades`,
      });
      continue;
    }
    grafo.set(origem, destino);
    resultados.push({ origem, destino, ok: true });
  }
  return resultados;
}
