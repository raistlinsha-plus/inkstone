# v0.6.5 RAG quality matrix

This version evaluates the production query normalization, BM25/vector candidate merge, lexical evidence gate, rerank application, displayed ranking and generation context budget. It uses temporary SQLite/files and synthetic documents, never the user's document library. The evaluation code is test-only. Expected paths, quotes and labels are consulted only after retrieval for scoring.

`manifest.json` freezes 32 new questions and their protocol before the v0.6.5 retrieval changes. There are 24 answerable and 8 unsupported cases, including six chart and four cross-document requests. The same development agent authored the cases and implementation. This is **not** independently authored or externally blinded. After the first run, all 32 are observed; follow-up runs are same-question regressions. The older 100 cases under `v0.6.2` were already observed before this version.

## Local gate

```sh
cargo test --locked --manifest-path src-tauri/Cargo.toml --lib evaluation_v065::local_frozen_quality_report -- --exact --nocapture
```

Reports are written under `artifacts/v0.6.5-development/evaluation/`. The first local reports are retained. Passing the software test verifies fixtures and execution, not the frozen quality targets. Recall is measured over distinct documents; cross-document questions require all gold documents in the first k. MRR uses the worst required source rank. Gold quote availability, insufficient-evidence admission, generated answer support, citations, refusal and chart semantics are separate metrics.

## Explicit real-service run

Set transient environment variables:

- `INKSTONE_EVAL_BASE_URL`, `INKSTONE_EVAL_EMBEDDING_MODEL`, `INKSTONE_EVAL_API_KEY`.
- `INKSTONE_ANSWER_EVAL_MODEL` (chat uses the same explicit base/key).
- `INKSTONE_EVAL_RERANK_ENDPOINT`, `INKSTONE_EVAL_RERANK_MODEL`, optionally `INKSTONE_EVAL_RERANK_KEY`. A missing rerank key can only reuse the embedding key at the same scheme/host/port.

```sh
node evals/v0.6.5/run.mjs --corpus seen-100 --run
node evals/v0.6.5/run.mjs --corpus new-32 --run
```

These commands incur model usage. They do not read Keychain or stored app settings. A caller may explicitly inject an authorized credential without saving it in source. The actual local run's credential bootstrap is documented separately from the evaluator. Each run has a hard ceiling of 240 HTTP attempts (including retries) and 20 minutes. `INKSTONE_065_MAX_ATTEMPTS` may reduce, never increase, that ceiling. There is no automatic model switching or infinite retry. Counts, statuses, endpoint/model, corpus/protocol/pipeline hashes, per-stage times, fallbacks and incomplete rows remain in timestamped reports. Bodies and credentials are not logged by the attempt trace. Billing and token totals are unknown unless supplied by the service; no invented currency estimate is reported.

All four modes use the same document corpus, up to 60 candidates per retrieval branch (the merged union can reach 120), 40 rerank candidates, 12 displayed candidates, six context sources, 2,400 characters per parent and a 12,000-character total setting. This is not an equal-total-raw-candidate-cost experiment; see the budget clarification in ERRATA. Query embeddings are batch-precomputed; reported retrieval/context timing is **not online query latency**. Vector-only is a diagnostic baseline: it does not acquire BM25 evidence eligibility merely by being near a query. It is not a user-facing mode. Reranking now filters/reorders eligible evidence and cannot turn an unsupported candidate into evidence by relevance score alone.

Only the frozen six-question subset requests generation across modes. No-context answers are returned locally without a model call. Sources, raw answers, finish reason, chart audit and an unfilled review rubric are retained. An implementation-agent review is labeled as such, not as an independent human audit. See [results](RESULTS.md) and [label errata](ERRATA.md). First-run failures are preserved; no target is relaxed to make a result pass.
