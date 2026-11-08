from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'tools/BHome.OcrSmoke/model_tools'))
from display_tile_geometry import tile_windows


class DisplayTileGeometryTests(unittest.TestCase):
    def test_every_native_pixel_is_covered_for_uneven_image(self):
        width, height = 73, 109
        tiles = tile_windows(width, height, 32)
        covered = {(x, y) for x1, y1, x2, y2 in tiles for x in range(x1, x2) for y in range(y1, y2)}
        self.assertEqual(width * height, len(covered))
        self.assertTrue(all(0 <= x1 < x2 <= width and 0 <= y1 < y2 <= height for x1, y1, x2, y2 in tiles))

    def test_small_image_is_not_invented_or_upscaled_by_tile_geometry(self):
        self.assertEqual([(0, 0, 15, 9)], tile_windows(15, 9, 416))

    def test_invalid_geometry_is_rejected(self):
        for arguments in [(0, 100, 32, .25), (100, 100, 32, 1)]:
            with self.assertRaises(ValueError):
                tile_windows(*arguments)


if __name__ == '__main__':
    unittest.main()
