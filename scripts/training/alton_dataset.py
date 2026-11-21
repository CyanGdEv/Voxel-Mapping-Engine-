"""OSM seed labels and symmetric ArcGIS disagreement review; no street tiles."""
import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

import osm2geojson
import requests
from pyproj import Transformer
from shapely.geometry import shape, mapping, box
from shapely.ops import transform, unary_union

BBOX = (52.9810, -1.8970, 52.9960, -1.8690)  # south,west,north,east
PROJECT = Transformer.from_crs(4326, 27700, always_xy=True).transform
UNPROJECT = Transformer.from_crs(27700, 4326, always_xy=True).transform
AOI = transform(PROJECT, box(BBOX[1], BBOX[0], BBOX[3], BBOX[2]))
PATHS = {'footway', 'path', 'pedestrian', 'steps', 'cycleway', 'bridleway', 'service', 'track', 'residential', 'unclassified'}


def write(path, value):
    Path(path).write_text(json.dumps(value, indent=2) + '\n')


def collection(features):
    return {'type': 'FeatureCollection', 'features': features}


def feature(geom, properties):
    return {'type': 'Feature', 'geometry': mapping(transform(UNPROJECT, geom)), 'properties': properties}


def fetch_osm(out):
    bbox = ','.join(map(str, BBOX))
    query = f'[out:json][timeout:120];(nwr[highway]({bbox});nwr[building]({bbox});nwr[natural=water]({bbox});nwr[waterway]({bbox});nwr[landuse=forest]({bbox});nwr[natural=wood]({bbox}););out geom;'
    errors = []
    for endpoint in ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']:
        try:
            r = requests.post(endpoint, data={'data': query}, timeout=180)
            r.raise_for_status()
            raw = r.json()
            if raw.get('remark'):
                raise ValueError(raw['remark'])
            write(out / 'osm.raw.json', raw)
            write(out / 'osm-source.json', {'url': endpoint, 'query': query, 'retrieved_at': datetime.now(timezone.utc).isoformat(), 'licence': 'ODbL-1.0', 'attribution': '© OpenStreetMap contributors', 'sha256': hashlib.sha256((out / 'osm.raw.json').read_bytes()).hexdigest()})
            return raw
        except (requests.RequestException, ValueError) as exc:
            errors.append(str(exc))
    # The bounded read-only OSM API avoids dependence on Overpass availability.
    endpoint = 'https://api.openstreetmap.org/api/0.6/map'
    try:
        r = requests.get(endpoint, params={'bbox': f'{BBOX[1]},{BBOX[0]},{BBOX[3]},{BBOX[2]}'}, timeout=90)
        r.raise_for_status()
        converted = osm2geojson.xml2geojson(r.text)
        (out / 'osm.raw.xml').write_bytes(r.content)
        write(out / 'osm-source.json', {'url': r.url, 'retrieved_at': datetime.now(timezone.utc).isoformat(), 'licence': 'ODbL-1.0', 'attribution': '© OpenStreetMap contributors', 'sha256': hashlib.sha256(r.content).hexdigest(), 'overpass_errors': errors})
        return converted
    except (requests.RequestException, ValueError) as exc:
        errors.append(str(exc))
    raise RuntimeError('OSM acquisition failed: ' + '; '.join(errors))


def seeds(raw):
    labels, lines = [], []
    data = raw if raw.get('type') == 'FeatureCollection' else osm2geojson.json2geojson(raw)
    for f in data['features']:
        p = f['properties']
        tags = p.get('tags', {})
        cls = 'building' if 'building' in tags else 'path' if tags.get('highway') in PATHS else 'water' if tags.get('natural') == 'water' or 'waterway' in tags else 'canopy' if tags.get('natural') == 'wood' or tags.get('landuse') == 'forest' else None
        if not cls:
            continue
        g = shape(f['geometry'])
        if not g.is_valid:
            g = g.buffer(0) if g.geom_type in ('Polygon', 'MultiPolygon') else g
        g = transform(PROJECT, g).intersection(AOI)
        if g.is_empty:
            continue
        props = {'class': cls, 'source': 'OSM', 'source_id': f"{p.get('type')}/{p.get('id')}", 'review_status': 'unreviewed', 'label_role': 'seed', 'occlusion': 'unknown', 'tags': tags}
        if g.geom_type in ('Polygon', 'MultiPolygon'):
            labels.append(feature(g, props))
        elif cls == 'path' and g.geom_type in ('LineString', 'MultiLineString'):
            lines.append(feature(g, props))
    return collection(labels), collection(lines)


