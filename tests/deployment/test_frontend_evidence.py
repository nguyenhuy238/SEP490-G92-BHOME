import importlib.util
import tempfile
import unittest
from pathlib import Path


spec = importlib.util.spec_from_file_location(
    "frontend_evidence",
    Path(__file__).resolve().parents[2] / "scripts/Verify-FrontendEvidence.py",
)
evidence = importlib.util.module_from_spec(spec)
spec.loader.exec_module(evidence)


class FrontendEvidenceTests(unittest.TestCase):
    def verify_xml(self, xml):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "report.xml"
            path.write_text(xml, encoding="utf-8")
            return evidence.verify(path)

    def report(self, cases='<testcase name="a"/>', count=1, skipped=0):
        return (
            f'<testsuites tests="{count}" failures="0" errors="0">'
            f'<testsuite tests="{count}" failures="0" errors="0" skipped="{skipped}">'
            f"{cases}</testsuite></testsuites>"
        )

    def test_valid_vitest_report(self):
        self.assertEqual(self.verify_xml(self.report()), 1)

    def test_missing_empty_or_incomplete_report(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(OSError):
                evidence.verify(Path(directory) / "missing.xml")
        for xml in (self.report("", 0), self.report(count=2), "<testsuites/>"):
            with self.subTest(xml=xml), self.assertRaises(ValueError):
                self.verify_xml(xml)

    def test_hidden_failure_or_skip_rejected_even_with_zero_counters(self):
        for tag in ("failure", "error", "skipped"):
            with self.subTest(tag=tag), self.assertRaises(ValueError):
                self.verify_xml(self.report(f'<testcase name="a"><{tag}/></testcase>'))
        with self.assertRaises(ValueError):
            self.verify_xml(self.report(skipped=1))
