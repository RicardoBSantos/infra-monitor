// Camada de acesso a API real do Infra Monitor. Todas as funcoes que fazem
// requisicao recebem o `fetch` como primeiro parametro (injecao de
// dependencia) para que os testes rodem sem rede.

export class ErroApi extends Error {
  constructor(status, corpo) {
    super((corpo && corpo.message) || `Erro HTTP ${status}`);
    this.name = 'ErroApi';
    this.status = status;
    this.corpo = corpo;
  }
}

function cabecalhos(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function lerCorpo(resposta) {
  const texto = await resposta.text();
  if (!texto) return null;
  try {
    return JSON.parse(texto);
  } catch {
    return { message: texto };
  }
}

/**
 * POST /auth/login. Lanca ErroApi em credenciais invalidas/conta desativada
 * (o backend responde 401/403). Se o usuario tiver troca de senha
 * obrigatoria pendente, o backend HOJE nao bloqueia o login (confirmado em
 * AuthService.login/AuthController) -- entao o proprio script recusa
 * prosseguir, para nao operar com uma credencial que a tela de login
 * consideraria invalida.
 */
export async function login(fetchImpl, baseUrl, email, senha) {
  const resposta = await fetchImpl(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, senha }),
  });
  const corpo = await lerCorpo(resposta);
  if (!resposta.ok) throw new ErroApi(resposta.status, corpo);

  if (corpo && corpo.usuario && corpo.usuario.trocaSenhaObrigatoria) {
    const erro = new Error(
      'Usuario com troca de senha obrigatoria pendente; o script recusa prosseguir ' +
        '(o backend nao bloqueia isso sozinho no login).'
    );
    erro.name = 'TrocaSenhaObrigatoriaError';
    throw erro;
  }

  const papel = corpo && corpo.usuario && corpo.usuario.papel;
  if (papel !== 'ADMIN' && papel !== 'OPERADOR') {
    const erro = new Error(
      `Papel "${papel}" nao tem permissao para cadastrar (minimo OPERADOR).`
    );
    erro.name = 'PapelInsuficienteError';
    throw erro;
  }

  return corpo; // { accessToken, expiresIn, usuario }
}

/**
 * GET de uma lista, percorrendo paginacao quando o endpoint devolver
 * PaginaResposta ({content, page, size, totalPages, last, ...}); endpoints
 * que devolvem array puro (tipos-equipamento, unidades) sao devolvidos como
 * vierem, sem paginar.
 */
export async function listarTudo(fetchImpl, baseUrl, token, caminho, params = {}) {
  const itens = [];
  let pagina = 0;
  for (;;) {
    const query = new URLSearchParams({ ...params, page: String(pagina), size: '200' });
    const resposta = await fetchImpl(`${baseUrl}${caminho}?${query}`, { headers: cabecalhos(token) });
    const corpo = await lerCorpo(resposta);
    if (!resposta.ok) throw new ErroApi(resposta.status, corpo);

    if (Array.isArray(corpo)) return corpo; // endpoint nao paginado

    const conteudo = (corpo && corpo.content) || [];
    itens.push(...conteudo);
    if (!corpo || corpo.last === true || conteudo.length === 0) break;
    pagina += 1;
  }
  return itens;
}

export async function criar(fetchImpl, baseUrl, token, caminho, corpoRequisicao) {
  const resposta = await fetchImpl(`${baseUrl}${caminho}`, {
    method: 'POST',
    headers: { ...cabecalhos(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(corpoRequisicao),
  });
  const corpo = await lerCorpo(resposta);
  return { status: resposta.status, ok: resposta.ok, corpo };
}

export async function definirConexao(fetchImpl, baseUrl, token, unidadeId, conectaAUnidadeId) {
  const resposta = await fetchImpl(`${baseUrl}/unidades/${unidadeId}/conexao`, {
    method: 'PUT',
    headers: { ...cabecalhos(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ conectaAUnidadeId }),
  });
  const corpo = await lerCorpo(resposta);
  return { status: resposta.status, ok: resposta.ok, corpo };
}

// ---------------------------------------------------------------------------
// Plano de idempotencia: puro, sem rede. Compara o que o arquivo pede com o
// que ja existe (lido antes via listarTudo) e decide a acao.
// ---------------------------------------------------------------------------

function normalizarValorComparavel(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  if (typeof valor === 'number') return Math.round(valor * 1e6) / 1e6;
  if (typeof valor === 'string') {
    const numero = Number(valor);
    if (valor.trim() !== '' && Number.isFinite(numero) && /^-?\d+(\.\d+)?$/.test(valor.trim())) {
      return Math.round(numero * 1e6) / 1e6;
    }
    return valor.trim();
  }
  return valor;
}

export function compararCampos(desejado, existente, campos) {
  const divergentes = [];
  for (const campo of campos) {
    const a = normalizarValorComparavel(desejado[campo]);
    const b = normalizarValorComparavel(existente[campo]);
    if (a !== b) divergentes.push(campo);
  }
  return divergentes;
}

/**
 * Decide a acao de idempotencia para um item.
 * - existente ausente (null/undefined) -> "criar"
 * - existente presente e igual em todos os `campos` -> "pulado"
 * - existente presente e diferente em algum campo -> "divergente" (com a lista)
 */
export function planejarAcao(desejado, existente, campos) {
  if (existente === null || existente === undefined) {
    return { acao: 'criar' };
  }
  const divergentes = compararCampos(desejado, existente, campos);
  if (divergentes.length === 0) {
    return { acao: 'pulado', motivo: 'ja existe na API e e igual ao arquivo' };
  }
  return { acao: 'divergente', motivo: 'ja existe na API com campos diferentes', campos: divergentes };
}
