import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { executar } from '../carga.mjs';

function jsonResp(status, corpo) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(corpo) };
}

async function novoDiretorioEntrada(prefixo, jsonEntrada) {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefixo));
  await writeFile(path.join(dir, 'entrada.json'), JSON.stringify(jsonEntrada), 'utf8');
  return path.join(dir, 'entrada.json');
}

const envBase = { CARGA_API_URL: 'https://fake.local/v1', CARGA_EMAIL: 'a@b.com', CARGA_SENHA: 'x' };
const geojsonVazio = { type: 'FeatureCollection', features: [] };

async function comGeojsonTemporario(t, geojson = geojsonVazio) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'carga-geo-'));
  const arquivo = path.join(dir, 'geo.json');
  await writeFile(arquivo, JSON.stringify(geojson), 'utf8');
  t.after(() => rm(dir, { recursive: true, force: true }));
  return arquivo;
}

async function rodar({ dados, estado, aplicar = false, geojson, t }) {
  const entrada = await novoDiretorioEntrada('carga-teste-', dados);
  t.after(() => rm(path.dirname(entrada), { recursive: true, force: true }));
  const geojsonPath = geojson || (await comGeojsonTemporario(t));
  const relatorioPath = path.join(path.dirname(entrada), 'relatorio.json');

  let nextId = 1000;
  const fetchFalso = async (url, opts = {}) => {
    const u = new URL(url);
    const p = u.pathname.replace(/^\/v1/, '');
    const method = opts.method || 'GET';
    if (p === '/auth/login') {
      return jsonResp(200, { accessToken: 'tok', usuario: { id: 1, papel: 'OPERADOR', trocaSenhaObrigatoria: false } });
    }
    if (method === 'GET' && p === '/tipos-equipamento') return jsonResp(200, estado.tipos);
    if (method === 'GET' && p === '/unidades') return jsonResp(200, estado.unidades);
    if (method === 'GET' && p === '/equipamentos') return jsonResp(200, { content: estado.equipamentos, last: true });
    if (method === 'GET' && p === '/monitores') return jsonResp(200, { content: estado.monitores, last: true });

    if (method === 'POST' && p === '/tipos-equipamento') {
      const corpo = JSON.parse(opts.body);
      if (estado.recusarTipo) return jsonResp(409, { code: 'BUSINESS_CONFLICT', message: 'ja existe' });
      const item = { id: nextId++, ...corpo, ativo: true };
      estado.tipos.push(item);
      return jsonResp(201, item);
    }
    if (method === 'POST' && p === '/unidades') {
      const corpo = JSON.parse(opts.body);
      const item = { id: nextId++, ...corpo, ativo: true, conectaAUnidadeId: null };
      estado.unidades.push(item);
      return jsonResp(201, item);
    }
    if (method === 'POST' && p === '/equipamentos') {
      const corpo = JSON.parse(opts.body);
      const unidade = estado.unidades.find((x) => x.id === corpo.unidadeId);
      const tipo = estado.tipos.find((x) => x.id === corpo.tipoEquipamentoId);
      const item = {
        id: nextId++,
        ...corpo,
        ativo: true,
        emManutencao: false,
        unidade: { id: unidade.id, nome: unidade.nome },
        tipoEquipamento: { id: tipo.id, nome: tipo.nome },
      };
      estado.equipamentos.push(item);
      return jsonResp(201, item);
    }
    if (method === 'POST' && p === '/monitores') {
      const corpo = JSON.parse(opts.body);
      const equipamento = estado.equipamentos.find((x) => x.id === corpo.equipamentoId);
      const item = {
        id: nextId++,
        ...corpo,
        ativo: true,
        equipamento: { id: equipamento.id, nome: equipamento.nome },
        // Espelha MonitorService: quando o campo nao vem no corpo, o backend
        // aplica o default (3 / 2), nunca deixa null.
        falhasParaIncidente: corpo.falhasParaIncidente ?? 3,
        sucessosParaRecovery: corpo.sucessosParaRecovery ?? 2,
      };
      estado.monitores.push(item);
      return jsonResp(201, item);
    }
    throw new Error(`rota nao mapeada no fake: ${method} ${p}`);
  };

  const codigo = await executar({
    argv: ['--entrada', entrada, '--geojson', geojsonPath, ...(aplicar ? ['--aplicar'] : []), '--relatorio', relatorioPath],
    env: envBase,
    fetchImpl: fetchFalso,
    escreverArquivo: (p, c) => writeFile(p, c, 'utf8'),
    log: () => {},
    logErro: () => {},
  });
  const relatorio = JSON.parse(await readFile(relatorioPath, 'utf8'));
  return { codigo, relatorio };
}

