# Run Inkstone v1.2.0-beta.1 from source

The source preview targets Apple Silicon Macs with macOS 13 or later. The interface supports English and Simplified Chinese. To change it after launch, open **Models and settings → Language / 语言**. [简体中文](QUICKSTART.md) · [Desktop guide](USER-MANUAL.en.md) · [Release notes](DELIVERY-v1.2.0-beta.1.en.md)

## Launch the app

Install Xcode Command Line Tools, Node 24.14.0, npm 11.9.0 and Rust 1.99.1. The initial installation downloads dependencies. [Pinned toolchain](../toolchain.json)

```sh
git clone --branch v1.2.0-beta.1 https://github.com/raistlinsha-plus/inkstone.git
cd inkstone
npm ci --registry=https://registry.npmjs.org
npm run desktop
```

Leave the command running while you try Inkstone. For a standalone local build, run `npm run bundle`. The app is created at `src-tauri/target/release/bundle/macos/Inkstone.app` using local ad hoc signing. The GitHub prerelease provides source code. Developer ID signing and Apple notarization are pending. [GitHub release](https://github.com/raistlinsha-plus/inkstone/releases/tag/v1.2.0-beta.1)

## Try it without a model key

1. Open **My documents → From sources to your first answer → Try the example**. This opens a separate example space. Try searching for `阅读活动` (reading activity) in the Chinese sample notes. Open a result to read the passage.
2. Under **Offline chat walkthrough**, choose **Try sample chat**, open a citation and save the sample answer. This walkthrough uses a prepared answer.
3. Switch back to your own space. Select **Import documents** to copy a note into that space. Use **Editor** and **Source** to read or change the copy, then press ⌘S. The [chart sample](../examples/v0.6.6/首发体验.md) includes a column chart. Hover over it or Tab to the toolbar to compare the **Chart** and **Table** views.

## Ask your own question

1. Open a note and choose **Ask about this document**. In **Models and settings**, configure the chat service’s address, model and API key. Test and save it, then return to the question. The key is stored in Inkstone’s private local settings.
2. To compare more than one note, use **AI chat → Add sources**. For example, import the [activity plan](../examples/v0.7.3/阅读活动计划.md) and [retrospective](../examples/v0.7.3/阅读活动复盘.md). Select both, then ask “How many sessions were planned, how many took place, and was satisfaction measured?”
3. Open both citations. The sample plan specifies four sessions and the retrospective records two completed. Satisfaction is unreported. Use **Save as document** to keep your answer, or return to the source note and carry on writing.

Keyword search runs locally. A real answer sends the question, relevant context and selected excerpts to your configured chat provider. Embeddings, reranking and Brave Search can be configured separately.

## Next steps

- **Schedule work.** Open **Tasks → Today**, enter a title and press Enter. Open the new task and schedule a time slot. Inspect the block in **Calendar**, then open its source note.
- **Compile a Wiki.** Open **Knowledge Wiki → Sources**, choose the allowed notes, save the scope, then choose **Compile selected sources**. The selected source text goes to the configured chat model. Inspect citations before publishing.
- **Read with a companion.** Open **Study companion**, choose a character and show the desk pet. Confirm an experience after saving a note to begin the character’s journal.
- **Verify a backup.** Open **Backup and restore rehearsal** in the space home, create and verify the archive, then restore a rehearsal copy to an empty destination.

For a reproducible issue, include the tag, macOS version, chip, steps and a small fictional sample. [Known limitations](KNOWN-LIMITATIONS.md) · [Issue tracker](https://github.com/raistlinsha-plus/inkstone/issues)
