"""Geometry/source integrity tests for offline public OCR diagnostics."""
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'tools/BHome.OcrSmoke/model_tools'))
from audit_meter_digit_boxes import iou, transform
from prepare_english_meter import prepare


class DiagnosticGeometryTests(unittest.TestCase):
    def test_polygon_iou_is_independent_of_corner_winding(self):
        square=np.array([[0,0],[10,0],[10,10],[0,10]],np.float32)
        self.assertAlmostEqual(1,iou(square,square[::-1]),places=5)
        self.assertAlmostEqual(1/3,iou(square,square+[5,0]),places=5)
        self.assertEqual(0,iou(square,square+[20,0]))

    def test_slanted_window_points_transform_to_the_measured_crop(self):
        polygon=np.array([[20,30],[120,40],[118,60],[18,50]],np.float32)
        matrix=transform(polygon,101,21)
        actual=cv2.perspectiveTransform(polygon[None],matrix)[0]
        np.testing.assert_allclose(actual,[[0,0],[100,0],[100,20],[0,20]],atol=.0001)

    def test_replaced_model_is_rejected_before_network_or_inference(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);(root/'inference.onnx').write_bytes(b'synthetic corrupt model')
            with patch('prepare_english_meter.requests.get') as network:
                with self.assertRaisesRegex(ValueError,'checksum'):
                    prepare(root)
                network.assert_not_called()


if __name__=='__main__':unittest.main()
