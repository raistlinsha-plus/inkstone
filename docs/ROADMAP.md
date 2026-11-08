# Inkstone roadmap

The current local development line is **v0.7.8**. v0.7.6 improves evidence selection, v0.7.7 refines first use and chat, and v0.7.8 introduces the Motuan motion pilot. [Delivery index](DELIVERY-INDEX-v0.7.8.md) · [Published source previews and tags](https://github.com/raistlinsha-plus/inkstone/releases)

## Ready to try in the source preview

- Persistent scoped conversations and standalone chat. Select one space, a few managed documents or local text attachments for a turn.
- Space Wikis built from explicitly selected documents, with source links, review and incremental maintenance. Local BM25, optional vectors and Wiki-guided recall can supply evidence.
- Opt-in, model-routed Brave Search for readable public pages. Live provider validation is pending.
- Markdown documents containing JSON, Mermaid, mindmaps, calendars and constrained charts.
- Stable document order, a separate Recent view, and explicitly confirmed permanent deletion with recovery bookkeeping.
- Optional ink companions, fixed stories and locally stored growth records. Motuan has an opt-in pixel-and-ink motion pilot and an extra album reward for the second chapter.

## Before a stable distribution

- Verify the exact commit selected for publication on GitHub CI and keep source and installer checks distinct.
- Complete visible native Mac checks for IME, shortcuts, dialogs and VoiceOver.
- Review final artwork and observe growth over at least five distinct natural usage days.
- Complete third-party binary-distribution notices, signing, notarization and cross-machine installation before offering a stable installer.

## Next usability and evaluation work

- Observe first-time users completing import → question → source and Wiki scope → review → original source. Refine model setup and fallback explanations using those observations.
- Extend the fixed local retrieval regression with externally reviewed questions and provider-generated answer and citation judgments. Keep source coverage, unsupported answers, unnecessary refusals, latency and model calls separate.
- Verify actual Brave routing with an authorized provider account. Record search-worthiness, public-query blocks, useful webpage evidence and failure reasons before broadening the web path.
- Improve asset sizes, startup/performance measurement and module boundaries without expanding the format surface at the same time.
- Observe the Motuan pilot during ordinary work sessions over at least five natural usage days. Review motion, quiet settings and growth before adapting motion to the other companions.

PDF/OCR, cloud collaboration, multi-space sourcing in a single turn, other operating systems and a floating desktop pet remain future ideas.

If you can help, start with a synthetic reproduction, a documented native accessibility check, or an independent retrieval evaluation. See [Contributing](../CONTRIBUTING.md).
