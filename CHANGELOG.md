# Changelog

Historical versions below describe local development deliveries, not earlier public GitHub releases. v0.6.6 is the first public source preview. See [release notes](docs/PUBLIC-RELEASE-v0.6.6.md).

## v0.7.1 · 2026-11-07 · 本机交付

- 新增可操作的首次使用引导，连接复制导入、本地索引、聊天模型、首问、来源核对和回答保存。
- 问答独立管理空间与全局的受控表达偏好，支持启停、删除、本轮停用及显式迁移旧偏好。
- 可预览并选取一条历史用户问题作为本轮背景。在模型调用前验证空间、文档范围、活动分支和摘要。回答保留轻量的本轮上下文记录。
- 同伴可选显示当前空间和角色近 30 天的已确认经历，手札支持角色、日期筛选和来源状态。会话库升级到 schema 2，兼容旧备份。
- [本机交付与回归记录](docs/DELIVERY-v0.7.1.md)。

## v0.7.0-rc.5 · 2026-11-07 · Local stability candidate

- Save the next question to its conversation while the current answer generates. Restore saved drafts after interruption and keep unsent text when regenerating an existing answer.
- Honor stop requests received while saving the submitted question, before starting the model request.
- Move document save and recovery draft handling into a dedicated hook. Keep the existing editor and workspace interfaces.
- Use a documentation check for eligible PRs. Run complete macOS verification on main, and reuse Cargo caches saved from main. See the [candidate delivery record](docs/DELIVERY-v0.7-rc5.md).
- Update zstd to 0.13.4 and zstd-safe to 7.4.0. Add version-pinned license texts for sqlite-vec, jieba-macros and the Apple Silicon Rolldown binding.

## v0.7.0-rc.4 · 2026-11-07 · Stable-scope candidate

- Prepare the next source-preview update: bilingual task-focused README, fictional Quickstart examples, fresh synthetic UI media, release/PR copy and a discoverability plan. Replace the credential test’s timing assumption with explicit worker completion and control the history-search test’s debounce clock while preserving its 200-row pagination/archive assertions; expand current public-doc checks and correct release-manifest catalog metadata to schema4. [Readiness review](docs/GITHUB-READINESS-v0.7.md). No remote publication in this preparation.

- Local deployment maintenance: consolidate daily launch at `/Applications/Inkstone.app`, unregister/remove duplicate application bundles and historical generated caches while retaining source and data backups. [Installation and cleanup record](docs/LOCAL-INSTALLATION.md). Application version unchanged.

- Default to stable natural-name document ordering, with an explicit Recent view, pinned groups, per-space durable preferences and list scroll anchors. Reading no longer influences equal-timestamp ordering.
- Add read-only trash details, explicit restore, and single-document permanent deletion with preview/confirmation, durable staging, rollback before commitment, resumable cleanup and source invalidation. External originals, prior conversations, confirmed experience text and user backups remain separate.
- Migrate the catalog to schema4 with a consistent pre-migration catalog snapshot; retain index schema3 and backup format2. Refuse backups of unfinished deletion state and reject late saves/drafts against unavailable managed documents.
- Align New/Import button icons and labels, refine Q&A scope/header density, keep compact companion actions accessible, and withdraw the ineffective nickname setting while preserving saved values.
- [Implementation, verification and release gates](docs/DELIVERY-v0.7-rc4.md). Not a stable GitHub release.

## v0.7.0-rc.3 · 2026-11-06 · Local candidate

- Narrow windows use a two-pane knowledge task layout and return to editing without overwriting pane preferences. Display the running version in the title bar.
- Compact bounded mindmap/Mermaid canvases with expansion, left-aligned JSON forms and consistent error spacing.
- Retain stopped nonempty responses as explicitly incomplete candidates after current-source checks; include them in validated snapshots.
- Export the current branch/selected answers or all branches/candidates explicitly; JSON remains a full export.
- Review and acceptance limits: [rc.3 delivery](docs/DELIVERY-v0.7-rc3.md), [review and stable-version decision](docs/REVIEW-v0.7-rc3.md).

