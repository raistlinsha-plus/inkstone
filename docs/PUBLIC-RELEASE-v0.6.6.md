# v0.6.6 — First Public Source Preview

This preview brings Inkstone's existing local Markdown workspace and knowledge assistant to GitHub. It targets macOS 13+ on Apple Silicon and uses your own compatible model API. It provides source and build instructions; Developer ID signing, notarized installers and cross-machine acceptance remain future work.

## Included

- Managed document spaces, copy import, source-update comparison, history, backup validation and restore preview.
- Source/visual Markdown editing with JSON, Mermaid, mindmap, calendar and constrained chart content.
- Local BM25, hybrid vector retrieval, optional reranking, rich answers and current-source citations.
- Startup loading through workspace/session restoration, failure retry, pane visibility preferences and correct return focus after auto-focused dialogs close.
- Update pulldown-cmark 0.13.5 → 0.13.6 for RUSTSEC-2026-0433 (conditional nested-wikilink parsing DoS; the app does not enable that option).
- Evidence checks for explicitly named document comparisons; heading-only chunks cannot be cited as answer rules.

## Validation and limits

The frozen 40-case synthetic check has 32 answerable and 8 insufficient-evidence questions. The final real BM25/hybrid/rerank runs each included necessary evidence for 32/32 answerable cases and admitted 0/8 insufficient cases. These are same-author, previously observed checks with repeated templates and reversed pairs, not a general answer accuracy claim. The corrected observed older 32-case regression remains at 19/24 evidence coverage; abstract cross-document paraphrases can still be conservatively refused.

Three bounded service runs used 204 HTTP attempts total: 98 embedding, 83 rerank and 23 chat calls. Original heading-only citation/presentation failures, selected follow-up and final full retest remain separate. Final 10 generated answers, including 3 charts, were reviewed by the implementation agent; 2 selected insufficient questions refused locally without chat. Costs/token totals are unknown. See [full results](../evals/v0.6.6/RESULTS.md).

Local gates passed 240 frontend tests, 132 Rust tests (5 explicit remote tests ignored), 10 tooling checks and 35 prototype checks, plus types/worker/build/docs. An independent source directory with its own dependencies and target also passed. Native scoped checks covered loading, keyboard dialog return focus, source/body/save/reopen (856 characters/62 lines), pane persistence and narrow layout; production cold launch restored the existing project. Hosted CI and public-release identity are finalized in the GitHub Release record. Do not infer native IME, VoiceOver or cross-machine success from unit tests or process startup probes. [Known limitations](KNOWN-LIMITATIONS.md).

## Run and contribute

Follow [the README](../README.md) or [中文说明](README.zh-CN.md). Use synthetic samples in issues and keep credentials, private text and backups out of the repository. [Contributing](../CONTRIBUTING.md) · [Security](../SECURITY.md).

Source is Apache-2.0; dependencies retain their original licenses. Eight missing notices were supplemented from immutable upstream revisions. Standalone local texts remain missing for 20 acquired packages; binary redistribution review is incomplete. No model weights or dependency executables are included in the source archive.

Companions, growth, CGs and stories remain the separate v0.7 prototype. Production integration starts after this first public source release.

## Dependency review at release preparation

The current npm audit reports 5 low findings and no moderate/high/critical findings (conditional KaTeX chain; editor math is disabled, which is not a proof that every transitive path is unreachable). The full 514-package Cargo lock OSV check initially found the pulldown-cmark advisory; after 0.13.6 it no longer appears. Remaining findings are fxhash/proc-macro-error maintenance notices, glib on another platform target, and zstd/zstd-safe advisories in the fixed compiled-dictionary dependency chain. The accepted macOS target has no glib dependency; arbitrary user zstd input is not an application feature. These are recorded applicability boundaries, not a security certification or a blanket dismissal of dependency risks.

Hosted macOS ARM capacity was unavailable: the initial queued run executed no steps and ended with a runner-acquisition error. Hosted CI therefore runs tests on `macos-15-intel` and cross-builds/verifies the Apple Silicon application; local isolated/production acceptance is on Apple Silicon. Cross-building does not establish native ARM execution on the hosted runner or complete Intel product acceptance.
