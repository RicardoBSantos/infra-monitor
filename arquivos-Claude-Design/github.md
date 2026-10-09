repo: tbrugz/geodata-br
branch: master
path: geojson

## Last sync
date: 2026-08-15T00:52:10Z

### Updated in this project
- Imported `geojson/geojs-28-mun.json` (75 Sergipe municipalities, IBGE-derived) and compacted it to `se-municipalities.geo.json` (96 KB).
- Added it to the 3D map as an independent, toggleable Municipal Boundaries Layer.
- Brazilian state outlines come from a second source (see below).

## Screen map
| Screen | Built from |
| --- | --- |
| Map — municipal boundaries layer (`sergipe-map.html`) | `se-municipalities.geo.json` ← `tbrugz/geodata-br@master:geojson/geojs-28-mun.json` |
| Map — state outlines (`sergipe-map.html`) | `br-states.geo.json` ← `giuliano-macedo/geodata-br-states@main:geojson/br_states/br_*.json` |

## Sync history
### 2026-08-15T00:39:43Z — giuliano-macedo/geodata-br-states@main (geojson/br_states)
- Imported the 26 Brazilian state GeoJSON files, merged and decimated into `br-states.geo.json` (330 KB).
