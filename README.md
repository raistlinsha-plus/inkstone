# Inkstone · 砚台

**Ask your notes. Open the source.**

Inkstone is a local-first Markdown workspace for **macOS 13+ on Apple Silicon**. Build a Wiki from selected notes, ask questions about those notes, and open the original passage behind a citation. Editing and keyword search work offline. AI features use a compatible model API you configure.

[Try the interactive demo](https://raistlinsha-plus.github.io/inkstone/) · [中文](docs/README.zh-CN.md) · [Build from source](#try-it-from-source) · [Preview feedback](https://github.com/raistlinsha-plus/inkstone/discussions/11) · [Roadmap](docs/ROADMAP.md)

The browser walkthrough uses fictional notes and simulated answers. Open a citation to check the original passage, then try the question the notes cannot answer.

**v0.9.0-beta.1 is a source preview with a Chinese interface.** The release includes a source archive and SHA-256 checksum. The notarized macOS app download is pending. [Release notes](docs/DELIVERY-v0.9.0-beta.1.md) · [Product brochure (Chinese PDF)](https://github.com/raistlinsha-plus/inkstone/releases/download/v0.9.0-beta.1/inkstone-v0.9.0-beta.1-brochure-zh-CN.pdf)

![Inkstone v0.9.0-beta.1 shows an answer beside a reference to its source](https://github.com/raistlinsha-plus/inkstone/releases/download/v0.9.0-beta.1/inkstone-social-preview.png)

*The example uses fictional notes and a simulated model response.*

## What makes Inkstone useful?

- **Documents you can keep.** Copy-import local Markdown/text, organize document spaces, preserve originals, and compare source updates explicitly. History, backups and recovery stay local.
- **Wikis with source links.** Select ready documents in one managed space, organize them into linked topics, and review changes or open the original lines. Local recall combines BM25, optional vectors and verified Wiki references. Reranking is optional.
- **Chat with the sources you choose.** Start directly, select one local space or attach a text file. The app can add public web evidence when you authorize Brave Search in settings. Inspect this turn’s sources, continue the conversation or save a useful answer as a document.
- **Rich content inside Markdown.** Edit JSON trees, Mermaid, mindmaps, calendars and constrained ECharts blocks in the document body, then switch back to source.
- **A quieter companion.** Optionally enable Motuan, Yanzhou or Zhiwei. Confirm real work milestones to unlock fixed stories and stage artwork. Motuan offers a gentle-motion pilot with a static option. Companions add no separate model call.

![Markdown document and an inline chart](docs/assets/launch-v0.7/01-editor.png)

## Watch the workflow

![Synthetic UI walkthrough: document, answer, source and missing-information follow-up](docs/assets/launch-v0.7/workflow.gif)

This earlier v0.7 walkthrough shows document import, scoped questions and source inspection using fictional data and fixture responses. [Larger MP4 and walkthrough notes](docs/launch/v0.7/README.md).

## Try it from source

You need Apple's command-line developer tools, Node **24.14.0**, npm **11.9.0**, and Rust **1.99.1**. See `toolchain.json`.

```sh
git clone --branch v0.9.0-beta.1 https://github.com/raistlinsha-plus/inkstone.git
cd inkstone
npm ci --registry=https://registry.npmjs.org
npm run desktop
```

The first build downloads dependencies and compiles locally. Start with one offline task.

1. In the document-space home, click **打开离线样例** (Open offline sample).
2. Search for **阅读活动** (reading events), then open a result to see the original Markdown.
3. If you have a compatible model API, try the two-note walkthrough. Ask how many events were planned and completed, then check whether the notes reported satisfaction.

[Two-note walkthrough](examples/v0.7.3/README.md) · [Detailed quickstart (Chinese)](docs/QUICKSTART.md)

Editing and keyword search work without model credentials. Configure a compatible model API for answers, Wiki organization or vectors. Optional reranking uses a separately configured Cohere-compatible endpoint, and optional web search uses your Brave Search API key.

Build a standalone, ad hoc signed local app with `npm run bundle`. Use `/Applications/Inkstone.app` as the single daily installation and keep build and test bundles separate. The built app runs without Node or a development server. [Local installation and data](docs/LOCAL-INSTALLATION.md) · [macOS release runbook](docs/MACOS_RELEASE.md)

## Local data, explicit model requests

Documents, indexes, conversations, Wiki state and companion state are stored on your Mac. Model operations send the applicable question, selected content or evidence to **the provider you configure**, which may charge usage fees. With web search enabled, the model plans from the current question and Brave receives a validated public query. Web citations retain source metadata so you can open the current page. Keys use macOS Keychain. [Security policy](SECURITY.md) · [Search boundaries](docs/DELIVERY-v0.7.2.md)

## Candidate status

Live Brave Search account verification, externally reviewed answer quality, native accessibility and installation on a clean Mac remain separate checks. Standalone chat supports TXT, Markdown, JSON and MMD attachments. PDF/OCR, cloud collaboration, multi-space selection in one turn and a floating desktop pet remain future scope. [Offline retrieval comparison](evals/v0.7.5/README.md) · [Known limitations](docs/KNOWN-LIMITATIONS.md)

Want to help? Try a workflow, report a small fictional reproduction, or independently review a retrieval case. [Contributing](CONTRIBUTING.md) · [Architecture](docs/ARCHITECTURE-v0.7.md) · [Technology](docs/TECH-STACK-v0.7.md). If this direction is useful to you, a star helps others find it.

## License

Inkstone source is **Apache-2.0**. Dependencies retain their licenses, including some unmodified MPL-2.0 packages. The current inventory includes 17 entries without a collected standalone license file. Review of the notices and provenance of components shipped in the binary is pending. See `LICENSE`, `NOTICE`, `THIRD_PARTY_NOTICES.md`, `licenses/` and artwork records under `src/companion/assets/`.
