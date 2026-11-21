# Inkstone roadmap

The **v1.0.0-rc.4 source prerelease** is available for testing on Apple Silicon Macs. The next priority is to recover answers whose evidence reached the search results but was dropped during quotation selection, particularly on follow-ups and partially supported questions. A new blinded human review will inform the 1.0 decision. [RC.4 results](DELIVERY-v1.0.0-rc.4.md) · [1.0 release criteria](design/v1.0.zh-CN.md)

The earlier **v0.9.6 source preview** brings together claim-by-claim Wiki review, a way back to the exact writing selection after checking a source, and three optional page-edge companions. [Wiki changes](DELIVERY-v0.9.4.md) · [Writing changes](DELIVERY-v0.9.5.md) · [Companions](DELIVERY-v0.9.6.md)

## Validation before 1.0

The next retrieval milestone is to answer paraphrased and multi-part questions from the selected notes. We will measure which required passages reach the model, then score answers and citations separately. First-use observations, native accessibility checks and a five-day companion study remain open. Public macOS installer distribution has a separate signing, notarization, clean-Mac and notice review track. [中文路线图和验收目标](ROADMAP.zh-CN.md)

## Earlier milestones

- [v0.8.0 release preparation](DELIVERY-v0.8.0.md) records verification and remaining distribution gates.
- [v0.8.1 question workbench](DELIVERY-v0.8.1.md) introduces contextual navigation and citation-to-document return.
- [v0.8.2 documents and Wiki](DELIVERY-v0.8.2.md) refines editing, appearance and source review.
- [v0.8.3 companion workspace](DELIVERY-v0.8.3.md) adds Motuan’s in-app pet, season reader and album.

- [v0.8.4 appearance and contrast](DELIVERY-v0.8.4.md) improves light and dark appearance across the app and rich previews.

- [v0.8.5 first use and local upgrade](DELIVERY-v0.8.5.md) adds offline sample search and a reversible local upgrade workflow.

- [v0.8.6 grounded answers](DELIVERY-v0.8.6.md) keeps a selected scope intact, labels the evidence at each turn, and adds a separate answer and citation evaluation.

- [v0.8.7 Wiki review and saved citations](DELIVERY-v0.8.7.md) compares a proposal to its base and verifies managed sources from saved answers.

- [v0.9.0-beta.2 first use](DELIVERY-v0.9.0-beta.2.md) adds an independent offline example and an in-context chat setup.
- [v0.9.1 evidence selection](DELIVERY-v0.9.1.md) improves compound questions, comparison, and follow-ups and adds 40 frozen cases.
- [v0.9.2 Wiki](DELIVERY-v0.9.2.md) adds recent changes beside topics and separates earlier snippets from currently verifiable citations.

## v0.9 macOS beta

- Verify Developer ID signing with the hardened runtime and a secure timestamp. Submit through Apple, attach the ticket and check the final ZIP after extraction. [Release runbook](MACOS_RELEASE.md)
- Install the verified download on a clean Apple Silicon Mac with Gatekeeper enabled. Test offline first launch and exercise upgrade and rollback with fictional documents.
- Review the notices and rights for the exact binary before sharing it. Link the validated archive and its checksum from the GitHub prerelease.

## Ready to try in the source preview

- Persistent scoped conversations and standalone chat. Select one space, a few managed documents or local text attachments for a turn.
- Space Wikis built from explicitly selected documents, with source links, review and incremental maintenance. Local BM25, optional vectors and Wiki-guided recall can supply evidence.
- Opt-in, model-routed Brave Search for readable public pages. See the [v0.8.6 evaluation](../evals/v0.8.6/README.md) for live verification status.
- Markdown documents containing JSON, Mermaid, mindmaps, calendars and constrained charts.
- Stable document order, a separate Recent view, and explicitly confirmed permanent deletion with recovery bookkeeping.
- Optional ink companions, fixed stories and locally stored growth records. Motuan, Yanzhou and Zhiwei each have a page-edge sprite. Their stories, album and confirmed experiences live in the companion workspace.

## Before a stable distribution

- Verify the exact commit selected for publication on GitHub CI and keep source and installer checks distinct.
- Complete visible native Mac checks for IME, shortcuts, dialogs and VoiceOver.
- Review final artwork and observe growth over at least five distinct natural usage days.
- Complete third-party binary-distribution notices, signing, notarization and cross-machine installation before offering a stable installer.

## Next usability and evaluation work

- Observe first-time users completing import → question → source and Wiki scope → review → original source. Refine model setup and fallback explanations using those observations.
- Extend the held-out answer evaluation with independently reviewed and less structured corpora. Keep source coverage, unsupported answers, unnecessary refusals, latency and model calls separate. Record search-worthiness, public-query blocks, useful webpage evidence and failure reasons before broadening the web path.
- Improve asset sizes, startup/performance measurement and module boundaries without expanding the format surface at the same time.
- Observe the three page-edge companions during ordinary work over at least five natural usage days. Track whether the sprite covers text, distracts during writing or makes people want to return.

PDF/OCR, cloud collaboration, multi-space sourcing in a single turn, other operating systems and a floating desktop pet remain future ideas.

If you can help, start with a synthetic reproduction, a documented native accessibility check, or an independent retrieval evaluation. See [Contributing](../CONTRIBUTING.md).