// ---------------------------------------------------------------------------
// Fix 1: idempotencia do monitor com campos opcionais omitidos
// ---------------------------------------------------------------------------

test('monitor: falhasParaIncidente/sucessosParaRecovery omitidos no arquivo nao geram divergente na 2a rodada', async (t) => {
  const dados = {
    tipos: [{ nome: 'Roteador' }],
    unidades: [{ nome: 'U1', sigla: 'U1' }],
    equipamentos: [{ unidadeSigla: 'U1', tipoNome: 'Roteador', nome: 'Eq1' }],
    monitores: [{ unidadeSigla: 'U1', equipamentoNome: 'Eq1', tipo: 'ICMP', nome: 'ping', intervaloSegundos: 60, timeoutMs: 2000 }],
    conexoes: [],
  };
  const estado = { tipos: [], unidades: [], equipamentos: [], monitores: [] };

  const rodada1 = await rodar({ dados, estado, aplicar: true, t });
  assert.equal(rodada1.relatorio.resumo.falhas, 0);
  assert.equal(rodada1.relatorio.resumo.criados, 4);

  const rodada2 = await rodar({ dados, estado, aplicar: true, t });
  const itemMonitor = rodada2.relatorio.itens.find((i) => i.fase === 'monitor');
  assert.equal(itemMonitor.acao, 'pulado', `esperava pulado, recebeu ${JSON.stringify(itemMonitor)}`);
  assert.equal(rodada2.relatorio.resumo.divergentes, 0);
  assert.equal(rodada2.relatorio.resumo.pulados, 4);
});

// ---------------------------------------------------------------------------
// Fix 2: uf em caixa diferente nao gera divergente
// ---------------------------------------------------------------------------

test('unidade: uf em minusculas no arquivo casa com uf em maiusculas ja gravada na API (normalizarUf do backend)', async (t) => {
  const dados = {
    tipos: [],
    unidades: [{ nome: 'Matriz', sigla: 'MTZ', uf: 'se' }],
    equipamentos: [],
    monitores: [],
    conexoes: [],
  };
  const estado = {
    tipos: [],
    unidades: [{ id: 1, nome: 'Matriz', sigla: 'MTZ', descricao: null, codigoIbge: null, endereco: null, cidade: null, uf: 'SE', latitude: null, longitude: null, conectaAUnidadeId: null }],
    equipamentos: [],
    monitores: [],
  };

  const { relatorio } = await rodar({ dados, estado, aplicar: false, t });
  const itemUnidade = relatorio.itens.find((i) => i.fase === 'unidade');
  assert.equal(itemUnidade.acao, 'pulado', `esperava pulado, recebeu ${JSON.stringify(itemUnidade)}`);
});

// ---------------------------------------------------------------------------
// Fix: falha em runtime (409/400) marca dependentes como "pulado: dependência falhou"
// ---------------------------------------------------------------------------

test('runtime: POST de tipo recusado (409) marca equipamento dependente como pulado: dependência falhou', async (t) => {
  const dados = {
    tipos: [{ nome: 'Roteador' }],
    unidades: [{ nome: 'U1', sigla: 'U1' }],
    equipamentos: [{ unidadeSigla: 'U1', tipoNome: 'Roteador', nome: 'Eq1' }],
    monitores: [],
    conexoes: [],
  };
  const estado = { tipos: [], unidades: [], equipamentos: [], monitores: [], recusarTipo: true };

  const { relatorio } = await rodar({ dados, estado, aplicar: true, t });
  const itemTipo = relatorio.itens.find((i) => i.fase === 'tipo');
  const itemEquipamento = relatorio.itens.find((i) => i.fase === 'equipamento');
  assert.equal(itemTipo.acao, 'falha');
  assert.equal(itemEquipamento.acao, 'pulado');
  assert.match(itemEquipamento.motivo, /pulado: dependência falhou/);
});

