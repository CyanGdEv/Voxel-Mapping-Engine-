# Path Phase 2B — Whole-Park Discovery

ThemePark Map v0.11.5 extends orthophoto path recovery beyond mapped-route expansion. High-confidence hardscape can now be classified as an independent plaza or route candidate when it is safely located near the guest path network.

## Delivered

- Whole-park hardscape segmentation beyond mapped-route seeds.
- Independent plaza and route classification.
- Guest-network anchor-distance gate.
- Building, water, vegetation, terrain-grade, and provenance gates.
- Component-specific measured RGB/material/pattern evidence.
- Clean final rendering with QA boundaries retained in GeoJSON/JSON reports only.
- Top natural-layer replacement while retaining the source terrain elevation.

## Default independent gates

- Pixel confidence: `0.78`
- Component confidence: `0.86`
- Minimum area: `28 m²`
- Maximum guest-network distance: `42 m`

## Activation

Whole-park recovery requires a rights-cleared georeferenced orthophoto:

```text
--orthophoto-mode evidence
--path-discovery-mode evidence
--path-discovery-scope whole-park
--path-edge-mode off
```

The detector combines mapped-path appearance prototypes with a generic hardscape classifier. An independent component compiles only when all safety, proximity, shape, terrain, and provenance gates pass.

## QA output

`path-topology-evidence.json` and `path-topology-qa.geojson` include discovery class, guest-network anchor distance, independent-pixel fraction, shape metrics, measured colour, selected material, and compilation status.

## Validation

- 38 JavaScript modules passed syntax checks.
- 18 focused tests passed.
- A synthetic whole-park test accepted a nearby unmapped plaza and rejected an identical distant hardscape yard.
- An end-to-end test confirmed measured asphalt palette application, natural-ground replacement, preserved terrain elevation, and no survey edging in the finished world.
