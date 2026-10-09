// Validacoes puras (sem rede) do conjunto de dados de carga: tipos, unidades,
// equipamentos, monitores e conexoes. Cada função devolve um resultado por
// linha: { chave, erros: [string], avisos: [string] }. Uma linha com erro
// nao e enviada; seus dependentes (linhas de fases seguintes que dependem
// dela) sao marcados como "pulado: dependencia falhou" por quem monta o
// plano de execucao (carga.mjs), nao aqui.

import { municipioExiste, pontoNoMunicipio } from './geo.mjs';

export function normalizarTexto(valor) {
  if (valor === null || valor === undefined) return null;
  const texto = String(valor).trim();
  return texto === '' ? null : texto;
}

export function chaveMinuscula(valor) {
  const texto = normalizarTexto(valor);
  return texto === null ? null : texto.toLowerCase();
}

/** Espelha UnidadeService.normalizarUf: trim + maiusculas. */
export function normalizarUf(valor) {
  const texto = normalizarTexto(valor);
  return texto === null ? null : texto.toUpperCase();
}

/**
 * Espelha RegraIpv4 do backend (e a V20): so IPv4 de host, sem zero a esquerda
 * (o ping do Linux le "010" como octal). Nulo = aceito; vazio = sem IP.
 */
export function motivoRecusaIp(valor) {
  const ip = normalizarTexto(valor);
  if (ip === null) return null;
  if (ip.includes(':')) return 'apenas IPv4 e suportado: o monitoramento ICMP nao sonda IPv6';
  if (!/^[0-9]{1,3}(\.[0-9]{1,3}){3}$/.test(ip)) return 'deve ser um endereco IPv4 no formato 192.168.0.10';
  const octetos = ip.split('.');
  if (octetos.some((octeto) => Number(octeto) > 255)) return 'cada octeto do IP vai de 0 a 255';
  if (octetos.some((octeto) => octeto.length > 1 && octeto.startsWith('0'))) {
    return 'octeto com zero a esquerda e ambiguo (pode ser lido como octal): escreva 10.0.0.1, nao 010.000.000.001';
  }
  const primeiro = Number(octetos[0]);
  if (primeiro === 0) return 'a faixa 0.0.0.0/8 nao e endereco de host';
  if (primeiro >= 224) return 'multicast, reservado ou broadcast (224.0.0.0 em diante) nao e endereco de host monitoravel';
  return null;
}

/** Espelha CreateUnidadeRequest: exatamente 7 digitos (com espacos ao redor tolerados). */
export function ibgeFormatoValido(valor) {
  const texto = normalizarTexto(valor);
  if (texto === null) return true; // IBGE e opcional no cadastro
  return /^\d{7}$/.test(texto.trim());
}

export function coordenadasCompletas(latitude, longitude) {
  const lat = normalizarTexto(latitude);
  const lon = normalizarTexto(longitude);
  return (lat === null) === (lon === null);
}

function paraNumero(valor) {
  const texto = normalizarTexto(valor);
  if (texto === null) return null;
  const numero = Number(texto);
  return Number.isFinite(numero) ? numero : NaN;
}

// ---------------------------------------------------------------------------
// Validacao por linha (formato e obrigatoriedade), sem cruzar com outras linhas.
// ---------------------------------------------------------------------------

export function validarLinhaTipo(linha) {
  const erros = [];
  if (normalizarTexto(linha.nome) === null) erros.push('nome e obrigatorio');
  return { chave: chaveMinuscula(linha.nome), erros, avisos: [] };
}

