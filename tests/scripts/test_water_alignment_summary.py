"""Synthetic metric regressions; do not use real images to select policy."""
import copy
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'tools/BHome.OcrSmoke/model_tools'))
from summarize_water_alignment import summarize


def fixture():
    return {'experiment': 'synthetic', 'selectionSet': 'validation', 'manifestSha256': 'a' * 64,
            'excludedManifestSha256': 'b' * 64, 'limitations': ['not billing ground truth'],
            'rows': [{'imageId': 'synthetic.jpg', 'sha256': 'c' * 64, 'completeDigitGroundTruth': '00123',
                      'sceneAllowed': True, 'sceneWarnings': [], 'variants': [
                          {'name': 'runtime_baseline', 'proposed': True, 'exactDigits': True,
                           'falseProposal': False, 'unknownGroundTruth': False},
                          {'name': 'diagnostics', 'originalDisagreement': True, 'pp': 'private-like text omitted'}]}]}


class AlignmentSummaryTests(unittest.TestCase):
    def test_metrics_remain_digit_only_and_do_not_activate(self):
        result = summarize(fixture(), 'd' * 64)
        self.assertEqual(1, result['metrics']['runtime_baseline']['exactDigits'])
        self.assertEqual('REJECTED', result['decision'])
        self.assertFalse(result['runtimeEnabled'])
        self.assertFalse(result['testEvaluated'])
        self.assertNotIn('pp', result['rows'][0])

    def test_unknown_ground_truth_proposal_is_not_exact(self):
        report = fixture()
        report['rows'][0]['completeDigitGroundTruth'] = None
        report['rows'][0]['variants'][0].update(exactDigits=False, unknownGroundTruth=True)
        result = summarize(report, 'd' * 64)
        self.assertEqual(0, result['fullyDigitLabeled'])
        self.assertEqual(1, result['metrics']['runtime_baseline']['unknownGroundTruth'])

    def test_invalid_outcomes_cannot_be_summarized_as_a_success(self):
        for change in ({'proposed': False}, {'exactDigits': 'true'}):
            report = copy.deepcopy(fixture())
            report['rows'][0]['variants'][0].update(change)
            with self.assertRaises(ValueError):
                summarize(report, 'd' * 64)


if __name__ == '__main__':
    unittest.main()
