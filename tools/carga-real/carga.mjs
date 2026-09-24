#!/usr/bin/env node
// Script de carga real do Infra Monitor: cadastra tipo -> unidade -> equipamento
// -> monitor -> conexao de hub pela API REST, nunca por SQL.
//
// Uso:
//   node carga.mjs --entrada <arquivo.json|diretorio> [--aplicar] [--relatorio saida.json] [--geojson caminho]
//
// Padrao e simulacao (dry-run): le a API (GET) e valida, nao escreve nada.
// Sem --aplicar, NENHUM POST/PUT e enviado.
//
// Credenciais so por variavel de ambiente: CARGA_API_URL, CARGA_EMAIL, CARGA_SENHA.

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseCsv } from './lib/csv.mjs';
import { indexarGeoJson } from './lib/geo.mjs';
import {
  normalizarTexto,
  chaveMinuscula,
  validarLinhaTipo,
  validarLinhaUnidade,
  validarLinhaEquipamento,
  validarLinhaMonitor,
  validarLinhaConexao,
  encontrarChavesDuplicadas,
  encontrarIpsRepetidos,
} from './lib/validacao.mjs';
import { validarArestas } from './lib/grafo.mjs';
import { login, listarTudo, criar, definirConexao, planejarAcao } from './lib/api.mjs';

const __filename = fileURLToPath(import.meta.url);
const DIRETORIO_SCRIPT = path.dirname(__filename);
const GEOJSON_PADRAO = path.resolve(
  DIRETORIO_SCRIPT,
  '../../infra-monitor-frontend/public/assets/maps/se-municipalities.geo.json'
);

// ---------------------------------------------------------------------------
// Argumentos e ambiente
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
  const args = { entrada: null, aplicar: false, relatorio: null, geojson: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--entrada') args.entrada = argv[++i];
    else if (arg === '--aplicar') args.aplicar = true;
    else if (arg === '--relatorio') args.relatorio = argv[++i];
    else if (arg === '--geojson') args.geojson = argv[++i];
    else throw new ErroConfiguracao(`Argumento desconhecido: ${arg}`);
  }
  if (!args.entrada) throw new ErroConfiguracao('--entrada e obrigatorio (arquivo .json ou diretorio de CSVs)');
  return args;
}

export class ErroConfiguracao extends Error {}

export function lerCredenciais(env) {
  const faltando = ['CARGA_API_URL', 'CARGA_EMAIL', 'CARGA_SENHA'].filter((chave) => !env[chave]);
  if (faltando.length > 0) {
    throw new ErroConfiguracao(
      `Variaveis de ambiente ausentes: ${faltando.join(', ')}. ` +
        'Defina CARGA_API_URL, CARGA_EMAIL e CARGA_SENHA antes de rodar o script.'
    );
  }
  return {
    apiUrl: env.CARGA_API_URL.replace(/\/+$/, ''),
    email: env.CARGA_EMAIL,
    senha: env.CARGA_SENHA,
  };
}

// ---------------------------------------------------------------------------
// Carregamento de dados de entrada (JSON unico ou diretorio de CSVs)
// ---------------------------------------------------------------------------

const CAMPOS_POR_ARQUIVO = {
  tipos: ['nome', 'descricao'],
  unidades: ['nome', 'sigla', 'descricao', 'codigoIbge', 'endereco', 'cidade', 'uf', 'latitude', 'longitude'],
  equipamentos: [
    'unidadeSigla',
    'tipoNome',
    'nome',
    'ip',
    'hostname',
    'descricao',
    'localizacao',
    'numeroSerie',
    'fabricante',
    'modelo',
  ],
  monitores: [
    'unidadeSigla',
    'equipamentoNome',
    'tipo',
    'nome',
    'intervaloSegundos',
    'timeoutMs',
    'falhasParaIncidente',
    'sucessosParaRecovery',
  ],
  conexoes: ['unidadeSigla', 'conectaSigla'],
};

