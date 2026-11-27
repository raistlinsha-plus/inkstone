# Inkstone roadmap

**1.4.0 stable · build 10225.** The release brings project images into chat and lets you save generated pictures. Near-term work focuses on follow-up evidence retrieval and independent Mac distribution testing. The milestones below preserve the planning history. [Stable release](DELIVERY-v1.4.0.en.md)

**v1.2.0-beta.3 · build 10218.** Browse project folders, search text in photos and edit mind maps on a canvas. Markdown-backed tasks and calendar entries stay linked to their source notes. [Release notes](DELIVERY-v1.2.0-beta.3.en.md) · [简体中文](ROADMAP.zh-CN.md)

## From beta.3 to a stable release

Plan dated 2026-11-28. **v1.2.0-rc.1** was the next planned milestone. It follows the same set of materials through writing, mind maps, image Q&A, tasks and calendar before adding more file types. Timing is tentative and starts when work on the candidate begins.

| Milestone | What users get | Release criteria |
| --- | --- | --- |
| **v1.2.0-rc.1 · Everyday reliability** (weeks 1–2) | Fix reproducible issues with Chinese composition, node dragging, saved themes and menu focus. Exercise the upgrade on an existing library. | Run the core journeys below on the same candidate build. Keep native Mac observations, restore results and paired answer evaluations. |
| **v1.2.0 · Stable** (review after at least one week of candidate use) | A documented path from first import to a cited answer and a scheduled task, with matching bilingual guides, examples and screenshots. | Close all cases of lost data, images sent without confirmation, out-of-scope citations and failures that block typing, saving or restoring. Issue rc.2 and rerun affected journeys if these surface during the trial. |
| **v1.2.x · Maintenance** (as needed) | Resolve recurring problems reported in daily use. | Reproduce the reported steps, add regression coverage and test with an existing library before releasing a patch. |

### What to verify in rc.1

| Journey | Acceptance check |
| --- | --- |
| Writing, controls and mind maps | Compose, dismiss a candidate and commit text mid-document and inside a list with macOS Pinyin and a second Chinese input method. Check caret and scroll position. Switch bold text through source, split and rich-text views. Dismiss space menus by clicking outside or pressing Escape, and check keyboard focus returns to the trigger. For both standalone mind-map formats, change theme, drag to empty space, reparent, undo and reopen. Check position, hierarchy and theme. |
| Files, images and upgrades | Back up a beta.3 library, upgrade, then restore the backup on the old version. Compare folders, HEIC/HEIF original hashes, OCR, saved descriptions and citation targets. Check file destination and count after a cancelled import, duplicate import or failed model request followed by retry. |
| Answers and actions | Compare beta.3 and the candidate on the same frozen questions with the same model. Have an independent reviewer score answer correctness and citation support separately, including follow-ups, partial evidence and unsupported claims. With permission, use a synthetic image to verify a real vision call. Cancelling must send zero images. Turn a quoted action into a task, reschedule it, mark it complete in the calendar and return to the source. All three views must point to the same task. |
| First use and accessibility | On an additional Mac, complete first import, Wiki source review and the core journeys in Simplified Chinese and English. Exercise narrow windows, light and dark modes, keyboard navigation and VoiceOver. Observe the optional companion over at least five days of ordinary use, recording any obscured text or interrupted writing. |

The frozen offline keyword replay placed 21 of 53 annotated answer points in the model context, including just 2 of 13 follow-up points. Trace where supporting passages disappear on follow-ups. Report evidence coverage, live-answer correctness and citation support separately. Investigate and retest any regression on the paired questions before release. [Evaluation record](../evals/v1.0/rc5/README.md) · [Known limitations](KNOWN-LIMITATIONS.md) · [Native UI regression checklist (Chinese)](design/v1.2-frontend-roadmap.zh-CN.md)

**The downloadable Mac installer has its own release checks.** GitHub currently offers a source prerelease. Review third-party licenses and artwork, sign with Developer ID, notarize with Apple and test first launch, upgrade and rollback using the exact download on a clean Apple Silicon Mac with Gatekeeper enabled. List the availability of stable source and the installer separately. [macOS release procedure](MACOS_RELEASE.md)

## Proposed releases after 1.2

| Proposal | First deliverable | Acceptance check |
| --- | --- | --- |
| **v1.3 · Use images in a conversation** | First, pick an image from the current space in general chat and choose local OCR, a saved description or an explicit image request to the user's vision model. Then support questions spanning an image and a note, with links back to both sources. | Ask a question about an iPhone HEIC and a meeting note. Text-only mode sends the selected text. Users can inspect the destination model and cancel an image request. Index a description only after explicit save. Once source access is revoked, new queries cannot retrieve its evidence. |
| **v1.4 candidate · Save generated images to a project** | If v1.3 trials confirm demand, support one user-configured image generation service. Start in chat, preview a result and choose its destination space and folder. | Request an image, preview, save and reopen it from the space. Cancellation writes no file and failures can be retried. Saved images use the existing viewing and retrieval flows. |

Traditional Chinese is the proposed first additional interface language. Review terminology, input methods, dates and an end-to-end task flow before release. Collect demand for searchable PDF import and another language separately and use trial feedback to schedule them. External AI tools already have a space-scoped read-only CLI. Once image citation targets settle, evaluate exposing them through the CLI. [External tools guide](EXTERNAL-TOOLS.en.md) · [Language design (Chinese)](design/localization.zh-CN.md)

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
