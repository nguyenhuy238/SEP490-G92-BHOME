"""Fail closed when a required Vitest JUnit report is absent or incomplete."""

import sys
import xml.etree.ElementTree as ET
from pathlib import Path


def verify(path):
    root = ET.parse(path).getroot()
    if root.tag != "testsuites":
        raise ValueError(f"{path}: expected Vitest testsuites")
    suites = root.findall("testsuite")
    if not suites:
        raise ValueError(f"{path}: no test suites")
    total = 0
    for suite in suites:
        cases = suite.findall("testcase")
        count = int(suite.attrib["tests"])
        if not cases or count != len(cases):
            raise ValueError(f"{path}: empty or incomplete suite")
        for field in ("failures", "errors", "skipped"):
            if int(suite.attrib[field]) != 0:
                raise ValueError(f"{path}: {field} in {suite.get('name')}")
        for case in cases:
            if not case.get("name") or any(
                case.find(tag) is not None for tag in ("failure", "error", "skipped")
            ):
                raise ValueError(f"{path}: incomplete or non-passing testcase")
        total += count
    if (
        total <= 0
        or total != int(root.attrib["tests"])
        or int(root.attrib["failures"]) != 0
        or int(root.attrib["errors"]) != 0
        or int(root.get("skipped", "0")) != 0
    ):
        raise ValueError(f"{path}: inconsistent or non-passing totals")
    return total


if __name__ == "__main__":
    try:
        if len(sys.argv) < 2:
            raise ValueError("At least one required JUnit report is needed")
        for argument in sys.argv[1:]:
            path = Path(argument)
            print(f"{path.name}: {verify(path)} passed, 0 failed/skipped")
    except (OSError, ET.ParseError, ValueError, KeyError) as error:
        print(f"Frontend test evidence failed: {error}", file=sys.stderr)
        sys.exit(1)
