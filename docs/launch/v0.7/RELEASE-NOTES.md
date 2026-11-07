# v0.7.0-rc.4 — Notes, cited conversations and optional ink companions

Inkstone brings local Markdown documents and evidence-based conversations into one macOS workspace. Use your own compatible model API; optionally keep an ink companion beside your work.

## Since the v0.6.6 source preview

- Continue persistent multi-turn conversations with fixed space/document scope, question branches, answer candidates and per-answer source snapshots.
- Expand Q&A when you need more room. Preserve a marked partial answer after stopping, retain the next question draft, and choose the export scope.
- Opt into Motuan, Yanzhou or Zhiwei, with three-stage progression, fixed stories and CG albums. No separate companion model call; current artwork is static candidate art.
- Keep ordinary document lists stable while opening notes. Use a separate Recent view and per-space sort preferences.
- Inspect trash items without accidentally restoring them. Permanently delete a single managed copy only after reviewing its scope and typing a confirmation; imported originals and historical exported data remain.
- Refine narrow-window layouts, structured content spacing and New/Import button alignment.
- Make CI checks deterministic: wait for credential-worker completion and explicitly advance the history-search debounce in its 200-row integration test. Production credential and search behavior are unchanged.

## Try it

macOS 13+ on Apple Silicon; Chinese UI. This is a **source preview**, not a signed/notarized installer. Follow [Quickstart](https://github.com/raistlinsha-plus/inkstone/blob/main/docs/QUICKSTART.md), import the fictional sample and compare 120 vs 80 participants; then ask about missing satisfaction data and inspect the refusal/source behavior.

Editing and keyword search work without model credentials. Embeddings, reranking and answers send selected information to your configured provider and may incur its fees. See [Security](https://github.com/raistlinsha-plus/inkstone/blob/main/SECURITY.md).

## Verification and limits

Local full gates: 53 frontend files / 282 tests; 178 Rust tests passed, six explicit remote tests ignored. Fresh synthetic-browser checks cover stable order, trash confirmation and multi-turn layouts; they make no model request and do not prove native WebKit or live-model quality. The [readiness assessment](https://github.com/raistlinsha-plus/inkstone/blob/main/docs/GITHUB-READINESS-v0.7.md) records the exact scope and remaining gates. Consult the repository checks for the exact tagged commit; local checks are not a substitute for hosted CI.

Stable release gates still include native IME/accessibility, multi-day growth, final artwork, third-party distribution notices and macOS signing/notarization/cross-machine acceptance. Existing dependency advisories remain documented. No Windows/Linux/Intel support or general answer-accuracy guarantee is claimed.

If local writing with inspectable answers is useful to you, a star helps others discover the project. A small synthetic bug report or independent evaluation is even more actionable.
