# Run the Alton Towers generator from a phone

The GitHub Actions workflow runs ThemePark Map v0.11.1 on GitHub's Linux infrastructure and returns a directly importable Minecraft Bedrock `.mcworld`. No local computer or terminal is required.

## One-time source upload

1. Download `ThemePark_Map_v0.11.1_Aerial_Surface_Vegetation_Source.zip` to the iOS Files app.
2. In this repository, open **Code** and choose **Add file → Upload files**.
3. Select the ZIP and commit it to the repository root without renaming it.
4. Optionally open **Settings → Secrets and variables → Actions → Variables** and add `TPMAP_CONTACT` containing an email address or public project URL. The workflow otherwise uses the repository URL.

## Generate the Alton Towers benchmark

1. Open **Actions**.
2. Select **Build Minecraft Theme Park World**.
3. Tap **Run workflow**.
4. Confirm the branch is `main`.
5. Choose:
   - Preset: `alton-towers`
   - Accuracy: `benchmark`
   - World margin: `32`
6. Leave all orthophoto fields blank for the first test.
7. Tap the green **Run workflow** button.

The benchmark profile uses live OSM, Environment Agency DTM/DSM, marker-only buildings, mapped path surfaces and expanded vegetation reconstruction. It deliberately permits deterministic vegetation and terrain detail where exact evidence is incomplete.

## Optional orthophoto evidence

Aerial colour, paving-pattern sampling, whole-image terrain texturing and canopy-gap filling require a georeferenced RGB GeoTIFF or Cloud Optimized GeoTIFF that can legally be used for derived output.

When one is available, provide:

- `orthophoto_url`: direct file URL;
- `orthophoto_source`: provider and survey name;
- `orthophoto_license`: explicit reuse licence;
- `orthophoto_date`: capture date in `YYYY-MM-DD`;
- `orthophoto_sha256`: expected checksum, when known.

The workflow validates the download with GDAL and activates aerial analysis only after the provenance fields are supplied. It does not scrape visual basemap tiles.

## Download on iPhone or iPad

1. Open the completed workflow run.
2. Scroll to **Artifacts**.
3. Download `alton-towers-resort-mcworld`.
4. GitHub downloads a ZIP containing the world and reports.
5. Open the ZIP in the Files app to extract it.
6. Tap the contained `.mcworld` file and choose Minecraft.

## What the generated world should contain

- Colour- and material-matched path palettes
- Deterministic path paving patterns
- Terrain conforming to EA elevation evidence
- Woodland and forest density models
- Tree rows and dense tree lines
- Continuous hedges
- Scrub, shrubs and bushes
- Marker-only building layouts
- Accuracy, evidence, fidelity and validation reports

Failed builds upload diagnostics wherever possible. Open the first red step in the run for the exact failure reason.
