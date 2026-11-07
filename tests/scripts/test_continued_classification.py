"""Split integrity, not model accuracy."""
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'tools/BHome.OcrSmoke/model_tools'))
from prepare_continued_classification import assert_isolation


class ContinuedClassificationTests(unittest.TestCase):
    def samples(self):
        return [{'id': 'a', 'sha256': 'one', 'sourceGroup': 'author1', 'split': 'train'},
                {'id': 'b', 'sha256': 'two', 'sourceGroup': 'author2', 'split': 'test'}]

    def test_group_and_byte_leakage_are_rejected(self):
        for field in ['sourceGroup', 'sha256']:
            rows = self.samples()
            rows[1][field] = rows[0][field]
            with self.assertRaises(ValueError):
                assert_isolation(rows)

    def test_duplicate_ids_are_rejected_even_in_same_split(self):
        row = self.samples()[0]
        with self.assertRaises(ValueError):
            assert_isolation([row, row.copy()])

    def test_disjoint_sources_are_valid(self):
        assert_isolation(self.samples())


if __name__ == '__main__':
    unittest.main()