export async function carregarDados(caminhoEntrada) {
  const stat = await statSeguro(caminhoEntrada);
  if (!stat) throw new ErroConfiguracao(`Entrada nao encontrada: ${caminhoEntrada}`);

  if (stat.isFile()) {
    const texto = await readFile(caminhoEntrada, 'utf8');
    let json;
    try {
      json = JSON.parse(texto);
    } catch (erro) {
      throw new ErroConfiguracao(`JSON de entrada invalido (${caminhoEntrada}): ${erro.message}`);
    }
    return normalizarDados(json);
  }

  const dados = {};
  for (const nomeArquivo of Object.keys(CAMPOS_POR_ARQUIVO)) {
    const arquivo = path.join(caminhoEntrada, `${nomeArquivo}.csv`);
    const existe = await statSeguro(arquivo);
    if (!existe) {
      dados[nomeArquivo] = [];
      continue;
    }
    const texto = await readFile(arquivo, 'utf8');
    dados[nomeArquivo] = parseCsv(texto);
  }
  return normalizarDados(dados);
}

async function statSeguro(caminho) {
  try {
    const { stat } = await import('node:fs/promises');
    return await stat(caminho);
  } catch {
    return null;
  }
}

function normalizarDados(bruto) {
  return {
    tipos: Array.isArray(bruto.tipos) ? bruto.tipos : [],
    unidades: Array.isArray(bruto.unidades) ? bruto.unidades : [],
    equipamentos: Array.isArray(bruto.equipamentos) ? bruto.equipamentos : [],
    monitores: Array.isArray(bruto.monitores) ? bruto.monitores : [],
    conexoes: Array.isArray(bruto.conexoes) ? bruto.conexoes : [],
  };
}

export async function carregarGeoJson(caminho) {
  const alvo = caminho || GEOJSON_PADRAO;
  const texto = await readFile(alvo, 'utf8');
  return JSON.parse(texto);
}

// ---------------------------------------------------------------------------
// Estado atual da API (para idempotencia e resolucao de referencias)
// ---------------------------------------------------------------------------

async function carregarEstadoApi(fetchImpl, apiUrl, token) {
  const [tipos, unidades, equipamentos, monitores] = await Promise.all([
    listarTudo(fetchImpl, apiUrl, token, '/tipos-equipamento'),
    listarTudo(fetchImpl, apiUrl, token, '/unidades'),
    listarTudo(fetchImpl, apiUrl, token, '/equipamentos'),
    listarTudo(fetchImpl, apiUrl, token, '/monitores'),
  ]);
  return { tipos, unidades, equipamentos, monitores };
}

// ---------------------------------------------------------------------------
// Orquestracao principal
// ---------------------------------------------------------------------------

