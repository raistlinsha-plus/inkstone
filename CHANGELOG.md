# Changelog

Historical versions below describe local development deliveries, not earlier public GitHub releases. v0.6.6 is the first public source preview. See [release notes](docs/PUBLIC-RELEASE-v0.6.6.md).

## 0.6.6 · 2026-11-03

- Keep startup loading through workspace/list/session restoration; distinguish failure from an empty library, support retry, and remember pane visibility. Restore dialog trigger focus even when child inputs auto-focus.
- Patch pulldown-cmark 0.13.5 → 0.13.6 for RUSTSEC-2026-0433; the application does not enable the affected Wikilinks option.
- Check explicitly named comparisons per document and shared attribute; preserve lexical/numeric constraints and reject heading-only evidence.
- Freeze synthetic checks, preserve first citation/presentation failures and retests, and add cumulative paid-evaluation reservation and interruption protection.
- Add public Chinese/English guides, architecture summary, synthetic demos and source-release preparation. Supplement eight missing notices from immutable upstream sources; twenty standalone-text gaps remain.

## 0.6.5 · 2026-11-02

- Prevent rerank relevance from granting unsupported evidence eligibility; share ranking and whole-source context limits between application and evaluation.
- Preserve failed real-service evaluations and new-corpus limitations.
- Update ZIP to 9.0.5 and Vitest to 4.1.12; use official npm lockfile URLs. Prepare clean source export, CI and repository templates.

## 0.6.4 · 2026-11-02

- Refine editor toolbar, list alignment, selection round trips, component spacing and narrow dual-pane layout.
- Add IME event/229 protections and keyboard/menu focus regressions; native candidate testing remains separate.

## 0.6.3 · 2026-11-01

- Extract display, typed IPC and parser-worker boundaries. Add scoped/full verification distinction, checked cache reuse, timing and isolated desktop builds.

## 0.6.1–0.6.2 · 2026-10-31

- Add recovery diagnostics, cross-batch internal links and independent relinking, pins/type views, per-document index state, complete ZIP backup validation and restore preview.
- 0.6.1 fixes were incorporated into the 0.6.2 local delivery.

## 0.5.1–0.6.0 · 2026-10

- Make document spaces the managed collection unit; support imports from multiple folders, explicit source updates and conflict protection.
- Refine navigation, editor/structured content spacing and knowledge workflows. 0.5.1 was incorporated into 0.6.0.

## 0.5 · 2026-10

- Add Markdown-rich answers, constrained charts and answer-to-document workflows; improve shared content rendering.

## 0.4–0.4.1 · 2026-10

- Add document calendar content and hybrid BM25/vector retrieval with optional reranking; improve editor toolbar, blank-line round trips and mindmap typography.

## 0.2–0.3 · 2026-10

- Add source/visual Markdown editing and structured JSON/Mermaid/mindmap presentation, cursor insertion and copy import.

## 0.1 · 2026-10

- Establish the local macOS text/Markdown editor, local indexing/retrieval and user-configured compatible model APIs.