## v0.7.0-rc.2 · 2026-11-05 · Local candidate

- Flush assistant drafts before navigation and exit; retain input until durable acceptance, preserve failed writes for retry, and serialize generation/draft revisions.
- Retain experience-card edits on save failure; query and paginate conversation history on the backend.
- Resolve explicitly named/fixed-document first questions before missing-context clarification while retaining evidence checks.
- Align title length and frozen-scope readiness; repair the official calendar example.
- [rc.2 implementation milestone](docs/DELIVERY-v0.7-rc2.md). No separate app bundle or GitHub release was created for this intermediate milestone.

## v0.7.0-rc.1 · 2026-11-05

生产候选新增独立持久会话、多轮追问、问题分支/候选、来源快照、草稿与历史管理，展开阅读与安全回答落地；当前追问属性独立门控，历史词项不稀释新缺项。三角色三阶段、九章、经历/偏好/数据控制与15张静态候选插画接入。备份format2纳入会话和角色库并兼容旧格式；catalog/index仍schema3。完整门槛前端260、Rust164/6忽略，三题真实服务冒烟2次HTTP200，五次隔离冷启动通过；本机界面补验因锁屏待完成，详见[候选交付](docs/DELIVERY-v0.7.md)。自然多日试用、动画/像素整理及正式发行门槛仍待后续。


## 0.6.6 · 2026-11-03

- Keep startup loading through workspace/list/session restoration; distinguish failure from an empty library, support retry, and remember pane visibility. Restore dialog trigger focus even when child inputs auto-focus.
- Patch pulldown-cmark 0.13.5 → 0.13.6 for RUSTSEC-2026-0433; the application does not enable the affected Wikilinks option.
- Check explicitly named comparisons per document and shared attribute; preserve lexical/numeric constraints and reject heading-only evidence.
- Freeze synthetic checks, preserve first citation/presentation failures and retests, and add cumulative paid-evaluation reservation and interruption protection.
- Add public Chinese/English guides, architecture summary, synthetic demos and source-release preparation. Supplement eight missing notices from immutable upstream sources; twenty standalone-text gaps remain.

## 0.6.5 · 2026-11-02

- Prevent rerank relevance from granting unsupported evidence eligibility; share ranking and whole-source context limits between application and evaluation.
- Preserve failed real-service evaluations and new-corpus limitations.
- Update ZIP to 9.0.5 and Vitest to 4.1.12; use official npm lockfile URLs. Prepare clean source export, CI and repository templates.

## 0.6.4 · 2026-11-02

- Refine editor toolbar, list alignment, selection round trips, component spacing and narrow dual-pane layout.
- Add IME event/229 protections and keyboard/menu focus regressions; native candidate testing remains separate.

## 0.6.3 · 2026-11-01

- Extract display, typed IPC and parser-worker boundaries. Add scoped/full verification distinction, checked cache reuse, timing and isolated desktop builds.

## 0.6.1–0.6.2 · 2026-10-31

- Add recovery diagnostics, cross-batch internal links and independent relinking, pins/type views, per-document index state, complete ZIP backup validation and restore preview.
- 0.6.1 fixes were incorporated into the 0.6.2 local delivery.

## 0.5.1–0.6.0 · 2026-10

- Make document spaces the managed collection unit; support imports from multiple folders, explicit source updates and conflict protection.
- Refine navigation, editor/structured content spacing and knowledge workflows. 0.5.1 was incorporated into 0.6.0.

## 0.5 · 2026-10

- Add Markdown-rich answers, constrained charts and answer-to-document workflows; improve shared content rendering.

## 0.4–0.4.1 · 2026-10

- Add document calendar content and hybrid BM25/vector retrieval with optional reranking; improve editor toolbar, blank-line round trips and mindmap typography.

## 0.2–0.3 · 2026-10

- Add source/visual Markdown editing and structured JSON/Mermaid/mindmap presentation, cursor insertion and copy import.

## 0.1 · 2026-10

- Establish the local macOS text/Markdown editor, local indexing/retrieval and user-configured compatible model APIs.
