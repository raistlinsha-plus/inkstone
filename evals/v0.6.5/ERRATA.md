# Label errata (post-run, frozen inputs unchanged)

During answer review, the same author found two question/rubric mismatches in the new corpus:

- **N21** asks to compare duration limits. Its gold quote for 柳桥排练厅 points to the volume-limit rule, while the relevant duration rule is earlier in that same document. A correct duration answer must not be judged wrong merely for omitting the unrelated volume rule.
- **N23** asks about identifiers/labels. Its gold quote for 澄湖标本室 points to storage temperature rather than the batch-code/leading-zero rule. Review the answer against the actual question and source.

The frozen corpus, hashes and first reports are unchanged. The published automatic metrics still use the original labels and are qualified by these errors. No retrospective corrected score is substituted for the original target comparison. These cases require corrected labels in a separately versioned future corpus before being used as new evidence-quality acceptance cases. This reduces the strength of the 32-question check and reinforces that it is not independent evaluation.

## Candidate-budget wording

The frozen protocol's `candidateLimit: 60` is the limit **per BM25/vector branch**, as implemented by the production SQL. The merged union can contain up to 120 candidates before the 40-item rerank window and 12 displayed results. All modes use the same per-branch, rerank and displayed limits; this is not a controlled comparison at an identical total raw-candidate budget. The original protocol/hash is retained. Do not interpret the comparison as proving a fusion benefit at equal total candidate cost.
