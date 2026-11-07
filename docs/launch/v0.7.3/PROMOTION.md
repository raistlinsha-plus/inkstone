# Inkstone v0.7.2–v0.7.3 GitHub 推广方案

面向新一轮 **macOS 源码预览**。两版串成一次对外介绍，入口统一指向 Inkstone 仓库和已公开的最新预发布。以 v0.7.3 的问答工作台打开试用，以 v0.7.2 的 Wiki 原文和变更记录展示差异。社区活动在标签、匿名访问与试用指引核对后开始。本文是执行计划与文案草稿。

## 一句话定位

**在 Mac 上编辑本地 Markdown，把选定资料整理成有出处的 Wiki，在同一个问答工作台里提问、查看原文。**

| 优先受众 | 为什么会试 | 首次体验目标 |
| --- | --- | --- |
| 用 Mac 和 Markdown 管理资料的中文开发者、研究者 | 同一主题散在数份笔记中，更新后难以确定哪条结论仍有效 | 导入两份虚构笔记，打开一个 Wiki 主题，再核对原文 |
| 愿意配置自己的 API 的本地知识工具用户 | 想在一个输入框完成改写、临时查资料和带来源问答 | 先直接提问，再明确添加一份资料，核对回答范围 |
| RAG、Tauri 和本地工具贡献者 | 可以复现引用、索引更新和路由边界 | 提交一条包含输入、预期依据及实际表现的最小用例 |

自动联网作为进阶路径。用户先在设置里配置并授权 Brave Search，之后由模型按题判断是否检索公开网页。自带模型 API 与联网是两类设置。界面以中文为主，源码构建有工具链门槛。远程模型可能收到用户问题和选定资料，搜索提供商接收通过校验的公开查询，两者的费用分别以服务商为准。

## 让仓库承接流量

1. **首页三步。** 首屏保留一句话、当前源码预发布状态和一张真实界面图，下方依次给出「查看演示」「从源码试用」「反馈」。在第一屏写明 macOS 目标范围、中文界面和源码构建。中文版与英文版共用一条示例路径，链接指向本次标签对应的版本说明。现有入口包括 [仓库首页](../../../README.md)、[源码试用](../../QUICKSTART.md) 和 [贡献指南](../../../CONTRIBUTING.md)。
2. **一张图与一条可复现的演示。** 社交卡片用真实 UI 的「主题页 → 原文」路径，加一句副标题。仓库 About 可用 `Local Markdown workspace for macOS with source-linked Wikis and AI chat`，在已有标签基础上核对 `markdown`、`macos`、`local-first`、`rag`、`llm-wiki`、`tauri`。社交图建议 1280×640、低于 1 MB，由有权限的维护者在仓库设置中上传。[仓库 Topics](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/classifying-your-repository-with-topics) · [社交预览设置](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/customizing-your-repositorys-social-media-preview)
3. **唯一的试用任务。** 用两份随标签下载的虚构「社区阅读计划」资料，计划举办 4 场，实际完成 2 场，满意度未知。先导入和编辑 Markdown，再试关键词检索。配置模型后选入 Wiki，打开主题页和对应原文，再问「计划和实际各是多少？满意度有数据吗？」可以追加一段「先直接请助手改写一句通知，再加入纪要做对照」。网页路径单独演示，实际搜索验收通过且能打开公开出处后才进入主物料。[虚构样例和演示步骤](../../../examples/v0.7.3/README.md)
4. **反馈入口紧跟任务。** Issue 只需版本、macOS 和芯片、停在哪一步、最小虚构样例和预期依据。发帖时邀请反馈一个明确问题，例如「你能从主题页找到原文里‘目前已举办 2 场’那一句吗？」维护者先复现安装、隐私和引用问题，再整理界面建议。[问题模板](../../../.github/ISSUE_TEMPLATE/bug.yml)

演示视频可控制在 35–50 秒，带字幕并展示来源定位。合成资料、模拟回答或分步剪辑在相邻说明标注；版本、实际运行环境和验收范围以发布记录为准。当前宣传以源码试用为入口，签名公证包、跨机兼容、模型准确率或联网成功率等主张各自以对应证据为前提。同伴可在结尾作为可选产品特色。

## 14 天执行节奏

第 0 天从本机更新、文档同步和 GitHub 预发布验收都完成后开始。每轮社区扩散以维护者当天能回答反馈为前提。

