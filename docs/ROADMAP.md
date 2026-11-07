# Inkstone roadmap

The current development line is **v0.7.3 source preview**. v0.7.2 introduces Wiki and public-web retrieval. v0.7.3 adds a standalone chat workspace. [v0.7.2 delivery](DELIVERY-v0.7.2.md) · [v0.7.3 delivery](DELIVERY-v0.7.3.md) · [GitHub Releases](https://github.com/raistlinsha-plus/inkstone/releases)

## Ready to try in the source preview

- Persistent scoped conversations and standalone chat. Select one space, a few managed documents or local text attachments for a turn.
- Space Wikis built from explicitly selected documents, with source links, review and incremental maintenance. Local BM25, optional vectors and Wiki-guided recall can supply evidence.
- Opt-in, model-routed Brave Search for readable public pages. Live provider validation is pending.
- Markdown documents containing JSON, Mermaid, mindmaps, calendars and constrained charts.
- Stable document order, a separate Recent view, and explicitly confirmed permanent deletion with recovery bookkeeping.
- Optional ink companions, fixed stories and locally stored growth records. Artwork is static candidate art.

## Before a stable distribution

- Verify the exact commit selected for publication on GitHub CI and keep source and installer checks distinct.
- Complete visible native Mac checks for IME, shortcuts, dialogs and VoiceOver.
- Review final artwork and observe growth over at least five distinct natural usage days.
- Complete third-party binary-distribution notices, signing, notarization and cross-machine installation before offering a stable installer.

## Next usability and evaluation work

- Test the first import → Wiki approval → original-source check and the first standalone question on a clean profile. Use feedback to improve model setup, costs and fallback explanations.
- Evaluate local-only and Wiki-assisted retrieval on the same reviewed questions. Measure necessary-source coverage, citation support, unsupported answers, unnecessary refusals, latency and model calls.
- Verify actual Brave routing with an authorized provider account. Record search-worthiness, public-query blocks, useful webpage evidence and failure reasons before broadening the web path.
- Improve asset sizes, startup/performance measurement and module boundaries without expanding the format surface at the same time.
- Pilot ink-and-pixel motion, expression variants and staged companion artwork as a separate track. Check reduced motion, quiet settings and growth over ordinary work sessions.

PDF/OCR, cloud collaboration, multi-space sourcing in a single turn, other operating systems and a floating desktop pet remain future ideas.

If you can help, start with a synthetic reproduction, a documented native accessibility check, or an independent retrieval evaluation. See [Contributing](../CONTRIBUTING.md).
