import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexarGeoJson, municipioExiste, pontoNoMunicipio } from '../lib/geo.mjs';

// Quadrado 0..10 x 0..10 com um buraco quadrado 4..6 x 4..6 no meio.
const quadradoComBuraco = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { id: '2800100', name: 'Municipio Quadrado' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [10, 0],
            [10, 10],
            [0, 10],
            [0, 0],
          ],
          [
            [4, 4],
            [6, 4],
            [6, 6],
            [4, 6],
            [4, 4],
          ],
        ],
      },
    },
    {
      type: 'Feature',
      properties: { id: '2800200', name: 'Municipio MultiPolygon' },
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          [
            [
              [20, 20],
              [30, 20],
              [30, 30],
              [20, 30],
              [20, 20],
            ],
          ],
          [
            [
              [40, 40],
              [50, 40],
              [50, 50],
              [40, 50],
              [40, 40],
            ],
          ],
        ],
      },
    },
  ],
};

test('indexarGeoJson + municipioExiste: encontra por id', () => {
  const indice = indexarGeoJson(quadradoComBuraco);
  assert.equal(municipioExiste(indice, '2800100'), true);
  assert.equal(municipioExiste(indice, '9999999'), false);
});

test('pontoNoMunicipio: ponto dentro do anel externo e fora do buraco -> true', () => {
  const indice = indexarGeoJson(quadradoComBuraco);
  // ponto [lon=2, lat=2] dentro do quadrado, longe do buraco
  assert.equal(pontoNoMunicipio(indice, '2800100', 2, 2), true);
});

test('pontoNoMunicipio: ponto dentro do buraco -> false', () => {
  const indice = indexarGeoJson(quadradoComBuraco);
  // buraco e 4..6 x 4..6; ponto (lat=5, lon=5) cai nele
  assert.equal(pontoNoMunicipio(indice, '2800100', 5, 5), false);
});

test('pontoNoMunicipio: ponto totalmente fora do poligono -> false', () => {
  const indice = indexarGeoJson(quadradoComBuraco);
  assert.equal(pontoNoMunicipio(indice, '2800100', 500, 500), false);
});

test('pontoNoMunicipio: MultiPolygon, ponto dentro de uma das partes -> true', () => {
  const indice = indexarGeoJson(quadradoComBuraco);
  assert.equal(pontoNoMunicipio(indice, '2800200', 45, 45), true);
  assert.equal(pontoNoMunicipio(indice, '2800200', 25, 25), true);
});

test('pontoNoMunicipio: MultiPolygon, ponto entre as duas partes -> false', () => {
  const indice = indexarGeoJson(quadradoComBuraco);
  assert.equal(pontoNoMunicipio(indice, '2800200', 35, 35), false);
});

test('pontoNoMunicipio: municipio inexistente -> null', () => {
  const indice = indexarGeoJson(quadradoComBuraco);
  assert.equal(pontoNoMunicipio(indice, '0000000', 1, 1), null);
});
