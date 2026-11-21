"""Exercise the grader with fabricated answers; no provider or working-state access."""

import json
from pathlib import Path
import tempfile
import unittest

import report


class ReviewTests(unittest.TestCase):
    def setUp(self):
        self.cases, self.docs, self.gold = report.fixture()

    def test_direct_support_requires_exact_source_and_matching_location(self):
        g = next(v for v in self.gold.values() if v["condition"] == "full")
        doc, quote = g["points"][0]["lines"][0]
        body = self.docs[doc]["text"]
        line = body.splitlines().index(quote) + 1
        hit = {
            "doc": doc,
            "first": line,
            "last": line,
            "text": quote.rstrip("。"),
            "sha256": report.digest(body.encode()),
        }
        self.assertTrue(report.matches(hit, doc, quote, self.docs))
        for changes in (
            {"doc": "other"},
            {"sha256": "old"},
            {"first": line + 1},
            {"last": line - 1},
            {"text": quote[3:]},
        ):
            self.assertFalse(
                report.matches(dict(hit, **changes), doc, quote, self.docs)
            )

    def test_grade_checks_blind_input_and_computes_pair_outcomes(self):
        with tempfile.TemporaryDirectory() as folder:
            base = Path(folder)
            live, review = base / "live.json", base / "masked"
            rows = []
            for cid, c in self.cases.items():
                doc = c["documents"][0]
                body = self.docs[doc]["text"]
                mock_source = {
                    "text": body,
                    "startLine": 1,
                    "endLine": len(body.splitlines()),
                    "hash": report.digest(body.encode()),
                    "matchKind": "test",
                }
                rows.append(
                    {
                        "id": cid,
                        "question": c["question"],
                        "selectedDocuments": c["documents"],
                        "failure": None,
                        "response": {
                            "text": "单元测试占位回答[1]",
                            "sources": [mock_source],
                        },
                        "previousQuestions": [],
                        "previousAnswer": None,
                        "sourceDocuments": [doc],
                        "outOfScopePath": False,
                    }
                )
            report.write_new(
                live,
                {
                    "suite": "rc4-blind",
                    "fixtureSha256": report.PINS["packet.json"],
                    "rubricSha256": report.PINS["RUBRIC.md"],
                    "live": True,
                    "version": "test",
                    "status": "complete",
                    "records": rows,
                },
            )
            report.blind([live], review, self.cases, self.docs, self.gold)
            ballots = report.read(review / "review.json")
            key_path = review / "private-key.json"
            key = report.read(key_path)
            for b in ballots:
                g = self.gold[key[b["ballotId"]]["case"]]
                n = len(g["points"])
                b["judgment"] = {
                    "facets": [
                        "gap" if f in g["unavailable"] else "grounded"
                        for f in g["slots"]
                    ],
                    "claims": n,
                    "supportedClaims": n,
                    "extraSevere": False,
                    "reason": "测试",
                }

            def score():
                p = base / "filled.json"
                p.write_text(json.dumps(ballots))
                return report.grade(
                    live, None, p, key_path, "ai", self.cases, self.docs, self.gold
                )

            result = score()
            self.assertEqual(result["bothVariantsStrictPass"], 20)
            self.assertEqual(result["groups"]["paired"]["availablePoints"], 53)
            self.assertEqual(result["groups"]["paired"]["explicitGapPoints"], 27)
            self.assertEqual(result["groups"]["full"]["strictPass"], 20)
            b = next(
                b
                for b in ballots
                if self.gold[key[b["ballotId"]]["case"]]["condition"] == "absent"
            )
            b["judgment"]["facets"][0] = "wrong"
            b["judgment"]["claims"] = 1
            revised = score()
            self.assertEqual(revised["bothVariantsStrictPass"], 19)
            self.assertEqual(revised["groups"]["absent"]["missingPointFalseAnswer"], 1)
            b["answer"] += "changed"
            with self.assertRaisesRegex(ValueError, "Review input changed"):
                score()


if __name__ == "__main__":
    unittest.main()
