# v0.6.6 results and retained failures

2026-11-02; local Apple Silicon; fictional documents only. Service: `https://aihubmix.com/v1`; embedding `text-embedding-3-small`, chat `gpt-4.1-mini`, rerank `qwen3-reranker-0.6b` (40 candidates, minimum score 0.5, timeout 15s). No production/private documents were sent.

## Evidence coverage

| Corpus / stage | Necessary gold evidence in context | Insufficient cases admitted |
| --- | ---: | ---: |
| Corrected observed older 32 / baseline | 19/24 (79.2%) | 0/8 |
| Corrected observed older 32 / final local | 19/24 (79.2%) | 0/8 |
| Frozen new 40 / baseline local BM25 | 24/32 (75%) | 0/8 |
| Frozen new 40 / final local BM25 | 32/32 (100%) | 0/8 |
| Frozen new 40 / final real BM25 | 32/32 (100%) | 0/8 |
| Frozen new 40 / final real hybrid | 32/32 (100%) | 0/8 |
| Frozen new 40 / final real hybrid + rerank | 32/32 (100%) | 0/8 |

Final real Recall@5 is 100%, MRR@10 0.875 in each mode. These are source/context metrics, not answer accuracy. Relevance did not grant evidence eligibility. Comparison sources were checked against their own explicitly named document and shared requested attributes, retaining two-thirds lexical coverage and numeric constraints. No dataset-specific entity/synonym list was added.

The old abstract comparison questions still fail conservatively, as does one duration paraphrase. Explicit document-name scoping does not solve arbitrary semantic paraphrases or a question asking unrelated attributes for two subjects. The new set is simpler in this respect and includes repeated patterns and reversed comparisons; do not compare its 100% to the old 79.2% as a universal quality gain. No independent reviewer or private-user dataset was used. Labels were frozen, baseline observed and retests kept separate.

## First failure, fix and retest

The first full service run used 95 HTTP attempts. It covered evidence but exposed heading-only snippets in citation context: P11 and P23 had redundant heading citations; P19 also echoed structured S IDs in prose. This was a citation/presentation defect, even though the substantive rules were available in proper sources. Original answers and the failed review are preserved.

A general heading-only evidence exclusion was added with a regression. Selected P11/P19/P23 follow-up used 14 requests and removed the redundant context and formatting defects. Because this rule affects every source, a final complete 40-case service run used 95 more requests. Its 10 generated answers were compared with supplied current source text; facts, conditions and citation targets were supported. P17/P19/P23 are 3 comparison variants over only 2 unique pairs. P25/P26/P29 charts preserved categories, years, units and exact values, including P25's missing August value as `null`. Two selected insufficient questions refused locally without chat. No final chart was rejected. Review was by the implementation agent and is not formal semantic proof.

## Online stage timing

| Final mode / population | n | P50 | P95 |
| --- | ---: | ---: | ---: |
| BM25 local retrieval/context, no generation | 40 | 6.1ms | 10.6ms |
| Hybrid query embedding + retrieval/context, no generation | 40 | 807.8ms | 1639.7ms |
| Rerank online total, mixed generation/not-requested/refusal rows | 40 | 2431.2ms | 5819.3ms |
| Rerank with actual generation only | 10 | 4290.4ms | 6634.5ms |

Query embedding alone P50/P95 was 791.8/1627.4ms. Vectors were requested per question and reused across the two semantic modes, not batch-precomputed. The total is the sum of measured stages, excluding document indexing, credential launch, UI and queues. Ten-answer percentiles describe this small run, not an SLA; mixed totals are not a fair all-question answer latency comparison.

## Actual usage and provenance

Three service runs totaled **204 HTTP attempts**: 98 embedding, 83 rerank, 23 chat. All returned HTTP 200; no retry/fallback was observed. There were 23 actual generation calls across initial/follow-up/final runs, not 23 distinct questions. Charges/token totals were not returned in a verifiable aggregate and remain unknown. The cumulative budget ledger and source/config hashes are retained.

The first launch helper failed to locate its Node binary before any request or ledger reservation; the path resolution was corrected. Raw service reports retain the three actual runs. Corpus/label hashes were not changed to improve scores. The original v0.6.5 frozen results remain historical, with a separately versioned corrected observed set here.

The evaluator/runner only receive transient credentials; the local launcher read an already authorized Keychain key explicitly and reused it only at the same origin. See [execution guide and boundaries](README.md). Results do not establish cross-provider, cross-machine, large-library or real-user quality.

After real service runs, pulldown-cmark was patched from 0.13.5 to 0.13.6 for a newly observed conditional Wikilinks DoS advisory. The app uses default parser options, not Wikilinks. Captured final charts are replayed through local validation with the patched parser; paid API runs were not repeated for this dependency-only patch. Raw pipeline reports describe the earlier lock version and do not prove an identical dependency build.