export async function executar({ argv, env, fetchImpl, escreverArquivo, log = console.log, logErro = console.error }) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (erro) {
    logErro(`Erro de configuracao: ${erro.message}`);
    return 2;
  }

  let credenciais;
  try {
    credenciais = lerCredenciais(env);
  } catch (erro) {
    logErro(`Erro de configuracao: ${erro.message}`);
    return 2;
  }

  let dados;
  let geojson;
  try {
    dados = await carregarDados(args.entrada);
    geojson = await carregarGeoJson(args.geojson);
  } catch (erro) {
    logErro(`Erro ao carregar entrada: ${erro.message}`);
    return 1;
  }
  const indiceGeoJson = indexarGeoJson(geojson);
  let idSimulado = -1; // ids negativos e decrescentes: placeholders so para o dry-run resolver fases seguintes

  const relatorio = {
    iniciadoEm: new Date().toISOString(),
    modo: args.aplicar ? 'aplicar' : 'dry-run',
    api: credenciais.apiUrl,
    resumo: { criados: 0, pulados: 0, divergentes: 0, falhas: 0, avisos: 0 },
    itens: [],
  };

  function registrar(item) {
    relatorio.itens.push(item);
    if (item.acao === 'criado') relatorio.resumo.criados += 1;
    if (item.acao === 'criar') relatorio.resumo.criados += 1; // dry-run: seria criado
    if (item.acao === 'pulado') relatorio.resumo.pulados += 1;
    if (item.acao === 'divergente') relatorio.resumo.divergentes += 1;
    if (item.acao === 'falha') relatorio.resumo.falhas += 1;
    if (item.avisos && item.avisos.length > 0) relatorio.resumo.avisos += item.avisos.length;
  }

  let sessao;
  try {
    sessao = await login(fetchImpl, credenciais.apiUrl, credenciais.email, credenciais.senha);
  } catch (erro) {
    logErro(`Falha no login: ${erro.message}`);
    return 1;
  }
  const token = sessao.accessToken;

  let estadoApi;
  try {
    estadoApi = await carregarEstadoApi(fetchImpl, credenciais.apiUrl, token);
  } catch (erro) {
    logErro(`Falha ao ler estado atual da API: ${erro.message}`);
    return 1;
  }

  // ------------------------------------------------------------------
  // Mapas de resolucao (chave natural -> id) seedados com o estado atual.
  // ------------------------------------------------------------------
  const tiposPorNome = new Map(estadoApi.tipos.map((t) => [chaveMinuscula(t.nome), t]));
  const unidadesPorSigla = new Map(estadoApi.unidades.map((u) => [chaveMinuscula(u.sigla), u]));
  const unidadesPorId = new Map(estadoApi.unidades.map((u) => [u.id, u]));

  const equipamentosPorChave = new Map();
  for (const equipamento of estadoApi.equipamentos) {
    const unidade = unidadesPorId.get(equipamento.unidade.id);
    const siglaUnidade = unidade ? chaveMinuscula(unidade.sigla) : `#${equipamento.unidade.id}`;
    equipamentosPorChave.set(`${siglaUnidade}::${chaveMinuscula(equipamento.nome)}`, equipamento);
  }
  const equipamentosPorId = new Map(estadoApi.equipamentos.map((e) => [e.id, e]));

  const monitoresPorChave = new Map();
  for (const monitor of estadoApi.monitores) {
    const equipamento = equipamentosPorId.get(monitor.equipamento.id);
    let chaveEquip = `#${monitor.equipamento.id}`;
    if (equipamento) {
      const unidade = unidadesPorId.get(equipamento.unidade.id);
      const siglaUnidade = unidade ? chaveMinuscula(unidade.sigla) : `#${equipamento.unidade.id}`;
      chaveEquip = `${siglaUnidade}::${chaveMinuscula(equipamento.nome)}`;
    }
    monitoresPorChave.set(`${chaveEquip}::${chaveMinuscula(monitor.nome)}`, monitor);
  }

  // grafo de hub atual, chaveado por sigla em minusculas
  const grafoHubBase = new Map();
  for (const unidade of estadoApi.unidades) {
    if (unidade.conectaAUnidadeId) {
      const hub = unidadesPorId.get(unidade.conectaAUnidadeId);
      if (hub) grafoHubBase.set(chaveMinuscula(unidade.sigla), chaveMinuscula(hub.sigla));
    }
  }

  // ------------------------------------------------------------------
  // Fase 1: tipos
  // ------------------------------------------------------------------
  const tiposValidados = dados.tipos.map((linha) => ({ linha, ...validarLinhaTipo(linha) }));
  const tiposDuplicados = encontrarChavesDuplicadas(tiposValidados);
  for (const item of tiposValidados) {
    if (item.chave !== null && tiposDuplicados.has(item.chave)) {
      item.erros.push('nome duplicado no arquivo de tipos');
    }
  }
  const tiposChavesFalhadas = new Set(
    tiposValidados.filter((i) => i.erros.length > 0 && i.chave !== null).map((i) => i.chave)
  );

  for (const item of tiposValidados) {
    if (item.erros.length > 0) {
      registrar({ fase: 'tipo', chave: item.linha.nome ?? '(sem nome)', acao: 'falha', motivo: item.erros.join('; ') });
      continue;
    }
    const existente = tiposPorNome.get(item.chave);
    const desejado = { nome: normalizarTexto(item.linha.nome), descricao: normalizarTexto(item.linha.descricao) };
    const plano = planejarAcao(desejado, existente, ['nome', 'descricao']);

    if (plano.acao === 'criar' && args.aplicar) {
      const resposta = await criar(fetchImpl, credenciais.apiUrl, token, '/tipos-equipamento', desejado);
      if (resposta.status === 401) {
        return finalizarComAbortoPor401(relatorio, 'tipo', item.chave, escreverArquivo, args, log, logErro);
      }
      if (!resposta.ok) {
        registrar({ fase: 'tipo', chave: item.chave, acao: 'falha', motivo: resposta.corpo?.message || 'erro HTTP', http: { status: resposta.status, corpo: resposta.corpo } });
        continue;
      }
      tiposPorNome.set(item.chave, resposta.corpo);
      registrar({ fase: 'tipo', chave: item.chave, acao: 'criado', avisos: item.avisos });
    } else if (plano.acao === 'criar') {
      tiposPorNome.set(item.chave, { id: idSimulado--, ...desejado });
      registrar({ fase: 'tipo', chave: item.chave, acao: 'criar', motivo: 'dry-run: seria criado', avisos: item.avisos });
    } else {
      registrar({ fase: 'tipo', chave: item.chave, acao: plano.acao, motivo: plano.motivo, campos: plano.campos, avisos: item.avisos });
    }
  }

  // ------------------------------------------------------------------
  // Fase 2: unidades
  // ------------------------------------------------------------------
  const unidadesValidadas = dados.unidades.map((linha) => ({ linha, ...validarLinhaUnidade(linha, indiceGeoJson) }));
  const unidadesDuplicadas = encontrarChavesDuplicadas(unidadesValidadas);
  for (const item of unidadesValidadas) {
    if (item.chave !== null && unidadesDuplicadas.has(item.chave)) {
      item.erros.push('sigla duplicada no arquivo de unidades');
    }
  }
  const unidadesChavesFalhadas = new Set(
    unidadesValidadas.filter((i) => i.erros.length > 0 && i.chave !== null).map((i) => i.chave)
  );

  for (const item of unidadesValidadas) {
    if (item.erros.length > 0) {
      registrar({ fase: 'unidade', chave: item.linha.sigla ?? '(sem sigla)', acao: 'falha', motivo: item.erros.join('; ') });
      continue;
    }
    const existente = unidadesPorSigla.get(item.chave);
    const desejado = {
      nome: normalizarTexto(item.linha.nome),
      sigla: normalizarTexto(item.linha.sigla),
      descricao: normalizarTexto(item.linha.descricao),
      codigoIbge: normalizarTexto(item.linha.codigoIbge),
      endereco: normalizarTexto(item.linha.endereco),
      cidade: normalizarTexto(item.linha.cidade),
      uf: normalizarTexto(item.linha.uf),
      latitude: normalizarTexto(item.linha.latitude),
      longitude: normalizarTexto(item.linha.longitude),
    };
    const plano = planejarAcao(desejado, existente, [
      'nome', 'sigla', 'descricao', 'codigoIbge', 'endereco', 'cidade', 'uf', 'latitude', 'longitude',
    ]);

    if (plano.acao === 'criar' && args.aplicar) {
      const resposta = await criar(fetchImpl, credenciais.apiUrl, token, '/unidades', desejado);
      if (resposta.status === 401) {
        return finalizarComAbortoPor401(relatorio, 'unidade', item.chave, escreverArquivo, args, log, logErro);
      }
      if (!resposta.ok) {
        registrar({ fase: 'unidade', chave: item.chave, acao: 'falha', motivo: resposta.corpo?.message || 'erro HTTP', http: { status: resposta.status, corpo: resposta.corpo } });
        continue;
      }
      unidadesPorSigla.set(item.chave, resposta.corpo);
      unidadesPorId.set(resposta.corpo.id, resposta.corpo);
      registrar({ fase: 'unidade', chave: item.chave, acao: 'criado', avisos: item.avisos });
    } else if (plano.acao === 'criar') {
      const unidadeSimulada = { id: idSimulado--, ...desejado, conectaAUnidadeId: null };
      unidadesPorSigla.set(item.chave, unidadeSimulada);
      unidadesPorId.set(unidadeSimulada.id, unidadeSimulada);
      registrar({ fase: 'unidade', chave: item.chave, acao: 'criar', motivo: 'dry-run: seria criada', avisos: item.avisos });
    } else {
      registrar({ fase: 'unidade', chave: item.chave, acao: plano.acao, motivo: plano.motivo, campos: plano.campos, avisos: item.avisos });
    }
  }

  // ------------------------------------------------------------------
  // Fase 3: equipamentos
  // ------------------------------------------------------------------
  const equipamentosValidados = dados.equipamentos.map((linha) => ({ linha, ...validarLinhaEquipamento(linha) }));
  const equipamentosDuplicados = encontrarChavesDuplicadas(equipamentosValidados);
  const { porUnidade: ipsDuplicadosNaUnidade, entreUnidades: ipsRepetidosEntreUnidades } = encontrarIpsRepetidos(dados.equipamentos);

  for (const item of equipamentosValidados) {
    if (item.chave !== null && equipamentosDuplicados.has(item.chave)) {
      item.erros.push('nome de equipamento duplicado na mesma unidade, dentro do arquivo');
    }
    const siglaUnidade = chaveMinuscula(item.linha.unidadeSigla);
    const ip = normalizarTexto(item.linha.ip);
    if (siglaUnidade && ip && ipsDuplicadosNaUnidade.has(`${siglaUnidade}::${ip}`)) {
      item.erros.push('IP repetido para outro equipamento da mesma unidade, dentro do arquivo');
    }
    if (ip && ipsRepetidosEntreUnidades.has(ip)) {
      item.avisos.push(`IP ${ip} aparece em mais de uma unidade no arquivo`);
    }
    if (siglaUnidade && unidadesChavesFalhadas.has(siglaUnidade)) {
      item.erros.push('pulado: dependência falhou (unidade com erro de validação no arquivo)');
    } else if (siglaUnidade && !unidadesPorSigla.has(siglaUnidade)) {
      item.erros.push(`unidade "${item.linha.unidadeSigla}" nao existe (nem no arquivo, nem na API)`);
    }
    const tipoNome = chaveMinuscula(item.linha.tipoNome);
    if (tipoNome && tiposChavesFalhadas.has(tipoNome)) {
      item.erros.push('pulado: dependência falhou (tipo com erro de validação no arquivo)');
    } else if (tipoNome && !tiposPorNome.has(tipoNome)) {
      item.erros.push(`tipo "${item.linha.tipoNome}" nao existe (nem no arquivo, nem na API)`);
    }
  }
  const equipamentosChavesFalhadas = new Set(
    equipamentosValidados.filter((i) => i.erros.length > 0 && i.chave !== null).map((i) => i.chave)
  );

  for (const item of equipamentosValidados) {
    if (item.erros.length > 0) {
      const acao = item.erros.every((e) => e.startsWith('pulado: dependência falhou')) ? 'pulado' : 'falha';
      registrar({ fase: 'equipamento', chave: item.chave ?? '(sem chave)', acao, motivo: item.erros.join('; ') });
      continue;
    }
    const unidade = unidadesPorSigla.get(chaveMinuscula(item.linha.unidadeSigla));
    const tipo = tiposPorNome.get(chaveMinuscula(item.linha.tipoNome));
    const existente = equipamentosPorChave.get(item.chave);
    const desejado = {
      unidadeId: unidade.id,
      tipoEquipamentoId: tipo.id,
      nome: normalizarTexto(item.linha.nome),
      ip: normalizarTexto(item.linha.ip),
      hostname: normalizarTexto(item.linha.hostname),
      descricao: normalizarTexto(item.linha.descricao),
      localizacao: normalizarTexto(item.linha.localizacao),
      numeroSerie: normalizarTexto(item.linha.numeroSerie),
      fabricante: normalizarTexto(item.linha.fabricante),
      modelo: normalizarTexto(item.linha.modelo),
    };
    const existenteComparavel = existente && {
      unidadeId: existente.unidade.id,
      tipoEquipamentoId: existente.tipoEquipamento.id,
      nome: existente.nome,
      ip: existente.ip,
      hostname: existente.hostname,
      descricao: existente.descricao,
      localizacao: existente.localizacao,
      numeroSerie: existente.numeroSerie,
      fabricante: existente.fabricante,
      modelo: existente.modelo,
    };
    const plano = planejarAcao(desejado, existenteComparavel, [
      'unidadeId', 'tipoEquipamentoId', 'nome', 'ip', 'hostname', 'descricao', 'localizacao', 'numeroSerie', 'fabricante', 'modelo',
    ]);

    if (plano.acao === 'criar' && args.aplicar) {
      const resposta = await criar(fetchImpl, credenciais.apiUrl, token, '/equipamentos', desejado);
      if (resposta.status === 401) {
        return finalizarComAbortoPor401(relatorio, 'equipamento', item.chave, escreverArquivo, args, log, logErro);
      }
      if (!resposta.ok) {
        registrar({ fase: 'equipamento', chave: item.chave, acao: 'falha', motivo: resposta.corpo?.message || 'erro HTTP', http: { status: resposta.status, corpo: resposta.corpo } });
        continue;
      }
      equipamentosPorChave.set(item.chave, resposta.corpo);
      equipamentosPorId.set(resposta.corpo.id, resposta.corpo);
      registrar({ fase: 'equipamento', chave: item.chave, acao: 'criado', avisos: item.avisos });
    } else if (plano.acao === 'criar') {
      equipamentosPorChave.set(item.chave, { id: idSimulado--, nome: desejado.nome });
      registrar({ fase: 'equipamento', chave: item.chave, acao: 'criar', motivo: 'dry-run: seria criado', avisos: item.avisos });
    } else {
      registrar({ fase: 'equipamento', chave: item.chave, acao: plano.acao, motivo: plano.motivo, campos: plano.campos, avisos: item.avisos });
    }
  }

  // ------------------------------------------------------------------
  // Fase 4: monitores
  // ------------------------------------------------------------------
  const monitoresValidados = dados.monitores.map((linha) => ({ linha, ...validarLinhaMonitor(linha) }));
  const monitoresDuplicados = encontrarChavesDuplicadas(monitoresValidados);
  for (const item of monitoresValidados) {
    if (item.chave !== null && monitoresDuplicados.has(item.chave)) {
      item.erros.push('nome de monitor duplicado no mesmo equipamento, dentro do arquivo');
    }
    const chaveEquip = item.linha.unidadeSigla && item.linha.equipamentoNome
      ? `${chaveMinuscula(item.linha.unidadeSigla)}::${chaveMinuscula(item.linha.equipamentoNome)}`
      : null;
    if (chaveEquip && equipamentosChavesFalhadas.has(chaveEquip)) {
      item.erros.push('pulado: dependência falhou (equipamento com erro de validação no arquivo)');
    } else if (chaveEquip && !equipamentosPorChave.has(chaveEquip)) {
      item.erros.push(`equipamento "${item.linha.equipamentoNome}" da unidade "${item.linha.unidadeSigla}" nao existe (nem no arquivo, nem na API)`);
    }
  }

  for (const item of monitoresValidados) {
    if (item.erros.length > 0) {
      const acao = item.erros.every((e) => e.startsWith('pulado: dependência falhou')) ? 'pulado' : 'falha';
      registrar({ fase: 'monitor', chave: item.chave ?? '(sem chave)', acao, motivo: item.erros.join('; ') });
      continue;
    }
    const chaveEquip = `${chaveMinuscula(item.linha.unidadeSigla)}::${chaveMinuscula(item.linha.equipamentoNome)}`;
    const equipamento = equipamentosPorChave.get(chaveEquip);
    const existente = monitoresPorChave.get(item.chave);
    const desejado = {
      equipamentoId: equipamento.id,
      tipo: normalizarTexto(item.linha.tipo)?.toUpperCase(),
      nome: normalizarTexto(item.linha.nome),
      intervaloSegundos: Number(item.linha.intervaloSegundos),
      timeoutMs: Number(item.linha.timeoutMs),
      falhasParaIncidente: item.linha.falhasParaIncidente ? Number(item.linha.falhasParaIncidente) : undefined,
      sucessosParaRecovery: item.linha.sucessosParaRecovery ? Number(item.linha.sucessosParaRecovery) : undefined,
    };
    const existenteComparavel = existente && {
      equipamentoId: existente.equipamento.id,
      tipo: existente.tipo,
      nome: existente.nome,
      intervaloSegundos: existente.intervaloSegundos,
      timeoutMs: existente.timeoutMs,
      falhasParaIncidente: existente.falhasParaIncidente,
      sucessosParaRecovery: existente.sucessosParaRecovery,
    };
    const plano = planejarAcao(desejado, existenteComparavel, [
      'equipamentoId', 'tipo', 'nome', 'intervaloSegundos', 'timeoutMs', 'falhasParaIncidente', 'sucessosParaRecovery',
    ]);

    if (plano.acao === 'criar' && args.aplicar) {
      const resposta = await criar(fetchImpl, credenciais.apiUrl, token, '/monitores', desejado);
      if (resposta.status === 401) {
        return finalizarComAbortoPor401(relatorio, 'monitor', item.chave, escreverArquivo, args, log, logErro);
      }
      if (!resposta.ok) {
        registrar({ fase: 'monitor', chave: item.chave, acao: 'falha', motivo: resposta.corpo?.message || 'erro HTTP', http: { status: resposta.status, corpo: resposta.corpo } });
        continue;
      }
      monitoresPorChave.set(item.chave, resposta.corpo);
      registrar({ fase: 'monitor', chave: item.chave, acao: 'criado', avisos: item.avisos });
    } else if (plano.acao === 'criar') {
      monitoresPorChave.set(item.chave, { id: idSimulado--, nome: desejado.nome });
      registrar({ fase: 'monitor', chave: item.chave, acao: 'criar', motivo: 'dry-run: seria criado', avisos: item.avisos });
    } else {
      registrar({ fase: 'monitor', chave: item.chave, acao: plano.acao, motivo: plano.motivo, campos: plano.campos, avisos: item.avisos });
    }
  }

  // ------------------------------------------------------------------
  // Fase 5: conexoes de hub
  // ------------------------------------------------------------------
  const conexoesValidadas = dados.conexoes.map((linha) => ({ linha, ...validarLinhaConexao(linha) }));
  for (const item of conexoesValidadas) {
    const siglaOrigem = chaveMinuscula(item.linha.unidadeSigla);
    const siglaDestino = chaveMinuscula(item.linha.conectaSigla);
    if (siglaOrigem && unidadesChavesFalhadas.has(siglaOrigem)) {
      item.erros.push('pulado: dependência falhou (unidade origem com erro de validação no arquivo)');
    } else if (siglaOrigem && !unidadesPorSigla.has(siglaOrigem)) {
      item.erros.push(`unidade origem "${item.linha.unidadeSigla}" nao existe (nem no arquivo, nem na API)`);
    }
    if (siglaDestino && unidadesChavesFalhadas.has(siglaDestino)) {
      item.erros.push('pulado: dependência falhou (unidade hub com erro de validação no arquivo)');
    } else if (siglaDestino && !unidadesPorSigla.has(siglaDestino)) {
      item.erros.push(`unidade hub "${item.linha.conectaSigla}" nao existe (nem no arquivo, nem na API)`);
    }
  }

  const conexoesValidasParaGrafo = conexoesValidadas
    .filter((item) => item.erros.length === 0)
    .map((item) => ({ origem: chaveMinuscula(item.linha.unidadeSigla), destino: chaveMinuscula(item.linha.conectaSigla) }));
  const resultadosArestas = validarArestas(grafoHubBase, conexoesValidasParaGrafo);
  let indiceAresta = 0;
  for (const item of conexoesValidadas) {
    if (item.erros.length > 0) continue;
    const resultadoAresta = resultadosArestas[indiceAresta];
    indiceAresta += 1;
    if (!resultadoAresta.ok) item.erros.push(resultadoAresta.motivo);
  }

  for (const item of conexoesValidadas) {
    if (item.erros.length > 0) {
      const acao = item.erros.every((e) => e.startsWith('pulado: dependência falhou')) ? 'pulado' : 'falha';
      registrar({ fase: 'conexao', chave: item.chave ?? '(sem chave)', acao, motivo: item.erros.join('; ') });
      continue;
    }
    const origem = unidadesPorSigla.get(chaveMinuscula(item.linha.unidadeSigla));
    const destino = unidadesPorSigla.get(chaveMinuscula(item.linha.conectaSigla));
    const desejado = { conectaAUnidadeId: destino.id };
    const existenteComparavel = { conectaAUnidadeId: origem.conectaAUnidadeId ?? null };
    const plano = planejarAcao(desejado, origem.conectaAUnidadeId ? existenteComparavel : null, ['conectaAUnidadeId']);

    if (plano.acao === 'criar' && args.aplicar) {
      const resposta = await definirConexao(fetchImpl, credenciais.apiUrl, token, origem.id, destino.id);
      if (resposta.status === 401) {
        return finalizarComAbortoPor401(relatorio, 'conexao', item.chave, escreverArquivo, args, log, logErro);
      }
      if (!resposta.ok) {
        registrar({ fase: 'conexao', chave: item.chave, acao: 'falha', motivo: resposta.corpo?.message || 'erro HTTP', http: { status: resposta.status, corpo: resposta.corpo } });
        continue;
      }
      origem.conectaAUnidadeId = destino.id;
      registrar({ fase: 'conexao', chave: item.chave, acao: 'criado', avisos: item.avisos });
    } else if (plano.acao === 'criar') {
      registrar({ fase: 'conexao', chave: item.chave, acao: 'criar', motivo: 'dry-run: seria definida', avisos: item.avisos });
    } else {
      registrar({ fase: 'conexao', chave: item.chave, acao: plano.acao, motivo: plano.motivo, campos: plano.campos, avisos: item.avisos });
    }
  }

  await finalizar(relatorio, args, escreverArquivo, log);
  return 0;
}

