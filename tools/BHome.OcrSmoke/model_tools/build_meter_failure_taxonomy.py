"""Join public water-stage diagnostics to frozen full-frame runtime observations.

This is an evidence classifier, not a policy selector. It does not tune thresholds,
train models, relabel images, or interpret incomplete ``u`` labels as unreadable.
Only public, pinned fixture reports belong in its inputs or committed output.
"""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path


TAXONOMY = {
    "meter_classification_failure": "Classification did not resolve a complete category; not necessarily a wrong class.",
    "incorrect_meter_bounding_box": "Incorrectness needs reviewed body-box ground truth; invalid geometry alone is a symptom.",
    "incorrect_reading_display_localization": "Display localization was rejected; exact crop correctness needs reviewed polygons.",
    "incomplete_digit_detection": "Digit assembly rejected or sequence length differs; missing detections are not a proven cause.",
    "incorrect_digit_order": "Equal digit multisets with a different sequence are only an ordering candidate.",
    "incorrect_register_selection": "Unverified/contradictory register evidence; actual wrong-register selection needs register ground truth.",
    "precision_decimal_ambiguity": "Decimal evidence is missing or inconsistent; digit-only accuracy is not billing accuracy.",
    "fusion_disagreement": "Runtime fusion veto or differing nonempty PP/Stage2 strings; guards remain in force.",
    "parser_rejection": "Runtime/parser reported an unrecognized, ambiguous, or contradictory reading.",
    "correctly_rejected_unreadable_input": "Count only explicit reviewed unreadable ground truth, never merely an unknown digit label.",
    "unnecessary_fallback": "A correct intermediate sequence is a recovery candidate, not proof it was safe to emit.",
}


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def indexed(rows, label):
    result = {}
    for row in rows:
        name = row["file"]
        if name != Path(name).name or name in result:
            raise ValueError(f"Unsafe or duplicate image identifier in {label}")
        result[name] = row
    return result


def percentile(values, fraction):
    if not values:
        return None
    ordered = sorted(values)
    position = (len(ordered) - 1) * fraction
    lower = int(position)
    upper = min(lower + 1, len(ordered) - 1)
    return round(ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower), 3)


def metrics(rows, prefix):
    total = len(rows)
    proposed = sum(row[prefix + "Proposed"] for row in rows)
    exact = sum(row[prefix + "Exact"] for row in rows)
    wrong = sum(row[prefix + "False"] for row in rows)
    unknown = sum(row[prefix + "Proposed"] and not row["clear"] for row in rows)
    latency = [row[prefix + "Milliseconds"] for row in rows]
    return {
        "inputs": total, "fullyDigitLabeled": sum(row["clear"] for row in rows),
        "emittedProposals": proposed, "exactDigitSequences": exact,
        "incorrectProposalsOnFullyLabeled": wrong, "proposalsWithoutFullDigitGroundTruth": unknown,
        "manualFallbacks": total - proposed,
        "correctProposalsOverAllInputs": exact / total if total else None,
        "correctProposalsOverEmittedProposals": exact / proposed if proposed and not unknown else None,
        "billingReadingAccuracy": None,
        "latencyMs": {"p50": percentile(latency, .5), "p95": percentile(latency, .95), "max": max(latency, default=None)},
    }


def validate_runtime(row):
    for prefix in ("typed", "automatic"):
        proposed, exact, wrong = (row[prefix + key] for key in ("Proposed", "Exact", "False"))
        if any(not isinstance(value, bool) for value in (proposed, exact, wrong, row["clear"])):
            raise ValueError("Runtime outcome flags must be booleans")
        if (exact or wrong) and (not proposed or not row["clear"]) or exact and wrong:
            raise ValueError("Inconsistent runtime outcome flags")
        if proposed and row["clear"] and not (exact or wrong):
            raise ValueError("Fully labeled proposal needs an exact or false outcome")
        latency = row[prefix + "Milliseconds"]
        if not isinstance(latency, (int, float)) or latency < 0 or latency != latency or latency == float("inf"):
            raise ValueError("Invalid runtime latency")


