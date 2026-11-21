import unittest
from shapely.geometry import box
from alton_dataset import PROJECT, feature, collection, seeds
from polygon_compare import compare_polygons


class PolygonTests(unittest.TestCase):
    def setUp(self):
        self.x, self.y = PROJECT(-1.888344, 52.9896574)
        self.square = box(self.x, self.y, self.x + 20, self.y + 20)
        self.truth = collection([feature(self.square, {'class': 'path', 'review_status': 'verified'})])
        self.coverage = collection([feature(self.square.buffer(10), {'review_status': 'verified', 'reviewed_classes': ['path']})])

    def test_missing_plaza_counts_as_omission(self):
        metrics, errors = compare_polygons(collection([]), self.truth, self.coverage)
        m = metrics['classes']['path']
        self.assertAlmostEqual(m['omitted_area_m2'], 400, places=3)
        self.assertEqual(m['omission_rate'], 1)
        self.assertEqual(m['iou'], 0)
        self.assertEqual(errors['features'][0]['properties']['error_type'], 'omission')

    def test_incorrect_boundary_measures_area(self):
        osm = collection([feature(box(self.x, self.y, self.x + 10, self.y + 20), {'class': 'path'})])
        metrics, _ = compare_polygons(osm, self.truth, self.coverage)
        self.assertAlmostEqual(metrics['classes']['path']['iou'], .5, places=6)
        self.assertAlmostEqual(metrics['classes']['path']['omitted_area_m2'], 200, places=3)

    def test_occluded_area_excluded(self):
        ignore = collection([feature(box(self.x + 10, self.y, self.x + 20, self.y + 20), {})])
        osm = collection([feature(box(self.x, self.y, self.x + 10, self.y + 20), {'class': 'path'})])
        metrics, _ = compare_polygons(osm, self.truth, self.coverage, ignore)
        self.assertAlmostEqual(metrics['classes']['path']['omitted_area_m2'], 0, places=3)
        self.assertAlmostEqual(metrics['classes']['path']['iou'], 1, places=6)

    def test_empty_unreviewed_reference_cannot_score_park(self):
        with self.assertRaises(ValueError):
            compare_polygons(collection([]), collection([]), collection([]))

    def test_tag_mismatch_is_not_accepted_as_match(self):
        osm = collection([feature(self.square, {'class': 'building'})])
        metrics, _ = compare_polygons(osm, self.truth, self.coverage)
        self.assertEqual(metrics['classes']['path']['omission_rate'], 1)
        self.assertNotIn('building', metrics['classes'])

    def test_area_highway_classification(self):
        f = feature(self.square, {'type': 'way', 'id': 1, 'tags': {'area:highway': 'pedestrian'}})
        polys, lines = seeds(collection([f]))
        self.assertEqual(polys['features'][0]['properties']['class'], 'path')
        self.assertEqual(lines['features'], [])


if __name__ == '__main__':
    unittest.main()
