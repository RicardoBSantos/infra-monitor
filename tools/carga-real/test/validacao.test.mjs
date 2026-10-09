import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexarGeoJson } from '../lib/geo.mjs';
import {
  motivoRecusaIp,
  ibgeFormatoValido,
  coordenadasCompletas,
  normalizarUf,
  validarLinhaTipo,
  validarLinhaUnidade,
  validarLinhaEquipamento,
  validarLinhaMonitor,
  validarLinhaConexao,
  encontrarChavesDuplicadas,
  encontrarIpsRepetidos,
} from '../lib/validacao.mjs';

const geojsonExemplo = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { id: '2800100', name: 'Municipio Teste' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-38, -11],
            [-37, -11],
            [-37, -10],
            [-38, -10],
            [-38, -11],
          ],
        ],
      },
    },
  ],
};

// --- motivoRecusaIp (espelha RegraIpv4 do backend) ---

for (const valor of [null, undefined, '', '   ', '10.0.0.1', ' 10.0.0.1 ', '223.255.255.255', '127.0.0.1']) {
  test(`motivoRecusaIp: aceita ${JSON.stringify(valor)}`, () => {
    assert.equal(motivoRecusaIp(valor), null);
  });
}

for (const [valor, mensagem] of [
  ['2001:db8::1', 'apenas IPv4 e suportado: o monitoramento ICMP nao sonda IPv6'],
  ['servidor.local', 'deve ser um endereco IPv4 no formato 192.168.0.10'],
  ['999.1.1.1', 'cada octeto do IP vai de 0 a 255'],
  ['010.0.0.1', 'octeto com zero a esquerda e ambiguo (pode ser lido como octal): escreva 10.0.0.1, nao 010.000.000.001'],
  ['0.0.0.0', 'a faixa 0.0.0.0/8 nao e endereco de host'],
  ['224.0.0.1', 'multicast, reservado ou broadcast (224.0.0.0 em diante) nao e endereco de host monitoravel'],
]) {
  test(`motivoRecusaIp: recusa ${valor}`, () => {
    assert.equal(motivoRecusaIp(valor), mensagem);
  });
}

test('validarLinhaEquipamento: IP recusado vira erro com o motivo', () => {
  const { erros } = validarLinhaEquipamento({ unidadeSigla: 'EX-01', tipoNome: 'Switch', nome: 'SW', ip: '010.0.0.1' });
  assert.deepEqual(erros, ['ip: octeto com zero a esquerda e ambiguo (pode ser lido como octal): escreva 10.0.0.1, nao 010.000.000.001']);
});

// --- ibgeFormatoValido ---

test('ibgeFormatoValido: exatamente 7 digitos', () => {
  assert.equal(ibgeFormatoValido('2800100'), true);
  assert.equal(ibgeFormatoValido('280010'), false);
  assert.equal(ibgeFormatoValido('28001000'), false);
  assert.equal(ibgeFormatoValido('280010a'), false);
});

// --- coordenadasCompletas ---

test('coordenadasCompletas: ambas ausentes ou ambas presentes -> true', () => {
  assert.equal(coordenadasCompletas(null, null), true);
  assert.equal(coordenadasCompletas('-10', '-37'), true);
});

test('coordenadasCompletas: apenas uma presente -> false', () => {
  assert.equal(coordenadasCompletas('-10', null), false);
  assert.equal(coordenadasCompletas(null, '-37'), false);
});

// --- validarLinhaTipo ---

test('validarLinhaTipo: nome obrigatorio', () => {
  const resultado = validarLinhaTipo({ nome: '' });
  assert.ok(resultado.erros.length > 0);
});

test('validarLinhaTipo: linha valida sem erros', () => {
  const resultado = validarLinhaTipo({ nome: 'Roteador' });
  assert.deepEqual(resultado.erros, []);
  assert.equal(resultado.chave, 'roteador');
});

// --- validarLinhaUnidade ---

test('validarLinhaUnidade: obrigatorios ausentes', () => {
  const resultado = validarLinhaUnidade({}, indexarGeoJson(geojsonExemplo));
  assert.ok(resultado.erros.includes('nome e obrigatorio'));
  assert.ok(resultado.erros.includes('sigla e obrigatoria'));
});

test('validarLinhaUnidade: IBGE com formato invalido', () => {
  const resultado = validarLinhaUnidade(
    { nome: 'Matriz', sigla: 'MTZ', codigoIbge: '123' },
    indexarGeoJson(geojsonExemplo)
  );
  assert.ok(resultado.erros.some((e) => e.includes('codigoIbge')));
});

test('validarLinhaUnidade: par de coordenadas incompleto e erro', () => {
  const resultado = validarLinhaUnidade(
    { nome: 'Matriz', sigla: 'MTZ', latitude: '-10.5' },
    indexarGeoJson(geojsonExemplo)
  );
  assert.ok(resultado.erros.some((e) => e.includes('latitude e longitude')));
});

test('validarLinhaUnidade: IBGE existente e coordenada coerente -> sem aviso', () => {
  const resultado = validarLinhaUnidade(
    { nome: 'Matriz', sigla: 'MTZ', codigoIbge: '2800100', latitude: '-10.5', longitude: '-37.5' },
    indexarGeoJson(geojsonExemplo)
  );
  assert.deepEqual(resultado.erros, []);
  assert.deepEqual(resultado.avisos, []);
});

test('validarLinhaUnidade: IBGE existente mas coordenada fora do municipio -> aviso, nao erro', () => {
  const resultado = validarLinhaUnidade(
    { nome: 'Matriz', sigla: 'MTZ', codigoIbge: '2800100', latitude: '0', longitude: '0' },
    indexarGeoJson(geojsonExemplo)
  );
  assert.deepEqual(resultado.erros, []);
  assert.equal(resultado.avisos.length, 1);
});

