# Run Voxel Mapping Engine from a phone

The repository includes a manually triggered GitHub Actions workflow that runs ThemePark Map v0.12.0 on a GitHub-hosted Linux runner and returns a directly importable Minecraft Bedrock `.mcworld` artifact.

No local terminal, desktop computer, or Minecraft server is required.

## First run on iPhone or iPad

1. Open this repository in the GitHub app or Safari.
2. Open **Actions**.
3. Select **Build Minecraft Theme Park World**.
4. Tap **Run workflow**.
5. Select a park preset:
   - `alton-towers`
   - `chessington`
   - `thorpe-park`
   - `custom`
6. Keep `benchmark` for a detailed world with disclosed deterministic gap filling, or select `verified` for evidence-only reconstruction and fail-closed source behavior.
7. Leave the default public-source switches enabled for the first build.
8. Tap the green **Run workflow** button.

The workflow verifies the embedded v0.12.0 source checksum, installs dependencies, runs compatibility tests, fetches bounded public data, compiles the world, validates the Bedrock archive, and uploads the world plus evidence reports.

## Custom park

Select `custom`, then enter:

- **Custom park name** — the displayed park name.
- **Custom WGS84 bounds** — `south,west,north,east`.

Example:

```text
52.9810,-1.8970,52.9960,-1.8690
```

Keep the area bounded. The compiler rejects unexpectedly large requests unless its explicit safety limits are changed in the build script.

## Public source switches

- **England open data** enables Planning Data and National Trees Outside Woodland. It is useful for English parks and harmlessly records unavailable coverage elsewhere.
- **Microsoft buildings** adds confidence-gated building footprints only where stronger geometry is absent.
- **Wikidata places** adds bounded attraction and place labels.
- **Wikimedia Commons** records nearby geotagged photo and licence evidence. It is off by default because it is an evidence catalogue rather than geometry.
- **OpenAerialMap** searches for open aerial imagery candidates covering the selected bounds.
- **Strict supplemental sources** makes any configured supplemental-source failure stop the build. Leave it off for normal phone runs.

Every supplemental request is bounded by feature, page-size, and compressed-download limits. Provider failures are included in `supplemental-sources.json`.

## Optional OS OpenMap Local or generic providers

Commit a WGS84 GeoJSON file or source configuration to the repository, then enter its repository-relative path in the workflow form.

Examples:

```text
mobile-data/alton-os-openmap-local.geojson
mobile-data/alton-source-config.json
```

The source-config format supports:

- OGC API Features
- ArcGIS Feature Layers
- Remote GeoJSON
- Repository GeoJSON

All vector geometry must use WGS84 longitude/latitude coordinates (`EPSG:4326`).

## Optional licensed orthophoto

Enter a direct URL to a georeferenced RGB GeoTIFF or Cloud Optimized GeoTIFF only when its licence permits the generated derivative output.

When `orthophoto_url` is supplied, also provide:

- `orthophoto_source`
- `orthophoto_license`
- `orthophoto_date`, when known
- `orthophoto_sha256`, when known

The workflow downloads the file, validates it with GDAL, and enables evidence-mode path discovery and terrain appearance analysis. It does not scrape Google, Bing, Apple, or other visual basemap tiles.

## Download the generated world

1. Open the completed workflow run.
2. Scroll to **Artifacts**.
3. Download the artifact ending in `-mcworld-v0120`.
4. Open the downloaded ZIP in the iOS Files app.
5. Extract it.
6. Tap the contained `.mcworld` file.
7. Choose Minecraft when iOS asks which app should open it.

The artifact also contains provenance, source-fusion, fidelity, validation, and supplemental-source reports.

## Failed runs

The workflow always attempts to upload `themepark-v0120-build-diagnostics`. Open the failed step or download that artifact to inspect:

- source archive and checksum validation;
- JavaScript syntax checks;
- npm installation;
- compatibility tests;
- provider acquisition reports;
- world-build logs;
- the final failing shell command and line number.
