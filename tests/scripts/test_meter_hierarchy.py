"""Synthetic decision invariants; these do not establish image accuracy."""
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'tools/BHome.OcrSmoke/model_tools'))
from meter_hierarchy_policy import hierarchy_decision


class MeterHierarchyTests(unittest.TestCase):
    def test_two_confident_visual_heads_map_to_water_digital(self):
        self.assertEqual('water_digital', hierarchy_decision(
            {'electricity': .01, 'water': .98, 'not_meter': .01},
            {'mechanical': .02, 'digital': .98}, .85, .65))

    def test_non_meter_rejects_even_with_confident_technology(self):
        self.assertEqual('unknown', hierarchy_decision(
            {'electricity': .01, 'water': .01, 'not_meter': .98},
            {'mechanical': .02, 'digital': .98}, .85, .65))

    def test_uncertain_head_cannot_be_rescued_by_other_head(self):
        self.assertEqual('unknown', hierarchy_decision(
            {'electricity': .98, 'water': .01, 'not_meter': .01},
            {'mechanical': .51, 'digital': .49}, .85, .5))
        self.assertEqual('unknown', hierarchy_decision(
            {'electricity': .5, 'water': .49, 'not_meter': .01},
            {'mechanical': .02, 'digital': .98}, .5, .65))


if __name__ == '__main__':
    unittest.main()
