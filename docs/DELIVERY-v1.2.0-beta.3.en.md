# Inkstone v1.2.0-beta.3 · Spaces, photos and editable mind maps

[简体中文](DELIVERY-v1.2.0-beta.3.md) · **English** · [Build from source](QUICKSTART.en.md)

This source prerelease corresponds to macOS build **10218**. Keep a project's photos and notes in folders, find an image by the words in it, or plan the next activity on a mind map.

**Try the reading night map.** Import the example, double-click a topic to rename it, then drag a branch into empty space. Drop it on another topic to change its parent. The theme and your placements travel with the file. Choose **Auto layout** to reset those placements. [Sample map](assets/v1.2.0-beta.3/en/reading-night.mmd) · [Canvas screenshot](assets/v1.2.0-beta.3/en/mind-map.png)

## Changes since the previous public beta

| Workspace | What you can do |
| --- | --- |
| Spaces | Open **My spaces** to find or rename a space. Browse one folder at a time, create a note or import a file into that folder, and use the breadcrumb to go back. |
| Images | Open HEIC, HEIF, JPEG, PNG, WebP and GIF files. Step through the images in a space by name, zoom in or export an original. macOS extracts text locally. You can send an image preview and a question to your configured vision model, review its response, then save a description for search and Q&A. |
| Mind maps | Edit a standalone Markdown map or a supported Mermaid mind map on the canvas. Double-click to rename, use Tab for a child or Enter for a sibling. Fold a branch, drag it into place, pick a theme or export SVG. Complex Mermaid diagrams retain their source and split views. |
| Tasks, calendar and navigation | Save an action from a conversation to a note, schedule it, and jump back to its source line from Calendar. The sidebar keeps its icons in place when you switch between documents, tasks and calendar. |

## Verification

All 483 frontend tests passed for build 10218. On macOS, trusted mouse events in WKWebView verified theme selection, branch dragging and reopening a saved map. The navigation icons stayed in the same positions across 16 tested states.

Image navigation, submitting a preview, saving and retrying were exercised with synthetic images and controlled model replies. Native tests covered HEIC/HEIF decoding, OCR, original export and keyword search for a saved description. Real-provider comparisons, further input-method coverage and manual VoiceOver testing remain on the roadmap.

The source release targets Apple Silicon Macs with macOS 13 or later. Developer ID signing, notarization and clean-Mac acceptance are still open for a public installer. [User manual](USER-MANUAL.en.md) · [Known limitations](KNOWN-LIMITATIONS.md) · [Roadmap](ROADMAP.md)
