"""Compare tagged OSM polygon coverage with reviewed imagery-traced polygons."""
import argparse
import json
from pathlib import Path

from shapely.geometry import shape
from shapely.ops import transform, unary_union
from alton_dataset import AOI, PROJECT, collection, feature, write

CLASSES = ('path', 'building', 'water', 'canopy')


def polygons(data, label):
    output = []
    for f in data['features']:
        g = shape(f['geometry'])
        if g.geom_type not in ('Polygon', 'MultiPolygon') or not g.is_valid:
            raise ValueError(f'{label}: valid Polygon/MultiPolygon geometry required')
        output.append((transform(PROJECT, g), f.get('properties', {})))
    return output


def compare_polygons(osm, reference, coverage, ignore=None):
    """Coverage defines exhaustively reviewed classes/areas, never the whole park by default."""
    mapped = polygons(osm, 'OSM')
    truth = polygons(reference, 'reference')
    regions = polygons(coverage, 'coverage')
    ignored = unary_union([g for g, _ in polygons(ignore or collection([]), 'ignore')])
    for _, p in truth:
        if p.get('class') not in CLASSES or p.get('review_status') != 'verified':
            raise ValueError('Reference polygons need a supported class and review_status=verified')
    if not regions:
        raise ValueError('Explicit reviewed coverage is required; empty reference is not negative evidence')
    for _, p in regions:
        classes = p.get('reviewed_classes')
        if p.get('review_status') != 'verified' or not isinstance(classes, list) or not classes or any(c not in CLASSES for c in classes):
            raise ValueError('Coverage needs review_status=verified and supported reviewed_classes')
    metrics, errors = {}, []
    for cls in CLASSES:
        region = unary_union([g for g, p in regions if cls in p['reviewed_classes']]).intersection(AOI).difference(ignored)
        if region.is_empty or region.area == 0:
            continue
        a = unary_union([g for g, p in mapped if p.get('class') == cls]).intersection(region)
        b = unary_union([g for g, p in truth if p['class'] == cls]).intersection(region)
        match, missing, extra = a.intersection(b), b.difference(a), a.difference(b)
        union_area = a.union(b).area
        metrics[cls] = {
            'evaluated_area_m2': region.area, 'osm_area_m2': a.area, 'reference_area_m2': b.area,
            'matched_area_m2': match.area, 'omitted_area_m2': missing.area, 'extra_area_m2': extra.area,
            'omission_rate': missing.area / b.area if b.area else None,
            'commission_rate': extra.area / a.area if a.area else None,
            'iou': match.area / union_area if union_area else None,
            'precision': match.area / a.area if a.area else None,
            'recall': match.area / b.area if b.area else None,
        }
        for kind, geom in [('omission', missing), ('extra_or_misclassified', extra)]:
            if geom.area:
                errors.append(feature(geom, {'class': cls, 'error_type': kind, 'area_m2': geom.area, 'review_status': 'needs_manual_review'}))
    if not metrics:
        raise ValueError('No reviewed area remains inside park after exclusions')
    return {'crs': 'EPSG:27700', 'meaning': 'OSM polygon disagreement against reviewed imagery labels; not survey accuracy', 'classes': metrics}, collection(errors)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--osm', type=Path, default=Path('training/alton-towers/osm-seed-polygons.geojson'))
    p.add_argument('--reference', type=Path, required=True)
    p.add_argument('--coverage', type=Path, required=True, help='Exhaustively reviewed regions with reviewed_classes')
    p.add_argument('--ignore', type=Path, help='Occluded or uncertain areas excluded from scoring')
    p.add_argument('--out', type=Path, default=Path('training/alton-towers/polygon-comparison'))
    args = p.parse_args()
    read = lambda path: json.loads(path.read_text())
    metrics, errors = compare_polygons(read(args.osm), read(args.reference), read(args.coverage), read(args.ignore) if args.ignore else None)
    args.out.mkdir(parents=True, exist_ok=True)
    write(args.out / 'polygon-metrics.json', metrics)
    write(args.out / 'polygon-errors.geojson', errors)
    print(json.dumps(metrics, indent=2))


if __name__ == '__main__':
    main()
