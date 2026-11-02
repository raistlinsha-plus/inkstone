# v0.6.6 synthetic RAG checks

This directory contains original fictional documents, a frozen 40-case check, corrected **observed** older labels, a protocol and immutable evidence reports. The implementation agent authored and reviewed the cases; this is not independent or externally blinded evaluation. Four reversed comparison pairs and repeated templates reduce diversity. Baseline results were observed before the implementation retest.

- `new-check.json`: 8 fictional documents; 32 answerable and 8 insufficient cases. Answerable cases include 8 comparison variants (4 reversed pairs) and 8 chart cases.
- `corrected-observed-32.json`: old v0.6.5 questions with only N21/N23 gold support corrected according to published errata. Original v0.6.5 fixtures and scores remain unchanged.
- `protocol.json` / `manifest.json`: frozen before retrieval changes (Git history in the private development baseline; only a clean source history is published).
- `evidence/`: baseline, initial failed presentation/citation output, selected follow-up and final real/local reports; hashes and explicit same-author review.
- [Results and limits](RESULTS.md).

Default Rust tests run only local synthetic checks. Real models require explicit execution and transient configuration:

```sh
node evals/v0.6.6/run.mjs --run
# Only if a documented change justifies an observed follow-up:
node evals/v0.6.6/run.mjs --run --cases=P11,P19,P23
```

Required environment names: `INKSTONE_EVAL_BASE_URL`, `INKSTONE_EVAL_EMBEDDING_MODEL`, `INKSTONE_ANSWER_EVAL_MODEL`, `INKSTONE_EVAL_RERANK_ENDPOINT`, `INKSTONE_EVAL_RERANK_MODEL`. Optional transient keys: `INKSTONE_EVAL_API_KEY` and `INKSTONE_EVAL_RERANK_KEY`. No key values belong in a document, command committed to Git, fixture or report. Rerank key reuse is limited to the same service origin.

The runner/evaluator do not read Keychain or app settings. For this local execution, a separate, uncommitted launcher explicitly read the previously authorized same-origin embedding Keychain key and passed it only in memory/environment. Thus `keychainAccessedByEvaluator=false` does not mean the entire launch process never read Keychain.

A persistent ledger under ignored `artifacts/v0.6.6-development/evaluation` limits all runs in that workspace to **240 HTTP attempts / 1800 seconds**. Capacity is reserved before child launch; unknown termination is charged in full. Known final reports refund unused capacity. A filesystem lock prevents concurrent runners; do not remove an in-flight lock or reset the ledger to evade a cap. Runner wall time includes necessary child compilation; provider tokens/cost remain unknown when unavailable. Budget unit checks are part of default tooling verification.

Query embeddings are requested online, once per question and shared across hybrid/rerank comparisons; document indexing is separate. Reports sum measured embedding, local retrieval/rerank/context and optional generation. This excludes Keychain launch, UI rendering, queues and user-perceived end-to-end timing. Per-branch candidate limits are 60 (fusion union up to 120), rerank window 40 and final display 12: not an equal-total-candidate-cost experiment.

Only `rerank` mode requests generation for the frozen subset. A local refusal with no evidence is not a paid chat completion. Preserve the first failure and corpus labels after observing results; further tuning makes the set an observed regression, not a new blind check.
