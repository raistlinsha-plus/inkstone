#!/usr/bin/env python3
"""Summarize frozen evidence; mask and score end-to-end semantic judgments."""

import argparse
from collections import Counter, defaultdict
import hashlib
import json
import math
from pathlib import Path
import secrets
from statistics import median

HERE = Path(__file__).resolve().parent
PINS = {
    "packet.json": "82ad39942669040f9aabdd704935f71a451a23d7a2845e97b30ae636a1132038",
    "labels.json": "8932b7c5fb8fe9ca8f704f7dde82afcb5afdcd779f6004350714200133c11fe5",
    "RUBRIC.md": "946d28ddb306fd2df2120d334a6fbf1decfbea3b2602616eb6cfa14df9be2225",
}
CHOICES = {"grounded", "uncited", "gap", "omitted", "wrong"}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read(path):
    return json.loads(path.read_bytes())


def write_new(path, obj):
    with path.open("x", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
        f.write("\n")


def ensure(value, message):
    if not value:
        raise ValueError(message)


def fixture():
    for name, expected in PINS.items():
        ensure(
            digest((HERE / name).read_bytes()) == expected,
            "Frozen file changed: " + name,
        )
    packet, gold = read(HERE / "packet.json"), read(HERE / "labels.json")
    docs = {d["id"]: d for d in packet["documents"]}
    cases = {c["id"]: c for c in packet["cases"]}
    ensure(len(cases) == 50 and set(gold) == set(cases), "Unexpected case count")
    pairs = defaultdict(list)
    for cid, g in gold.items():
        q = cases[cid]
        for point in g["points"]:
            for doc, line in point["lines"]:
                ensure(
                    doc in q["documents"] and line in docs[doc]["text"].splitlines(),
                    "Orphaned evidence",
                )
        if g["kind"] == "paired":
            pairs[g["pair"]].append(cid)
    ensure(len(pairs) == 20, "Unexpected pair count")
    for members in pairs.values():
        ensure(len(members) == 2, "Pair size")
        full, missing = sorted(members, key=lambda c: gold[c]["condition"] != "full")
        ensure(
            gold[full]["condition"] == "full"
            and gold[missing]["condition"] in ("partial", "absent"),
            "Invalid pair arms",
        )
        ensure(
            cases[full]["question"] == cases[missing]["question"],
            "Paired question mismatch",
        )
        ensure(
            cases[full]["documents"] != cases[missing]["documents"], "Identical scope"
        )
        expect = [p["claim"] for p in gold[full]["points"]]
        for cid in [full, missing]:
            g = gold[cid]
            actual = {p["claim"] for p in g["points"]}
            ensure(
                actual.isdisjoint(g["unavailable"])
                and actual | set(g["unavailable"]) == set(expect),
                "Facet mismatch",
            )
            g["slots"] = expect
        scope_text = "\n".join(docs[d]["text"] for d in cases[missing]["documents"])
        for p in gold[full]["points"]:
            if p["claim"] in gold[missing]["unavailable"]:
                ensure(
                    all(line not in scope_text for _, line in p["lines"]),
                    "Missing evidence present",
                )
    for g in gold.values():
        if g["kind"] == "setup":
            g["slots"] = [p["claim"] for p in g["points"]]
    return cases, docs, gold


def checked(path, cases, live=None):
    result = read(path)
    ensure(
        result["suite"] == "rc4-blind"
        and result["fixtureSha256"] == PINS["packet.json"]
        and result["rubricSha256"] == PINS["RUBRIC.md"],
        "Mismatched suite, rubric or packet",
    )
    ensure(
        result["status"] == "complete"
        and len(result["records"]) == len(cases)
        and set(cases) == {r["id"] for r in result["records"]},
        "Report incomplete",
    )
    if live is not None:
        ensure(result["live"] is live, "Wrong live/offline report")
    for r in result["records"]:
        c = cases[r["id"]]
        ensure(
            r["question"] == c["question"] and r["selectedDocuments"] == c["documents"],
            "Unexpected evaluation input",
        )
        ensure(r["failure"] is None and r["response"] is not None, "Incomplete turn")
    return result


def sources(row):
    response = row["response"]
    ensure(
        len(row["sourceDocuments"]) == len(response["sources"]),
        "Mismatched source mapping",
    )
    return [
        {
            "doc": doc,
            "text": s["text"],
            "first": s["startLine"],
            "last": s["endLine"],
            "sha256": s["hash"],
            "matchKind": s["matchKind"],
        }
        for s, doc in zip(response["sources"], row["sourceDocuments"])
    ]


def matches(hit, doc_id, quote, docs):
    if hit["doc"] != doc_id:
        return False
    text = docs[doc_id]["text"]
    # A pasted substring alone cannot establish scope, file version and passage location.
    valid_lines = text.splitlines()[hit["first"] - 1 : hit["last"]]
    return (
        hit["sha256"] == digest(text.encode())
        and hit["first"] >= 1
        and quote in valid_lines
        and quote.rstrip("。！？") in hit["text"]
    )


def stage_coverage(row, g, docs):
    final_sources = sources(row)
    records = {
        "sources": final_sources,
        "selectedQuotes": [
            h for h in final_sources if h["matchKind"] == "selected-quote"
        ],
    }
    candidates = row.get("rc4Candidates")
    if candidates is not None:
        records.update({s: candidates[s] for s in ("top8", "admitted")})
    elif row.get("clarification") is not None:
        records.update(top8=[], admitted=[])
    result = {}
    for stage, hits in records.items():
        covered = {
            p["claim"]
            for p in g["points"]
            if any(matches(h, *line, docs) for line in p["lines"] for h in hits)
        }
        lure = any(matches(h, *line, docs) for line in g["lures"] for h in hits)
        result[stage] = (covered, lure, len(hits))
    return result


def groups(c, g):
    return (
        ["all", g["condition"]]
        + (["paired"] if g["kind"] == "paired" else [])
        + (["followups"] if c["follow_up_to"] else [])
    )


def percentile95(numbers):
    return sorted(numbers)[math.ceil(0.95 * len(numbers)) - 1]


def summary(report, cases, docs, gold):
    stages = {}
    for r in report["records"]:
        cid = r["id"]
        g = gold[cid]
        for group in groups(cases[cid], g):
            section = stages.setdefault(
                group,
                {
                    "turns": 0,
                    "prematureClarifications": 0,
                    "scopeEscapes": 0,
                    "stages": {},
                },
            )
            section["turns"] += 1
            section["prematureClarifications"] += int(
                r["clarification"] is not None and bool(g["points"])
            )
            section["scopeEscapes"] += int(r["outOfScopePath"])
            for s, (covered, lure, length) in stage_coverage(r, g, docs).items():
                n = section["stages"].setdefault(s, Counter())
                n["measuredTurns"] += 1
                n["turnsWithAnyPassage"] += int(length > 0)
                n["answerableTurns"] += bool(g["points"])
                n["turnsWithAnyDirectSupport"] += bool(covered)
                n["turnsWithAllAvailablePoints"] += bool(g["points"]) and len(
                    covered
                ) == len(g["points"])
                n["availablePoints"] += len(g["points"])
                n["coveredPoints"] += len(covered)
                n["turnsWithLabelledDistractor"] += lure
    times = [r["elapsedMs"] for r in report["records"]]
    attempts = report["usage"]["attempts"]
    return {
        "version": report["version"],
        "fixtureSha256": report["fixtureSha256"],
        "rubricSha256": PINS["RUBRIC.md"],
        "labelSha256": PINS["labels.json"],
        "live": report["live"],
        "httpAttempts": report["usage"]["httpAttempts"],
        "httpAttemptsByStage": dict(Counter(a["stage"] for a in attempts)),
        "turnMsP50": median(times),
        "turnMsP95": percentile95(times),
        "finish": dict(
            Counter(r["response"]["finishReason"] for r in report["records"])
        ),
        "evidence": stages,
        "semanticReview": None,
    }


def anon_case(r, case, docs):
    refs = []
    for i, h in enumerate(sources(r), 1):
        refs.append(
            {
                "number": i,
                "title": docs.get(h["doc"], {}).get("title", "范围外"),
                "first": h["first"],
                "last": h["last"],
                "text": h["text"],
            }
        )
    return {
        "question": r["question"],
        "previousQuestions": r["previousQuestions"],
        "previousAnswer": r["previousAnswer"],
        "answer": r["response"]["text"],
        "citations": refs,
        "selectedDocuments": [
            {"title": docs[id]["title"], "text": docs[id]["text"]}
            for id in case["documents"]
        ],
    }


def canonical(obj):
    return json.dumps(
        obj, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode()


def blind(paths, directory, cases, docs, gold):
    ballots, key, reports = [], {}, []
    for path in paths:
        r = checked(path, cases, True)
        sha = digest(path.read_bytes())
        ensure(sha not in reports, "Duplicate report")
        reports.append(sha)
        for row in r["records"]:
            cid = row["id"]
            bid = secrets.token_hex(10)
            prompt = anon_case(row, cases[cid], docs)
            ballots.append(
                {
                    "ballotId": bid,
                    **prompt,
                    "judgment": {
                        "facets": [None] * len(gold[cid]["slots"]),
                        "claims": None,
                        "supportedClaims": None,
                        "extraSevere": None,
                        "reason": "",
                    },
                }
            )
            key[bid] = {
                "case": cid,
                "report": sha,
                "inputDigest": digest(canonical(prompt)),
            }
    secrets.SystemRandom().shuffle(ballots)
    directory.mkdir(mode=0o700, exist_ok=False)
    write_new(directory / "review.json", ballots)
    write_new(directory / "private-key.json", key)


def grade(
    report_path, offline_path, ballots_path, key_path, reviewer_kind, cases, docs, gold
):
    live = checked(report_path, cases, True)
    offline = checked(offline_path, cases, False) if offline_path else None
    if offline:
        ensure(offline["version"] == live["version"], "Replay version differs")
    replay = {r["id"]: r for r in offline["records"]} if offline else {}
    rows = {r["id"]: r for r in live["records"]}
    ballots, key = read(ballots_path), read(key_path)
    ensure(
        len(ballots) == len(key) and {b["ballotId"] for b in ballots} == set(key),
        "Missing, extra or duplicate ballots",
    )
    sha = digest(report_path.read_bytes())
    counts = defaultdict(Counter)
    passed = defaultdict(list)
    seen = set()
    for b in ballots:
        k = key[b["ballotId"]]
        if k["report"] != sha:
            continue
        cid = k["case"]
        ensure(cid not in seen, "Duplicate graded turn")
        seen.add(cid)
        r, g, c = rows[cid], gold[cid], cases[cid]
        original = anon_case(r, c, docs)
        ensure(
            digest(canonical(original)) == k["inputDigest"]
            and {name: b[name] for name in original} == original,
            "Review input changed",
        )
        j = b["judgment"]
        facets, claims, supported = j["facets"], j["claims"], j["supportedClaims"]
        ensure(
            len(facets) == len(g["slots"]) and set(facets) <= CHOICES,
            "Incomplete facet scores",
        )
        ensure(
            type(claims) is int and type(supported) is int and 0 <= supported <= claims,
            "Invalid claim counts",
        )
        ensure(
            supported >= facets.count("grounded"),
            "Supported count below grounded facet count",
        )
        ensure(
            not supported or original["citations"],
            "Supported claims without any returned source",
        )
        ensure(
            claims >= sum(f in {"grounded", "uncited", "wrong"} for f in facets),
            "Claim count below the number of separately answered facets",
        )
        ensure(
            type(j["extraSevere"]) is bool
            and isinstance(j["reason"], str)
            and j["reason"].strip(),
            "Missing serious-error decision or reason",
        )
        available = {p["claim"] for p in g["points"]}
        present = [f for slot, f in zip(g["slots"], facets) if slot in available]
        gaps = [f for slot, f in zip(g["slots"], facets) if slot not in available]
        invented = any(f in {"grounded", "uncited", "wrong"} for f in gaps)
        serious = j["extraSevere"] or "wrong" in facets or invented
        strict = (
            all(f == "grounded" for f in present)
            and all(f == "gap" for f in gaps)
            and not serious
            and supported == claims
            and not r["outOfScopePath"]
        )
        if g["pair"]:
            passed[g["pair"]].append(strict)
        off = replay.get(cid)
        comparable = off is not None and all(
            off[k] == r[k]
            for k in (
                "question",
                "retrievalQuestion",
                "selectedDocuments",
                "previousQuestions",
            )
        )
        coverage = stage_coverage(off, g, docs)["top8"][0] if comparable else set()
        for group in groups(c, g):
            n = counts[group]
            n["turns"] += 1
            n["strictPass"] += strict
            n["seriousErrors"] += serious
            n["claims"] += claims
            n["supportedClaims"] += supported
            n["availablePoints"] += len(present)
            n["correctAvailablePoints"] += sum(
                f in {"grounded", "uncited"} for f in present
            )
            n["correctAndCitedAvailablePoints"] += present.count("grounded")
            n["unavailablePoints"] += len(gaps)
            n["explicitGapPoints"] += gaps.count("gap")
            n["answerableTurns"] += bool(present)
            n["blanketFalseRefusal"] += bool(present) and all(
                f == "gap" for f in present
            )
            n["turnsWithMissingPoints"] += bool(gaps)
            n["missingPointFalseAnswer"] += invented
            n["allMissingPointsHandled"] += bool(gaps) and all(f == "gap" for f in gaps)
            if offline:
                n["matchingOfflineRetrievalInputs"] += comparable
                n["availablePointsInMatchedReplayTop8"] += len(coverage)
                n["correctAndCitedAmongMatchedReplayTop8"] += sum(
                    f == "grounded" and slot in coverage
                    for slot, f in zip(g["slots"], facets)
                )
    ensure(
        seen == set(cases) and all(len(v) == 2 for v in passed.values()),
        "Incomplete graded report",
    )
    return {
        "version": live["version"],
        "reportSha256": sha,
        "reviewerKind": reviewer_kind,
        "externalHumanReview": None,
        "groups": counts,
        "pairs": len(passed),
        "bothVariantsStrictPass": sum(all(v) for v in passed.values()),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="action", required=True)
    inspect = sub.add_parser("summary")
    inspect.add_argument("report", type=Path)
    create = sub.add_parser("blind")
    create.add_argument("new_directory", type=Path)
    create.add_argument("reports", type=Path, nargs="+")
    score = sub.add_parser("grade")
    score.add_argument("report", type=Path)
    score.add_argument("review", type=Path)
    score.add_argument("key", type=Path)
    score.add_argument("--offline", type=Path)
    score.add_argument(
        "--reviewer-kind", choices=["ai", "human-self-reported"], required=True
    )
    args = parser.parse_args()
    cases, docs, gold = fixture()
    if args.action == "blind":
        blind(args.reports, args.new_directory, cases, docs, gold)
        return
    if args.action == "summary":
        result = summary(checked(args.report, cases), cases, docs, gold)
    else:
        result = grade(
            args.report,
            args.offline,
            args.review,
            args.key,
            args.reviewer_kind,
            cases,
            docs,
            gold,
        )
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
