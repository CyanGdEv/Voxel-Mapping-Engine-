# Voxel Mapping Engine

A phone-controlled cloud generator that converts public geospatial evidence into a pre-generated Minecraft Bedrock `.mcworld`.

## Current generator

The Actions workflow now targets **ThemePark Map v0.11.1**, based on the proven v0.11 source. Its accuracy upgrade adds:

- colour- and material-matched three-block path palettes;
- deterministic paving patterns such as herringbone, running bond, slabs and mosaic;
- rights-gated aerial terrain texturing for grass, woodland floor, soil, gravel/rock and sand;
- mapped forest, woodland, orchard, scrub, shrub, bush, tree-row and hedge reconstruction;
- dense tree-line placement, continuous hedges and irregular bush models;
- high-confidence aerial-canopy gap filling outside incomplete vegetation polygons;
- DSM-minus-DTM tree-height evidence where available.

Buildings stay in **marker mode** for the benchmark world rather than being generated as inaccurate solid shells.

## Generate Alton Towers from a phone

1. Upload `ThemePark_Map_v0.11.1_Aerial_Surface_Vegetation_Source.zip` to the repository root without renaming it.
2. Open **Actions**.
3. Select **Build Minecraft Theme Park World**.
4. Tap **Run workflow**.
5. Keep:
   - preset: `alton-towers`
   - accuracy: `benchmark`
   - world margin: `32`
6. Leave the orthophoto fields empty unless you have a direct, georeferenced RGB GeoTIFF/COG URL and explicit reuse licence.
7. Start the workflow.
8. When it finishes, download the artifact ending in `-mcworld`.
9. Unzip the artifact in the iOS Files app and tap the contained `.mcworld` to import it into Minecraft.

## Optional aerial evidence

The workflow can download a georeferenced orthophoto when these inputs are supplied:

- `orthophoto_url`
- `orthophoto_source`
- `orthophoto_license`
- `orthophoto_date` (recommended)
- `orthophoto_sha256` (recommended)

Without a rights-cleared orthophoto, the build still uses live OSM, Environment Agency DTM/DSM, mapped path surface tags and mapped vegetation extents. Aerial-only path recovery, colour sampling and canopy-gap filling remain inactive rather than using unlicensed imagery.

See [`MOBILE_GITHUB_ACTIONS.md`](MOBILE_GITHUB_ACTIONS.md) for full phone setup and download instructions.
