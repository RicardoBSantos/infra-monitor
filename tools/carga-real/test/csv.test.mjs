import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv } from '../lib/csv.mjs';

test('parseCsv: cabecalho simples e uma linha', () => {
  const registros = parseCsv('nome,sigla\nMatriz,MTZ\n');
  assert.deepEqual(registros, [{ nome: 'Matriz', sigla: 'MTZ' }]);
});

test('parseCsv: campo entre aspas com virgula dentro', () => {
  const registros = parseCsv('nome,descricao\nMatriz,"Sede, predio principal"\n');
  assert.deepEqual(registros, [{ nome: 'Matriz', descricao: 'Sede, predio principal' }]);
});

test('parseCsv: aspas escapadas ("") dentro de campo entre aspas', () => {
  const registros = parseCsv('nome,apelido\nMatriz,"Predio ""novo"""\n');
  assert.deepEqual(registros, [{ nome: 'Matriz', apelido: 'Predio "novo"' }]);
});

test('parseCsv: remove BOM UTF-8 do inicio do arquivo', () => {
  const comBom = '﻿nome,sigla\nMatriz,MTZ\n';
  const registros = parseCsv(comBom);
  assert.deepEqual(registros, [{ nome: 'Matriz', sigla: 'MTZ' }]);
});

test('parseCsv: ignora linhas totalmente em branco', () => {
  const registros = parseCsv('nome,sigla\nMatriz,MTZ\n\n\nFilial,FIL\n');
  assert.deepEqual(registros, [
    { nome: 'Matriz', sigla: 'MTZ' },
    { nome: 'Filial', sigla: 'FIL' },
  ]);
});

test('parseCsv: aceita \\r\\n (CRLF)', () => {
  const registros = parseCsv('nome,sigla\r\nMatriz,MTZ\r\nFilial,FIL\r\n');
  assert.deepEqual(registros, [
    { nome: 'Matriz', sigla: 'MTZ' },
    { nome: 'Filial', sigla: 'FIL' },
  ]);
});

test('parseCsv: campo vazio no meio da linha vira string vazia', () => {
  const registros = parseCsv('nome,ip,hostname\nRouter1,,switch01\n');
  assert.deepEqual(registros, [{ nome: 'Router1', ip: '', hostname: 'switch01' }]);
});

test('parseCsv: arquivo so com cabecalho devolve lista vazia', () => {
  const registros = parseCsv('nome,sigla\n');
  assert.deepEqual(registros, []);
});

test('parseCsv: ultima linha sem quebra de linha final e lida', () => {
  const registros = parseCsv('nome,sigla\nMatriz,MTZ');
  assert.deepEqual(registros, [{ nome: 'Matriz', sigla: 'MTZ' }]);
});
