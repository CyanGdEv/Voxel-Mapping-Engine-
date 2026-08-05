# Voxel Mapping Engine

A phone-controlled cloud generator that converts public geospatial evidence into a high-fidelity, pre-generated Minecraft Bedrock `.mcworld`.

## GitHub Actions mobile generator

The repository workflow runs **ThemePark Map v0.12.0 Supplemental Source Fusion**. It can be launched from the GitHub app or a mobile browser without a local computer.

The build combines bounded evidence from:

- OpenStreetMap and Overpass;
- Environment Agency DTM, DSM, and LiDAR coverage;
- Planning Data trees, TPO areas, ancient woodland, and listed buildings;
- National Trees Outside Woodland canopy polygons and height evidence;
- Microsoft Global ML Building Footprints as confidence-gated gap fill;
- optional OS OpenMap Local WGS84 GeoJSON;
- Wikidata place and attraction labels;
- Wikimedia Commons geotagged photo/licence evidence;
- OpenAerialMap imagery discovery;
- generic OGC API Features, ArcGIS Feature Layer, and GeoJSON source configs;
- optional rights-cleared georeferenced orthophotos.

## Required source archive

Keep this exact file in the repository root:

```text
ThemePark_Map_v0.12.0_Supplemental_Source_Fusion_Source.zip
```

The workflow verifies its SHA-256 before extraction:

```text
2b8fe8692802b0bfca587a20821a86eacb091a63a4554153d4b3dd665dc240ec
```

Do not rename, recompress, or edit the archive without updating the checksum in the build runner.

## Generate a world from a phone

1. Open **Actions**.
2. Select **Build Minecraft Theme Park World**.
3. Tap **Run workflow**.
4. Choose `alton-towers`, `chessington`, `thorpe-park`, or `custom`.
5. Keep the default source switches enabled.
6. Start the workflow.
7. Download the artifact ending in `-mcworld-v0120`.
8. Extract the artifact in the iOS Files app and tap the `.mcworld` file to import it into Minecraft.

For a custom park, enter a name and WGS84 bounding box in this order:

```text
south,west,north,east
```

## Accuracy profiles

- `benchmark` uses evidence where available and clearly disclosed deterministic reconstruction where public data has gaps.
- `verified` uses conservative evidence-only behavior and refuses elevation/source fallback.

Buildings remain in marker mode by default so uncertain heights are not converted into misleading solid structures. Verified building, LiDAR, or planning evidence can still improve the compiled representation.

## Source and download safety

The GitHub Actions build applies:

- SHA-256 verification of the v0.12.0 source archive;
- bounded supplemental feature counts and pagination;
- compressed-download ceilings;
- confidence-gated Microsoft footprints;
- source provenance and licence recording;
- fail-open optional providers by default;
- optional fail-closed supplemental-source mode;
- independent `.mcworld` archive validation before upload.

See [`MOBILE_GITHUB_ACTIONS.md`](MOBILE_GITHUB_ACTIONS.md) for phone instructions, custom providers, optional imagery, and diagnostics.
