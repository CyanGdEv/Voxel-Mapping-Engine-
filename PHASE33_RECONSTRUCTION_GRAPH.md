# Phase 33 — Unified Park Reconstruction Graph

Phase 33 introduces a typed intermediate park scene between evidence fusion and Minecraft rasterization.
It is intentionally additive in this first slice: world compilation still uses the existing feature map while the graph is built, validated and emitted as `park-reconstruction-graph.json` before raster compilation.

## Why this exists

The previous pipeline moves directly from enriched GIS/planning features into a 1 m raster. That makes it difficult to solve cross-object 3D relationships such as ride supports meeting track and terrain, paths passing under rides, bridges crossing water, buildings adjoining paths, and barriers following circulation edges.

The reconstruction graph gives later phases a stable place to solve those relationships before Minecraft representation decisions are made.

## Node model

Every physical node retains:

- source feature ID and semantic type;
- geographic and local-metre geometry;
- bounds, centroid, length/area and dimensionality;
- ground/base/top elevation fields with evidence provenance;
- height and vertical relationship;
- material/surface/pattern/colour evidence;
- lifecycle/planning state;
- planning semantics and measured dimensions;
- geometry and attribute authority;
- provenance, document hash/reference and verification;
- separate geometry, vertical, semantic and material confidence.

Evidence-only geometry and explicit construction-fence exclusions are never promoted to physical nodes.

## Relationship foundation

The first deterministic relationship pass records high-value relationships needed by later solvers:

- ride support → ride track;
- bridge → water;
- path → building;
- barrier → path;
- ride track ↔ nearby building;
- path ↔ ride track interaction.

Relationships preserve current vertical evidence and mark unresolved vertical ordering when evidence is insufficient rather than guessing.

## Authority invariants

When `planningWorldAuthority=planning-only`, graph creation fails closed if any OSM or OSM-derived Overture feature reaches the physical scene. OSM can still exist upstream for registration/reference, but it cannot become a reconstruction node.

## Next Phase 33 slices

1. Make `compileMap` consume reconstruction nodes instead of raw features.
2. Add typed terrain surfaces and explicit object-ground attachment edges.
3. Add graph partitioning by spatial tile/chunk for incremental compilation.
4. Add stable node/relationship hashes for change detection.
5. Feed Phase 34 vertical solving into the same graph rather than mutating ad-hoc feature fields.
