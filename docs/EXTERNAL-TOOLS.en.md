# Search Inkstone notes from a local AI tool

The v1.2.0-beta.1 source includes `inkstone-cli`. A terminal or local assistant can use it to search one space’s keyword index and read passages with their document version and line numbers. Queries work with the desktop app closed once the space has a ready index and an active connection. [简体中文](EXTERNAL-TOOLS.zh-CN.md) · [Desktop guide](USER-MANUAL.en.md)

## Connect a tool to one space

1. [Build and launch Inkstone](QUICKSTART.en.md) on your Mac. Import a note into the intended space. In the desktop app, try keyword search and open a result to confirm the note is indexed.
2. Open **Models and settings → External tools**. Name your tool, select its space and choose **Create read-only connection**. The grant covers current and future indexed documents in that space. To share a smaller collection, give the tool a dedicated space.
3. Copy the connection credential when shown. Give the calling tool the credential in the environment variable `INKSTONE_CLI_TOKEN`. In macOS zsh, these prompts keep the credential out of command history. The second prompt takes the space ID displayed in settings.

```zsh
read -rs 'INKSTONE_CLI_TOKEN?Connection credential: '
export INKSTONE_CLI_TOKEN
read -r 'SPACE_ID?Space ID: '
```

4. In the repository root, build the CLI and search. Replace the example query with words from an indexed note in your space.

```sh
cargo build --locked --release --manifest-path src-tauri/Cargo.toml -p inkstone-cli
src-tauri/target/release/inkstone-cli search --space "$SPACE_ID" --query 'reading activity' --json
```

5. Pick a hit from `result.results`. Copy its `ref` value into the prompt below and read the source before using it in an answer. The CLI checks the connection and the current version each time. If the document changed, search again for a current reference.

```zsh
read -r 'REF_ID?ref from search result: '
src-tauri/target/release/inkstone-cli read --space "$SPACE_ID" --ref "$REF_ID" --json
```

## Read the JSON result

A successful command exits with status 0 and writes one JSON object to standard output. The envelope includes `protocolVersion: 1`, the space ID and a `result` object. Search uses `bm25` and returns up to 12 hits. Each has a title, document ID, version, start and end lines, source text, an evidence flag and a reference. Each excerpt contains up to 40 lines and 2,400 characters. Check `truncated` when quoting a long passage.

| Search status | How to use it |
| --- | --- |
| `ok` | Inspect passages marked `evidence: true` and confirm that the wording supports your answer. |
| `candidates_only` | The passages are leads. Try a more specific term or inspect the note before citing a claim. |
| `no_results` | Check the space, the note’s index status and the query wording. |

A failure exits with status 1 and writes JSON with `protocolVersion` and `error` to standard error. For `denied`, check the connection credential, space and revocation status. For `stale_reference`, search again. For `reference_unavailable`, check that the note is still available in the authorized space. For `index_not_ready` or `upgrade_required`, reopen Inkstone and prepare or update the index. For `temporarily_busy`, retry after the current operation finishes.

## Permissions and revocation

The CLI reads the existing local keyword index and managed documents. SQLite may create auxiliary files for concurrent access. Embeddings, reranking, chat, web search and Wiki generation are available in the desktop app. A CLI connection credential is separate from model API keys.

Revoke a connection in **External tools** to end future reads with that credential. Handle any passages already copied into the calling tool according to that tool’s settings, including whether it sends them to a model provider. If you move to a new Mac using a portable space backup, create a new connection there.
