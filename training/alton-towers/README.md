# Alton Towers training evidence

This dataset workspace excludes street tile logic. It uses the generator's existing
park boundary: south=52.9810, west=-1.8970, north=52.9960, east=-1.8690.
Coverage claims apply only to this rectangle; extend it before including resort areas.

## Acquired evidence

The supplied ArcGIS webmap `d118d2f66f2c42f8aca7cdf538ed0e90` was inspected.
It has no operational layers; its basemap contains World Imagery and World
Transportation. The transportation service advertises `Map,Tilemap`, not query
access to path centerlines, and its metadata says it is no longer updated.
See `arcgis-reference-assessment.json` and the saved webmap/service metadata.
No street tiles were downloaded or processed. Numeric centerline positional
error remains unmeasured because this map supplies no queryable path reference.
Polygon coverage error can instead be measured against reviewed manual traces
of visible boundaries in the ArcGIS imagery; it does not require a FeatureServer.

The OSM API snapshot contains 649 clipped path/road centerline features and
348 seed polygons: 265 buildings, 14 path areas, 12 water areas and 57 woodland
areas. These are source features, not counts of distinct real-world objects.
`woodland-path-review.geojson` flags 81 path features with woodland overlap
(about 9.09 km summed overlap; source overlaps may double-count segments).
This is a review queue, not a measurement of missing paths or actual occlusion.
The manual polygon layer is intentionally empty until real annotation is done.

## Build seed labels

From the repository root:

```sh
python -m pip install -r scripts/training/requirements.txt
python scripts/training/alton_dataset.py
```

To reproduce the checked-in snapshot outputs without a network request:

```sh
python scripts/training/alton_dataset.py --osm-raw training/alton-towers/osm.raw.xml
python -m unittest discover -s scripts/training -p 'test_*.py'
```

If Overpass is unavailable, acquisition falls back to the bounded read-only
OSM map API. Both Overpass JSON and OSM XML snapshots can be supplied as input.

OSM snapshots, retrieval metadata and hashes are retained. Polygon outputs contain
mapped buildings, path areas, water and woodland. Path centerlines are a separate
layer: they do not establish a measured path width. Service roads and tracks retain
OSM access tags and need review before being classified as guest paths.
OSM labels start as unreviewed seeds, not manually verified training truth.

## ArcGIS comparison

Supply the specific ArcGIS map/FeatureServer URL and identify a path centerline
layer. Export that layer as WGS84 GeoJSON, clipped to the park. Basemap street
cartography alone does not provide a complete park footpath reference, and may
share underlying OSM data. Record its underlying provider and independence.
Do not assume an imagery viewing licence permits training or redistribution.

Create a metadata JSON with `url`, `licence`, and `training_use_permitted: true`
only after verifying those terms, plus provider, acquisition date and export date.
Then run:

```sh
python scripts/training/alton_dataset.py \
  --osm-raw training/alton-towers/osm.raw.json \
  --arcgis-paths /path/to/arcgis-path-centerlines.geojson \
  --arcgis-source /path/to/arcgis-source.json --tolerance-m 3
```

The tool projects to British National Grid (EPSG:27700), clips to the boundary,
and reports unmatched length and fraction in both directions at a configurable
3 m tolerance, plus Hausdorff distance. These measure source disagreement,
not absolute positional error. `path-review.geojson` identifies review candidates.
Use independently surveyed control points to measure absolute error and any
systematic offset; never snap everything to one source without that evidence.

## Manual polygons and trees

Open the OSM polygon and centerline layers in ArcGIS Pro with permitted aerial
imagery. Edit `manual-polygons.geojson` as a WGS84 polygon layer with fields:
`class` (path/building/water/canopy), `source`, `source_id`, `review_status`,
`occlusion` (visible/partial/under_canopy/unknown), `confidence`, `reviewer`,
`reviewed_at`, and `evidence`. Trace visible edges and correct building footprints.
Keep bridges, tunnels, stairs and queue routes distinguishable with extra fields.
Use mapped connectivity, independent surveys or permitted reference evidence to
review paths beneath trees. Retain unknown boundaries as unknown; do not invent
widths or label obscured ground as background. A canopy polygon is only woodland
context, not proof of pixel-level occlusion. Do not buffer lines into final labels
without measured widths. The script preserves existing manual work.

Before model training, validate geometry, overlaps, class consistency and path
connectivity, review every label, and rasterize only verified polygons against
rights-cleared imagery. Mark unreviewed and obscured areas with an ignore mask.
Separate train/validation/test by spatial blocks with buffers so adjacent patches
and duplicates do not leak between splits. Report accuracy separately for visible
and canopy-obscured areas. Preserve OSM attribution and assess ODbL obligations
for distributed derived databases.

`dataset-status.json` deliberately reports `training_ready: false`: seed extraction
and source comparison do not constitute manual annotation or model training.

## Polygon error: Wicker Man plaza

`wicker-man-review.geojson` records the user's report that the plaza is visible
in imagery but missing or incorrectly outlined in OSM. Its point is the OSM
Wicker Man attraction location for navigation, not a measured plaza boundary.
No actual Wicker Man error number is claimed until the plaza has been traced.

Use OSM tags to select comparable classes: `building=*` excluding `no` for
buildings, `highway=pedestrian/footway/path/...` and `area:highway=*` for path
areas, water tags for water and woodland tags for canopy context. Original tags
are retained for finer distinctions such as plazas, queues, stairs, surface and
access. A line through a plaza does not count as a correctly mapped area; never
invent a width by buffering it to improve the score. Do not assume all hardscape
is a guest plaza, or match a building to a path solely because they overlap.

Trace the visible plaza boundary into `manual-polygons.geojson` with `class=path`
and `review_status=verified` after review. Record imagery provider/date,
reviewer and evidence. Also create `reviewed-coverage.geojson` polygons with
`review_status=verified` and `reviewed_classes=["path"]` covering areas where
**all path areas** have been checked. This coverage must be defined explicitly;
the rest of the park is unreviewed, not background. Put uncertain/tree-hidden
areas in an optional `ignore.geojson` polygon layer.

```sh
python scripts/training/polygon_compare.py \
  --reference training/alton-towers/manual-polygons.geojson \
  --coverage /path/to/reviewed-coverage.geojson \
  --ignore /path/to/ignore.geojson
```

Omit `--ignore` only when there are no uncertain areas inside reviewed coverage.
The command outputs per-class metrics and error polygons in British National
Grid square metres:

- Omission = reference area absent from the OSM polygon union.
- Extra area = OSM area outside the reference within reviewed coverage.
- Omission rate = omitted area / reference area.
- Commission rate = extra area / OSM area.
- IoU = intersection area / union area; precision and recall are also reported.

For a wholly missing plaza, omission is 100% and IoU is 0. An OSM polygon covering
half a plaza with no excess has 50% omission and IoU 0.5. These are illustrative
cases, not measurements of Wicker Man. Zero-denominator metrics are null, not
perfect scores. Polygons are unioned per class to prevent double-counting;
occluded areas are excluded before scoring. Misclassification appears as an
omission in the true class and extra area in the wrong class when both classes
have reviewed coverage. Image dates and alignment still affect results: these
scores measure disagreement against reviewed traces, not absolute survey error.
