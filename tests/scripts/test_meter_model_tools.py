"""Self-contained offline regression tests: no downloaded images or GPU required."""
import json
from pathlib import Path
import sys
import tempfile
import unittest

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools/BHome.OcrSmoke/model_tools"))
from prepare_meter_training import audit_pairs, perceptual_hash, prepare
from evaluate_finetuned_yolo import decode, digit_score, letterbox
from download_public_meter_assets import fetch
from train_meter_yolo import verify_training_audit


class DatasetSafety(unittest.TestCase):
    def test_perceptual_duplicate_cross_split_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "cross-split"):
            audit_pairs([{"id": "a", "split": "train"}, {"id": "b", "split": "test"}], {"a": 1234, "b": 1234})

    def test_near_duplicates_are_reported_within_one_split(self):
        pairs = audit_pairs([{"id": "a", "split": "train"}, {"id": "b", "split": "train"}], {"a": 0, "b": 31})
        self.assertEqual(pairs[0]["distance"], 5)
        self.assertFalse(pairs[0]["crossSplit"])

    def test_hash_preserves_a_resized_view(self):
        # A structured synthetic scene, not high-frequency sensor noise whose
        # downsampling changes its image content rather than just its scale.
        coarse = np.random.default_rng(42).integers(0, 256, (16, 16, 3), dtype=np.uint8)
        pixels = np.asarray(Image.fromarray(coarse).resize((128, 128)))
        small = np.asarray(Image.fromarray(pixels).resize((64, 64)))
        self.assertLessEqual((perceptual_hash(pixels) ^ perceptual_hash(small)).bit_count(), 6)

    def test_unreviewed_asset_host_cannot_download(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, "host"):
                fetch({"downloadUrl": "https://example.org/private.jpg"}, Path(directory))

    def test_invalid_license_cannot_download(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, "license"):
                fetch({"downloadUrl": "https://upload.wikimedia.org/f.jpg", "license": "unknown"}, Path(directory))

    def test_four_class_export_does_not_silently_accept_missing_classes(self):
        import hashlib
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            samples = []
            for i, split in enumerate(("train", "validation", "test")):
                pixels = np.random.default_rng(i).integers(0, 256, (64, 64, 3), dtype=np.uint8)
                path = root / f"source{i}.jpg"
                Image.fromarray(pixels).save(path)
                samples.append({"id": f"s{i}", "image": path.name, "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                                "siteGroup": f"g{i}", "meterGroup": f"g{i}", "sourceGroup": f"g{i}",
                                "captureGroup": f"g{i}", "nearDuplicateGroup": f"g{i}", "split": split,
                                "category": "water_mechanical", "annotationLevel": "meter",
                                "meterPolygon": [[0, 0], [1, 0], [1, 1], [0, 1]], "windowPolygon": None,
                                "reading": None, "quality": {"blur": False, "glare": False},
                                "provenance": {"kind": "synthetic", "license": "CC0-1.0"},
                                "review": {"method": "synthetic_test"}})
            manifest = root / "manifest.json"
            manifest.write_text(json.dumps({"version": 1, "samples": samples}), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "four classes"):
                prepare(manifest, root, root / "output")
            audit = prepare(manifest, root, root / "output", allow_partial=True)
            self.assertEqual(audit["classes"], ["water_mechanical"])
            self.assertEqual(len(audit["samples"]), 3)
            verify_training_audit(root / "output", audit)
            label = root / "output" / audit["samples"][0]["label"]
            label.write_text('0 0.5 0.5 0.1 0.1\n', encoding='utf-8')
            with self.assertRaisesRegex(ValueError, "Frozen training input"):
                verify_training_audit(root / "output", audit)


class InferenceSafety(unittest.TestCase):
    def test_letterbox_uses_rgb_normalization_and_rounded_offsets(self):
        image = np.zeros((100, 200, 3), np.uint8)
        image[:] = (0, 0, 255)
        tensor, scale, left, top = letterbox(image)
        self.assertEqual((scale, left, top), (2.08, 0, 104))
        self.assertEqual(tensor.shape, (1, 3, 416, 416))
        self.assertEqual(float(tensor[0, 0, 200, 200]), 1.)
        self.assertEqual(float(tensor[0, 2, 200, 200]), 0.)

    def test_decoder_preserves_conflicting_classes_for_review(self):
        raw = np.array([[[200, 200], [200, 200], [50, 50], [50, 50], [.9, .1], [.1, .8]]], dtype=np.float32)
        found = decode(raw, (416, 416), 1, 0, 0, .5)
        self.assertEqual(len(found), 2)
        self.assertEqual({p["class"] for p in found}, {0, 1})

    def test_overlap_never_becomes_a_digit_proposal(self):
        samples = [{"id": "a", "expectedDigits": "012"}]
        predictions = {"a": [{"class": n, "score": .99, "box": [0, 0, 10, 20]} for n in range(3)]}
        result = digit_score(samples, predictions, .5)
        self.assertEqual(result["fallback"], 1)
        self.assertEqual(result["falseProposals"], 0)

    def test_a_plausible_incomplete_number_is_counted_as_false(self):
        samples = [{"id": "a", "expectedDigits": "00123"}]
        predictions = {"a": [{"class": n, "score": .99, "box": [i*12, 0, i*12+10, 20]} for i, n in enumerate([0, 1, 2, 3])]}
        result = digit_score(samples, predictions, .5)
        self.assertEqual(result["falseProposals"], 1)
        self.assertEqual(result["exact"], 0)


if __name__ == "__main__":
    unittest.main()
