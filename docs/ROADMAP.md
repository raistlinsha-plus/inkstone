# Inkstone roadmap

**v1.2.0-beta.3 · build 10218.** Browse project folders, search text in photos and edit mind maps on a canvas. Markdown-backed tasks and calendar entries stay linked to their source notes. [Release notes](DELIVERY-v1.2.0-beta.3.en.md) · [简体中文](ROADMAP.zh-CN.md)

## Next validation work

RC.1 focuses on native Mac regression testing, assistive technology and real-model verification. [English manual](USER-MANUAL.en.md)

| Area | What to verify next |
| --- | --- |
| Answers and citations | Compare actual answers from the same model on the frozen question set. Mark missed evidence, unsupported claims and citation errors separately, with independent human review. Follow-ups and partially supported questions have the largest documented gaps. |
| Tasks, calendars and languages | Ask people to turn a real action into a task, schedule it and return to the source note in both interface languages. Repeat the flow on additional Macs with keyboard navigation, an input method and VoiceOver. |
| Day-to-day use | Observe first-time import, Wiki review and five days of optional companion use. Record where users get stuck or where the pet covers their writing. |
| Public Mac installer | Verify the notices and rights for the binary, Developer ID signature and notarization. Test the exact download on a clean Apple Silicon Mac with Gatekeeper enabled, including upgrade and rollback. |

The current beta measures source coverage offline. Its frozen live-answer score, independent human review and installer acceptance are open. Other interface languages, PDF import and OCR for PDFs, cloud collaboration and a system-level desktop pet depend on later evaluations. [Known limitations](KNOWN-LIMITATIONS.md)

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
- [v0.9.4 through v0.9.6](DELIVERY-v0.9.6.md) delivered Wiki claim review, return to editing position and three optional companions.
- [v1.0.0-rc.4](DELIVERY-v1.0.0-rc.4.md) added quotation checks and paired evaluation. Its live scores describe that candidate.
- [The plans for RC.5, 1.1 and 1.2 (中文)](design/v1.2-integration.zh-CN.md) document the task, localization and context changes integrated in this beta.

To reproduce a problem or contribute an independent evaluation, use a fictional document you can share. [Contributing](../CONTRIBUTING.md)
