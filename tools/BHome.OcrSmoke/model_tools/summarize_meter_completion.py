"""Summarize offline public evaluation output; no model training or image processing."""
import argparse
from collections import Counter
import json
import math
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("runtime", type=Path)
parser.add_argument("calibration", type=Path)
parser.add_argument("unused_test", type=Path)
parser.add_argument("output", type=Path)
args = parser.parse_args()

def latency(rows, key):
    values = sorted(r[key] for r in rows)
    return {"p50Milliseconds": values[math.ceil(len(values) * .5) - 1],
            "p95Milliseconds": values[math.ceil(len(values) * .95) - 1],
            "maxMilliseconds": max(values), "within10Seconds": sum(v <= 10000 for v in values)}

def runtime_summary(rows):
    summary = {"images": len(rows), "fullyLabeled": sum(r["clear"] for r in rows)}
    for prefix, time in (("baseline", "baselineMilliseconds"), ("typed", "typedMilliseconds"), ("automatic", "automaticMilliseconds")):
        summary[prefix] = {"proposals": sum(r[prefix + "Proposed"] for r in rows),
                           "exact": sum(r[prefix + "Exact"] for r in rows),
                           "falseOnFullyLabeled": sum(r[prefix + "False"] for r in rows),
                           "fallbacks": sum(not r[prefix + "Proposed"] for r in rows),
                           **latency(rows, time)}
    summary["automaticCategoryCounts"] = dict(Counter(r["detectedCategory"] for r in rows))
    return summary

runtime = json.loads(args.runtime.read_text())["rows"]
results = {"runtime": runtime_summary(runtime), "cropComparisons": [],
           "productionReady": False, "representativeFourTypeAcceptance": False,
           "groundTruthChanged": False, "trainingPerformed": False}
for label, path in (("previously-selected-10", args.calibration), ("previously-unused-author-test-42", args.unused_test)):
    rows = json.loads(path.read_text())["rows"]
    variants = {}
    for name in ("legacy", "canonical", "margin03", "margin08"):
        items = [v for r in rows for v in r["variants"] if v["name"] == name]
        variants[name] = {strategy: {metric: sum(v[strategy][metric] for v in items)
                                     for metric in ("proposed", "exact", "falseProposal")}
                          for strategy in ("pp", "ppDirect", "ppContrast", "stage2", "combined")}
    results["cropComparisons"].append({"set": label, "images": len(rows),
        "fullyLabeled": sum(r["clear"] for r in rows), "variants": variants})
results["limitations"] = [
    "Same author water-meter test split, repeated meters; not an independent BHOME four-category dataset.",
    "Original annotations include unclear digits and apparent coverage gaps; retained unchanged.",
    "Crop comparison uses original resolution; runtime uses mobile 1600/JPEG85, actual scene/profile/parser guards.",
    "Exact denominator excludes annotations with u; unknown ground truth is never counted as exact or false.",
    "No billing decimal ground truth for public water images. These are exact annotated digit-string metrics."
]
args.output.write_text(json.dumps(results, indent=2) + "\n", encoding="utf-8")
print(json.dumps(results["runtime"]))
