# Phase 34 — Vertical Evidence Engine

Phase 34 resolves vertical truth on the Phase 33 reconstruction graph before Minecraft compilation. The current slices remain graph-only: they do not mutate legacy compiler feature objects, so vertical decisions can be validated before they move blocks in the world.

## Vertical model

Every physical reconstruction node is solved as four distinct properties: `groundElevationM`, `baseElevationM`, `heightM`, and `topElevationM`. Missing values stay unresolved; no default elevation or height is invented.

## Evidence authority

Evidence is selected deterministically by property. Current priority is accepted planning elevation and planning FFL/ride/water/terrain observations, then explicit feature vertical data, then LiDAR/terrain ground samples, followed only by deterministic derived values such as `top = base + height`.

Planning evidence only applies to compatible object types within bounded spatial radii. Matching planning references and source-document hashes strengthen association. OSM and OSM-derived Overture data are never valid vertical world evidence in planning-only mode.

## Multi-point ride vertical profiles

Ride elevation observations are projected onto the measured planning-authoritative ride centerline. Compatible anchors are ordered by distance along the track and interpolation is allowed only between accepted neighboring anchors. The solver never extrapolates before the first anchor or beyond the final anchor, and gaps above the configured safety limit stay unresolved.

## Graph-derived 3D ride geometry

Resolved ride profiles now feed `ride-3d-geometry.mjs`. The engine samples the exact planning alignment at 1 m by default (configurable) and creates graph-owned `(x,y,z)` samples. Resolved neighboring samples form `resolved-3d` segments with true 3D length and pitch. Unsupported profile spans keep `y=null` and become `unresolved-vertical-gap` segments, so no hidden elevation is fabricated.

This geometry is still graph-only. The legacy Minecraft compiler remains unchanged until dedicated output tests prove a safe feature-family cutover.

## Conflict handling

Conflicting values remain in per-node vertical-resolution diagnostics. Higher-authority evidence is selected but disagreement remains auditable for later automated QA.

## Next slices

1. Separate DTM ground and DSM object-top evidence.
2. Attach ride supports to solved 3D track samples and reconstructed ground surfaces.
3. Resolve building roof/top surfaces.
4. Add terrain-surface attachment edges.
5. Cut graph-resolved ride/building/water/support vertical state into Minecraft generation one family at a time under explicit output tests.
