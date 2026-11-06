"""Freeze an incremental water decision policy on validation, then score fixed test.

Does not train, relabel, or install a new default model. Audit inputs must contain
public fixtures only; output omits digit strings. Same-site leakage in the author
data is unknown and explicitly does not establish independent acceptance.
"""
import argparse
from collections import Counter
import json
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("validation", type=Path)
parser.add_argument("test", type=Path)
parser.add_argument("report", type=Path)
parser.add_argument("--exclude-exact-overlap", action="store_true")
parser.add_argument("--runtime-before", type=Path)
args = parser.parse_args()
validation = json.loads(args.validation.read_text())["rows"]
test = json.loads(args.test.read_text())["rows"]
test_hashes = set(r["sourceSha256"] for r in test)
overlap = [r for r in validation if r["sourceSha256"] in test_hashes]
if overlap and not args.exclude_exact_overlap:
    raise ValueError("Exact source-image leakage between validation and test; review exclusions explicitly")
validation = [r for r in validation if r["sourceSha256"] not in test_hashes]

def eligible(r, threshold):
    return (r["sceneAllowed"] and r["stage2Value"] is not None and r["stage2Confidence"] >= threshold
        and "blur_or_low_detail" not in r["imageWarnings"] and r["ppValue"] is None and r["ppLines"] == 1
        and "multiple_reading_regions" not in r["ppWarnings"] and "meter_type_mismatch" not in r["ppWarnings"])

def measure(rows, threshold):
    selected = [r for r in rows if eligible(r, threshold)]
    return {"proposals": len(selected), "knownExact": sum(r["clear"] and r["stage2Value"] == r["expected"] for r in selected),
        "knownFalse": sum(r["clear"] and r["stage2Value"] != r["expected"] for r in selected),
        "unknownGroundTruth": sum(not r["clear"] for r in selected)}

# All decisions below are computed from validation only, before scoring test.
grid = [{"threshold": t, **measure(validation, t)} for t in (.5, .6, .7, .8, .9, .95, .97, .99)]
feasible = [r for r in grid if r["knownFalse"] == 0 and r["knownExact"] > 0]
chosen = max(feasible, key=lambda r: (r["knownExact"], -r["threshold"])) if feasible else None

def breakdown(rows):
    outcomes = Counter()
    for r in rows:
        proposal = r["fusedValue"]
        if not r["clear"]:
            outcomes["unreadableAnnotationRejected" if proposal is None else "proposalWithUnknownGroundTruth"] += 1
        elif proposal is not None:
            outcomes["correctProposal" if proposal == r["expected"] else "incorrectProposal"] += 1
        elif r["stage2Value"] == r["expected"]:
            outcomes["correctStage2Rejected"] += 1
        elif r["stage2Value"] is None:
            outcomes["missingOrUncertainStage2Rejected"] += 1
        else:
            outcomes["incorrectStage2Rejected"] += 1
    return {"images": len(rows), "fullyLabeled": sum(r["clear"] for r in rows), "outcomes": dict(outcomes),
        "sceneRejections": dict(Counter(w for r in rows if not r["sceneAllowed"] for w in r["sceneWarnings"])),
        "stage2Rejections": dict(Counter(w for r in rows for w in r["stage2Warnings"]))}

report = {"validation": breakdown(validation), "testBefore": breakdown(test), "validationGrid": grid,
    "excludedValidationExactDuplicates": [r["file"] for r in overlap],
    "frozenCandidate": chosen, "testCandidate": measure(test, chosen["threshold"]) if chosen else None,
    "policy": "For a single unparseable PP crop line, keep all stage1/stage2/blur/type guards and return a stage2-only review proposal. Valid numeric disagreements remain rejected.",
    "independentAcceptance": False, "trainingPerformed": False,
    "limitations": ["Author val/test split, physical-meter/site grouping unknown.", "Original u annotations and labels kept unchanged.", "Zero observed validation/test false proposals is not a production safety guarantee.", "Typed-water study does not solve missing automatic classification metadata."]}
if args.runtime_before:
    runtime = json.loads(args.runtime_before.read_text())["rows"]
    report["automaticClassificationBefore"] = {
        "images": len(runtime),
        "unknownCategory": sum(r["detectedCategory"] == "unknown" for r in runtime),
        "profileRequiredWarning": sum("recognizer_profile_required" in r["automaticWarnings"] for r in runtime),
        "note": "Orthogonal to typed failure outcomes; missing automatic metadata is not a wrong digit recognition."
    }
args.report.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"frozenCandidate": chosen, "testCandidate": report["testCandidate"]}))