export function validarLinhaUnidade(linha, indiceGeoJson) {
  const erros = [];
  const avisos = [];
  if (normalizarTexto(linha.nome) === null) erros.push('nome e obrigatorio');
  if (normalizarTexto(linha.sigla) === null) erros.push('sigla e obrigatoria');
  if (normalizarTexto(linha.sigla) !== null && linha.sigla.trim().length > 30) {
    erros.push('sigla deve ter no maximo 30 caracteres');
  }
  if (!ibgeFormatoValido(linha.codigoIbge)) {
    erros.push('codigoIbge deve conter exatamente 7 digitos');
  }
  if (!coordenadasCompletas(linha.latitude, linha.longitude)) {
    erros.push('latitude e longitude devem ser informadas juntas ou ambas omitidas');
  }
  const latitude = paraNumero(linha.latitude);
  const longitude = paraNumero(linha.longitude);
  if (latitude !== null && Number.isNaN(latitude)) erros.push('latitude invalida');
  if (longitude !== null && Number.isNaN(longitude)) erros.push('longitude invalida');
  if (latitude !== null && !Number.isNaN(latitude) && (latitude < -90 || latitude > 90)) {
    erros.push('latitude deve estar entre -90 e 90');
  }
  if (longitude !== null && !Number.isNaN(longitude) && (longitude < -180 || longitude > 180)) {
    erros.push('longitude deve estar entre -180 e 180');
  }

  // "IBGE 7 digitos e existente" (spec): um codigo com formato valido mas
  // ausente do GeoJSON de SE e ERRO -- a linha nao e enviada -- independente
  // de ter coordenada ou nao. So a DIVERGENCIA entre IBGE existente e a
  // coordenada informada e aviso (decisao: a coordenada prevalece).
  const ibge = normalizarTexto(linha.codigoIbge);
  if (erros.length === 0 && ibge !== null && indiceGeoJson) {
    if (!municipioExiste(indiceGeoJson, ibge)) {
      erros.push(`codigoIbge ${ibge} nao existe no GeoJSON de SE (unidades fora de SE nao sao aceitas por este script)`);
    } else if (latitude !== null && longitude !== null) {
      const dentro = pontoNoMunicipio(indiceGeoJson, ibge, latitude, longitude);
      if (dentro === false) {
        avisos.push(
          `coordenada (${latitude}, ${longitude}) nao cai dentro do municipio do codigoIbge ${ibge}; ` +
            'a coordenada prevalece, o IBGE fica como divergencia a revisar'
        );
      }
    }
  }

  return { chave: chaveMinuscula(linha.sigla), erros, avisos };
}

export function validarLinhaEquipamento(linha) {
  const erros = [];
  if (normalizarTexto(linha.unidadeSigla) === null) erros.push('unidadeSigla e obrigatoria');
  if (normalizarTexto(linha.tipoNome) === null) erros.push('tipoNome e obrigatorio');
  if (normalizarTexto(linha.nome) === null) erros.push('nome e obrigatorio');
  const motivoIp = motivoRecusaIp(linha.ip);
  if (motivoIp !== null) erros.push(`ip: ${motivoIp}`);

  const chave =
    normalizarTexto(linha.unidadeSigla) !== null && normalizarTexto(linha.nome) !== null
      ? `${chaveMinuscula(linha.unidadeSigla)}::${chaveMinuscula(linha.nome)}`
      : null;

  return { chave, erros, avisos: [] };
}

export function validarLinhaMonitor(linha) {
  const erros = [];
  if (normalizarTexto(linha.unidadeSigla) === null) erros.push('unidadeSigla e obrigatoria');
  if (normalizarTexto(linha.equipamentoNome) === null) erros.push('equipamentoNome e obrigatorio');
  if (normalizarTexto(linha.nome) === null) erros.push('nome e obrigatorio');
  if (normalizarTexto(linha.tipo) === null) erros.push('tipo e obrigatorio');
  if (normalizarTexto(linha.tipo) !== null && linha.tipo.trim().toUpperCase() !== 'ICMP') {
    erros.push('tipo deve ser ICMP (unico tipo de monitor implementado)');
  }

  const intervalo = paraNumero(linha.intervaloSegundos);
  const timeout = paraNumero(linha.timeoutMs);
  if (intervalo === null || Number.isNaN(intervalo)) erros.push('intervaloSegundos e obrigatorio e numerico');
  else if (intervalo < 10 || intervalo > 86400) erros.push('intervaloSegundos deve estar entre 10 e 86400');
  if (timeout === null || Number.isNaN(timeout)) erros.push('timeoutMs e obrigatorio e numerico');
  else if (timeout < 100 || timeout > 60000) erros.push('timeoutMs deve estar entre 100 e 60000');

  for (const [campo, valor] of [
    ['falhasParaIncidente', linha.falhasParaIncidente],
    ['sucessosParaRecovery', linha.sucessosParaRecovery],
  ]) {
    const numero = paraNumero(valor);
    if (numero !== null && (Number.isNaN(numero) || numero < 1 || numero > 100)) {
      erros.push(`${campo} deve estar entre 1 e 100 quando informado`);
    }
  }

  const chave =
    normalizarTexto(linha.unidadeSigla) !== null &&
    normalizarTexto(linha.equipamentoNome) !== null &&
    normalizarTexto(linha.nome) !== null
      ? `${chaveMinuscula(linha.unidadeSigla)}::${chaveMinuscula(linha.equipamentoNome)}::${chaveMinuscula(linha.nome)}`
      : null;

  return { chave, erros, avisos: [] };
}

