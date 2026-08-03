# ThemePark Map v0.11.8 — EA Coverage Metadata Recovery

## Failure addressed

The v0.11.7 benchmark reached the live Environment Agency source broker, resolved the namespace and transformed the Alton Towers envelope to EPSG:27700, but the WFS still returned HTTP 400. The request used the WFS 2.0 `typeNames` parameter while Defra's current working migration examples use singular `typeName`.

## Implemented

- Try WFS 2.0 with singular `typeName` and `outputFormat=GEOJSON` first.
- Retain WFS 2.0 `typeNames` and WFS 1.1 `typeName` compatibility attempts.
- Record every query URL, response status and server detail.
- Fall back to the official data.gov.uk CKAN dataset metadata when all WFS forms fail.
- Select and download the Vertical Aerial Photography GeoJSON resource automatically.
- Extract ZIP-packaged coverage metadata and detect whether its coordinates are EPSG:27700 or EPSG:4326.
- Filter the full metadata catalogue to the park envelope and continue raster/package staging when a direct download URL is exposed.
- Preserve the fail-closed aerial benchmark: coverage metadata alone is never treated as imagery.

## Validation

- JavaScript syntax validation passed.
- 31/31 focused tests passed.
- The new regression forces all WFS variants to return HTTP 400, then verifies CKAN metadata discovery, spatial filtering and direct raster staging.

## Checksums

- Encoded v0.11.8 patch: `df0f74cf212a15e6cea2acb24c19c632730d34235998852ed7c268a0d7823625`
- Decoded v0.11.8 patch: `cab5f8f13f424a4c2adf628c1ca4019e430bcd9dce732183d24ae324d2b757de`
