#!/usr/bin/env python3
"""Summarize exact line coverage. Prepare arm-blind review sheets for real answers."""
import argparse
from collections import Counter
from hashlib import sha256
import json
from math import ceil
from pathlib import Path
import secrets

HERE = Path(__file__).resolve().parent
ARMS = ("rc2Gate", "rc3Reader", "gold")


def percentile(values, q):
    return sorted(values)[ceil(len(values) * q) - 1] if values else None


def summarize(report, cases):
    out = {"fixture": report["fixtureManifestSha256"], "live": report["live"],
           "caseKinds": dict(Counter(c["kind"] for c in cases.values())), "stages": {}}
    for stage in ("top8", *ARMS):
        rows = report["cases"]
        matched = full = present = flagged = 0
        by_case = []
        total = positive = 0
        for r in rows:
            block = r["top8"] if stage == "top8" else r["arms"][stage]
            n = len(block["coveredPoints"])
            size = len(cases[r["id"]]["points"])
            total += size
            positive += int(size > 0)
            matched += n
            full += int(size > 0 and n == size)
            present += int(bool(block["sources"]))
            flagged += int(bool(block["labelledDistractorsPresent"]))
            by_case.append([r["id"], n, size])
        out["stages"][stage] = {"points": [matched,total], "fullPositiveCases": [full,positive],
                                "nonempty": [present,len(rows)], "containsLabelledDistractor": [flagged,len(rows)],
                                "pointCounts": by_case}
    rows = report["cases"]
    losses = Counter()
    for r in rows:
        for p in cases[r["id"]]["points"]:
            name = p["point"]
            if name not in r["top8"]["coveredPoints"]:
                losses["missingFromTop8"] += 1
            else:
                losses["availableInTop8"] += 1
                for arm in ARMS[:2]:
                    if name not in r["arms"][arm]["coveredPoints"]:
                        losses[arm + "MissedAvailable"] += 1
    out["pointDiagnosis"] = dict(losses)
    out["reader"] = {"extraRequestCounts": dict(Counter(r["readerCalls"] for r in rows)),
                     "statusCounts": dict(Counter(r["readerStatus"] for r in rows)),
                     "maxChars": max(r["readerChars"] for r in rows),
                     "maxPassages": max(r["readerPassages"] for r in rows)}
    if report["live"]:
        out["generator"] = {}
        for arm in ARMS:
            blocks = [r["arms"][arm] for r in rows]
            latencies = [b["generationMs"] for b in blocks]
            path_ms = [b["pathMs"] for b in blocks]
            out["generator"][arm] = {"calls": len(blocks), "completedStop": sum(b.get("finish") == "stop" for b in blocks),
                                     "generationMsP50": percentile(latencies,.50), "generationMsP95":percentile(latencies,.95),
                                     "pathMsP50":percentile(path_ms,.50), "pathMsP95":percentile(path_ms,.95)}
    return out


def blind(report, cases, outdir):
    if not report["live"]:
        raise SystemExit("A live generator report is required for blind scoring")
    outdir.mkdir(mode=0o700, exist_ok=False)
    corpus = {p.stem:p.read_text().splitlines() for p in (HERE / "corpus").glob("*.md")}
    reviewers, key = [], {}
    for row in report["cases"]:
        c = cases[row["id"]]
        arms = list(ARMS)
        secrets.SystemRandom().shuffle(arms)
        for arm in arms:
            uid = secrets.token_hex(6)
            key[uid] = {"case":c["id"], "arm":arm}
            a = row["arms"][arm]
            evidence = []
            for point in c["points"]:
                examples = []
                for label in point["accept_any_line"]:
                    title, lineno = label.rsplit("#",1)
                    examples.append({"location":label,"text":corpus[title][int(lineno)-1]})
                evidence.append({"point":point["point"], "acceptableEvidence":examples,
                                 "answerCorrect":None,"adjacentCitationSupportsClaim":None})
            reviewers.append({"ballotId":uid,"case":c["id"],"previous":c["previous_turn"],"question":c["question"],
                              "answer":a.get("text"),"finish":a.get("finish", a.get("error")),"sources":a["sources"],
                              "points":evidence, "knownGaps":c["missing"],"wrongValueExamples":c["wrong_values"],
                              "knownGapHandled":None,"unsupportedAnswerOnNegative":None,"falseRefusal":None,
                              "criticalClaimCount":None,"supportedCriticalClaimCount":None,
                              "strictQuestionPass":None,"seriousError":None,"reason":""})
    secrets.SystemRandom().shuffle(reviewers)
    for name, obj in [("blind-review.json",reviewers),("keep-from-reviewer.json",key)]:
        (outdir / name).write_text(json.dumps(obj,ensure_ascii=False,indent=2)+"\n")


