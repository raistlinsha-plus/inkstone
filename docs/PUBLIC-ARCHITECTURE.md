# Architecture and technology

Version 0.6.6. Inkstone is a local desktop application; it has no required hosted document server, account service or bundled model weights.

| Layer | Components and responsibility |
| --- | --- |
| Desktop shell | Tauri 2, system macOS WebKit, native file dialogs and Keychain boundary |
| Frontend | React 19 / TypeScript; app composition and typed IPC, document session, source/visual editor and worker-based parsing |
| Editing and presentation | CodeMirror 6, Milkdown 7; shared Markdown content contracts; JSON trees, Mermaid, Markmap, FullCalendar and constrained ECharts |
| Local backend | Rust: safe file writes, stable document/space identity, source updates, history, backups, indexing and remote provider calls |
| Storage | UTF-8 document files/images/history plus SQLite catalog and index; FTS5, jieba tokenization and sqlite-vec |
| Models | User-configured OpenAI-compatible embedding/chat and Cohere-compatible reranking over HTTPS; loopback HTTP allowed |

A **space** is the main product unit. It can hold managed copies imported from several folders. A directory is a source or advanced direct-edit mode. The retrieval index is rebuildable derived data, not a second document truth.

```mermaid
flowchart TB
  UI[React workspace and editor] --> IPC[Typed Tauri IPC]
  IPC --> DOC[Documents and spaces]
  DOC --> FILE[UTF-8 text, images and history]
  DOC --> CAT[SQLite catalog]
  IPC --> RAG[Retrieval and answer orchestration]
  RAG --> IDX[FTS5 and sqlite-vec index]
  RAG --> GATE[Scope, hash and lexical evidence checks]
  GATE --> CTX[Complete source context budget]
  CTX --> API[User-configured model API]
  API --> OUT[Markdown and chart validation]
  OUT --> UI
```

Retrieval combines BM25 and vectors using RRF, then optionally reranks candidates. Relevance cannot grant evidence eligibility. Explicit comparisons can scope each source to its own document name while still requiring the common requested attributes, numeric constraints and the original two-thirds coverage threshold. Heading-only snippets are excluded. Before generation, source identity, scope and current file hashes are checked again. This remains conservative lexical support, not a semantic entailment guarantee.

`src/shell` owns display components; `src/platform` owns IPC and optional layout preferences. `src-tauri/src/evidence.rs` owns lexical evidence decisions; `retrieval.rs` owns shared query/ranking/context behavior. Documents remain governed by existing session, conflict, save and recovery rules. v0.6.6 adds no catalog/index schema migration (schema 3 remains).

Renderer frames and chart formats are constrained rather than arbitrary executable document code. Untrusted text and model output never authorize filesystem or external actions. See [security](../SECURITY.md) and [limits](KNOWN-LIMITATIONS.md).

Default verification runs local synthetic tests, types, worker checks, builds and document checks. `desktop-e2e` is a separate test identity with system credentials disabled and only loopback model stubs permitted; production builds exclude that feature. Real service evaluations are opt-in, bounded and recorded separately. `toolchain.json` and lockfiles define verified versions.

The v0.7 companion prototype is separate from the production architecture. A future companion store must not become a second writable document state or alter factual evidence rules.
