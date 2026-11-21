from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'tools/BHome.OcrSmoke/model_tools'))
from wheel_row_geometry import group_rows


class ObservedWheelRowTests(unittest.TestCase):
    def box(self, x, raw, y=0):
        return {'box': [x, y, x + 10, y + 20], 'raw': raw, 'minimumCharacterScore': .9}

    def test_observed_leading_zeros_and_order_are_preserved(self):
        rows = group_rows([self.box(40, '3'), self.box(0, '0'), self.box(20, '0')])
        self.assertEqual('003', rows[0]['raw'])
        self.assertEqual(3, rows[0]['observedRegions'])

    def test_large_gap_and_different_row_do_not_create_digits(self):
        rows = group_rows([self.box(0, '0'), self.box(100, '3'), self.box(20, '7', y=40)])
        self.assertEqual(3, len(rows))
        self.assertEqual(['0', '3', '7'], sorted(row['raw'] for row in rows))

    def test_mixed_text_is_not_cleaned_into_a_reading(self):
        self.assertEqual([], group_rows([self.box(0, 'O03')]))

    def test_slight_baseline_slope_preserves_left_to_right_order(self):
        rows = group_rows([self.box(0, '0', y=2), self.box(20, '1', y=1), self.box(40, '2')])
        self.assertEqual('012', rows[0]['raw'])


if __name__ == '__main__': unittest.main()