async function finalizarComAbortoPor401(relatorio, fase, chave, escreverArquivo, args, log, logErro) {
  relatorio.itens.push({ fase, chave, acao: 'falha', motivo: '401 recebido no meio da execucao; abortando' });
  relatorio.abortadoEm = new Date().toISOString();
  logErro('401 recebido no meio da execucao (sessao expirou ou foi revogada). Abortando e gravando relatorio parcial.');
  await finalizar(relatorio, args, escreverArquivo, log);
  return 1;
}

async function finalizar(relatorio, args, escreverArquivo, log) {
  if (args.relatorio && escreverArquivo) {
    await escreverArquivo(args.relatorio, JSON.stringify(relatorio, null, 2));
  }
  log(
    `[${relatorio.modo}] criados=${relatorio.resumo.criados} pulados=${relatorio.resumo.pulados} ` +
      `divergentes=${relatorio.resumo.divergentes} falhas=${relatorio.resumo.falhas} avisos=${relatorio.resumo.avisos}`
  );
}

// ---------------------------------------------------------------------------
// Entrada de linha de comando (nao roda em testes: so quando chamado direto)
// ---------------------------------------------------------------------------

const chamadoDiretamente = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (chamadoDiretamente) {
  const { writeFile } = await import('node:fs/promises');
  const codigo = await executar({
    argv: process.argv.slice(2),
    env: process.env,
    fetchImpl: fetch,
    escreverArquivo: (caminho, conteudo) => writeFile(caminho, conteudo, 'utf8'),
  });
  process.exit(codigo);
}
