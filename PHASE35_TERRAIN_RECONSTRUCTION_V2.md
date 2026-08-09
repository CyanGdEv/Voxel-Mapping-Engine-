# Phase 35 — 3D Terrain Reconstruction v2

Phase 35 moves terrain beyond a single heightfield by detecting terrain morphology and representing vertical terrain structures explicitly in the reconstruction graph before Minecraft compilation.

## First slice: morphology classification

The first slice consumes bare-earth DTM only. It samples the park bounds on a deterministic bounded grid and derives local slope, relief and break-of-slope strength without altering the source terrain.

Resolved cells are classified as `level`, `slope`, `steep-bank`, `cliff-face` or `terrace-break`. Missing DTM samples remain `unresolved` and never receive inferred heights.

Contiguous `steep-bank`, `cliff-face` and `terrace-break` cells are grouped into explicit terrain-structure candidates. These candidates remain graph-owned and Minecraft-independent in this slice. A cliff group therefore becomes an explicit `vertical-rock-face` compiler intent rather than forcing the terrain heightfield to represent a near-vertical surface.

## Authority and fidelity invariants

- Planning geometry remains world authority wherever planning data exists.
- OSM is not introduced as terrain or physical-object authority.
- DTM is used only as independent bare-earth vertical evidence.
- No smoothing, downsampling or terrain mutation occurs in the morphology slice.
- Missing or capped evidence fails closed rather than silently reducing resolution.
- Existing Phase 34 ride excavation, 3D track and support output stays unchanged.

## Planned Phase 35 slices

1. Morphology classifier and explicit terrain-structure graph candidates.
2. Planning-aware retaining-wall/cutting/embankment association.
3. Explicit cliff and steep-bank Minecraft compiler using rock/soil/moss palettes.
4. Terrain/ride excavation reconciliation around tunnel portals and cuttings.
5. Retaining wall and engineered terrace compilation.
6. Terrain QA against DTM and planning spot levels.
