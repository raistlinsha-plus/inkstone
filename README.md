# Inkstone · 砚台

[简体中文](docs/README.zh-CN.md) · **English**

Inkstone is a local Markdown workspace for **macOS 13 or later on Apple Silicon**. Ask a question about your notes, open the cited lines, and turn an action from the conversation into a task in the original project. Schedule the work in Calendar and return to the same Markdown line when you are ready to write.

[**Try the browser demo**](https://raistlinsha-plus.github.io/inkstone/?lang=en) · [Try the same note on your Mac](examples/quick-tour/README.md) · [Get the beta source](https://github.com/raistlinsha-plus/inkstone/releases/tag/v1.2.0-beta.1)

Two reading events, one question: which drew more people? Open the citation, check the figures, then turn the follow-up into a scheduled task. The browser demo uses a fictional note and preset answers. You can try it without installing Inkstone or entering a model key.

![A Markdown note with an embedded data chart in the English editor](docs/assets/v1.2.0-beta.1/en/workspace.png)

The screenshots show a fictional project in **v1.2.0-beta.1**. Hover over a chart or use Tab to reveal its controls. Switch to the data table to check the numbers or export the figure as SVG or PNG.

## Work with your notes

| When you want to… | In Inkstone |
| --- | --- |
| Write or collect material | Import copies of Markdown, TXT, JSON or Mermaid files into a space. Edit Markdown visually or alongside its source, including tables, diagrams, mind maps and charts. |
| Check a claim | Choose **Ask about this document**. Follow each citation back to the passage and inspect which sources the answer used. Standalone **AI chat** can also work with files selected for a single turn. |
| Follow up on an answer | Turn a passage into a task, review its wording and select the destination note. In **Tasks**, add a due date or schedule time to work. In **Calendar**, drag the work session to reschedule it or open the source line. |
| Maintain a project Wiki | Select the notes a Wiki may use, review proposed changes against the excerpts, and publish a topic or just its verified excerpts. Revisit the sources when they change. |
| Read with a companion | Choose an optional pixel-art character for the page margin. Confirm completed work to unlock story chapters and illustrations, or enable focus mode for quiet writing. |

[See the task list](docs/assets/v1.2.0-beta.1/en/tasks.png) · [See the calendar](docs/assets/v1.2.0-beta.1/en/calendar.png) · [Product tour](docs/PRODUCT.en.md)

## Try it from source

This beta is distributed as source. On an Apple Silicon Mac, install Apple's command-line developer tools, Node **24.14.0**, npm **11.9.0** and Rust **1.99.1**. [Pinned toolchain](toolchain.json)

```sh
git clone --branch v1.2.0-beta.1 https://github.com/raistlinsha-plus/inkstone.git
cd inkstone
npm ci --registry=https://registry.npmjs.org
npm run desktop
```

1. Open **My documents**. Try **From sources to your first answer → Try the example** to search local text without a model key.
2. To use AI, add your compatible chat provider in **Models and settings**. Import a plan and its follow-up, ask what changed, and open a citation to check the answer. You can set the interface to English or Simplified Chinese and choose the answer language separately.
3. Run `npm run bundle` to build a standalone app for your Mac. This local build uses an ad hoc signature. Before replacing an existing installation, back up and verify your spaces. [Backup and recovery](docs/USER-MANUAL.en.md#back-up-and-recover)

## Your files and your models

Editing, task tracking, keyword search and companion stories work offline. Inkstone keeps documents, conversations, indexes and Wiki state on your Mac. Model-backed Q&A, Wiki compilation, embeddings and reranking send the relevant question or material to the services you configure. Optional Brave Search receives a public search query when enabled. Provider charges depend on your account.

Provider keys live in an owner-only local preferences file. Portable backups omit the keys. Older installations can import individual service keys from Keychain in Settings. To let a terminal or external AI tool search your notes, grant read-only access to a specific space. [Security policy](SECURITY.md) · [CLI guide](docs/EXTERNAL-TOOLS.en.md)

## Documentation and feedback

| | English | 简体中文 |
| --- | --- | --- |
| First steps | [Quickstart](docs/QUICKSTART.en.md) | [快速开始](docs/QUICKSTART.md) |
| Daily use | [User manual](docs/USER-MANUAL.en.md) | [操作手册](docs/USER-MANUAL.zh-CN.md) |
| Features | [Product tour](docs/PRODUCT.en.md) | [产品介绍](docs/PRODUCT.md) |
| Beta changes and evaluation | [Release notes](docs/DELIVERY-v1.2.0-beta.1.en.md) | [交付与验证](docs/DELIVERY-v1.2.0-beta.1.md) |
| Future work | [Roadmap](docs/ROADMAP.md) | [路线图](docs/ROADMAP.zh-CN.md) |

[Architecture](docs/PUBLIC-ARCHITECTURE.md) · [Known limitations](docs/KNOWN-LIMITATIONS.md) · [Share feedback on the walkthrough](https://github.com/raistlinsha-plus/inkstone/discussions/11) · [Report an issue](https://github.com/raistlinsha-plus/inkstone/issues) · [Contributing](CONTRIBUTING.md)

## License

Inkstone source is licensed under **Apache-2.0**. Dependencies retain their own licenses. [License](LICENSE) · [Third-party notices](THIRD_PARTY_NOTICES.md) · [Artwork credits](src/companion/assets/README.md)
