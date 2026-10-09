// Consulta geografica IBGE x coordenada usando o mesmo GeoJSON do mapa do
// frontend (infra-monitor-frontend/public/assets/maps/se-municipalities.geo.json).
// point-in-polygon por ray casting, com suporte a buracos (aneis internos) e
// a geometrias Polygon e MultiPolygon.

/**
 * Constroi um indice { [codigoIbge]: feature } a partir do FeatureCollection.
 * O codigo IBGE do municipio esta em feature.properties.id (string de 7 digitos).
 */
export function indexarGeoJson(geojson) {
  const indice = new Map();
  const features = geojson && Array.isArray(geojson.features) ? geojson.features : [];
  for (const feature of features) {
    const id = feature && feature.properties && feature.properties.id;
    if (id) indice.set(String(id), feature);
  }
  return indice;
}

/**
 * true se o municipio (codigo IBGE) existe no GeoJSON de SE.
 */
export function municipioExiste(indiceGeoJson, codigoIbge) {
  return indiceGeoJson.has(String(codigoIbge));
}

/**
 * true se o ponto (lat, lon) esta dentro do poligono do municipio informado.
 * Se o municipio nao existir no indice, retorna null (indeterminado — quem
 * chama decide o que fazer, mas o caso esperado e checar municipioExiste antes).
 */
export function pontoNoMunicipio(indiceGeoJson, codigoIbge, latitude, longitude) {
  const feature = indiceGeoJson.get(String(codigoIbge));
  if (!feature) return null;
  return pontoNaGeometria([longitude, latitude], feature.geometry);
}

function pontoNaGeometria(ponto, geometria) {
  if (!geometria) return false;
  if (geometria.type === 'Polygon') {
    return pontoNoPoligono(ponto, geometria.coordinates);
  }
  if (geometria.type === 'MultiPolygon') {
    return geometria.coordinates.some((poligono) => pontoNoPoligono(ponto, poligono));
  }
  return false;
}

// coordinates de um Polygon: [anelExterno, ...aneisDeBuracos]
// O ponto esta "dentro" do poligono se estiver no anel externo e em nenhum buraco.
function pontoNoPoligono(ponto, aneis) {
  if (!aneis || aneis.length === 0) return false;
  const [externo, ...buracos] = aneis;
  if (!pontoNoAnel(ponto, externo)) return false;
  for (const buraco of buracos) {
    if (pontoNoAnel(ponto, buraco)) return false;
  }
  return true;
}

// Ray casting classico (even-odd) sobre um unico anel de coordenadas [lon, lat].
function pontoNoAnel(ponto, anel) {
  const [x, y] = ponto;
  let dentro = false;
  for (let i = 0, j = anel.length - 1; i < anel.length; j = i, i += 1) {
    const [xi, yi] = anel[i];
    const [xj, yj] = anel[j];
    const intersecta = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersecta) dentro = !dentro;
  }
  return dentro;
}
