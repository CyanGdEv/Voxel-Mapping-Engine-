# Phase 35 — 3D Terrain Reconstruction v2

Phase 35 moves terrain beyond a single heightfield by detecting terrain morphology, associating explicit planning engineering semantics, and compiling verified vertical terrain structures into the native Bedrock operation stream.

## Morphology and planning association

Bare-earth DTM is sampled on a deterministic bounded grid and classified as `level`, `slope`, `steep-bank`, `cliff-face`, `terrace-break` or `unresolved`. Contiguous high-gradient cells retain their exact DTM cells and local min/max elevation evidence.

Only planning-authoritative nodes with explicit engineering semantics can promote a terrain structure to `retaining-wall`, `cutting`, `embankment` or `engineered-terrace`. Generic fences/barriers never become retaining walls by proximity alone. OSM-derived engineering evidence is rejected.

## Native terrain structure compiler

Verified terrain structures compile at phase 6, before Phase 34 excavation at phase 7, supports/portals at phase 8 and ride track at phase 9. Ordinary terrain outside verified structure cells remains on the existing heightfield path.

Natural rock faces and engineered structures use deterministic class-specific palettes. Exact morphology cells are compiled rather than coarse bounding-box fills.

## Stateful block transport and steep banks

The compiler palette supports backward-compatible stateful block descriptors `{name, states}` in addition to legacy string block IDs. Direct `.mcworld` output writes those states into the chunk NBT palette and validates a stateful sample by reading it back. Behavior-pack output uses `BlockPermutation.resolve(...)` for stateful single-voxel writes.

`natural-steep-bank` terrain can use DTM-normal-directed stairs where the horizontal normal is cardinal-dominant. The DTM normal points downhill; the stair ascent is the opposite direction. Diagonal or ambiguous normals fall back to the certified slab treatment. The treatment never smooths, widens or excavates terrain.

## Retaining-wall detail

`retaining-wall-detail.mjs` refines only terrain structures already associated with explicit planning retaining-wall evidence.

DTM remains the vertical source of truth. Each exact structure cell supplies the wall base and top elevation. Because adjacent cells keep their own top elevations, long walls naturally compile into stepped top courses wherever the measured terrain changes rather than being forced to one constant wall height.

Planning metadata may refine the wall only when it is explicit:

- `wall_thickness`, `thickness` or `width` may expand an axis-aligned wall normal, bounded to a safe maximum;
- broad/diagonal planning bounds do not receive guessed thickness expansion;
- explicit material tags may select stone brick, smooth stone/concrete, cobblestone or andesite treatment;
- explicit `coping`, `cap`, `wall_cap` or `capped` semantics may replace the measured top course;
- coping never increases the verified DTM wall height;
- missing material/thickness/cap evidence produces no inferred decoration or expansion.

The wall-detail stage emits no air and cannot promote a generic barrier into a retaining structure.

## Tunnel portal reconciliation

Terrain structures, retaining-wall detail and steep-bank surface blocks are reconciled against only the verified `TPMAP_PHASE34_RIDE_EXCAVATION_MASK_V1` mask before phase-7 excavation. The reconciliation stage can split/remove phase-6 terrain only inside already-authorised excavation cells. It emits no air and cannot widen a tunnel or cutting.

## Authority and fidelity invariants

- Planning remains world authority wherever planning data exists.
- OSM is never introduced as physical terrain/engineering authority.
- DTM is independent bare-earth vertical evidence.
- Missing or ambiguous evidence remains unresolved rather than fabricated.
- Ordinary heightfield output is unchanged outside verified structures.
- Retaining-wall height follows DTM; width/material/coping require explicit planning evidence.
- Stateful stairs preserve Bedrock orientation end-to-end.
- Phase 7 remains the sole excavation authority.
- Existing Phase 34 supports/portals and graph-owned 3D ride track remain phase 8/9.

## Current phase order

`terrain structures (6) -> retaining-wall detail (6) -> DTM-directed steep-bank stairs/slabs (6) -> portal reconciliation -> verified excavation (7) -> supports/portals (8) -> 3D ride track (9)`

## Remaining Phase 35 slices

1. Add geology-aware natural rock palettes where independent geology evidence is available.
2. Add terrain QA against DTM and planning spot levels.
3. Add bounded real-world `.mcworld` fixtures for cliff/tunnel/retaining-wall/steep-bank transitions.
4. Add visual/output comparison of reconstructed terrain against the prior whole-block representation.
