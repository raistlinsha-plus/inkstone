"""Locate the first observable loss of each expected fact in the frozen RC4 packet."""
import argparse
import importlib.util
import json
import sys
from collections import Counter
from pathlib import Path

sys.dont_write_bytecode = True
module = Path(__file__).resolve().parent.parent / "rc4" / "report.py"
spec = importlib.util.spec_from_file_location("frozen_report", module)
frozen = importlib.util.module_from_spec(spec)
spec.loader.exec_module(frozen)


def trace(path):
    cases, docs, gold = frozen.fixture()
    report = frozen.checked(path, cases)
    facts = []
    for row in report["records"]:
        key = row["id"]
        label = gold[key]
        if label["kind"] != "paired":
            continue
        stages = frozen.stage_coverage(row, label, docs)
        for point in label["points"]:
            claim = point["claim"]
            present = {stage: claim in value[0] for stage, value in stages.items()}
            # Reader-selected quotes can bypass lexical admission. Check the final
            # source first, then trace misses backwards; never infer an unobserved reason.
            loss = next((name for stage, name in (
                ("top8", "retrieval"), ("admitted", "admission"),
                ("sources", "context")) if not present.get(stage)), None)
            if present["sources"]:
                loss = None
            elif row["clarification"]:
                loss = "clarification"
            facts.append(dict(id=key, claim=claim, followup=bool(cases[key]["follow_up_to"]),
                              condition=label["condition"], stages=present, firstLoss=loss))
    return dict(packet=report["fixtureSha256"], version=report["version"],
                counts=Counter(x["firstLoss"] or "in_context" for x in facts), facts=facts)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("report", type=Path)
    args = parser.parse_args()
    print(json.dumps(trace(args.report), ensure_ascii=False, indent=2))
