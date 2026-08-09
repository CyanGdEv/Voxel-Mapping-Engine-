# Phase 34 — Vertical Evidence Engine

Phase 34 resolves vertical truth on the Phase 33 reconstruction graph before Minecraft compilation. The current slices remain graph-only: they do not mutate legacy compiler feature objects, so vertical decisions can be validated before they move blocks in the world.

## Vertical model

Every physical reconstruction node is solved as four distinct properties: `groundElevationM`, `baseElevationM`, `heightM`, and `topElevationM`. Missing values stay unresolved; no default elevation or height is invented.

## Evidence authority

Evidence is selected deterministically by property. Current priority is accepted planning elevation and planning FFL/ride/water/terrain observations, then explicit feature vertical data, then LiDAR/terrain ground samples, followed only by deterministic derived values such as `top = base + height`.

Planning evidence only applies to compatible object types within bounded spatial radii. Matching planning references and source-document hashes strengthen association. OSM and OSM-derived Overture data are never valid vertical world evidence in planning-only mode.

## DTM / DSM surface separation

`terrain-surface-model.mjs` separates bare-earth ground from object/top surfaces. `dtmElevationM` is ground elevation; `dsmElevationM` is an independently observed top/visible surface; `aboveGroundHeightM` is derived only when both exist as DSM minus DTM.

A legacy generic `sampleLocal()` source is ground-compatible only and is never duplicated into DSM. Invalid pairs where DSM is below DTM are rejected. Paths/supports attach to DTM; buildings and vegetation use DTM base plus optional DSM top; water has its own surface; rides and bridges remain independent elevated geometry.

## Footprint-aware building and roof reconstruction

`building-roof-reconstruction.mjs` samples DTM and DSM across the actual planning-authoritative building polygon instead of relying on one centroid observation. Sampling is bounded and deterministic, with a 2 m default grid and a hard per-building cap.

Planning FFL/base/top evidence remains authoritative over sampled surfaces. DTM supplies robust building ground/base context where planning levels are absent; independent DSM supplies roof/top observations. A generic ground sampler can resolve a base but can never fabricate a roof.

The first roof classifier distinguishes `flat`, `shed`, `pitched`, `complex`, and `unresolved`. It uses robust DSM relief statistics plus a least-squares surface fit to identify a dominant roof rise direction when the evidence supports it. Ambiguous or undersampled roofs stay unresolved rather than becoming generic extrusions.

## Multi-plane roof decomposition

`building-roof-plane-decomposition.mjs` converts supported building roof evidence into graph-owned roof primitives. Flat roofs become one explicit footprint plane with eave edges. Non-flat roofs require an independent DSM channel; DSM samples are decomposed into supported plane groups with explicit polygons, slope, aspect, fitted plane coefficients, height ranges and confidence.

Where at least two supported planes exist, the graph emits a bounded ridge candidate using the reconstructed roof direction and footprint geometry. Eave edges follow the planning-authoritative footprint. Missing DSM, insufficient samples or poor plane fits remain unresolved; the engine never fabricates gable/hip geometry from a generic ground sampler.

These plane/ridge/eave primitives are intentionally Minecraft-independent so the later compiler can choose stairs, slabs or full blocks without changing reconstruction truth.

## Planning elevation and section roof constraints

`building-roof-planning-constraints.mjs` applies explicit planning annotations after DSM plane decomposition. Compatible planning observations can constrain ridge elevation, eave elevation, roof pitch and ridge direction. Matching document hashes and planning references are used before spatial association, and distant or incompatible observations are rejected.

Planning values are authoritative for the exact property they state. For example, an explicit 35 degree roof pitch replaces a DSM-derived 22 degree slope on the reconstructed roof planes, while the DSM plane polygons can still provide geometry that the plan did not explicitly define. Likewise, explicit ridge/eave levels replace sampled vertical values without discarding the independent DSM evidence.

Disagreement is never hidden. When planning ridge/eave/pitch/direction materially disagrees with DSM-derived values, the selected planning value is applied and the difference is retained as a conflict for later QA. OSM-derived observations are never accepted as roof constraints in planning-only mode.

## Vegetation digital twin

`vegetation-reconstruction.mjs` uses planning-authoritative vegetation geometry with the separated terrain surfaces to create evidence-bounded vegetation objects. DTM supplies ground elevation; independent DSM supplies canopy-top observations; height is taken from explicit planning data when present, otherwise derived only when both ground and canopy top are resolved.

Polygon vegetation is sampled across its actual planning footprint rather than only at the centroid. The reconstruction records ground elevation, canopy-top elevation, vegetation height, crown area, equivalent crown diameter, approximate crown volume, sample counts and property-level authority. Point tree geometry can use explicit crown-diameter annotations where present.

The graph distinguishes `individual-tree`, `canopy-group`, and `woodland` using planning semantics and measured crown geometry. Species, trunk diameter and other biological properties are never invented without evidence. A generic ground-only elevation sampler can never fabricate canopy height or volume, and OSM-derived vegetation geometry is rejected in planning-only mode.

## Multi-point ride vertical profiles

Ride elevation observations are projected onto the measured planning-authoritative ride centerline. Compatible anchors are ordered by distance along the track and interpolation is allowed only between accepted neighboring anchors. The solver never extrapolates before the first anchor or beyond the final anchor, and gaps above the configured safety limit stay unresolved.

## Graph-derived 3D ride geometry

Resolved ride profiles feed `ride-3d-geometry.mjs`. The engine samples the exact planning alignment at 1 m by default and creates graph-owned `(x,y,z)` samples. Resolved neighboring samples form `resolved-3d` segments with true 3D length and pitch. Unsupported spans keep `y=null`.

## Ride / terrain interaction reconstruction

`ride-terrain-interaction.mjs` compares each resolved graph-owned 3D ride sample with bare-earth DTM at the same local coordinate. Samples are classified as `elevated`, `near-grade`, `cutting`, `tunnel`, or `unresolved` from configurable clearance thresholds. The default policy treats track at least 2 m above DTM as elevated, within 0.75 m of ground as near-grade, between the near-grade and tunnel thresholds as cutting, and at least 1.5 m below DTM as tunnel.

Adjacent samples with the same state are condensed into measured interaction intervals along the planning-authoritative centerline. Cutting and tunnel intervals are emitted as explicit excavation-required intervals for a later terrain compiler cutover. Unresolved ride Y, missing DTM, or missing local DTM samples never produce a clearance estimate, tunnel classification or excavation request.

The interaction stage runs after 3D ride reconstruction and before support reconstruction. It uses DTM only for ground relationship; it does not allow OSM geometry to influence the ride or terrain authority.

## Ride support reconstruction

Planning support nodes feed `ride-support-reconstruction.mjs`. Each support is associated only with a compatible planning ride, then connected to the nearest resolved 3D track sample. Its footing consumes resolved DTM/ground state. Resolved supports record footing, track connection, height, horizontal offset, true 3D length, lean and confidence; unresolved evidence never produces an invented column.

These structures remain graph-only. The legacy Minecraft compiler stays unchanged until dedicated output tests prove a safe feature-family cutover.

## Next slices

1. Add Minecraft-aware tunnel/trench excavation compilation from graph interaction intervals.
2. Add Minecraft-aware building shell compilation using the graph roof primitives.
3. Add explicit façade/elevation constraints from planning elevation drawings.
4. Add individual-tree crown segmentation where sufficient DSM/LiDAR detail exists.
5. Cut graph-resolved building/ride/water/support/vegetation vertical state into Minecraft generation one family at a time under explicit output tests.