def woodland_review(polygons, lines):
    """Mapped woodland overlap is a review hint, never confirmed image occlusion."""
    woods = [transform(PROJECT, shape(f['geometry'])) for f in polygons['features'] if f['properties']['class'] == 'canopy']
    canopy = unary_union(woods)
    candidates = []
    for f in lines['features']:
        overlap = transform(PROJECT, shape(f['geometry'])).intersection(canopy)
        if overlap.length > 0:
            candidates.append(feature(overlap, {**f['properties'], 'review_reason': 'mapped_woodland_overlap', 'review_status': 'needs_manual_review', 'overlap_length_m': overlap.length}))
    return collection(candidates)


def compare(osm, arcgis, tolerance):
    """Compare actual centerlines only; buffered coverage is not polygon ground truth."""
    groups = []
    for data in (osm, arcgis):
        geoms = []
        for f in data['features']:
            g = shape(f['geometry'])
            if g.geom_type not in ('LineString', 'MultiLineString'):
                raise ValueError('Comparison requires path centerlines, not mixed classes or polygons')
            if not g.is_valid:
                raise ValueError('Invalid centerline geometry')
            g = transform(PROJECT, g).intersection(AOI)
            if not g.is_empty:
                geoms.append(g)
        if not geoms:
            raise ValueError('Both sources must have centerlines inside the Alton Towers boundary')
        groups.append(unary_union(geoms))
    a, b = groups
    review, metrics = [], {'tolerance_m': tolerance, 'crs': 'EPSG:27700', 'meaning': 'Source disagreement; neither source is ground truth'}
    for name, source, target in [('osm_only', a, b), ('arcgis_only', b, a)]:
        missing = source.difference(target.buffer(tolerance))
        metrics[name + '_length_m'] = missing.length
        metrics[name + '_fraction'] = missing.length / source.length
        if not missing.is_empty:
            review.append(feature(missing, {'disagreement': name, 'review_status': 'needs_manual_review', 'possible_causes': ['occlusion', 'alignment', 'date_difference', 'missing_mapping']}))
    metrics.update(osm_length_m=a.length, arcgis_length_m=b.length, hausdorff_distance_m=a.hausdorff_distance(b))
    return metrics, collection(review)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, default=Path('training/alton-towers'))
    parser.add_argument('--osm-raw', type=Path)
    parser.add_argument('--arcgis-paths', type=Path, help='WGS84 GeoJSON of path centerlines only')
    parser.add_argument('--arcgis-source', type=Path, help='JSON declaring url, licence and training_use_permitted=true')
    parser.add_argument('--tolerance-m', type=float, default=3)
    args = parser.parse_args()
    if not 0 < args.tolerance_m <= 100:
        parser.error('tolerance must be >0 and <=100 metres')
    args.out.mkdir(parents=True, exist_ok=True)
    if args.osm_raw:
        content = args.osm_raw.read_text()
        raw = osm2geojson.xml2geojson(content) if content.lstrip().startswith('<') else json.loads(content)
    else:
        raw = fetch_osm(args.out)
    polygons, lines = seeds(raw)
    write(args.out / 'osm-seed-polygons.geojson', polygons)
    write(args.out / 'osm-path-centerlines.geojson', lines)
    review = woodland_review(polygons, lines)
    write(args.out / 'woodland-path-review.geojson', review)
    # Never overwrite manual annotation work.
    manual = args.out / 'manual-polygons.geojson'
    if not manual.exists():
        write(manual, collection([]))
    status = {'status': 'awaiting_arcgis_and_manual_review', 'bbox_south_west_north_east': BBOX, 'seed_polygon_count': len(polygons['features']), 'path_centerline_count': len(lines['features']), 'training_ready': False}
    status['polygon_counts_by_class'] = {cls: sum(f['properties']['class'] == cls for f in polygons['features']) for cls in ('path', 'building', 'water', 'canopy')}
    status['woodland_review_segment_count'] = len(review['features'])
    status['woodland_overlap_length_m'] = sum(f['properties']['overlap_length_m'] for f in review['features'])
    status['arcgis_reference_assessment'] = 'arcgis-reference-assessment.json' if (args.out / 'arcgis-reference-assessment.json').exists() else None
    if status['arcgis_reference_assessment']:
        status['status'] = 'awaiting_independent_path_reference_and_manual_review'
    if args.arcgis_paths:
        if not args.arcgis_source:
            parser.error('--arcgis-source is required with --arcgis-paths')
        metadata = json.loads(args.arcgis_source.read_text())
        if not metadata.get('url') or not metadata.get('licence') or metadata.get('training_use_permitted') is not True:
            parser.error('ArcGIS metadata must identify URL, licence and permitted training use')
        data = json.loads(args.arcgis_paths.read_text())
        metrics, review = compare(lines, data, args.tolerance_m)
        write(args.out / 'arcgis-source.json', metadata)
        write(args.out / 'disagreement-metrics.json', metrics)
        write(args.out / 'path-review.geojson', review)
        status['status'] = 'awaiting_manual_review'
    write(args.out / 'dataset-status.json', status)
    print(json.dumps(status, indent=2))


if __name__ == '__main__':
    main()
