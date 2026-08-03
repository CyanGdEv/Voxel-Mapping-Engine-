# ThemePark Map v0.11.6 — Aerial Acquisition Phase 2C

## Scope

Automatic, rights-aware orthophoto discovery and fail-closed aerial benchmark validation for whole-park path/plaza recovery.

## Implemented

- Environment Agency Vertical Aerial Photography WFS coverage query.
- Resolution/date ranking and direct raster/package staging when a catalogue record exposes a URL.
- GeoTIFF direct downloads, ECW conversion through GDAL, and ZIP package extraction/conversion.
- OpenAerialMap search with explicit open-licence filtering and direct raster acquisition.
- Automatic provider audit in `source-acquisition.json`.
- Park-wide raster coverage estimation.
- `mapped-only`, `aerial-preferred`, and `aerial-required` path-source policies.
- Fail-closed 95% coverage and meaningful-detector execution gates.

## Validation

- All JavaScript source, script, and test modules pass `node --check`.
- 29/29 focused path, appearance, acquisition, licence, and benchmark-gate tests pass.
- Full `npm test` was not run locally because the sandbox package proxy did not contain `zstddec@0.2.0`; GitHub Actions runs `npm ci` using its normal package network before the focused suite.

## Provider limitations

The Environment Agency public catalogue can expose coverage without a direct downloadable raster URL. Such a result is recorded as `coverage-only` and never treated as imagery. The broker then tries OpenAerialMap or a manually supplied orthophoto. Standard Ubuntu GDAL may lack ECW support; conversion failures remain explicit and trigger provider fallback rather than an OSM-only world.

## Benchmark guarantees

An `aerial-required` build fails when imagery is missing, covers less than 95% of the park, whole-park discovery is disabled, no hardscape component is analysed, or no independent candidate is found. A successful benchmark therefore cannot be another silent OSM-only build.
