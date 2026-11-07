# v0.7 传播方案与可发布文案

以下均为成稿或执行建议，尚未发布。建议先面向愿意构建应用的 macOS/Markdown/RAG 开发者，稳定安装包具备条件后再扩大到普通文档用户。当前最明显的试用门槛是本地工具链和首次编译；精美截图不能替代可运行的入门流程。

## 定位与素材组合

主叙事：**把资料留在本机，让问答回到来源。** 英文：**Write locally. Ask your notes. Check the sources.**

每次介绍只展示一条完整任务：导入虚构阅读计划 → 比较参与人数 → 打开来源 → 追问缺失的满意度。配一张问答截图和分步演示；把 JSON/图表作为写作能力，把墨团作为可选特色。长期成长、像素动画、通用准确率和安装便捷性均不扩大承诺。

仓库 About/Topics 选用元数据文件中的已实现主题。GitHub Topics 可以帮助用户按目的和主题发现仓库，最多 20 个；本方案使用 12 个相关主题，不堆竞品名称或无关热门标签。[GitHub Topics 说明](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/classifying-your-repository-with-topics)。

## 中文开发者社区成稿

**标题：我做了一个 Mac 本地 Markdown＋带来源问答工具，还放了一只可关闭的墨团**

最近把自己反复用到的几个步骤放进了一个开源工具：整理本地 Markdown、向自己的资料提问、核对引用，再把有用的回答保存为文档。

Inkstone 的文档空间可以复制导入电脑不同位置的资料，保留原件；正文能直接显示 JSON、Mermaid、脑图、日程和受约束的图表。问答支持持续会话、追问和不同回答候选，每轮保留自己的来源快照。缺少资料时应该说明不足，而不是用相关片段凑出结论。

这次 v0.7 源码预览还加入了可选书房同伴：墨团、砚舟和知微。确认工作经历后逐步开放固定故事与阶段形象；可随时关闭，不要求连续签到，也不会为陪伴额外调用模型。目前是静态候选插画。

演示中的阅读活动资料和回答都是合成样例，只展示界面流程，没有把它当作真实模型准确率。编辑和关键词检索不需要 API；向量、重排和问答使用你自己的兼容服务，可能产生服务商费用。文档在本机，模型请求会发送选定资料，不能理解为“AI 全离线”。

当前目标为 macOS 13+ Apple Silicon，界面为中文，需要从源码构建；还没有签名公证的一键安装包，原生输入法/无障碍和长期成长仍在继续验收。

仓库：https://github.com/raistlinsha-plus/inkstone

如果你也在用本地笔记管理知识，欢迎试试仓库里的虚构样例。最想收到的反馈是：第一次导入、配置模型或核对来源时，哪里最费解？愿意的话也欢迎点一个 Star，帮助更多有相同需求的人发现。

## 英文技术社区成稿

**Title: Inkstone: a local Markdown workspace with source-cited conversations for macOS**

I built Inkstone to connect a small loop: organize local notes, ask a question, inspect the sources, then keep the useful answer as an editable document.

The v0.7 source preview adds persistent scoped conversations, follow-ups, answer candidates and source snapshots. Documents can contain JSON, Mermaid, mindmaps, calendars and constrained chart blocks. Retrieval uses BM25 with optional vectors and reranking; a high similarity score does not by itself grant evidence.

There is also an optional ink companion with locally stored milestones and fixed stories. It can be turned off, does not add a separate model call, and currently uses static candidate artwork.

The screenshots and step-by-step walkthrough use fictional documents and simulated responses. They demonstrate the interface, not live-model accuracy or latency. Editing and keyword search need no credentials; vectors and answers use your own compatible provider and transmit selected content to it.

This is a source preview for macOS 13+ on Apple Silicon, with a Chinese UI. You need to build it locally; signing/notarization, broader native accessibility checks and multi-day growth acceptance are still pending.

Code and fictional examples: https://github.com/raistlinsha-plus/inkstone

I'd appreciate feedback on the first import → indexing → cited-answer experience, or independently reviewed retrieval cases. If this is a direction you want to follow, a star helps people find the project.

## 短帖成稿

中文：Inkstone 的 v0.7 源码预览：本地 Markdown＋带来源的多轮问答，正文支持 JSON/脑图/图表，还可以自愿开启一只书房墨团。自己的模型 API，macOS Apple Silicon，中文界面；暂需源码构建。演示为合成资料与模拟回答。https://github.com/raistlinsha-plus/inkstone

English: Inkstone: local Markdown, cited multi-turn Q&A, and optional ink companions. Bring your own API. macOS Apple Silicon; Chinese UI; source preview, installer pending. Demo uses synthetic data. https://github.com/raistlinsha-plus/inkstone

## 建议的两周节奏

| 时间 | 动作 | 完成证据 |
| --- | --- | --- |
| 发布前 | 合并、托管 CI、预发布、About/Topics/社交卡片、匿名检查 | 目标提交检查链接、标签、源码校验和与可访问首页 |
| 第 1 天 | 在一个匹配的中文开发者社区介绍，作者在线回答 | 帖子 URL、实际问题；不在多个社区机械复制同一帖子 |
| 第 2–3 天 | 回复首次配置/导入问题，优先修正文档或复现缺陷 | Issue 与对应修订；不把尚未实现的功能写进介绍 |
| 第 4–7 天 | 发布英文技术介绍；按真实反馈分享一条改进 | 第二篇帖子 URL、前后变化与验证 |
| 第 8–14 天 | 汇总试用阻碍，决定小版本及是否具备更广泛推广条件 | 反馈分类和下一步；有可安装体验后再考虑普通用户发布渠道 |

社区发帖、Show HN/相关主题社区与 awesome 列表均需先阅读当时的规则并符合收录条件；本方案不自动发帖、不批量私信、不购买或交换 Stars。没有在本轮承诺任何社区一定接受或带来多少 Stars。

## 如何判断曝光是否有效

查询时点仓库为 0 Stars、0 forks，公开源码首发约五天，不能据此推断产品价值或未来增长。优先追踪四组实际数据：

- GitHub 独立访客、克隆、引荐站点；目前未读取私有 Traffic，基线待仓库所有者记录。
- 自愿反馈的首次成功试用人数，和卡在源码安装/模型配置/导入的人数；没有新增产品遥测。
- 有复现信息的 Issue、独立评测和外部贡献。
- Stars 增量作为关注指标，与反馈/修复一起看，不承诺转化率。

Traffic 展示过去 14 天访客/完整克隆及引荐数据，时区是 UTC；建议在第 0、7、14 天手动保存快照，避免时间窗口滚动造成误判。独立访客、克隆和 Stars 并非可逐人关联的漏斗，不将它们相除当作严格试用转化率。[GitHub Traffic 说明](https://docs.github.com/en/repositories/viewing-activity-and-data-for-your-repository/viewing-traffic-to-a-repository)。

首轮可设“收集 5–10 份可操作的外部试用反馈”为运营目标，尚非已达成结果；根据实际流量再定 Stars 目标。回复真实问题和缩短首次运行路径，会比重复宣传更直接地改善试用体验。
