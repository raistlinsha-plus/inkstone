# How Inkstone works · v1.0.0-rc.4

Inkstone runs as a Tauri desktop app on Apple Silicon Macs. A **space** groups managed copies of documents imported from one or more folders. The Markdown and text files remain readable outside the app. SQLite holds the catalog, search index and feature-specific stores. Users can write, search by keyword, read published Wiki pages and use their study companion locally. They can configure providers for model-assisted tasks.

[中文 4A 架构](ARCHITECTURE-4A.md) · [技术栈与锁定版本](TECH-STACK.md)

## Following a document through the app

| What the user does | What happens |
| --- | --- |
| Imports or edits a document | The Rust document library gives managed files stable identities and tracks their sources. The React workspace offers CodeMirror and Milkdown views of the same Markdown. Changes made in the calendar write back to the owning document. |
| Asks about a document or space | Within the selected scope, the backend combines keyword and optional vector ranks using reciprocal rank fusion. Published Wiki topics can point to original passages. An optional reranker reorders candidates. RC.4 checks evidence for individual parts of a question. If the user enables model-assisted quotation checks, Rust verifies returned text against current sources within the selected scope. |
| Lets another tool search a space | The desktop app grants a revocable read-only connection. The local CLI searches the existing keyword index and rechecks the grant, document version and line range when reading a reference. [CLI protocol and examples](EXTERNAL-TOOLS.zh-CN.md) |
| Opens a citation | The answer retains the source snapshot used for that turn. The reader can inspect the excerpt and, where available, open the current document. Changed sources are flagged. Generated answers still need review against the original text. |
| Maintains a Wiki | Compilation reads documents explicitly authorized in one managed space. Review compares a proposed change with its baseline and shows claims alongside source lines. Publication and later retrieval recheck source authorization and version. A reviewer can publish verified excerpts alone or preview which dependent records and historical versions will be removed before withdrawing a source. |
| Records a milestone at the page edge | A successful changed-document save provides a short-lived receipt. The user previews a card and expressly confirms before a deduplicated experience is recorded. All three characters can respond to document Q&A activity with local animation. Motion and story progress require no model call. |

The standalone assistant also supports general questions, selected documents in one space and per-turn text attachments. With automatic web search configured and permitted for a turn, a planner examines the current question. Brave supplies discovery results. Only excerpts from retrieved public pages can enter the web evidence budget. Local hits and web candidates use separate ranking paths. [Answer runtime](../src-tauri/src/assistant_runtime.rs) · [Retrieval](../src-tauri/src/retrieval.rs) · [Wiki](../src-tauri/src/wiki.rs)

## Components and data ownership

| Component | Implementation and state |
| --- | --- |
| Desktop and editing | Tauri 2 and macOS WebKit host React 19 and TypeScript. Shared Markdown handling feeds structured blocks for JSON, Mermaid, mind maps, calendars and constrained ECharts charts. |
| Documents and derived data | The catalog uses schema 4. The index uses schema 3 with SQLite FTS5, jieba tokenization and sqlite-vec. Calendar schema 1 caches events from document content. |
| Assistant and Wiki | Assistant schema 4 persists conversations, candidates, attachments and source snapshots. Wiki schema 2 persists authorization, proposals, page versions and evidence. |
| Companion | Companion schema 1 stores story progress, confirmed experiences and pending confirmations. WebView layout preferences store the pet’s dock edge and relative height. Compact editor panes display a bookmark. [Placement](../src/companion/petPlacement.ts) · [Experience handling](../src-tauri/src/companion/mod.rs) |
| Backup and credentials | Portable backups snapshot the catalog and present auxiliary stores. Archives with a Wiki store use format 3, other new archives use format 2. Restore previews use a new directory. Provider credentials remain in macOS Keychain. [Backup implementation](../src-tauri/src/maintenance.rs) |

Embedding and chat use user-configured OpenAI-compatible services. Optional reranking uses a Cohere-compatible endpoint. API use can send queries, selected passages or authorized Wiki inputs to the configured provider. Source files, answer history, Wiki versions and the companion ledger stay under local application ownership. Feature limits, validation and distribution status are documented separately. [Known limitations](KNOWN-LIMITATIONS.md) · [Paired Q&A evaluation](../evals/v1.0/rc4/README.md) · [macOS distribution](MACOS_RELEASE.md) · [RC.4 delivery](DELIVERY-v1.0.0-rc.4.md)
