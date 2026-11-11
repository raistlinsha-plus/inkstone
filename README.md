# Inkstone · 砚台

**Write locally. Build a Wiki from your notes. Check the sources.**

A Markdown workspace for **macOS 13+ on Apple Silicon** with a source-linked Wiki and a standalone AI chat workspace. Bring your own compatible model API. Keep an optional ink companion beside your work.

[中文](docs/README.zh-CN.md) · [Start from source](docs/QUICKSTART.md) · [Roadmap](docs/ROADMAP.md) · [Releases](https://github.com/raistlinsha-plus/inkstone/releases) · [Feedback](https://github.com/raistlinsha-plus/inkstone/issues)

**Current development version v0.8.3.** This branch includes the redesigned question workbench, document and Wiki refinements, and the optional in-app companion workspace. The current public source preview is v0.8.0-rc.2. [Current delivery notes](docs/DELIVERY-v0.8.3.md) · [Published versions](https://github.com/raistlinsha-plus/inkstone/releases)

![Inkstone cited conversation using fictional reading-activity data](docs/assets/launch-v0.7/02-conversation.png)

*Earlier v0.7 interface with fictional documents and simulated model responses. The screenshot shows the citation workflow.*

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
npm ci --registry=https://registry.npmjs.org
npm run desktop
```

Start with two fictional reading-plan notes. Ask how many events were planned and completed, check the two original passages, then ask whether satisfaction was measured. The first build downloads dependencies and compiles locally. [v0.7.3 walkthrough](examples/v0.7.3/README.md) · [Quickstart](docs/QUICKSTART.md)

Editing and keyword search work without model credentials. Configure a compatible model API for answers, Wiki organization or vectors. Optional reranking uses a separately configured Cohere-compatible endpoint, and optional web search uses your Brave Search API key.

Build an independent local app with `npm run bundle`. Use `/Applications/Inkstone.app` as the single daily installation and keep temporary build/test bundles separate. This is a locally ad-hoc signed build, not a notarized public installer. It runs without Node or a development server after building. [Installation/data boundaries](docs/LOCAL-INSTALLATION.md).

## Local data, explicit model requests

Documents, indexes, conversations, Wiki state and companion state are stored on your Mac. Model operations send the applicable question, selected content or evidence to **the provider you configure**, which may charge usage fees. With web search enabled, the model plans from the current question and Brave receives a validated public query. Web citations retain source metadata so you can open the current page. Keys use macOS Keychain. [Security policy](SECURITY.md) · [Search boundaries](docs/DELIVERY-v0.7.2.md)

## Candidate status

Live Brave Search account verification, externally reviewed answer quality, native accessibility and cross-machine installation remain separate gates. Standalone chat supports TXT, Markdown, JSON and MMD attachments. PDF/OCR, cloud collaboration, multi-space selection in one turn and a floating desktop pet remain future scope. [Offline retrieval comparison](evals/v0.7.5/README.md) · [Known limitations](docs/KNOWN-LIMITATIONS.md)

Want to help? Try a workflow, report a small fictional reproduction, or independently review a retrieval case. [Contributing](CONTRIBUTING.md) · [Architecture](docs/ARCHITECTURE-v0.7.md) · [Technology](docs/TECH-STACK-v0.7.md). If this direction is useful to you, a star helps others find it.

## License

Inkstone source is **Apache-2.0**. Dependencies retain their licenses, including some unmodified MPL-2.0 packages; see `LICENSE`, `NOTICE`, `THIRD_PARTY_NOTICES.md` and `licenses/`. Twenty acquired packages still lack standalone local notice text, so binary redistribution review is incomplete. Artwork provenance and candidate status are recorded under `src/companion/assets/`.
