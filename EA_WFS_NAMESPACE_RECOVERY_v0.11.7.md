# ThemePark Map v0.11.7 — EA WFS Namespace Recovery

The previous aerial-required run reached the source broker, but the Environment Agency WFS returned HTTP 400. Diagnostics showed that the request used an unqualified legacy feature type and appended a CRS URN directly to the BBOX value.

## Implemented

- Query WFS `GetCapabilities` before requesting vertical-aerial records.
- Resolve the currently advertised, namespace-qualified feature type.
- Retain the dataset-qualified feature name only as a fallback.
- Convert the WGS84 park envelope to British National Grid (`EPSG:27700`).
- Send a WFS 2.0 request using the projected numeric BBOX and explicit `srsName`.
- Record the capabilities URL, resolved feature type, query CRS and projected bounds in the source audit.
- Preserve the fail-closed aerial benchmark when the catalogue exposes coverage metadata but no usable raster.

## Validation

- JavaScript syntax validation passed.
- Source-broker tests passed 7/7.
- The full focused Actions suite now contains 30 tests.
- Encoded patch SHA-256: `6317a7c50630da74eb196b6b025b30c20d18f79897a95d5d1a1d9607fba9c240`.
- Decoded patch SHA-256: `505f3d2bb50024f78cba5c6217ba6ee6c3b46aeec45d387385186c1e7c9824b8`.

## Remaining provider boundary

A valid WFS response proves only that the survey catalogue can be queried. It does not guarantee a directly downloadable GeoTIFF. When records expose only coverage polygons or ECW package metadata, `aerial-required` remains failed rather than generating another OSM-only world. The next Actions run will reveal whether Alton Towers has a usable direct raster/package route in the current catalogue.
