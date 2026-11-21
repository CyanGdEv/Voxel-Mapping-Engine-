import unittest
from shapely.geometry import LineString
from alton_dataset import collection, feature, compare, PROJECT, seeds, woodland_review
from shapely.ops import transform


class ComparisonTests(unittest.TestCase):
    def setUp(self):
        self.line = transform(PROJECT, LineString([(-1.885, 52.988), (-1.883, 52.988)]))
        self.data = collection([feature(self.line, {})])

    def test_identical_has_no_disagreement(self):
        metrics, review = compare(self.data, self.data, 3)
        self.assertEqual(metrics['osm_only_length_m'], 0)
        self.assertEqual(metrics['arcgis_only_length_m'], 0)
        self.assertEqual(review['features'], [])

    def test_missing_branch_is_reported_in_metres(self):
        from shapely.affinity import translate
        other = collection([feature(translate(self.line, yoff=10), {})])
        metrics, review = compare(self.data, other, 3)
        self.assertGreater(metrics['osm_only_length_m'], 100)
        self.assertAlmostEqual(metrics['hausdorff_distance_m'], 10, places=3)
        self.assertEqual(len(review['features']), 2)

    def test_empty_source_is_not_perfect_match(self):
        with self.assertRaises(ValueError):
            compare(self.data, collection([]), 3)

    def test_polygons_are_not_centerlines(self):
        with self.assertRaises(ValueError):
            compare(self.data, collection([feature(self.line.buffer(2), {})]), 3)

    def test_woodland_overlap_is_unverified_review(self):
        woods = collection([feature(self.line.buffer(5), {'class': 'canopy'})])
        paths = collection([feature(self.line, {'occlusion': 'unknown', 'source_id': 'way/1'})])
        result = woodland_review(woods, paths)
        self.assertEqual(len(result['features']), 1)
        self.assertEqual(result['features'][0]['properties']['occlusion'], 'unknown')
        self.assertAlmostEqual(result['features'][0]['properties']['overlap_length_m'], self.line.length, places=3)

    def test_xml_converted_features_preserve_tags_and_clip(self):
        outside = {'type': 'Feature', 'geometry': {'type': 'LineString', 'coordinates': [[0, 50], [0.01, 50]]}, 'properties': {'type': 'way', 'id': 9, 'tags': {'highway': 'footway'}}}
        inside = feature(self.line, {'type': 'way', 'id': 1, 'tags': {'highway': 'footway', 'access': 'private'}})
        polygons, paths = seeds(collection([inside, outside]))
        self.assertEqual(len(polygons['features']), 0)
        self.assertEqual(len(paths['features']), 1)
        self.assertEqual(paths['features'][0]['properties']['tags']['access'], 'private')


if __name__ == '__main__':
    unittest.main()