test('validarLinhaUnidade: IBGE com 7 digitos mas AUSENTE do GeoJSON -> ERRO (nao e enviado), mesmo sem coordenada', () => {
  const resultado = validarLinhaUnidade(
    { nome: 'Matriz', sigla: 'MTZ', codigoIbge: '9999999' },
    indexarGeoJson(geojsonExemplo)
  );
  assert.ok(resultado.erros.some((e) => e.includes('9999999') && e.includes('nao existe no GeoJSON')));
  assert.deepEqual(resultado.avisos, []);
});

test('validarLinhaUnidade: IBGE ausente do GeoJSON e ERRO mesmo COM coordenada informada', () => {
  const resultado = validarLinhaUnidade(
    { nome: 'Matriz', sigla: 'MTZ', codigoIbge: '9999999', latitude: '-10.5', longitude: '-37.5' },
    indexarGeoJson(geojsonExemplo)
  );
  assert.ok(resultado.erros.some((e) => e.includes('nao existe no GeoJSON')));
  // Como o IBGE nem existe, nao ha o que comparar com a coordenada: sem aviso de divergencia.
  assert.deepEqual(resultado.avisos, []);
});

// --- normalizarUf ---

test('normalizarUf: aplica trim e maiusculas (espelha UnidadeService.normalizarUf)', () => {
  assert.equal(normalizarUf(' se '), 'SE');
  assert.equal(normalizarUf('se'), 'SE');
  assert.equal(normalizarUf('SE'), 'SE');
});

test('normalizarUf: vazio/nulo vira null', () => {
  assert.equal(normalizarUf(''), null);
  assert.equal(normalizarUf(null), null);
  assert.equal(normalizarUf(undefined), null);
});

// --- validarLinhaEquipamento ---

test('validarLinhaEquipamento: obrigatorios ausentes', () => {
  const resultado = validarLinhaEquipamento({});
  assert.ok(resultado.erros.includes('unidadeSigla e obrigatoria'));
  assert.ok(resultado.erros.includes('tipoNome e obrigatorio'));
  assert.ok(resultado.erros.includes('nome e obrigatorio'));
});

test('validarLinhaEquipamento: IP invalido gera erro', () => {
  const resultado = validarLinhaEquipamento({
    unidadeSigla: 'MTZ',
    tipoNome: 'Roteador',
    nome: 'Router1',
    ip: '999.1.1.1',
  });
  assert.ok(resultado.erros.some((e) => e.includes('cada octeto do IP vai de 0 a 255')));
});

test('validarLinhaEquipamento: chave combina unidade e nome (case-insensitive)', () => {
  const resultado = validarLinhaEquipamento({
    unidadeSigla: 'MTZ',
    tipoNome: 'Roteador',
    nome: 'Router1',
  });
  assert.equal(resultado.chave, 'mtz::router1');
});

// --- validarLinhaMonitor ---

test('validarLinhaMonitor: intervalo fora da faixa e erro', () => {
  const resultado = validarLinhaMonitor({
    unidadeSigla: 'MTZ',
    equipamentoNome: 'Router1',
    nome: 'ping',
    tipo: 'ICMP',
    intervaloSegundos: '5',
    timeoutMs: '2000',
  });
  assert.ok(resultado.erros.some((e) => e.includes('intervaloSegundos')));
});

test('validarLinhaMonitor: linha valida', () => {
  const resultado = validarLinhaMonitor({
    unidadeSigla: 'MTZ',
    equipamentoNome: 'Router1',
    nome: 'ping',
    tipo: 'ICMP',
    intervaloSegundos: '60',
    timeoutMs: '2000',
    falhasParaIncidente: '3',
    sucessosParaRecovery: '2',
  });
  assert.deepEqual(resultado.erros, []);
});

// --- validarLinhaConexao ---

test('validarLinhaConexao: ambos os lados obrigatorios', () => {
  const resultado = validarLinhaConexao({ unidadeSigla: 'FIL' });
  assert.ok(resultado.erros.includes('conectaSigla e obrigatoria'));
});

// --- encontrarChavesDuplicadas ---

test('encontrarChavesDuplicadas: identifica repetidas, ignora chave nula', () => {
  const duplicadas = encontrarChavesDuplicadas([
    { chave: 'a' },
    { chave: 'a' },
    { chave: 'b' },
    { chave: null },
  ]);
  assert.deepEqual([...duplicadas], ['a']);
});

// --- encontrarIpsRepetidos ---

test('encontrarIpsRepetidos: mesmo IP na mesma unidade -> erro (porUnidade)', () => {
  const { porUnidade, entreUnidades } = encontrarIpsRepetidos([
    { unidadeSigla: 'MTZ', ip: '192.0.2.10' },
    { unidadeSigla: 'MTZ', ip: '192.0.2.10' },
  ]);
  assert.equal(porUnidade.has('mtz::192.0.2.10'), true);
  assert.equal(entreUnidades.size, 0);
});

test('encontrarIpsRepetidos: mesmo IP em unidades diferentes -> aviso (entreUnidades)', () => {
  const { porUnidade, entreUnidades } = encontrarIpsRepetidos([
    { unidadeSigla: 'MTZ', ip: '192.0.2.10' },
    { unidadeSigla: 'FIL', ip: '192.0.2.10' },
  ]);
  assert.equal(porUnidade.size, 0);
  assert.equal(entreUnidades.has('192.0.2.10'), true);
});