def grade(report, cases, review_path, key_path):
    ballots = json.loads(review_path.read_text())
    key = json.loads(key_path.read_text())
    rows = {row["id"]:row for row in report["cases"]}
    pairs = set()
    counts = {arm:Counter() for arm in ARMS}

    def boolean(value):
        if type(value) is not bool:
            raise ValueError("A required true/false judgment is missing")
        return int(value)

    def integer(value):
        if type(value) is not int or value < 0:
            raise ValueError("A claim count must be a nonnegative integer")
        return value

    if len(key) != len(cases)*len(ARMS) or {b["ballotId"] for b in ballots}!=set(key):
        raise ValueError("Incomplete or mismatched blind ballots")
    for b in ballots:
        pair = key[b["ballotId"]]
        cid, arm = pair["case"],pair["arm"]
        if pair["case"] != b["case"] or (cid,arm) in pairs:
            raise ValueError("Duplicate or mismatched case/arm")
        pairs.add((cid,arm))
        block=rows[cid]["arms"][arm]
        if b["answer"]!=block.get("text") or b["sources"]!=block["sources"]:
            raise ValueError("Answer or citation list changed after blinding")
        n=counts[arm]
        case=cases[cid]
        n["questions"]+=1
        n["strictPass"]+=boolean(b["strictQuestionPass"])
        n["seriousErrors"]+=boolean(b["seriousError"])
        if case["points"]:
            n["positiveCases"]+=1
            n["falseRefusals"]+=boolean(b["falseRefusal"])
        if case["kind"]=="unanswerable":
            n["negativeCases"]+=1
            n["negativeFalseAnswers"]+=boolean(b["unsupportedAnswerOnNegative"])
        if case["missing"]:
            n["gapCases"]+=1
            n["gapHandled"]+=boolean(b["knownGapHandled"])
        supported, claims=integer(b["supportedCriticalClaimCount"]),integer(b["criticalClaimCount"])
        if supported>claims:
            raise ValueError("Supported claims exceed claims made")
        n["claims"]+=claims
        n["supportedClaims"]+=supported
        if [p["point"] for p in b["points"]]!=[p["point"] for p in case["points"]]:
            raise ValueError("Answer point list changed")
        for point in b["points"]:
            correct=boolean(point["answerCorrect"])
            cited=boolean(point["adjacentCitationSupportsClaim"])
            if point["point"] in rows[cid]["top8"]["coveredPoints"]:
                n["pointsInTop8"]+=1
                n["correctAndCitedAmongPointsInTop8"]+=correct*cited
    if len(pairs)!=len(cases)*len(ARMS):
        raise ValueError("Incomplete paired review")
    return counts


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("report", type=Path)
    p.add_argument("--blind", type=Path, metavar="NEW_DIRECTORY")
    p.add_argument("--score",type=Path,nargs=2,metavar=("COMPLETED_BALLOTS","PRIVATE_KEY"))
    args = p.parse_args()
    report = json.loads(args.report.read_text())
    if report["fixtureManifestSha256"] != sha256((HERE/"fixture.sha256").read_bytes()).hexdigest():
        raise SystemExit("Fixture manifest mismatch")
    for record in (HERE/"fixture.sha256").read_text().splitlines():
        digest,relative=record.split("  ",1)
        if sha256((HERE/relative).read_bytes()).hexdigest()!=digest:
            raise SystemExit("Fixture source mismatch: "+relative)
    cases = {c["id"]: c for file in ("questions.json","ambiguous.json") for c in json.loads((HERE/file).read_text())}
    if len(report["cases"]) != len(cases) or {r["id"] for r in report["cases"]} != cases.keys():
        raise SystemExit("Incomplete or duplicate case set")
    if args.blind:
        blind(report,cases,args.blind)
    summary=summarize(report,cases)
    if args.score:
        summary["scoredAnswers"]=grade(report,cases,*args.score)
    print(json.dumps(summary,ensure_ascii=False,indent=2))


if __name__=="__main__":
    main()
