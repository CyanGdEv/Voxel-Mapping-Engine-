# Phase 34 — Vertical Evidence Engine

Phase 34 resolves vertical truth on the Phase 33 reconstruction graph before Minecraft compilation. The current implementation is deliberately graph-first: it does not mutate the legacy compiler feature objects, so vertical decisions can be validated before they move blocks in the world.

## Vertical model

Every physical reconstruction node is solved as four distinct properties:

- `groundElevationM` — terrain/surface elevation beneath the object;
- `baseElevationM` — physical object base or surface elevation;
- `heightM` — measured/known object height;
- `topElevationM` — resolved top elevation when base + height are known.

Missing values stay unresolved. The solver never invents a default elevation or height.

## Evidence authority

Evidence is selected deterministically by property, not by a generic source score. Current priority is:

1. explicit accepted planning elevation;
2. planning FFL / ride HP-LP / water level / terrain level observations;
3. explicit feature vertical data;
4. LiDAR/terrain ground samples;
5. deterministic derived values such as `top = base + height`.

Planning evidence only applies to compatible physical node types and within bounded spatial radii. Same planning application reference and same source-document hash strongly increase association confidence.

OSM and OSM-derived Overture data are never valid vertical world evidence in planning-only mode.

## Observation classes

Phase 34 consumes the evidence nodes introduced by Phase 33:

- `building-level` — building FFL and related building level points;
- `ride-elevation` — ride track HP/LP/spot elevation points;
- `water-level` — water surface levels;
- `terrain-level` — ground/spot levels used for terrain-associated objects.

## Multi-point ride vertical profiles

Ride elevation is no longer limited to one nearest level for the whole ride object. The ride profile solver projects every compatible planning HP/LP/spot-level observation onto the measured ride centerline, then orders accepted anchors by distance along the track.

For each track:

- planning reference and source-document hash are used to prevent nearby labels crossing between separate rides;
- anchors must fall within a bounded lateral distance of the track;
- duplicate anchors at effectively the same track measure are resolved deterministically;
- elevation is interpolated only between adjacent accepted planning anchors;
- no elevation is extrapolated before the first anchor or after the last anchor;
- anchor gaps larger than the configured evidence-support limit remain explicitly unresolved;
- each supported segment records its start/end elevations, gradient and source anchor IDs.

This produces an evidence-bounded continuous ride elevation profile while preserving unsupported sections as unknown rather than fabricating track height.

## Conflict handling

Conflicting values are retained in per-node `verticalResolution.conflicts` diagnostics. Higher-authority evidence is selected, but lower-authority disagreement is not silently discarded. This creates the audit trail needed for later automated QA.

## Current compiler policy

Phase 34 currently updates reconstruction-graph vertical state and ride profiles only. `reconstructionCompilerMap()` still passes the original feature references to the existing compiler, preserving current block output. A later Phase 34 slice will migrate selected compiler families to graph-resolved vertical values under explicit output tests.

## Next slices

1. Add DTM/DSM separation for ground vs object-top evidence.
2. Add terrain-surface attachment edges and support-footing ground intersections.
3. Add roof/top-surface observations for buildings and vegetation.
4. Convert ride profile elevation into graph-derived 3D compiler geometry under output-difference tests.
5. Cut resolved building, water and support vertical state into the Minecraft compiler one family at a time.