export function validarLinhaConexao(linha) {
  const erros = [];
  if (normalizarTexto(linha.unidadeSigla) === null) erros.push('unidadeSigla e obrigatoria');
  if (normalizarTexto(linha.conectaSigla) === null) erros.push('conectaSigla e obrigatoria');

  const chave =
    normalizarTexto(linha.unidadeSigla) !== null
      ? chaveMinuscula(linha.unidadeSigla)
      : null;

  return { chave, erros, avisos: [] };
}

// ---------------------------------------------------------------------------
// Validacoes de conjunto (cruzam linhas do mesmo arquivo e/ou com a API).
// ---------------------------------------------------------------------------

/**
 * Marca chaves duplicadas dentro da mesma lista de itens ja com {chave}.
 * Devolve um Set das chaves que aparecem mais de uma vez.
 */
export function encontrarChavesDuplicadas(itens) {
  const contagem = new Map();
  for (const item of itens) {
    if (item.chave === null) continue;
    contagem.set(item.chave, (contagem.get(item.chave) || 0) + 1);
  }
  const duplicadas = new Set();
  for (const [chave, quantidade] of contagem) {
    if (quantidade > 1) duplicadas.add(chave);
  }
  return duplicadas;
}

/**
 * IPs repetidos dentro do arquivo de equipamentos.
 * Devolve { porUnidade: Set<"sigla::ip"> (erro), entreUnidades: Set<ip> (aviso) }.
 */
export function encontrarIpsRepetidos(equipamentos) {
  const porUnidadeChaves = new Set();
  const ipParaUnidades = new Map();

  for (const linha of equipamentos) {
    const ip = normalizarTexto(linha.ip);
    const sigla = chaveMinuscula(linha.unidadeSigla);
    if (ip === null || sigla === null) continue;
    const chaveUnidade = `${sigla}::${ip}`;
    if (!ipParaUnidades.has(chaveUnidade)) ipParaUnidades.set(chaveUnidade, 0);
    ipParaUnidades.set(chaveUnidade, ipParaUnidades.get(chaveUnidade) + 1);

    if (!ipParaUnidades.has(ip)) ipParaUnidades.set(ip, new Set());
  }

  // repeticao dentro da mesma unidade -> erro
  for (const [chaveUnidade, quantidade] of ipParaUnidades) {
    if (typeof quantidade === 'number' && quantidade > 1) porUnidadeChaves.add(chaveUnidade);
  }

  // repeticao do mesmo IP entre unidades diferentes -> aviso
  const ipUnidadesMap = new Map();
  for (const linha of equipamentos) {
    const ip = normalizarTexto(linha.ip);
    const sigla = chaveMinuscula(linha.unidadeSigla);
    if (ip === null || sigla === null) continue;
    if (!ipUnidadesMap.has(ip)) ipUnidadesMap.set(ip, new Set());
    ipUnidadesMap.get(ip).add(sigla);
  }
  const entreUnidades = new Set();
  for (const [ip, unidades] of ipUnidadesMap) {
    if (unidades.size > 1) entreUnidades.add(ip);
  }

  return { porUnidade: porUnidadeChaves, entreUnidades };
}
