import { test } from 'node:test';
import assert from 'node:assert/strict';
import { login, listarTudo, criar, definirConexao, ErroApi, planejarAcao, compararCampos } from '../lib/api.mjs';

function respostaJson(status, corpo) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(corpo),
  };
}

// --- login ---

test('login: sucesso devolve o corpo (accessToken, usuario)', async () => {
  const fetchFalso = async (url, opts) => {
    assert.equal(url, 'https://api.exemplo/v1/auth/login');
    assert.equal(opts.method, 'POST');
    return respostaJson(200, {
      accessToken: 'tok123',
      expiresIn: 3600,
      usuario: { id: 1, papel: 'OPERADOR', trocaSenhaObrigatoria: false },
    });
  };
  const resultado = await login(fetchFalso, 'https://api.exemplo/v1', 'a@b.com', 'senha');
  assert.equal(resultado.accessToken, 'tok123');
});

test('login: 401 vira ErroApi', async () => {
  const fetchFalso = async () => respostaJson(401, { message: 'Credenciais invalidas' });
  await assert.rejects(
    () => login(fetchFalso, 'https://api.exemplo/v1', 'a@b.com', 'errada'),
    ErroApi
  );
});

test('login: troca de senha obrigatoria pendente -> script recusa (backend nao bloqueia)', async () => {
  const fetchFalso = async () =>
    respostaJson(200, {
      accessToken: 'tok123',
      usuario: { id: 1, papel: 'OPERADOR', trocaSenhaObrigatoria: true },
    });
  await assert.rejects(
    () => login(fetchFalso, 'https://api.exemplo/v1', 'a@b.com', 'senha'),
    /troca de senha/i
  );
});

test('login: papel VISUALIZADOR e insuficiente (minimo OPERADOR)', async () => {
  const fetchFalso = async () =>
    respostaJson(200, {
      accessToken: 'tok123',
      usuario: { id: 1, papel: 'VISUALIZADOR', trocaSenhaObrigatoria: false },
    });
  await assert.rejects(
    () => login(fetchFalso, 'https://api.exemplo/v1', 'a@b.com', 'senha'),
    /permiss/i
  );
});

// --- listarTudo ---

test('listarTudo: endpoint nao paginado (array puro) devolve direto', async () => {
  const fetchFalso = async () => respostaJson(200, [{ id: 1, nome: 'Roteador' }]);
  const itens = await listarTudo(async (u, o) => fetchFalso(u, o), 'https://api', 'tok', '/unidades');
  assert.deepEqual(itens, [{ id: 1, nome: 'Roteador' }]);
});

test('listarTudo: percorre todas as paginas de um PaginaResposta', async () => {
  let chamadas = 0;
  const fetchFalso = async (url) => {
    chamadas += 1;
    const pagina = new URL(url).searchParams.get('page');
    if (pagina === '0') {
      return respostaJson(200, { content: [{ id: 1 }, { id: 2 }], last: false });
    }
    return respostaJson(200, { content: [{ id: 3 }], last: true });
  };
  const itens = await listarTudo(fetchFalso, 'https://api', 'tok', '/equipamentos');
  assert.equal(chamadas, 2);
  assert.deepEqual(itens, [{ id: 1 }, { id: 2 }, { id: 3 }]);
});

test('listarTudo: erro HTTP vira ErroApi', async () => {
  const fetchFalso = async () => respostaJson(500, { message: 'boom' });
  await assert.rejects(() => listarTudo(fetchFalso, 'https://api', 'tok', '/monitores'), ErroApi);
});

// --- criar / definirConexao ---

test('criar: 201 devolve ok true e corpo', async () => {
  const fetchFalso = async (url, opts) => {
    assert.equal(opts.method, 'POST');
    return respostaJson(201, { id: 10 });
  };
  const resultado = await criar(fetchFalso, 'https://api', 'tok', '/unidades', { nome: 'X' });
  assert.equal(resultado.ok, true);
  assert.equal(resultado.status, 201);
});

test('criar: 409 devolve ok false com corpo ErroResposta', async () => {
  const fetchFalso = async () => respostaJson(409, { code: 'BUSINESS_CONFLICT', message: 'ja existe' });
  const resultado = await criar(fetchFalso, 'https://api', 'tok', '/unidades', { nome: 'X' });
  assert.equal(resultado.ok, false);
  assert.equal(resultado.corpo.code, 'BUSINESS_CONFLICT');
});

test('definirConexao: PUT no caminho correto', async () => {
  const fetchFalso = async (url, opts) => {
    assert.equal(url, 'https://api/unidades/5/conexao');
    assert.equal(opts.method, 'PUT');
    assert.deepEqual(JSON.parse(opts.body), { conectaAUnidadeId: 9 });
    return respostaJson(200, { id: 5 });
  };
  const resultado = await definirConexao(fetchFalso, 'https://api', 'tok', 5, 9);
  assert.equal(resultado.ok, true);
});

// --- plano de idempotencia ---

test('planejarAcao: ausente na API -> criar', () => {
  const resultado = planejarAcao({ nome: 'X' }, null, ['nome']);
  assert.equal(resultado.acao, 'criar');
});

test('planejarAcao: existente e igual -> pulado', () => {
  const resultado = planejarAcao({ nome: 'X', descricao: 'd' }, { nome: 'X', descricao: 'd' }, ['nome', 'descricao']);
  assert.equal(resultado.acao, 'pulado');
});

test('planejarAcao: existente e diferente -> divergente com lista de campos', () => {
  const resultado = planejarAcao(
    { nome: 'X', descricao: 'nova' },
    { nome: 'X', descricao: 'antiga' },
    ['nome', 'descricao']
  );
  assert.equal(resultado.acao, 'divergente');
  assert.deepEqual(resultado.campos, ['descricao']);
});

test('compararCampos: numeros com representacao textual diferente sao iguais (10 == 10.0)', () => {
  const divergentes = compararCampos({ latitude: '-10.5' }, { latitude: -10.5 }, ['latitude']);
  assert.deepEqual(divergentes, []);
});

test('compararCampos: nulo/vazio/undefined sao equivalentes', () => {
  const divergentes = compararCampos({ hostname: '' }, { hostname: null }, ['hostname']);
  assert.deepEqual(divergentes, []);
});
