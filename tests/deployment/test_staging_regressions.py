import importlib.util
import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path

spec = importlib.util.spec_from_file_location('staging_regressions', Path(__file__).resolve().parents[2] / 'scripts/Verify-StagingRegressions.py')
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)


class StagingRegressionTests(unittest.TestCase):
    def report(self, directory, removed=None, outcome='Passed', duplicate=False):
        root = ET.Element('TestRun')
        for prefix, minimum in guard.REQUIRED.items():
            for case in range(minimum):
                if prefix == removed and case == 0:
                    continue
                name = prefix + ('case' if prefix.endswith('.') else '') + f'(synthetic: {case})'
                ET.SubElement(root, 'UnitTestResult', testName=name,
                              outcome=outcome if case == 0 else 'Passed')
                if duplicate:
                    ET.SubElement(root, 'UnitTestResult', testName=name, outcome='Passed')
        ET.ElementTree(root).write(Path(directory) / 'test.trx')

    def test_all_retained_hotfix_groups_must_pass(self):
        with tempfile.TemporaryDirectory() as directory:
            self.report(directory)
            self.assertEqual(guard.verify(directory), len(guard.REQUIRED))

    def test_missing_case_cannot_be_hidden_by_duplicating_other_results(self):
        with tempfile.TemporaryDirectory() as directory:
            for group in guard.REQUIRED:
                with self.subTest(group=group):
                    self.report(directory, removed=group, duplicate=True)
                    with self.assertRaises(ValueError):
                        guard.verify(directory)

    def test_failed_skipped_and_empty_reports_block_release(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ValueError):
                guard.verify(directory)
            for outcome in ('Failed', 'NotExecuted', 'Skipped'):
                self.report(directory, outcome=outcome)
                with self.subTest(outcome=outcome), self.assertRaises(ValueError):
                    guard.verify(directory)


if __name__ == '__main__':
    unittest.main()
