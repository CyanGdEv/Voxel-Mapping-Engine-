# Phase 35 — 3D Terrain Reconstruction v2

Phase 35 moves terrain beyond a single heightfield by detecting terrain morphology, associating explicit planning engineering semantics, and compiling verified vertical terrain structures into the native Bedrock operation stream.

## Morphology classification

The first slice consumes bare-earth DTM only. It samples the park bounds on a deterministic bounded grid and derives local slope, relief and break-of-slope strength without altering the source terrain.

Resolved cells are classified as `level`, `slope`, `steep-bank`, `cliff-face` or `terrace-break`. Missing DTM samples remain `unresolved` and never receive inferred heights.

Contiguous `steep-bank`, `cliff-face` and `terrace-break` cells are grouped into explicit terrain-structure candidates. Each structure retains its exact classified DTM cells plus local minimum/maximum elevation evidence; compiler output never fills the structure's bounding rectangle.

## Planning terrain association

Only planning-authoritative nodes with explicit engineering semantics can promote a detected terrain structure to `retaining-wall`, `cutting`, `embankment` or `engineered-terrace`. A generic fence/barrier near a steep face is never promoted by proximity alone. Conflicting nearby planning roles remain ambiguous rather than guessed. OSM-derived engineering evidence is rejected.

Unassociated DTM structures remain natural terrain classes such as `natural-rock-face`, `natural-steep-bank` and `natural-terrace-break`.

## Minecraft terrain structure compiler

Verified structure cells now compile through the native Bedrock operation representation at phase 6. This intentionally precedes Phase 34 ride excavation at phase 7, supports/tunnel portals at phase 8 and ride track at phase 9.

The compiler currently emits explicit vertical geometry for natural rock faces, natural terrace breaks, retaining walls, cuttings, embankments and engineered terraces. Natural steep banks remain on the existing heightfield path until a dedicated slope-treatment compiler is introduced.

Material selection is deterministic and classification-specific. Natural rock faces use stone/andesite/cobblestone/mossy-cobblestone variation; retaining and engineered structures use appropriate stone palettes; cuttings and embankments use deterministic rock/soil palettes. Material variation never changes the verified geometry footprint.

## Authority and fidelity invariants

- Planning geometry remains world authority wherever planning data exists.
- OSM is not introduced as terrain or physical-object authority.
- DTM is used only as independent bare-earth vertical evidence.
- Missing or capped evidence fails closed rather than silently reducing resolution.
- Ordinary terrain heightfield generation is unchanged outside verified terrain-structure cells.
- Terrain structure output uses exact morphology cells, not coarse bounding-box fills.
- Phase 7 ride excavation remains later than phase 6 terrain structure output, so verified tunnels can carve reconstructed rock/retaining faces correctly.
- Existing Phase 34 3D track/support output remains phase 8/9 and is not weakened.

## Remaining Phase 35 slices

1. Reconcile tunnel portals/cuttings with terrain-face edges and portal geometry.
2. Add dedicated steep-bank voxel treatment using stairs/slabs where the Minecraft representation benefits.
3. Add retaining-wall caps, stepped courses and material detail where planning evidence supports them.
4. Add geology-aware natural rock palettes where independent geology data is available.
5. Add terrain QA against DTM and planning spot levels.
