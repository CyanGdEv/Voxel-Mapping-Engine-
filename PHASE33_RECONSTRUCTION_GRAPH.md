# Phase 33 — Unified Park Reconstruction Graph

Phase 33 introduces a typed intermediate park scene between evidence fusion and Minecraft rasterization. It is intentionally additive in this first slice: world compilation still uses the existing feature map while the graph is built, validated and emitted as `park-reconstruction-graph.json` before raster compilation.

## Why this exists

The previous pipeline moves directly from enriched GIS/planning features into a 1 m raster. That makes it difficult to solve cross-object 3D relationships such as ride supports meeting track and terrain, paths passing under rides, bridges crossing water, buildings adjoining paths, and barriers following circulation edges.

The reconstruction graph gives later phases a stable place to solve those relationships before Minecraft representation decisions are made.

## Physical node model

Every physical node retains:

- source feature ID and semantic type;
- exact in-memory geographic and local-metre geometry plus compact bounds/centroid/measure metadata;
- ground/base/top elevation fields with evidence provenance;
- height and vertical relationship;
- material/surface/pattern/colour evidence;
- lifecycle/planning state;
- planning semantics and measured dimensions;
- geometry and attribute authority;
- provenance, document hash/reference and verification;
- separate geometry, vertical, semantic and material confidence.

Exact source geometry is retained as a non-enumerable in-memory reference so later compilers can consume it without duplicating large coordinate arrays in the diagnostic JSON artifact.

Evidence-only geometry and explicit construction-fence exclusions are never promoted to physical nodes.

## Evidence observations

Planning level/elevation annotations such as ride HP/LP points, building FFLs, water levels and terrain spot levels are stored separately in `evidenceNodes`. They remain available for Phase 34 vertical solving without being mistaken for physical park objects.

## Relationship foundation

The first deterministic relationship pass records high-value relationships needed by later solvers:

- ride support → nearest ride track;
- bridge → intersecting water;
- path → nearby building;
- barrier → nearby path;
- ride track ↔ nearby building;
- path ↔ ride track interaction.

Relationship fan-out is deliberately bounded per source object and uses a geometry-bounds spatial grid, preventing dense plans from creating quadratic relationship growth. Relationships preserve current vertical evidence and mark unresolved vertical ordering when evidence is insufficient rather than guessing.

## Authority invariants

When `planningWorldAuthority=planning-only`, graph creation fails closed if any OSM or OSM-derived Overture feature reaches the physical or evidence scene. OSM can still exist upstream for registration/reference, but it cannot become a reconstruction node.

## Scaling / diagnostics

The production artifact uses `compactParkReconstructionGraph()` rather than serializing the complete in-memory graph. A synthetic scale probe with roughly 110,000 physical nodes completed graph construction in about 2.6 seconds, kept inferred relationships bounded at about 30,000, and produced roughly 36 MB of compact JSON instead of the much larger full geometry-rich representation. This benchmark is an engineering probe rather than a guaranteed production runtime.

## Next Phase 33 slices

1. Make `compileMap` consume reconstruction nodes instead of raw features.
2. Add typed terrain surfaces and explicit object-ground attachment edges.
3. Add graph partitioning by spatial tile/chunk for incremental compilation.
4. Add stable node/relationship hashes for change detection.
5. Feed Phase 34 vertical solving into the same graph rather than mutating ad-hoc feature fields.
