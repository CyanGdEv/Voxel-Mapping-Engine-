# Comprehensive planning-drawing extraction

Phase 30D makes every accepted, accurately georeferenced park plan an automatic
semantic input. Vector PDFs use their native geometry and positioned text. Plans
whose useful content is raster imagery use a bounded OpenCV contour/line pass and
positioned Tesseract OCR. Both paths feed the same typed feature schema and the
same planning-authority, provenance, licence, confidence, status and georeference
gates.

## Planning-only world authority

The production build runs with `--planning-world-authority planning-only`.
OpenStreetMap may be consulted before fusion to locate the park and register a
drawing, but no OSM feature, OSM tag, OSM height/elevation or OSM-derived
Overture feature is allowed into the normalized world feature set. The cutover
happens before boundary selection, fidelity enrichment and raster compilation.

Accepted planning geometry supplies the world coverage boundary. If no accepted
planning feature exists, the build fails closed instead of silently falling back
to an OSM/geocoder boundary. Independent non-OSM evidence such as terrain or
survey measurements may still fill an attribute that a plan does not state, but
it cannot replace planning geometry or a planning attribute.

## Data retained

- Rides: track/rail alignment, footprints, high and low elevation points, running
  levels, supports, columns, stanchions and support footings.
- Access: path centre lines and surfaces, plazas, queues, steps, ramps, bridges,
  boardwalks and tunnels, including measured width, material and vertical state.
- Structures: building footprints and finished floor levels, permanent walls,
  retaining walls, acoustic screens, permanent fences, railings and barriers.
- Landscape: individual tree positions, crown/canopy geometry, tree state,
  protection zones, woodland cover, hedges, shrubs, groundcover, planted areas,
  meadow and amenity grass.
- Terrain and water: rockwork, boulders, rock faces, gabions, spot levels,
  contours, slopes, cut/fill and earthworks, water bodies, watercourses, drainage,
  ditches, swales and water levels.

Each candidate keeps its document/application reference, URL, content hash, page,
extraction method, georeference method/error, semantic label/class, existing/new/
retained/removed state, measurements and confidence. Accepted plan candidates are
then promoted through the planning-authority fusion layer and compiled by the
existing world feature handlers. A final invariant records that zero OSM-derived
world features remain before compilation.

## Explicit construction-fence exclusion

Temporary construction fencing, site-security fencing and hoarding are never
promoted into the world. The exclusion is driven by the drawing label (for
example, “Temporary fencing to secure building site”). A red stroke increases
association confidence but red alone never excludes a feature, because red is
also commonly used for planning boundaries and annotations.

The exclusion is enforced twice:

1. The extractor withholds matching geometry and records
   `temporary-construction-fence` in `excludedByReason`.
2. The fusion layer rejects any candidate carrying the explicit exclusion flag,
   preventing a malformed or externally supplied candidate from bypassing the
   extractor.

Planning/application boundaries remain as evidence for registration, cropping
and provenance, but are deliberately marked non-rendering because they are not a
physical park object.

## Deterministic safety behavior

All accepted plans are queued automatically, with raised but finite document and
feature caps to keep Actions bounded. Ambiguous, unlabelled general/site-plan
linework is withheld rather than guessed. Raster extraction is enabled only when
the plan has an accepted affine page/image-to-British-National-Grid transform;
missing alignment, OCR or native tooling degrades to evidence-only diagnostics
instead of generating speculative geometry.
