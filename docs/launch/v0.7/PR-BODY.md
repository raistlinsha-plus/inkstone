# Prepare v0.7 source preview: persistent cited conversations and optional companions

The public v0.6.6 preview lacks the candidate's persistent conversation workflow. This update keeps scoped conversations, question branches, answer candidates and source snapshots together, adds optional companions with local growth/stories, and completes stable document ordering plus explicitly confirmed permanent deletion.

The repository homepage now explains the task, source-build requirements and provider/data boundaries first. It includes freshly captured synthetic UI examples, a step-by-step walkthrough, fictional import samples, bilingual quickstart links, release copy and discoverability materials.

Validation: full local gates (53 frontend files / 282 tests, 178 Rust passes with six explicit remote tests ignored), fresh isolated browser checks, source/history privacy review and dependency review. A credential timeout test now waits for explicit worker completion instead of a fixed delay. Production credential behavior is unchanged. The release manifest's catalog version is corrected to schema4.

Remote CI on this exact PR commit remains required. This update does not claim native IME/VoiceOver, multi-day growth, final artwork, notarized installers or general RAG accuracy. Remaining dependency and third-party distribution notice gaps are documented in `docs/GITHUB-READINESS-v0.7.md`.

No keys, private data, machine backups or production model calls are included. Only a source pre-release is proposed; stable/binary publication stays gated. No repository settings, external posts or Release were changed while preparing this PR.
