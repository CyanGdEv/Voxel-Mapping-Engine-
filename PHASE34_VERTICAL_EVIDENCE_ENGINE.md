# Phase 34 — Vertical Evidence Engine

Phase 34 resolves vertical truth on the Phase 33 reconstruction graph before Minecraft compilation. The current slices remain graph-only: they do not mutate legacy compiler feature objects, so vertical decisions can be validated before they move blocks in the world.

## Vertical model

Every physical reconstruction node is solved as four distinct properties: `groundElevationM`, `baseElevationM`, `heightM`, and `topElevationM`. Missing values stay unresolved; no default elevation or height is invented.

## Evidence authority

Evidence is selected deterministically by property. Current priority is accepted planning elevation and planning FFL/ride/water/terrain observations, then explicit feature vertical data, then LiDAR/terrain ground samples, followed only by deterministic derived values such as `top = base + height`.

Planning evidence only applies to compatible object types within bounded spatial radii. Matching planning references and source-document hashes strengthen association. OSM and OSM-derived Overture data are never valid vertical world evidence in planning-only mode.

## DTM / DSM surface separation

`terrain-surface-model.mjs` now separates bare-earth ground from object/top surfaces instead of treating every elevation sample as the same quantity.

- `dtmElevationM` is bare-earth/ground elevation beneath the object.
- `dsmElevationM` is the visible/object-top surface where independent DSM or explicit top evidence exists.
- `aboveGroundHeightM` is derived only when both surfaces exist, as `DSM - DTM`.

A legacy generic `sampleLocal()` elevation source is accepted only as ground-compatible evidence. It is never reused as DSM, because duplicating one elevation into both channels would create fabricated zero-height buildings, vegetation and structures. Invalid surface pairs where DSM is below DTM are rejected and left unresolved.

Attachment semantics are explicit: paths, roads, terrain details, barriers and support footings attach to DTM; buildings/structures/vegetation have DTM base plus optional DSM top; water keeps an independent surface over a DTM bed; rides and bridges remain independent elevated objects over DTM.

The pipeline now hands the runtime elevation source into the graph vertical solver so dedicated `sampleDtmLocal` / `sampleDsmLocal`-style providers can be consumed when present without weakening planning authority.

## Multi-point ride vertical profiles

Ride elevation observations are projected onto the measured planning-authoritative ride centerline. Compatible anchors are ordered by distance along the track and interpolation is allowed only between accepted neighboring anchors. The solver never extrapolates before the first anchor or beyond the final anchor, and gaps above the configured safety limit stay unresolved.

## Graph-derived 3D ride geometry

Resolved ride profiles feed `ride-3d-geometry.mjs`. The engine samples the exact planning alignment at 1 m by default (configurable) and creates graph-owned `(x,y,z)` samples. Resolved neighboring samples form `resolved-3d` segments with true 3D length and pitch. Unsupported profile spans keep `y=null` and become `unresolved-vertical-gap` segments, so no hidden elevation is fabricated.

## Ride support reconstruction

Planning support nodes feed `ride-support-reconstruction.mjs`. Each support is associated only with a compatible planning ride, then connected to the nearest resolved 3D track sample inside a bounded distance. Its footing consumes the resolved DTM/ground state on the support node.

A resolved support records footing `(x,y,z)`, track connection `(x,y,z)`, track measure, vertical height, horizontal offset, true 3D member length, lean angle and confidence. If the track span is unresolved, ground elevation is missing, the compatible ride is too far away, or the track connection is not above the footing, the support remains unresolved rather than inventing a column.

Planning references and source-document hashes prevent nearby independent rides from cross-linking. OSM-derived support geometry is rejected in planning-only mode.

These ride, support and surface structures are still graph-only. The legacy Minecraft compiler remains unchanged until dedicated output tests prove a safe feature-family cutover.

## Conflict handling

Conflicting values remain in per-node vertical-resolution diagnostics. Higher-authority evidence is selected but disagreement remains auditable for later automated QA.

## Next slices

1. Add footprint-aware terrain-surface sampling rather than centroid-only DTM/DSM observations.
2. Resolve building roof planes/top surfaces from DSM plus planning elevations/sections.
3. Add vegetation crown height/volume from DTM/DSM separation.
4. Add ride clearance/tunnel/terrain-intersection classification from solved 3D geometry against DTM.
5. Cut graph-resolved ride/building/water/support vertical state into Minecraft generation one family at a time under explicit output tests.
