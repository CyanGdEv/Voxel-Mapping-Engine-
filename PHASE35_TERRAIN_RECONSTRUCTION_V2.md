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

Verified structure cells compile through the native Bedrock operation representation at phase 6. This intentionally precedes Phase 34 ride excavation at phase 7, supports/tunnel portals at phase 8 and ride track at phase 9.

The compiler emits explicit vertical geometry for natural rock faces, natural terrace breaks, retaining walls, cuttings, embankments and engineered terraces. Natural steep banks remain on the existing heightfield path until a dedicated slope-treatment compiler is introduced.

Material selection is deterministic and classification-specific. Natural rock faces use stone/andesite/cobblestone/mossy-cobblestone variation; retaining and engineered structures use appropriate stone palettes; cuttings and embankments use deterministic rock/soil palettes. Material variation never changes the verified geometry footprint.

## Tunnel portal and cliff-face reconciliation

`terrain-tunnel-portal-reconciliation.mjs` runs after phase-6 terrain structure compilation and before Phase 34 phase-7 excavation. It consumes only the verified `TPMAP_PHASE34_RIDE_EXCAVATION_MASK_V1` mask.

For each ride, the first and last verified tunnel measures form bounded portal-mouth bands. Phase-6 terrain structure operations are split so no reconstructed cliff, cutting, retaining wall or terrace voxel remains inside an already-authorised tunnel/cutting excavation voxel. Terrain outside the verified mask is preserved exactly.

This stage does **not** emit `minecraft:air`, enlarge a tunnel, or create excavation authority. Phase 7 remains the only carving stage. Cutting overlap is reconciled but is not labelled as a tunnel portal. Invalid/duplicate excavation cells and unverified mask markers fail closed before mutation.

## Authority and fidelity invariants

- Planning geometry remains world authority wherever planning data exists.
- OSM is not introduced as terrain or physical-object authority.
- DTM is used only as independent bare-earth vertical evidence.
- Missing or capped evidence fails closed rather than silently reducing resolution.
- Ordinary terrain heightfield generation is unchanged outside verified terrain-structure cells.
- Terrain structure output uses exact morphology cells, not coarse bounding-box fills.
- Portal reconciliation can remove phase-6 terrain only inside the existing verified Phase 34 excavation mask.
- Portal reconciliation emits no air and cannot widen excavation.
- Phase 7 ride excavation remains the sole carve authority and follows phase-6 terrain/reconciliation.
- Existing Phase 34 supports/tunnel portals and 3D track output remain phase 8/9 and are not weakened.

## Remaining Phase 35 slices

1. Add dedicated steep-bank voxel treatment using stairs/slabs where the Minecraft representation benefits.
2. Add retaining-wall caps, stepped courses and material detail where planning evidence supports them.
3. Add geology-aware natural rock palettes where independent geology data is available.
4. Add terrain QA against DTM and planning spot levels.
5. Add bounded real-world `.mcworld` portal fixtures to visually validate reconstructed cliff/tunnel transitions.
