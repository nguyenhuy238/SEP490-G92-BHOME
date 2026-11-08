"""Offline source-integrity and leakage regressions; no network or model needed."""
import hashlib
import importlib.util
import io
from pathlib import Path
import tempfile
import unittest

from PIL import Image

MODULE = Path(__file__).resolve().parents[2] / "tools/BHome.OcrSmoke/model_tools/audit_badger_digit_source.py"
SPEC = importlib.util.spec_from_file_location("badger_source_audit", MODULE)
audit = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(audit)


def sample(**changes):
    stream = io.BytesIO()
    Image.new("RGB", (32, 48), "white").save(stream, format="JPEG")
    return {"slot": 4, "digit": 0, "theta_deg": 1.5, "tier": "gold", "mechanism": "geneva",
            "split": "train", "frame": "synthetic.jpg", "source_pool": "synthetic",
            "image_bytes": stream.getvalue(), **changes}


class LicensedSourceAuditTests(unittest.TestCase):
    def test_duplicate_frame_splits_are_reported_without_admitting_ground_truth(self):
        report, rows = audit.audit_rows([sample(), sample(split="test")])
        self.assertEqual(1, report["uniqueSha256Images"])
        self.assertEqual(1, report["exactDuplicateGroupsAcrossPublisherSplits"])
        self.assertEqual(1, report["publisherFramesSpanningSplits"])
        self.assertEqual(0, report["bhomeSupervisedImagesAdded"])
        self.assertEqual(0, report["bhomeIndependentEvaluationImagesAdded"])
        self.assertTrue(all(row["bhomeSplit"] is None for row in rows))
        self.assertTrue(all(row["annotationReview"] == "pending" for row in rows))

    def test_transition_label_is_preserved_without_settled_reading(self):
        report, rows = audit.audit_rows([sample(slot=7, mechanism="continuous", theta_deg=17.9)])
        self.assertEqual({"continuous": 1}, report["publisherCounts"]["mechanism"])
        self.assertNotIn("reading", rows[0])
        self.assertNotIn("confirmedValue", rows[0])

    def test_invalid_labels_and_corrupt_images_fail_closed(self):
        for changes in [{"slot": 3}, {"digit": 10}, {"theta_deg": float("nan")},
                        {"theta_deg": 360}, {"split": "acceptance"}, {"tier": "auto"},
                        {"slot": 7}, {"source_pool": ""}, {"image_bytes": b"invalid"}]:
            with self.subTest(changes=changes), self.assertRaises((ValueError, OSError)):
                audit.audit_rows([sample(**changes)])

    def test_checksum_and_size_pins_reject_replaced_source(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "source.bin"
            path.write_bytes(b"synthetic")
            digest = hashlib.sha256(b"synthetic").hexdigest()
            audit.verify_file(path, digest, 9)
            with self.assertRaises(ValueError):
                audit.verify_file(path, digest, 8)
            with self.assertRaises(ValueError):
                audit.verify_file(path, "0" * 64, 9)

    def test_empty_source_is_rejected(self):
        with self.assertRaises(ValueError):
            audit.audit_rows([])


if __name__ == "__main__":
    unittest.main()