def observations(raw, runtime):
    result = []

    def add(category, stage, reason, evidence, assessment="observed_rejection", mode="typed"):
        result.append({"category": category, "pipeline": mode, "stage": stage, "reason": reason,
                       "assessment": assessment, "rootCauseConfirmed": False, "evidence": evidence})

    scene = raw.get("sceneWarnings", [])
    digit = raw.get("stage2Warnings", [])
    pp = raw.get("ppWarnings", [])
    typed = runtime["typedWarnings"]
    automatic = runtime["automaticWarnings"]
    actual_class = runtime.get("detectedCategory", "unknown")
    if actual_class == "unknown" and not runtime["automaticProposed"]:
        add("meter_classification_failure", "classification", "complete_category_unresolved",
            {"classificationStatus": runtime.get("classificationStatus"), "warnings": automatic}, mode="automatic")
    if "meter_region_invalid" in scene:
        add("incorrect_meter_bounding_box", "scene_geometry", "invalid_geometry_rejected",
            {"warnings": scene}, assessment="geometry_symptom_not_box_accuracy")
    localization = [warning for warning in scene if warning in {
        "reading_region_uncertain", "reading_region_not_detected", "meter_not_detected",
        "meter_detection_uncertain", "multiple_meters", "ambiguous_reading", "meter_region_invalid"}]
    if localization:
        add("incorrect_reading_display_localization", "display_localization", "scene_selection_rejected",
            {"warnings": localization}, assessment="rejection_not_localization_accuracy")
    expected = raw.get("expected") if raw["clear"] else None
    stage2 = raw.get("stage2Value")
    detection_warnings = [warning for warning in digit if warning in {
        "digit_count_uncertain", "digit_gap_uncertain", "digit_overlap_conflict", "digit_geometry_uncertain",
        "unclear_digit", "digit_low_confidence", "no_unique_window"}]
    if detection_warnings or expected is not None and stage2 is not None and len(stage2) != len(expected):
        add("incomplete_digit_detection", "digit_assembly", "sequence_not_verified_complete",
            {"warnings": detection_warnings, "expectedLength": len(expected) if expected is not None else None,
             "detectedLength": len(stage2) if stage2 is not None else None}, assessment="sequence_symptom")
    if expected is not None and stage2 is not None and expected != stage2 and Counter(expected) == Counter(stage2):
        add("incorrect_digit_order", "digit_ordering", "same_multiset_different_sequence",
            {"expected": expected, "stage2": stage2}, assessment="ordering_candidate_not_proven")
    for mode, warnings in (("typed", typed), ("automatic", automatic)):
        register = [warning for warning in warnings if warning in {"billing_register_unverified", "meter_type_mismatch"}]
        if register:
            add("incorrect_register_selection", "register_validation", "register_or_utility_unverified",
                {"warnings": register}, assessment="unverified_not_wrong_register_ground_truth", mode=mode)
        precision = [warning for warning in warnings if warning in {"decimal_separator_unverified", "meter_precision_mismatch"}]
        if precision:
            add("precision_decimal_ambiguity", "precision_validation", "precision_evidence_missing_or_mismatched",
                {"warnings": precision}, mode=mode)
    different = raw.get("ppValue") is not None and stage2 is not None and raw["ppValue"].replace(".", "") != stage2
    if "recognizer_conflict" in typed or different:
        add("fusion_disagreement", "fusion", "runtime_fusion_veto" if "recognizer_conflict" in typed else "intermediate_strings_disagree",
            {"ppValue": raw.get("ppValue"), "stage2Value": stage2, "numericStringsDisagree": different,
             "warnings": typed}, assessment="observed_guard_or_disagreement")
    parser = [warning for warning in pp if warning in {"ambiguous_reading", "multiple_reading_regions", "meter_type_mismatch", "reading_not_recognized"}]
    if "reading_not_recognized" in typed or parser:
        add("parser_rejection", "parser", "no_valid_runtime_reading" if not runtime["typedProposed"] else "intermediate_pp_rejection",
            {"ppWarnings": parser, "runtimeWarnings": typed})
    if not runtime["typedProposed"] and raw.get("readability") == "unreadable" and raw.get("readabilityReviewed") is True:
        add("correctly_rejected_unreadable_input", "proposal", "explicit_reviewed_unreadable_rejected",
            {"readability": "unreadable"}, assessment="ground_truth_outcome")
        result[-1]["rootCauseConfirmed"] = True
    if not runtime["typedProposed"] and expected is not None and stage2 == expected:
        add("unnecessary_fallback", "proposal", "correct_intermediate_sequence_rejected",
            {"sceneAllowed": raw.get("sceneAllowed"), "sceneWarnings": scene, "ppWarnings": pp,
             "runtimeWarnings": typed}, assessment="recovery_candidate_not_proven_safe_to_emit")
    return result


