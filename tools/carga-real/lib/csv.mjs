// Parser CSV proprio e minimo: sem dependencias externas.
// Suporta: aspas duplas, virgula dentro de aspas, aspas escapadas (""),
// BOM UTF-8 no inicio do arquivo, linhas em branco (ignoradas), \r\n e \n.
//
// Nao suporta (nao e necessario para o caso de uso): campos multilinha fora
// de aspas, delimitador diferente de virgula, encoding diferente de UTF-8.

/**
 * Recebe o texto bruto de um CSV e devolve um array de objetos, um por
 * linha de dados, com chaves a partir do cabecalho (primeira linha nao
 * vazia). Linhas totalmente em branco sao ignoradas.
 */
export function parseCsv(texto) {
  const semBom = removerBom(texto);
  const linhas = dividirEmLinhas(semBom);
  if (linhas.length === 0) return [];

  const cabecalho = linhas[0];
  const registros = [];
  for (let i = 1; i < linhas.length; i += 1) {
    const campos = linhas[i];
    if (campos.length === 1 && campos[0] === '') continue; // linha em branco
    const registro = {};
    for (let c = 0; c < cabecalho.length; c += 1) {
      registro[cabecalho[c]] = campos[c] !== undefined ? campos[c] : '';
    }
    registros.push(registro);
  }
  return registros;
}

function removerBom(texto) {
  if (texto.charCodeAt(0) === 0xfeff) return texto.slice(1);
  return texto;
}

/**
 * Divide o texto em linhas logicas (respeitando quebras de linha dentro de
 * campos entre aspas) e cada linha em campos, ja sem as aspas delimitadoras.
 */
function dividirEmLinhas(texto) {
  const linhas = [];
  let campos = [];
  let atual = '';
  let dentroDeAspas = false;
  let i = 0;
  let linhaTemConteudo = false;

  const normalizado = texto.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  while (i < normalizado.length) {
    const ch = normalizado[i];

    if (dentroDeAspas) {
      if (ch === '"') {
        if (normalizado[i + 1] === '"') {
          atual += '"';
          i += 2;
          continue;
        }
        dentroDeAspas = false;
        i += 1;
        continue;
      }
      atual += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      dentroDeAspas = true;
      linhaTemConteudo = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      campos.push(atual);
      atual = '';
      linhaTemConteudo = true;
      i += 1;
      continue;
    }
    if (ch === '\n') {
      campos.push(atual);
      if (linhaTemConteudo || campos.length > 1 || campos[0] !== '') {
        linhas.push(campos);
      }
      campos = [];
      atual = '';
      linhaTemConteudo = false;
      i += 1;
      continue;
    }
    atual += ch;
    linhaTemConteudo = true;
    i += 1;
  }

  // ultimo campo/linha, se o arquivo nao terminar em \n
  if (atual !== '' || campos.length > 0) {
    campos.push(atual);
    if (linhaTemConteudo || campos.length > 1) {
      linhas.push(campos);
    }
  }

  return linhas.filter((linha) => !(linha.length === 1 && linha[0].trim() === ''));
}