| 时间 | 渠道与动作 | 当天要留下的结果 |
| --- | --- | --- |
| 第 0 天 | GitHub Releases、README、现有 Issues。匿名核对标签、截图和快速开始，记录曝光基线。 | 发布链接、对应提交、两条实测路径及受限功能清单 |
| 第 1–2 天 | 优先邀请 5–10 位已有交流、愿意源码构建的 Mac 用户。邀请正文只给一条任务，允许从编辑和关键词检索起步。 | 试用者卡点及最远完成步骤，明确允许后再引用其反馈 |
| 第 3–6 天 | 先修第一处高频阻碍，再在一个中文创作者社区发实测帖。候选为 V2EX「分享创造」，发前复核规则并预留当日回复时间。 | 一条可访问帖子、对应反馈 Issue、关键文档修订。[V2EX 分享创造](https://www.v2ex.com/go/create) |
| 第 7 天 | 拉取 Traffic 快照，按构建、模型配置、导入、Wiki 与引用分组。 | 两个优先修复项，每项有可核对的完成条件 |
| 第 8–10 天 | 用一次真实改进写技术短文，放在维护者自有博客或项目文档，附一个能复现的引用用例。看能否由英文读者按说明独立完成。 | 一篇能独立阅读的复盘和一条外部复现记录 |
| 第 11–14 天 | 在原帖或 GitHub 更新结果，复测高频卡点，决定下一轮推广范围。 | 14 天统计、已修问题与下一轮推广条件 |

英文社区先用英文 README 和自有渠道触达。Show HN 留到陌生用户能按说明试用且版本变化足够实质时，由项目作者亲自撰写和参与讨论。其现行规则要求作品可试用，普通升级通常不适合 Show HN，并明确禁止生成文案和动员投票或评论。[Show HN 指南](https://news.ycombinator.com/showhn.html) · [Hacker News 社区规则](https://news.ycombinator.com/newsguidelines.html)

## 自有渠道文案

**中文标题** · 我在 Mac 上把本地 Markdown 整成了可查原文的 Wiki

> 同一件事在几份笔记里分别写着计划和进展，下一次提问时，怎么快速知道答案依据的是哪一份？我做的 Inkstone 现在可以在 Mac 上选定本地 Markdown 资料做成 Wiki，从主题页打开原文，也能在单独的 AI 问答工作台直接提问或加一份资料。聊天用自己的兼容模型 API。可选网页搜索另需配置 Brave Search。当前是中文界面的源码预览。欢迎用虚构阅读计划走一遍，告诉我你在哪一步找到了依据，或者卡住了。

[Inkstone 仓库和试用入口](https://github.com/raistlinsha-plus/inkstone)

**英文短帖** · 用于自有博客或社交账号

> Inkstone is an open-source Markdown workspace for macOS. Build a Wiki from selected notes, open the source behind a claim, and ask follow-up questions in a separate AI chat workspace. Bring your own compatible model API. This is a source preview with a Chinese interface. Start with the fictional reading-plan example and tell us where the source-checking flow gets in your way.

[Inkstone source and quickstart](https://github.com/raistlinsha-plus/inkstone)

Star 提示只放在 GitHub README 的贡献入口之后，例如「如果你想关注后续更新，可以给 Inkstone 点一颗 Star。」试用、反馈和源码都对任何人开放。

## 复盘指标与决策

| 指标 | 怎样记录 | 怎样用 |
| --- | --- | --- |
| 被发现 | 第 0、7、14 天手工记录 GitHub 独立访客、完整克隆、引荐来源与净增 Stars。统一使用 Traffic 的 UTC 日期。 | 看哪个渠道带来访客，以及关注是否跟随改进。两周窗口会滚动；快照保留原日期范围。 |
| 首次可用 | 让自愿反馈的试用者在构建并启动、导入和搜索、连接模型、打开一条对应原文中标记完成的最远一步。分母用该期回报结果的尝试者，标明样本数。 | 目标为 5 次外部可核对的完整试用和 3 条可执行反馈。 |
| 问题质量 | 按源码构建、模型配置、资料范围、Wiki 更新、引用、联网分别统计去重 Issue。记录修复后是否经外部复测。 | 当两个独立试用者卡在同一步，把该步骤的修复和复测放在下一轮扩散之前。 |

GitHub 的访客、克隆、Stars 来自聚合统计，首次试用来自自愿回报，分别报告。当天可在仓库 **Insights → Traffic** 查看最近 14 天的数据，需要仓库写入权限。试用记录保留步骤与问题链接即可。[GitHub Traffic 说明](https://docs.github.com/en/repositories/viewing-activity-and-data-for-your-repository/viewing-traffic-to-a-repository)