def build_report(audit, runtime, manifest, image_root=None):
    raw_rows = indexed(audit["rows"], "stage audit")
    runtime_rows = indexed(runtime["rows"], "runtime")
    if set(raw_rows) != set(runtime_rows):
        raise ValueError("Stage audit and runtime image identifiers differ")
    rows = []
    for name, raw in sorted(raw_rows.items()):
        current = runtime_rows[name]
        validate_runtime(current)
        if raw["clear"] != current["clear"]:
            raise ValueError("Digit ground-truth completeness differs")
        if not manifest.get(name) or raw.get("sourceSha256") != manifest[name]:
            raise ValueError("Source image hash differs from pinned manifest")
        label_name = str(Path(name).with_suffix(".txt"))
        if label_name not in manifest:
            raise ValueError("Pinned label hash is missing")
        if image_root is not None:
            for asset in (name, label_name):
                if sha256(image_root / asset) != manifest[asset]:
                    raise ValueError("Current public fixture differs from pinned manifest")
        rows.append({
            "imageId": name, "sourceSha256": manifest[name], "labelSha256": manifest[label_name],
            "groundTruth": {"completeDigits": raw["expected"] if raw["clear"] else None,
                            "partialAnnotatedDigits": raw["expected"] if not raw["clear"] else None,
                            "readability": raw.get("readability", "not_reviewed"),
                            "decimalPlaces": None, "billingRegister": None, "bodyBox": None, "displayPolygon": None},
            "outcome": {prefix: {"proposed": current[prefix + "Proposed"], "exactDigits": current[prefix + "Exact"],
                                 "incorrectOnFullDigitLabels": current[prefix + "False"], "warnings": current[prefix + "Warnings"]}
                        for prefix in ("typed", "automatic")},
            "stageEvidence": {key: raw.get(key) for key in ("sceneAllowed", "sceneWarnings", "imageWarnings", "ppLines",
                                                           "ppValue", "ppWarnings", "stage2Value", "stage2Confidence", "stage2Warnings")},
            "observations": observations(raw, current),
        })
    counts = Counter(event["category"] for row in rows for event in row["observations"])
    return {
        "schemaVersion": 1, "purpose": "Public-fixture failure audit; no training or threshold selection",
        "independentAcceptance": False, "inputTransform": sorted({row["inputTransform"] for row in runtime_rows.values()}),
        "groundTruthLimitations": [
            "Historical author mechanical-water corpus; physical-meter/site independence is unknown.",
            "Supplied diagnostic records contain no decimal/register ground truth or body/display coordinate comparisons. Source OBB labels exist but crop accuracy is not measured by this join.",
            "Unknown-digit ('u') annotations mean incomplete numeric ground truth, not verified unreadability.",
            "Correct Stage2 sequences rejected by fusion are recovery candidates; they do not authorize bypassing disagreement or scene guards.",
            "Stage audit is an earlier diagnostic run; its fusedValue is deliberately ignored. Runtime outcomes come from the supplied current report.",
            "Runtime rows have no per-image hashes; the filename join uses a pinned manifest and optionally verifies the current image/label corpus.",
        ],
        "currentCorpusHashesVerified": image_root is not None,
        "metrics": {prefix: metrics(list(runtime_rows.values()), prefix) for prefix in ("typed", "automatic")},
        "taxonomy": {key: {"definition": description, "observationCount": counts[key],
                           "countMeaning": "nonexclusive observations, not proven root-cause counts"}
                     for key, description in TAXONOMY.items()},
        "notMeasured": ["body_box_accuracy", "display_polygon_accuracy", "billing_register_accuracy", "decimal_billing_accuracy",
                        "confirmed_digit_ordering_root_causes", "reviewed_unreadable_rejection_accuracy", "safely_recoverable_fallback_rate"],
        "rows": rows,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("audit", type=Path)
    parser.add_argument("runtime", type=Path)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("report", type=Path)
    parser.add_argument("--images", type=Path, help="Verify current public image and label bytes against the manifest")
    args = parser.parse_args()
    data = [json.loads(path.read_text(encoding="utf-8-sig")) for path in (args.audit, args.runtime, args.manifest)]
    report = build_report(*data, image_root=args.images)
    report["evidence"] = [{"path": path.as_posix(), "sha256": sha256(path)} for path in (args.audit, args.runtime, args.manifest)]
    args.report.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({"images": len(report["rows"]), "metrics": report["metrics"]}))


if __name__ == "__main__":
    main()