// ---------------------------------------------------------------------------
// Fix: abort por 401 conta em resumo.falhas
// ---------------------------------------------------------------------------

test('401 no meio da execucao: item de abort e contado em resumo.falhas', async (t) => {
  const dados = {
    tipos: [{ nome: 'Roteador' }],
    unidades: [],
    equipamentos: [],
    monitores: [],
    conexoes: [],
  };
  const estado = { tipos: [], unidades: [], equipamentos: [], monitores: [] };
  const entrada = await novoDiretorioEntrada('carga-401-', dados);
  t.after(() => rm(path.dirname(entrada), { recursive: true, force: true }));
  const geojsonPath = await comGeojsonTemporario(t);
  const relatorioPath = path.join(path.dirname(entrada), 'relatorio.json');

  const fetchFalso = async (url, opts = {}) => {
    const u = new URL(url);
    const p = u.pathname.replace(/^\/v1/, '');
    const method = opts.method || 'GET';
    if (p === '/auth/login') return jsonResp(200, { accessToken: 'tok', usuario: { id: 1, papel: 'OPERADOR', trocaSenhaObrigatoria: false } });
    if (method === 'GET') return jsonResp(200, p === '/tipos-equipamento' || p === '/unidades' ? [] : { content: [], last: true });
    if (method === 'POST') return jsonResp(401, { message: 'sessao expirada' });
    throw new Error(`rota nao mapeada: ${method} ${p}`);
  };

  const codigo = await executar({
    argv: ['--entrada', entrada, '--geojson', geojsonPath, '--aplicar', '--relatorio', relatorioPath],
    env: envBase,
    fetchImpl: fetchFalso,
    escreverArquivo: (p, c) => writeFile(p, c, 'utf8'),
    log: () => {},
    logErro: () => {},
  });
  const relatorio = JSON.parse(await readFile(relatorioPath, 'utf8'));

  assert.equal(codigo, 1);
  assert.equal(relatorio.resumo.falhas, 1, `esperava resumo.falhas=1, recebeu ${JSON.stringify(relatorio.resumo)}`);
  assert.ok(relatorio.abortadoEm);
});

// ---------------------------------------------------------------------------
// Fix: aresta divergente/nao aplicada nao contamina o grafo para as proximas linhas
// (cobertura de ponta a ponta; a unidade do grafo puro esta em test/grafo.test.mjs)
// ---------------------------------------------------------------------------

test('conexao: hub ja existente e diferente do arquivo fica divergente e nao afeta o cheque de ciclo de outra linha', async (t) => {
  const dados = {
    tipos: [],
    unidades: [],
    equipamentos: [],
    monitores: [],
    conexoes: [
      { unidadeSigla: 'A', conectaSigla: 'B' }, // A ja aponta para Z na API -> divergente, nao aplicado
      { unidadeSigla: 'B', conectaSigla: 'A' }, // so fecharia ciclo se a linha anterior tivesse sido aplicada
    ],
  };
  const estado = {
    tipos: [],
    unidades: [
      { id: 1, sigla: 'A', nome: 'A', conectaAUnidadeId: 3 },
      { id: 2, sigla: 'B', nome: 'B', conectaAUnidadeId: null },
      { id: 3, sigla: 'Z', nome: 'Z', conectaAUnidadeId: null },
    ],
    equipamentos: [],
    monitores: [],
  };

  const { relatorio } = await rodar({ dados, estado, aplicar: false, t });
  const itens = relatorio.itens.filter((i) => i.fase === 'conexao');
  const itemA = itens.find((i) => i.chave === 'a');
  const itemB = itens.find((i) => i.chave === 'b');
  assert.equal(itemA.acao, 'divergente', `esperava divergente, recebeu ${JSON.stringify(itemA)}`);
  assert.equal(itemB.acao, 'criar', `b->a nao deveria ser rejeitada como ciclo: ${JSON.stringify(itemB)}`);
});
