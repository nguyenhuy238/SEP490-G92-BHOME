"""Synthetic evidence tests; no models, network, private data or GPU required."""
import copy
import hashlib
import sys
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools/BHome.OcrSmoke/model_tools"))
from build_meter_failure_taxonomy import TAXONOMY, build_report


def fixture(clear=True, proposed=False):
    raw = {"file": "public.jpg", "sourceSha256": "a" * 64, "clear": clear, "expected": "00123",
           "sceneAllowed": True, "sceneWarnings": [], "imageWarnings": [], "ppLines": 1,
           "ppValue": "00128", "ppWarnings": [], "stage2Value": "00123", "stage2Confidence": .95,
           "stage2Warnings": [], "fusedValue": "obsolete_value"}
    current = {"file": "public.jpg", "clear": clear, "inputTransform": "mobile-1600-jpeg85",
               "typedProposed": proposed, "typedExact": proposed and clear, "typedFalse": False,
               "typedWarnings": [] if proposed else ["recognizer_conflict", "reading_not_recognized"],
               "typedMilliseconds": 200, "automaticProposed": False, "automaticExact": False,
               "automaticFalse": False, "automaticWarnings": ["decimal_separator_unverified"],
               "automaticMilliseconds": 300, "classificationStatus": "ambiguous", "detectedCategory": "unknown"}
    return {"rows": [raw]}, {"rows": [current]}, {"public.jpg": "a" * 64, "public.txt": "b" * 64}


class FailureTaxonomyTests(unittest.TestCase):
    def test_unknown_digits_are_not_unreadable_or_accuracy_ground_truth(self):
        report = build_report(*fixture(clear=False))
        self.assertIsNone(report["rows"][0]["groundTruth"]["completeDigits"])
        self.assertEqual("00123", report["rows"][0]["groundTruth"]["partialAnnotatedDigits"])
        self.assertEqual(0, report["taxonomy"]["correctly_rejected_unreadable_input"]["observationCount"])
        self.assertEqual(0, report["taxonomy"]["unnecessary_fallback"]["observationCount"])

    def test_correct_intermediate_is_candidate_not_permission_to_bypass_disagreement(self):
        report = build_report(*fixture())
        events = report["rows"][0]["observations"]
        recovery = next(event for event in events if event["category"] == "unnecessary_fallback")
        self.assertFalse(recovery["rootCauseConfirmed"])
        self.assertEqual("recovery_candidate_not_proven_safe_to_emit", recovery["assessment"])
        self.assertTrue(next(event for event in events if event["category"] == "fusion_disagreement")["evidence"]["numericStringsDisagree"])
        self.assertEqual(1, report["metrics"]["typed"]["manualFallbacks"])
        self.assertEqual(set(TAXONOMY), set(report["taxonomy"]))

    def test_current_runtime_wins_over_stale_fused_value_and_modes_are_separate(self):
        report = build_report(*fixture(proposed=True))
        self.assertEqual(1, report["metrics"]["typed"]["exactDigitSequences"])
        self.assertEqual(0, report["metrics"]["automatic"]["exactDigitSequences"])
        self.assertEqual(1, report["metrics"]["typed"]["correctProposalsOverEmittedProposals"])
        self.assertIsNone(report["metrics"]["typed"]["billingReadingAccuracy"])
        self.assertEqual(0, report["taxonomy"]["unnecessary_fallback"]["observationCount"])

    def test_exact_flags_cannot_claim_accuracy_on_incomplete_labels(self):
        data = fixture(clear=False, proposed=True)
        data[1]["rows"][0]["typedExact"] = True
        with self.assertRaisesRegex(ValueError, "outcome"):
            build_report(*data)

    def test_proposal_with_unknown_ground_truth_has_no_conditional_accuracy(self):
        report = build_report(*fixture(clear=False, proposed=True))
        self.assertEqual(1, report["metrics"]["typed"]["proposalsWithoutFullDigitGroundTruth"])
        self.assertIsNone(report["metrics"]["typed"]["correctProposalsOverEmittedProposals"])

    def test_missing_duplicate_and_hash_mismatched_evidence_is_rejected(self):
        original = fixture()
        for change, message in (("missing", "identifiers"), ("duplicate", "duplicate"), ("hash", "hash")):
            data = copy.deepcopy(original)
            if change == "missing":
                data[1]["rows"] = []
            elif change == "duplicate":
                data[0]["rows"] *= 2
            else:
                data[2]["public.jpg"] = "c" * 64
            with self.assertRaisesRegex(ValueError, message):
                build_report(*data)

    def test_corpus_verification_catches_modified_image_or_label(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "public.jpg").write_bytes(b"synthetic public fixture")
            (root / "public.txt").write_bytes(b"synthetic labels")
            data = fixture()
            data[2].update({name: hashlib.sha256((root / name).read_bytes()).hexdigest() for name in data[2]})
            data[0]["rows"][0]["sourceSha256"] = data[2]["public.jpg"]
            self.assertTrue(build_report(*data, image_root=root)["currentCorpusHashesVerified"])
            (root / "public.txt").write_bytes(b"changed labels")
            with self.assertRaisesRegex(ValueError, "fixture"):
                build_report(*data, image_root=root)

    def test_geometry_rejection_does_not_become_proven_wrong_crop(self):
        data = fixture()
        data[0]["rows"][0]["sceneWarnings"] = ["meter_region_invalid"]
        report = build_report(*data)
        event = next(event for event in report["rows"][0]["observations"] if event["category"] == "incorrect_meter_bounding_box")
        self.assertFalse(event["rootCauseConfirmed"])
        self.assertIsNone(report["rows"][0]["groundTruth"]["displayPolygon"])


if __name__ == "__main__":
    unittest.main()
