# Inkstone v1.2.0-beta.1 · Document tasks, a weekly calendar and a bilingual workspace

This GitHub source prerelease corresponds to macOS local build **10207**. It brings together passage selection for document questions, Markdown tasks, English and Simplified Chinese interfaces, and per-answer context details. [简体中文发布说明](DELIVERY-v1.2.0-beta.1.md) · [Build from source](QUICKSTART.en.md) · [Desktop guide](USER-MANUAL.en.md)

## What to try

| Start in | Try this |
| --- | --- |
| **Tasks** | Enter several tasks in succession. In task details, set a deadline and schedule a time slot. Open **Calendar** to move the block, then check the same checklist item in its Markdown note. |
| **AI chat** | Choose sources or web search beside the composer. Open **More answer actions (…)** below an answer to inspect the context used, or select a passage and create a task in a note. |
| **Editor** | Read a tall Mermaid diagram by scrolling the document. Hover or Tab to reveal controls for a mind map or chart. Data charts let you switch between Chart, Table and Source, edit values and export SVG or PNG. |
| **Knowledge Wiki** | Filter the list of sources and select or clear all matches. Selections outside the filter are retained. Save the scope before compiling. |
| **Models and settings** | Switch the interface to English or Simplified Chinese. Choose an answer language independently. Notes, task titles, citations and past conversations retain their original wording. |

The built-in space is **My Documents**. Existing custom space names are preserved. Chat, embedding, reranking and Brave credentials are stored in the current user’s Inkstone settings on the Mac. For an upgrade, import an existing key individually from the old Keychain entry or enter it directly in that service’s settings. [Storage location and permissions](USER-MANUAL.en.md#ask-about-sources)

## What was checked

- **Build 10207.** All 424 frontend tests and the offline Worker check passed. Production frontend checks exercised chart, table and source switching, edits and SVG/PNG output in light mode, dark mode and narrow split view. The installed macOS app opened the existing sample note and switched between its column chart and data table.
- **Earlier integration checks.** Build 10203 passed 412 frontend and 340 Rust tests. A separate native macOS profile exercised creating a task, navigating back to its Markdown note from the calendar, checking it off and reopening it. Browser fixtures exercised chat-to-task capture and distinct due dates and scheduled time slots.
- **Document questions.** The frozen RC.4 offline benchmark contained 40 scored turns with 53 answerable points. The final answer context contained evidence for 21 of those points, up from 15 with RC.4. Only two of 13 follow-up points reached the final context. These counts measure passage coverage. Final-answer accuracy and independent blind grading for this beta are still open. The first beta’s live answer evaluation stopped at credential access, before sending a model request. [Benchmark and reproduction steps (Chinese)](../evals/v1.0/rc5/README.md)

## Distribution

The prerelease provides source for Apple Silicon Macs running macOS 13 or later. Local builds use ad hoc signing. Developer ID signing, Apple notarization and clean-Mac installation acceptance are pending for binary distribution. To report a problem, include your macOS version, the release tag, steps and a small fictional note. [Build instructions](QUICKSTART.en.md) · [Issue tracker](https://github.com/raistlinsha-plus/inkstone/issues)
