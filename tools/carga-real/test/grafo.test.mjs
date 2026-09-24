import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criariCiclo, validarArestas } from '../lib/grafo.mjs';

test('criariCiclo: auto-referencia e sempre ciclo', () => {
  assert.equal(criariCiclo(new Map(), 'a', 'a'), true);
});

test('criariCiclo: A->B direto nao e ciclo em grafo vazio', () => {
  assert.equal(criariCiclo(new Map(), 'a', 'b'), false);
});

test('criariCiclo: A->B->A fecha ciclo (2 saltos)', () => {
  const grafo = new Map([['b', 'a']]); // b ja aponta para a
  // tentar criar a->b fecharia o ciclo a->b->a
  assert.equal(criariCiclo(grafo, 'a', 'b'), true);
});

test('criariCiclo: A->B->C->A fecha ciclo (3 saltos)', () => {
  const grafo = new Map([
    ['b', 'a'],
    ['c', 'b'],
  ]); // c->b->a
  // tentar criar a->c fecharia a->c->b->a
  assert.equal(criariCiclo(grafo, 'a', 'c'), true);
});

test('criariCiclo: cadeia longa sem voltar para origem nao e ciclo', () => {
  const grafo = new Map([
    ['b', 'a'],
    ['c', 'b'],
    ['d', 'c'],
  ]);
  assert.equal(criariCiclo(grafo, 'x', 'd'), false);
});

test('validarArestas: combina API + arquivo, aresta invalida nao contamina o grafo acumulado', () => {
  // grafo base (API): b->a
  const grafoBase = new Map([['b', 'a']]);
  const resultados = validarArestas(grafoBase, [
    { origem: 'a', destino: 'b' }, // fecharia ciclo (b->a existente) -> invalida
    { origem: 'c', destino: 'a' }, // valida, independente da anterior
  ]);
  assert.equal(resultados[0].ok, false);
  assert.equal(resultados[1].ok, true);
});

test('validarArestas: segunda aresta do arquivo pode fechar ciclo com a primeira ja aplicada', () => {
  const resultados = validarArestas(new Map(), [
    { origem: 'a', destino: 'b' }, // ok, grafo passa a ter a->b
    { origem: 'b', destino: 'a' }, // fecharia ciclo com a aresta anterior do proprio arquivo
  ]);
  assert.equal(resultados[0].ok, true);
  assert.equal(resultados[1].ok, false);
});

test('validarArestas: auto-referencia tem motivo especifico', () => {
  const resultados = validarArestas(new Map(), [{ origem: 'a', destino: 'a' }]);
  assert.equal(resultados[0].ok, false);
  assert.match(resultados[0].motivo, /auto-referencia/);
});

test('validarArestas: aresta que nao muda o hub real (divergente/nao aplicada) nao contamina o grafo de trabalho', () => {
  // "a" ja tem hub "z" na API. O arquivo propoe a->b (nao seria realmente
  // aplicado -- so um PUT acontece quando o estado atual esta ausente) e
  // depois b->a. Sem o fix, a primeira aresta sobrescreveria o mapeamento
  // de "a" para "b" no grafo de trabalho, fazendo a segunda aresta (b->a)
  // ser rejeitada como ciclo (b->a->b), quando na realidade "a" continua
  // apontando para "z" e b->a nao fecha ciclo nenhum.
  const grafoBase = new Map([['a', 'z']]);
  const resultados = validarArestas(grafoBase, [
    { origem: 'a', destino: 'b' },
    { origem: 'b', destino: 'a' },
  ]);
  assert.equal(resultados[0].ok, true);
  assert.equal(resultados[1].ok, true, 'b->a nao deveria ser rejeitada como ciclo');
});
