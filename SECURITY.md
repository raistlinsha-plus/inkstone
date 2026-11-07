# Security policy

Inkstone is an experimental local application. Only the current source preview is maintained; there is no security SLA or supported production release line yet.

Do not post a working exploit containing credentials, personal documents or a real backup in a public issue. Once the repository is published, use its GitHub **Security → Report a vulnerability** channel when enabled. Until a private reporting channel is enabled, avoid sending sensitive exploit material through public issues. Repository owners should enable private vulnerability reporting and secret scanning before announcing the project.

Model requests use the endpoint configured by the user. Embedding sends selected text chunks; reranking sends the question and candidate snippets; generation sends the question and selected evidence. Local-only keyword retrieval makes no model request. Keys are stored through macOS Keychain and are not part of document backups. Untrusted documents and model output never authorize actions.

In v0.7, generation can also send up to six previous user questions (4,000 characters total) and enabled presentation preferences for the current scope. Old assistant answers, companion stories and experience cards are not factual retrieval evidence. Conversations, answer/source snapshots, drafts and companion state are local SQLite data; format 2 backups include these stores and therefore may contain private questions, quoted sources and confirmed experiences. Deletion in the current app does not delete earlier exported files or backups. The companion is opt-in and adds no separate model call.

The app constrains Markdown/structured blocks, renderer frames and chart data. Citation identifiers and numeric presence are checks, not proof of semantic truth. Review AI output before using it. Backups validate paths, hashes and database contents and restore to a new directory for preview.

Known dependency findings and the exact scope of checks are recorded in [the public readiness assessment](docs/GITHUB-READINESS-v0.7.md). Passing a scanner does not establish absence of vulnerabilities. Development servers listen on loopback; do not expose them to an untrusted network.
