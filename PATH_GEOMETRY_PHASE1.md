# Path Geometry Phase 1 — v0.11.3

This phase improves mapped path geometry without inventing isolated paths that have no source evidence.

## Implemented

- Conservative short-gap repair from a dangling mapped endpoint to a compatible mapped route segment.
- Separate guest, service and queue path roles.
- `area:highway` pedestrian areas and plazas as polygons.
- Tagged start/end width interpolation.
- Explicit kerb and path-edge rendering.
- Building, water, layer, bridge, tunnel, role and direction gates for inferred connectors.
- QA-only path candidates in verified mode.
- Path geometry evidence and QA GeoJSON reports in every build.

## Alton Towers benchmark defaults

- Path geometry mode: `repair`
- Maximum repair distance: `3 m`
- Minimum confidence: `0.70`
- Path edge mode: `evidence`
- Buildings remain marker-only.

Verified builds use `qa` mode and do not compile inferred connectors.

## Validation

- 34 source/script modules passed JavaScript syntax validation.
- 13 focused appearance, direct-world and path-geometry tests passed.
- The compressed patch and decoded source patch are both SHA-256 verified by GitHub Actions before application.

## Remaining limitation

This phase repairs gaps between mapped paths. It does not discover a completely unmapped or visually isolated path. Whole-park missing-path discovery requires a legally reusable georeferenced orthophoto and is planned for Path Phase 2.
