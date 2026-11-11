# Changelog

Entries describe implementation milestones. GitHub Releases is the record of public dates, tags and assets. The first public source preview was v0.6.6. [Public release history](https://github.com/raistlinsha-plus/inkstone/releases) · [v0.6.6 notes](docs/PUBLIC-RELEASE-v0.6.6.md)

## v0.8.1 · 问答工作台

- 左侧导航随工作区切换会话列表与空间文档。
- 区分当轮资料、网页搜索设置和实际引用。支持在问答与原文之间往返，并恢复原会话。[交付说明](docs/DELIVERY-v0.8.1.md)

## v0.8.0 · 问答与 Wiki 发布收口

- 统一版本号与升级说明。独立问答在缺证时引导补充资料或检查索引，网页禁用提示区分公开搜索和模型服务。
- 整理正式发布前的真实服务、独立评测、原生无障碍、升级回退和安装包验收条件。[交付说明](docs/DELIVERY-v0.8.0.md)

## v0.8.0-rc.2 · 问答漏证与 Wiki 审阅

- 改进本地问答的原文证据选择。开发回归继续分别记录必需文档命中、片段覆盖与无答案题误入证。
- Wiki 审阅标出待核对的摘要结论，发布端复核引文，支持仅发布核验过的原文摘录。
- 区分上一次整理结果与当前待审数量。[候选交付和验收](docs/DELIVERY-v0.8.0-rc2.md)

## v0.8.0-rc.1 · 问答证据与 Wiki 整理

- 在有来源的回答中标记可识别的引用冲突和待核对结论。保留原文入口，复制与保存回答时附带核对状态。
- Wiki 修订记录所有模型输入。删除资料或撤回授权时清除关联派生内容。旧 Wiki 生成内容需重新整理，原始文档与授权范围保留。
- 压缩问答资料选择和来源面板，改善 Wiki 待审阅与资料覆盖反馈，保护新建会话时正在保存的草稿。
- 升级 SQLite 并加强备份校验。图表、日历和文档导出的目标位置由原生保存面板返回。
- 冻结已有检索门槛，并增加 64 道开发回归题。[候选交付与验证状态](docs/DELIVERY-v0.8.0-rc1.md)

## v0.7.8 · 墨团动效试点

- 墨团加入像素水墨形象、待机／陪读／里程碑表情和短动效，并随原有阶段装束变化。专注模式和减少动态设置采用静态呈现。
- 相识阶段新增纪念 CG，沿用原来的成长和解锁记录。[本版交付](docs/DELIVERY-v0.7.8.md) · [三版交付导航](docs/DELIVERY-INDEX-v0.7.8.md)

## v0.7.7 · 问答体验与首次使用

- 浏览空间时先核对可选文档，显式选择整个空间或具体文档。问答显示当前阶段，停止操作可防重复点击，重试保留下一问草稿。
- 首次使用可直达问答输入框。Wiki 提供范围、整理、审阅步骤与原文入口，发布后打开生效页面。[本版交付](docs/DELIVERY-v0.7.7.md)

## v0.7.6 · 原文证据选择

- 分别核验独立分问，明确按文档归因保留冲突来源。已发布 Wiki 的部分确切别名可定位有属性和值支撑的原文。
- 增加冻结预留题，分别记录候选和上下文覆盖，并检查过期、越界与无依据结果。[本版交付](docs/DELIVERY-v0.7.6.md)

## v0.7.5 · 联网诊断与检索基线

- 在自动联网设置中增加显式连接测试，区分搜索接口不可用、凭据或额度问题，以及搜索成功但网页正文不可读。测试使用固定公开查询，可在保存新密钥前运行。
- 问答区分搜索失败、没有返回候选和网页无法读取，查阅路径使用中文说明。
- 增加固定合成语料，在相同问题上比较本地关键词检索和 Wiki 辅助召回，分别记录原文覆盖、错误候选和检索耗时。
- [本版交付与验收边界](docs/DELIVERY-v0.7.5.md)。

## v0.7.4 · 本机可靠性更新

- 随问答草稿保存资料范围、分支位置和本轮网页搜索限制。提交成功后为下一轮重新选择范围，重新生成继续使用原轮次的权限和资料。
- 区分翻译、改写等文本处理和时效核查。保留自动联网模式，新增「本轮不搜索网页」，后端在联网规划前执行。
- 独立问答引用按保存时的原文哈希和行号定位。Wiki 引用绑定已显示版本。
- Wiki 支持拒绝后在相同资料范围重新生成，处理原文空行引用。永久删除文档时清理相关 Wiki 派生内容。
- [本版交付与验收边界](docs/DELIVERY-v0.7.4.md)。

## v0.7.3 · 通用问答源码预览

- 新增独立 AI 问答工作台。支持直接聊天、写作、翻译和解释，独立会话与文档空间会话分开保留。
- 每轮可选一个受管理空间、其中最多 5 篇文档，以及最多 5 份 UTF-8 TXT、Markdown、JSON 或 MMD 附件。附件是本机会话副本，单文件上限 2 MiB。
- 合并可用的本地与公开网页证据，显示查阅路径、来源和未读范围。来源选择随本轮保存，问答内容通过明确操作保存为文档。
- 会话库 schema 3 增加附件与每轮来源选择，备份验证覆盖新旧会话格式。[本版交付](docs/DELIVERY-v0.7.3.md)

## v0.7.2 · 知识 Wiki 与自动联网源码预览

- 在受管理空间明确授权可用文档，建立带原文定位的知识 Wiki。提供范围、增量整理、草稿审阅和版本恢复；启用自动维护后只自动发布符合规则的常规整理。
- 将 Wiki 主题和章节用于原文召回，与本地 BM25、可选向量融合。保留候选重排与原文证据核验的独立门槛。
- 新增可关闭的 Brave Search BYOK。启用后模型按当前问题提出查询，应用校验查询及网页访问范围。回答可引用已读取的公开正文，历史保留网页出处元数据。真实 Brave 帐号端到端调用未验收。
- 备份可纳入 Wiki 页面、来源和审阅记录。[本版交付](docs/DELIVERY-v0.7.2.md)

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
